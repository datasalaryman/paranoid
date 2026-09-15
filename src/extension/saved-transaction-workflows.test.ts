import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { IDBFactory } from 'fake-indexeddb';
import {
    address,
    appendTransactionMessageInstruction,
    blockhash,
    compileTransaction,
    createTransactionMessage,
    getTransactionEncoder,
    pipe,
    setTransactionMessageConfig,
    setTransactionMessageFeePayer,
    setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';
import { Connection, Keypair, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import nacl from 'tweetnacl';
import { deserializeTransaction } from '../lib/solana';
import { V1Transaction } from '../lib/transaction-v1';
import { setupBackground, transactionMessageBase64 } from './background';
import type { ApprovalDecision, ApprovalDetails, ProviderMethod, SavedTransactionSummary } from './messages';
import * as keypairs from './keypairs';
import { listSavedTransactions } from './saved-transactions';

const payer = Keypair.generate();
const recentBlockhash = Keypair.generate().publicKey.toBase58();
const nextBlockhash = Keypair.generate().publicKey.toBase58();
const program = Keypair.generate().publicKey;
const rpc: keypairs.ActiveRpc = {
    id: 'devnet',
    name: 'Devnet',
    kind: 'devnet',
    chain: 'solana:devnet',
    url: 'https://api.devnet.solana.com',
};
const account = {
    name: 'payer',
    publicKey: payer.publicKey.toBase58(),
    createdAt: 0,
    encryptedSecretKey: { iv: [], ciphertext: [] },
};

function fixture(version: 0 | 1): Uint8Array {
    if (version === 0) {
        return new VersionedTransaction(
            new TransactionMessage({
                payerKey: payer.publicKey,
                recentBlockhash,
                instructions: [
                    new TransactionInstruction({ programId: program, keys: [], data: Buffer.alloc(10, 42) }),
                ],
            }).compileToV0Message()
        ).serialize();
    }
    return new Uint8Array(
        getTransactionEncoder().encode(
            compileTransaction(
                pipe(
                    createTransactionMessage({ version: 1 }),
                    (message) => setTransactionMessageFeePayer(address(payer.publicKey.toBase58()), message),
                    (message) =>
                        setTransactionMessageLifetimeUsingBlockhash(
                            { blockhash: blockhash(recentBlockhash), lastValidBlockHeight: 100n },
                            message
                        ),
                    (message) =>
                        setTransactionMessageConfig(
                            { computeUnitLimit: 30000, loadedAccountsDataSizeLimit: 65536, priorityFeeLamports: 5000n },
                            message
                        ),
                    (message) =>
                        appendTransactionMessageInstruction(
                            { programAddress: address(program.toBase58()), data: new Uint8Array(2000).fill(42) },
                            message
                        )
                )
            )
        )
    );
}

describe('V0/V1 saved-transaction workflow parity', () => {
    let originalChrome: typeof chrome;
    let originalIndexedDB: PropertyDescriptor | undefined;
    let listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0];
    let decision: ApprovalDecision;
    let approvals: ApprovalDetails[];
    let signed: VersionedTransaction[];
    let secrets: Uint8Array[];
    let spies: Array<{ mockRestore(): void }>;
    let activeRpc: ReturnType<typeof spyOn<typeof keypairs, 'getActiveRpc'>>;
    let activeAccount: ReturnType<typeof spyOn<typeof keypairs, 'getActiveKeypair'>>;
    let validity: ReturnType<typeof spyOn<Connection, 'isBlockhashValid'>>;
    let simulation: ReturnType<typeof spyOn<Connection, 'simulateTransaction'>>;
    let broadcast: ReturnType<typeof spyOn<Connection, 'sendRawTransaction'>>;
    let genesis: ReturnType<typeof spyOn<Connection, 'getGenesisHash'>>;
    let submittedUrls: string[];
    const popup = { id: 'paranoid', url: 'chrome-extension://paranoid/popup.html' };
    const approvalPage = { id: 'paranoid', url: 'chrome-extension://paranoid/approval.html?id=test' };

    const send = (message: unknown, sender: chrome.runtime.MessageSender = popup): Promise<any> =>
        new Promise((resolve) => listener(message, sender, resolve));
    const provider = (method: ProviderMethod, params: unknown) =>
        send(
            {
                type: 'provider-request',
                request: { channel: 'paranoid:page', id: crypto.randomUUID(), method, params },
            },
            { tab: { url: 'https://dapp.example/' } as chrome.tabs.Tab }
        );
    const action = (type: string, id?: string, extra = {}) =>
        send({ type: `saved-transactions:${type}`, id, ...extra });

    beforeEach(() => {
        originalChrome = globalThis.chrome;
        originalIndexedDB = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
        Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: new IDBFactory() });
        decision = 'save-for-later';
        approvals = [];
        signed = [];
        secrets = [];
        submittedUrls = [];
        globalThis.chrome = {
            storage: {
                local: {
                    async get() {
                        return { trustedOrigins: ['https://dapp.example'] };
                    },
                },
            },
            runtime: {
                id: 'paranoid',
                getURL: (path: string) => `chrome-extension://paranoid/${path}`,
                onMessage: {
                    addListener(value: typeof listener) {
                        listener = value;
                    },
                },
            },
            windows: {
                onRemoved: { addListener() {} },
                async create({ url }: { url: string }) {
                    const id = new URL(url).searchParams.get('id')!;
                    approvals.push(await send({ type: 'approval:get', id }, approvalPage));
                    await send({ type: 'approval:resolve', id, decision }, approvalPage);
                    return {};
                },
            },
        } as unknown as typeof chrome;
        activeRpc = spyOn(keypairs, 'getActiveRpc').mockResolvedValue(rpc);
        activeAccount = spyOn(keypairs, 'getActiveKeypair').mockResolvedValue(account);
        const signer = spyOn(keypairs, 'getActiveSigner').mockImplementation(async () => {
            const secretKey = new Uint8Array(payer.secretKey);
            secrets.push(secretKey);
            return { publicKey: payer.publicKey, secretKey } as Keypair;
        });
        genesis = spyOn(Connection.prototype, 'getGenesisHash').mockResolvedValue(
            'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'
        );
        const accounts = spyOn(Connection.prototype, 'getMultipleAccountsInfo').mockResolvedValue([null, null]);
        simulation = spyOn(Connection.prototype, 'simulateTransaction').mockResolvedValue({
            context: { slot: 1 },
            value: { err: null, logs: [], accounts: [null, null] },
        });
        validity = spyOn(Connection.prototype, 'isBlockhashValid').mockResolvedValue({
            context: { slot: 1 },
            value: true,
        });
        const latest = spyOn(Connection.prototype, 'getLatestBlockhash').mockResolvedValue({
            blockhash: nextBlockhash,
            lastValidBlockHeight: 200,
        });
        broadcast = spyOn(Connection.prototype, 'sendRawTransaction').mockImplementation(async function () {
            submittedUrls.push(this.rpcEndpoint);
            return 'submitted';
        });
        const signV0 = VersionedTransaction.prototype.sign;
        const signV1 = V1Transaction.prototype.sign;
        const signingV0 = spyOn(VersionedTransaction.prototype, 'sign').mockImplementation(function (signers) {
            signV0.call(this, signers);
            signed.push(this);
        });
        const signingV1 = spyOn(V1Transaction.prototype, 'sign').mockImplementation(async function (signers) {
            await signV1.call(this, signers);
            signed.push(this);
        });
        spies = [
            activeRpc,
            activeAccount,
            signer,
            genesis,
            accounts,
            simulation,
            validity,
            latest,
            broadcast,
            signingV0,
            signingV1,
        ];
        setupBackground();
    });

    afterEach(() => {
        spies.forEach((spy) => spy.mockRestore());
        globalThis.chrome = originalChrome;
        if (originalIndexedDB) Object.defineProperty(globalThis, 'indexedDB', originalIndexedDB);
        else Reflect.deleteProperty(globalThis, 'indexedDB');
    });

    for (const version of [0, 1] as const) {
        for (const method of ['signTransaction', 'signAndSendTransaction'] as const) {
            test(`V${version} ${method}: save, review, reorder, pin, expire, refresh, retry, sign and remove`, async () => {
                const bytes = fixture(version);
                const original = deserializeTransaction(bytes);
                const options = { maxRetries: 3, preflightCommitment: 'confirmed' };
                const result = await provider(method, { transaction: [...bytes], options });
                expect(result.__error).toBe('Transaction saved for later');
                expect(approvals[0]).toMatchObject({ transaction: true, canSaveForLater: true });
                expect(signed).toHaveLength(0);
                expect(broadcast).not.toHaveBeenCalled();
                const stored = (await listSavedTransactions(account.publicKey, rpc.id))[0]!;
                expect(stored.transaction).toEqual([...bytes]);
                expect(stored.method).toBe(method);
                if (method === 'signAndSendTransaction') expect(stored.options).toEqual(options);

                // Reads and actions use the same account/RPC scope as saving.
                activeRpc.mockResolvedValue({ ...rpc, id: 'other-rpc' });
                expect(await action('list')).toEqual([]);
                activeRpc.mockResolvedValue(rpc);
                activeAccount.mockResolvedValue({ ...account, publicKey: Keypair.generate().publicKey.toBase58() });
                expect(await action('list')).toEqual([]);
                activeAccount.mockResolvedValue(account);

                const review: SavedTransactionSummary = await action('get', stored.id);
                expect(review.transactionMessage).toBe(transactionMessageBase64(original));
                expect(review.expiredBlockhash).toBe(false);
                expect(review.balanceChanges).toHaveLength(2);
                expect(review.instructionTree![0]!.data).toHaveLength(version === 1 ? 2000 : 10);
                expect(review.lines).toContain(`Version: ${version}`);
                if (version === 1) expect(review.lines).toContain('Priority fee (total): 5000 lamports');

                await provider(method, { transaction: [...bytes], options });
                const other = (await listSavedTransactions(account.publicKey, rpc.id))[0]!;
                expect((await action('list'))[0].id).toBe(other.id);
                expect(await action('save-for-later', stored.id)).toBe(true);
                expect((await action('list'))[0].id).toBe(stored.id);
                expect(await action('set-pinned', stored.id, { pinned: true })).toBe(true);
                expect((await action('list'))[0]).toMatchObject({ id: stored.id, pinned: true });

                validity.mockResolvedValue({ context: { slot: 1 }, value: false });
                const before = simulation.mock.calls.length;
                expect((await action('get', stored.id)).expiredBlockhash).toBe(true);
                expect(simulation.mock.calls.length).toBe(before);
                expect(await action('refresh-blockhash', stored.id)).toBe(true);
                const refreshed = (await listSavedTransactions(account.publicKey, rpc.id)).find(
                    ({ id }) => id === stored.id
                )!;
                const refreshedTransaction = deserializeTransaction(
                    new Uint8Array(refreshed.transaction)
                ) as VersionedTransaction;
                expect(refreshedTransaction.version).toBe(version);
                expect(refreshedTransaction.message.recentBlockhash).toBe(nextBlockhash);
                expect(
                    refreshedTransaction.signatures.every((signature) => signature.every((byte) => byte === 0))
                ).toBe(true);
                expect(refreshed.pinned).toBe(true);
                if (version === 1)
                    expect((refreshedTransaction as V1Transaction).config).toEqual((original as V1Transaction).config);
                validity.mockResolvedValue({ context: { slot: 1 }, value: true });
                const refreshedReview = await action('get', stored.id);
                expect(refreshedReview.transactionMessage).toBe(transactionMessageBase64(refreshedTransaction));
                expect(refreshedReview.transactionMessage).not.toBe(review.transactionMessage);

                // A failed fresh simulation keeps the record reviewable with its prior details.
                simulation.mockRejectedValueOnce(new Error('RPC unavailable'));
                const staleReview = await action('get', stored.id);
                expect(staleReview.simulationError).toBe('RPC unavailable');
                expect(staleReview.lines).toEqual(review.lines);
                broadcast.mockRejectedValueOnce(new Error('Send failed'));
                expect((await action('sign', stored.id)).__error).toBe('Send failed');
                expect(
                    (await listSavedTransactions(account.publicKey, rpc.id)).find(({ id }) => id === stored.id)
                ).not.toHaveProperty('processingAt');
                expect(await action('sign', stored.id)).toEqual({ signature: 'submitted' });
                const signedTransaction = signed.at(-1)!;
                const message = Buffer.from(transactionMessageBase64(signedTransaction), 'base64');
                expect(
                    nacl.sign.detached.verify(message, signedTransaction.signatures[0]!, payer.publicKey.toBytes())
                ).toBe(true);
                expect(transactionMessageBase64(signedTransaction)).toBe(refreshedReview.transactionMessage);
                expect(broadcast.mock.calls.at(-1)![0]).toEqual(signedTransaction.serialize());
                expect(broadcast.mock.calls.at(-1)![1]).toEqual(
                    method === 'signAndSendTransaction' ? options : undefined
                );
                expect(submittedUrls.at(-1)).toBe(rpc.url);
                expect(simulation.mock.calls.at(-1)![1]).toEqual({ commitment: 'confirmed', sigVerify: true });
                expect(secrets.every((secret) => secret.every((byte) => byte === 0))).toBe(true);
                expect(
                    (await action('list')).find((item: SavedTransactionSummary) => item.id === stored.id)
                ).toMatchObject({ pinned: true });
                expect(await action('set-pinned', stored.id, { pinned: false })).toBe(true);
                await action('sign', stored.id);
                expect((await action('list')).map((item: SavedTransactionSummary) => item.id)).toEqual([other.id]);
                await action('set-pinned', other.id, { pinned: true });
                expect(await action('remove', other.id)).toBe(true);
                expect(await action('list')).toEqual([]);
            });
        }
    }

    test.each([
        [0, 0],
        [1, 1],
        [0, 1],
    ] as const)('saves an entire V%s/V%s batch unsigned in request order', async (first, second) => {
        const bytes = [fixture(first), fixture(second)];
        const result = await provider('signAllTransactions', { transactions: bytes.map((bytes) => [...bytes]) });
        expect(result.__error).toBe('Transactions saved for later');
        expect(signed).toHaveLength(0);
        expect(broadcast).not.toHaveBeenCalled();
        expect(approvals[0]).toMatchObject({ transaction: true, canSaveForLater: true });
        expect(approvals[0]!.transactions).toHaveLength(2);
        expect(simulation).not.toHaveBeenCalled();
        expect(approvals[0]!.transactions![0]!.lines).toContain('Batch signing: transactions are not simulated.');
        const stored = await listSavedTransactions(account.publicKey, rpc.id);
        expect(stored.map(({ transaction }) => transaction)).toEqual(bytes.map((bytes) => [...bytes]));
        expect(stored.map(({ method }) => method)).toEqual(['signTransaction', 'signTransaction']);
        for (const [index, item] of stored.entries()) {
            const review = await action('get', item.id);
            expect(review.transactionMessage).toBe(approvals[0]!.transactions![index]!.transactionMessage);
            expect(review.instructionTree).toEqual(approvals[0]!.transactions![index]!.instructionTree);
            expect(await action('sign', item.id)).toEqual({ signature: 'submitted' });
        }
        expect(signed).toHaveLength(2);
        expect(broadcast).toHaveBeenCalledTimes(2);
        expect(submittedUrls).toEqual([rpc.url, rpc.url]);
        expect(await action('list')).toEqual([]);
    });

    test.each(['sign-only', 'devnet', 'custom'] as const)(
        'fresh single and batch signing in %s returns transactions to the dapp without sending',
        async (kind) => {
            const selected: keypairs.ActiveRpc =
                kind === 'sign-only'
                    ? { ...rpc, id: 'sign-only', kind, chain: null }
                    : kind === 'custom'
                      ? { ...rpc, id: 'custom', kind, chain: 'solana:mainnet', url: 'https://fork.example/rpc' }
                      : rpc;
            activeRpc.mockResolvedValue(selected);
            decision = 'approve';
            const verify = (bytes: number[], original: Uint8Array) => {
                const transaction = deserializeTransaction(new Uint8Array(bytes)) as VersionedTransaction;
                const message = Buffer.from(transactionMessageBase64(transaction), 'base64');
                expect(transactionMessageBase64(transaction)).toBe(
                    transactionMessageBase64(deserializeTransaction(original))
                );
                expect(nacl.sign.detached.verify(message, transaction.signatures[0]!, payer.publicKey.toBytes())).toBe(
                    true
                );
            };
            const originals = [fixture(0), fixture(1)];
            for (const bytes of originals) {
                verify(
                    await provider('signTransaction', {
                        transaction: [...bytes],
                        chain: selected.chain ?? 'solana:mainnet',
                    }),
                    bytes
                );
            }
            const batch = await provider('signAllTransactions', {
                transactions: originals.map((bytes) => [...bytes]),
                chain: selected.chain ?? 'solana:mainnet',
            });
            expect(batch).toHaveLength(2);
            batch.forEach((bytes: number[], index: number) => verify(bytes, originals[index]!));
            expect(broadcast).not.toHaveBeenCalled();
            expect(await listSavedTransactions(account.publicKey, selected.id)).toEqual([]);
        }
    );

    test('saved V1 from signAllTransactions submits to the selected custom RPC', async () => {
        const custom: keypairs.ActiveRpc = {
            ...rpc,
            id: 'custom',
            kind: 'custom',
            chain: 'solana:mainnet',
            url: 'https://fork.example/rpc',
        };
        activeRpc.mockResolvedValue(custom);
        genesis.mockResolvedValue('custom-fork-genesis');
        expect(
            (await provider('signAllTransactions', { transactions: [[...fixture(1)]], chain: 'solana:mainnet' }))
                .__error
        ).toBe('Transactions saved for later');
        const stored = (await listSavedTransactions(account.publicKey, custom.id))[0]!;
        expect(stored.method).toBe('signTransaction');
        expect(broadcast).not.toHaveBeenCalled();
        expect(await action('sign', stored.id)).toEqual({ signature: 'submitted' });
        expect(submittedUrls).toEqual([custom.url]);
        expect((broadcast.mock.calls[0]![0] as Uint8Array)[0]).toBe(0x81);
        expect(await listSavedTransactions(account.publicKey, custom.id)).toEqual([]);
    });

    test.each([0, 1] as const)(
        'failed simulation of saved V%s prevents sending and keeps the request retryable',
        async (version) => {
            await provider('signTransaction', { transaction: [...fixture(version)] });
            const stored = (await listSavedTransactions(account.publicKey, rpc.id))[0]!;
            simulation.mockResolvedValueOnce({
                context: { slot: 1 },
                value: { err: 'MaxLoadedAccountsDataSizeExceeded', logs: [] },
            });
            expect((await action('sign', stored.id)).__error).toContain('Simulation failed');
            expect(broadcast).not.toHaveBeenCalled();
            expect((await listSavedTransactions(account.publicKey, rpc.id))[0]).toEqual(stored);
            expect(await action('sign', stored.id)).toEqual({ signature: 'submitted' });
            expect(broadcast).toHaveBeenCalledTimes(1);
        }
    );

    test('cancelling a mixed batch signs and saves nothing', async () => {
        decision = 'cancel';
        expect(
            (await provider('signAllTransactions', { transactions: [[...fixture(0)], [...fixture(1)]] })).__error
        ).toContain('cancelled');
        expect(signed).toHaveLength(0);
        expect(await action('list')).toEqual([]);
    });

    test('Sign Only has the same save restrictions for V0, V1, and mixed batches', async () => {
        activeRpc.mockResolvedValue({ ...rpc, id: 'sign-only', kind: 'sign-only', chain: null });
        decision = 'approve';
        for (const version of [0, 1] as const) {
            const result = await provider('signTransaction', { transaction: [...fixture(version)] });
            expect(result.__error).toBeUndefined();
            expect(approvals.at(-1)!.canSaveForLater).toBe(false);
        }
        decision = 'save-for-later';
        expect(
            (await provider('signAllTransactions', { transactions: [[...fixture(0)], [...fixture(1)]] })).__error
        ).toContain('Sign Only');
        expect(approvals.at(-1)!.canSaveForLater).toBe(false);
        expect(simulation).not.toHaveBeenCalled();
        expect(signed).toHaveLength(2);
        expect(await listSavedTransactions(account.publicKey, 'sign-only')).toEqual([]);
    });
});
