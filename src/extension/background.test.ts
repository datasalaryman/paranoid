import { describe, expect, test, spyOn } from 'bun:test';
import {
    Keypair,
    Connection,
    PublicKey,
    SystemProgram,
    Transaction,
    TransactionMessage,
    VersionedTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import {
    buildInstructionTree,
    calculateSolBalanceChanges,
    replaceRecentBlockhash,
    setupBackground,
    transactionMessageBase64,
    validateRequestedChain,
} from './background';
import type { ProviderRequest } from './messages';
import * as keypairs from './keypairs';

test('Send SOL restricts senders and signs only approved, unexpired transactions in the pinned context', async () => {
    const originalChrome = globalThis.chrome;
    const payer = Keypair.generate();
    const recipient = Keypair.generate().publicKey;
    const blockhash = Keypair.generate().publicKey.toBase58();
    const account = {
        name: 'payer',
        publicKey: payer.publicKey.toBase58(),
        createdAt: 0,
        encryptedSecretKey: { iv: [], ciphertext: [] },
    };
    const rpc: keypairs.ActiveRpc = {
        id: 'devnet',
        name: 'Devnet',
        kind: 'devnet',
        chain: 'solana:devnet',
        url: 'https://api.devnet.solana.com',
    };
    let listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0];
    let approvalId = '';
    let approvalReady: () => void = () => {};
    let pendingResult: Promise<unknown> | undefined;
    globalThis.chrome = {
        windows: {
            onRemoved: { addListener() {} },
            async create({ url }: { url: string }) {
                approvalId = new URL(url).searchParams.get('id')!;
                approvalReady();
                return {};
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
    } as unknown as typeof chrome;
    const activeAccount = spyOn(keypairs, 'getActiveKeypair').mockResolvedValue(account);
    const activeRpc = spyOn(keypairs, 'getActiveRpc').mockResolvedValue(rpc);
    let secret = new Uint8Array();
    const signer = spyOn(keypairs, 'getActiveSigner').mockImplementation(async () => {
        const copy = Keypair.fromSecretKey(payer.secretKey);
        secret = copy.secretKey;
        return { publicKey: copy.publicKey, secretKey: secret } as Keypair;
    });
    const genesis = spyOn(Connection.prototype, 'getGenesisHash').mockResolvedValue(
        'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'
    );
    const latest = spyOn(Connection.prototype, 'getLatestBlockhash').mockResolvedValue({
        blockhash,
        lastValidBlockHeight: 100,
    });
    const valid = spyOn(Connection.prototype, 'isBlockhashValid').mockResolvedValue({
        context: { slot: 1 },
        value: true,
    });
    const accounts = spyOn(Connection.prototype, 'getMultipleAccountsInfo').mockResolvedValue([null, null, null]);
    const simulation = spyOn(Connection.prototype, 'simulateTransaction').mockResolvedValue({
        context: { slot: 1 },
        value: { err: null, logs: [], accounts: [null, null, null] },
    });
    const broadcast = spyOn(Connection.prototype, 'sendRawTransaction').mockResolvedValue('submitted');
    const signing = spyOn(Transaction.prototype, 'partialSign');
    const spies = [activeAccount, activeRpc, signer, genesis, latest, valid, accounts, simulation, broadcast, signing];
    try {
        setupBackground();
        const sender = { id: 'paranoid', url: 'chrome-extension://paranoid/popup.html' };
        const send = (message: unknown, from: chrome.runtime.MessageSender = sender) =>
            new Promise<any>((resolve) => listener(message, from, resolve));
        const request = {
            type: 'wallet:send-sol',
            recipient: recipient.toBase58(),
            amount: '0.000000001',
            publicKey: account.publicKey,
            rpcId: rpc.id,
        };
        const tab = { ...sender, tab: {} as chrome.tabs.Tab };
        const approvalSender = { ...tab, url: 'chrome-extension://paranoid/approval.html?id=test' };
        for (const from of [
            { ...approvalSender, id: 'other' },
            { ...approvalSender, url: 'https://evil.example/approval.html' },
            { ...approvalSender, url: 'chrome-extension://paranoid/approval.html.evil' },
        ]) {
            expect((await send({ type: 'approval:get', id: 'test' }, from)).__error).toBeString();
        }
        for (const from of [tab, { id: 'other', url: sender.url }, { id: sender.id, url: 'https://evil.example' }]) {
            for (const type of ['wallet:send-sol', 'approval:get', 'approval:resolve']) {
                expect((await send({ ...request, type, decision: 'approve' }, from)).__error).toContain(
                    'only available from Paranoid'
                );
            }
        }
        for (const fields of [
            { recipient: null },
            { amount: 1 },
            { amount: '0' },
            { publicKey: 'stale' },
            { rpcId: 'stale' },
        ]) {
            expect((await send({ ...request, ...fields })).__error).toBeString();
        }
        expect(signer).not.toHaveBeenCalled();
        activeRpc.mockResolvedValue({ ...rpc, chain: null, kind: 'sign-only' });
        expect((await send(request)).__error).toContain('Select an RPC');
        activeRpc.mockResolvedValue(rpc);
        genesis.mockResolvedValueOnce('wrong-cluster');
        expect((await send(request)).__error).toContain('changed clusters');
        for (const scenario of [
            'cancel',
            'save-for-later',
            'account',
            'rpc',
            'url',
            'chain',
            'cluster',
            'expired',
            'signer',
            'send-error',
            'success',
        ]) {
            activeAccount.mockResolvedValue(account);
            activeRpc.mockResolvedValue(rpc);
            genesis.mockResolvedValue('EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
            valid.mockResolvedValue({ context: { slot: 1 }, value: true });
            signer.mockClear();
            signing.mockClear();
            broadcast.mockClear();
            const ready = new Promise<void>((resolve) => {
                approvalReady = resolve;
            });
            const result = send(request);
            pendingResult = result;
            await Promise.race([
                ready,
                result.then((response) => {
                    throw new Error(JSON.stringify(response));
                }),
            ]);
            expect(simulation).toHaveBeenCalled();
            expect(signer).not.toHaveBeenCalled();
            expect(signing).not.toHaveBeenCalled();
            expect((await send(request)).__error).toContain('already in progress');
            const details = await send({ type: 'approval:get', id: approvalId }, approvalSender);
            expect(details).toMatchObject({ title: 'Send SOL', transaction: true, canSaveForLater: false });
            expect(details.lines).toContain(`Recipient: ${recipient.toBase58()}`);
            expect(details.lines).toContain(`RPC: ${rpc.name}`);
            expect(details.lines.some((line: string) => line.includes('solana:'))).toBe(false);
            expect(details.transactionMessage).toBeString();
            expect(
                (await send({ type: 'approval:resolve', id: approvalId, decision: 'approve' }, tab)).__error
            ).toBeString();
            expect(signer).not.toHaveBeenCalled();
            if (scenario === 'account') activeAccount.mockResolvedValue(null);
            if (scenario === 'rpc') activeRpc.mockResolvedValue({ ...rpc, id: 'other' });
            if (scenario === 'url') activeRpc.mockResolvedValue({ ...rpc, url: 'https://other.example' });
            if (scenario === 'chain') activeRpc.mockResolvedValue({ ...rpc, chain: 'solana:mainnet' });
            if (scenario === 'cluster') genesis.mockResolvedValue('other-genesis');
            if (scenario === 'expired') valid.mockResolvedValue({ context: { slot: 1 }, value: false });
            if (scenario === 'signer') {
                const other = Keypair.generate();
                secret = other.secretKey;
                signer.mockResolvedValueOnce({ publicKey: other.publicKey, secretKey: secret } as Keypair);
            }
            if (scenario === 'send-error') broadcast.mockRejectedValueOnce(new Error('Preflight failed'));
            await send(
                {
                    type: 'approval:resolve',
                    id: approvalId,
                    decision: scenario === 'cancel' || scenario === 'save-for-later' ? scenario : 'approve',
                },
                approvalSender
            );
            const response = await result;
            pendingResult = undefined;
            if (scenario === 'success' || scenario === 'send-error') {
                expect(signer).toHaveBeenCalledTimes(1);
                expect(secret.every((byte) => byte === 0)).toBe(true);
                if (scenario === 'success') {
                    expect(response).toEqual({ signature: 'submitted' });
                    const [bytes, options] = broadcast.mock.calls[0]!;
                    const transaction = Transaction.from(bytes);
                    expect(transaction.verifySignatures()).toBe(true);
                    expect(transaction.recentBlockhash).toBe(blockhash);
                    expect(transactionMessageBase64(transaction)).toBe(details.transactionMessage);
                    expect(options).toEqual({ skipPreflight: false, preflightCommitment: 'confirmed' });
                } else expect(response.__error).toBe('Preflight failed');
            } else {
                expect(response.__error).toBeString();
                if (scenario === 'signer') {
                    expect(signer).toHaveBeenCalledTimes(1);
                    expect(secret.every((byte) => byte === 0)).toBe(true);
                } else expect(signer).not.toHaveBeenCalled();
                expect(signing).not.toHaveBeenCalled();
                expect(broadcast).not.toHaveBeenCalled();
            }
        }
        simulation.mockRejectedValueOnce(new Error('Simulation failed: insufficient funds'));
        signer.mockClear();
        expect((await send(request)).__error).toContain('insufficient funds');
        expect(signer).not.toHaveBeenCalled();
        expect(latest).toHaveBeenCalledTimes(12);
    } finally {
        if (pendingResult) {
            listener!(
                { type: 'approval:resolve', id: approvalId, decision: 'cancel' },
                { id: 'paranoid', url: 'chrome-extension://paranoid/popup.html' },
                () => {}
            );
            await pendingResult;
        }
        for (const spy of spies) spy.mockRestore();
        globalThis.chrome = originalChrome;
    }
});

test('RPC explorer preference handlers require extension senders and booleans, and toggles require unlocking', async () => {
    const originalChrome = globalThis.chrome;
    let listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0];
    globalThis.chrome = {
        windows: { onRemoved: { addListener() {} } },
        runtime: {
            id: 'paranoid',
            getURL: (path: string) => `chrome-extension://paranoid/${path}`,
            onMessage: {
                addListener(value: typeof listener) {
                    listener = value;
                },
            },
        },
    } as unknown as typeof chrome;
    try {
        setupBackground();
        const sender = { id: 'paranoid', url: 'chrome-extension://paranoid/popup.html' };
        const send = (message: unknown, from: chrome.runtime.MessageSender = sender) =>
            new Promise<unknown>((resolve) => listener(message, from, resolve));
        for (const type of ['wallet:update-rpc', 'wallet:set-rpc-explorer-mainnet']) {
            expect(await send({ type, explorerMainnet: true }, { ...sender, tab: {} as chrome.tabs.Tab })).toEqual({
                __error: 'Wallet management is only available from Paranoid',
            });
            for (const explorerMainnet of [undefined, null, 'false', 0, 1, {}]) {
                expect(await send({ type, explorerMainnet })).toEqual({
                    __error: 'Explorer mainnet preference must be a boolean',
                });
            }
        }
        for (const explorerMainnet of [false, true]) {
            // No URL is supplied: preference-only changes must not try to resolve an RPC chain.
            expect(await send({ type: 'wallet:set-rpc-explorer-mainnet', id: 'custom', explorerMainnet })).toEqual({
                __error: 'Wallet is locked. Open Paranoid to unlock it',
            });
        }
    } finally {
        globalThis.chrome = originalChrome;
    }
});

describe('validateRequestedChain', () => {
    const request = (method: ProviderRequest['method'], chain?: string): ProviderRequest => ({
        channel: 'paranoid:page',
        id: 'test',
        method,
        params: { chain },
    });

    test('Sign Only permits single, batch, and message signing for any cluster', () => {
        for (const method of ['signTransaction', 'signAllTransactions', 'signMessage'] as const) {
            for (const chain of ['solana:mainnet', 'solana:devnet', 'solana:testnet', 'solana:localnet', undefined]) {
                expect(() => validateRequestedChain(request(method, chain), null)).not.toThrow();
            }
        }
    });

    test('Sign Only rejects broadcasting with or without an explicit cluster', () => {
        for (const chain of ['solana:devnet', undefined]) {
            expect(() => validateRequestedChain(request('signAndSendTransaction', chain), null)).toThrow(
                'Select an RPC to sign and send transactions'
            );
        }
    });

    test('RPC selections still reject mismatched clusters', () => {
        for (const method of ['signTransaction', 'signAllTransactions', 'signAndSendTransaction'] as const) {
            expect(() => validateRequestedChain(request(method, 'solana:mainnet'), 'solana:devnet')).toThrow(
                'The dapp requested solana:mainnet, but the active RPC uses solana:devnet'
            );
            expect(() => validateRequestedChain(request(method, 'solana:devnet'), 'solana:devnet')).not.toThrow();
        }
    });
});

describe('calculateSolBalanceChanges', () => {
    test('calculates increases, decreases, unchanged balances, and account creation', () => {
        expect(
            calculateSolBalanceChanges(['payer', 'recipient', 'program', 'created'], [10, 2, 5, null], [4, 8, 5, 3])
        ).toEqual([
            { address: 'payer', lamports: -6 },
            { address: 'recipient', lamports: 6 },
            { address: 'program', lamports: 0 },
            { address: 'created', lamports: 3 },
        ]);
    });

    test('rejects a mismatched simulation response', () => {
        expect(() => calculateSolBalanceChanges(['account'], [1], [])).toThrow(
            'Simulation returned an unexpected number of accounts'
        );
    });
});

describe('replaceRecentBlockhash', () => {
    test('updates a legacy transaction and clears its signatures', () => {
        const signer = Keypair.generate();
        const transaction = new Transaction({
            feePayer: signer.publicKey,
            recentBlockhash: Keypair.generate().publicKey.toBase58(),
        });
        transaction.partialSign(signer);
        const blockhash = Keypair.generate().publicKey.toBase58();

        replaceRecentBlockhash(transaction, blockhash);

        expect(transaction.recentBlockhash).toBe(blockhash);
        expect(transaction.signatures.every(({ signature }) => signature === null)).toBe(true);
    });

    test('updates a versioned transaction and clears its signatures', () => {
        const signer = Keypair.generate();
        const message = new TransactionMessage({
            payerKey: signer.publicKey,
            recentBlockhash: Keypair.generate().publicKey.toBase58(),
            instructions: [],
        }).compileToV0Message();
        const transaction = new VersionedTransaction(message);
        transaction.sign([signer]);
        const blockhash = Keypair.generate().publicKey.toBase58();

        replaceRecentBlockhash(transaction, blockhash);

        expect(transaction.message.recentBlockhash).toBe(blockhash);
        expect(transaction.signatures.every((signature) => signature.every((byte) => byte === 0))).toBe(true);
    });
});

describe('transactionMessageBase64', () => {
    test('encodes a legacy transaction message', () => {
        const transaction = new Transaction({
            feePayer: Keypair.generate().publicKey,
            recentBlockhash: Keypair.generate().publicKey.toBase58(),
        });

        expect(Buffer.from(transactionMessageBase64(transaction), 'base64')).toEqual(
            Buffer.from(transaction.serializeMessage())
        );
    });

    test('encodes a versioned transaction message', () => {
        const message = new TransactionMessage({
            payerKey: Keypair.generate().publicKey,
            recentBlockhash: Keypair.generate().publicKey.toBase58(),
            instructions: [],
        }).compileToV0Message();
        const transaction = new VersionedTransaction(message);

        expect(Buffer.from(transactionMessageBase64(transaction), 'base64')).toEqual(Buffer.from(message.serialize()));
    });
});

describe('buildInstructionTree', () => {
    test('attaches simulated inner instructions to their outer instruction', () => {
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: Keypair.generate().publicKey,
                toPubkey: Keypair.generate().publicKey,
                lamports: 1,
            })
        );
        const tokenProgram = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

        const tree = buildInstructionTree(
            transaction,
            [],
            [
                {
                    index: 0,
                    instructions: [{ programId: tokenProgram, accounts: [], data: bs58.encode(Uint8Array.of(7)) }],
                },
            ]
        );

        expect(tree).toHaveLength(1);
        expect(tree[0]?.programId).toBe(SystemProgram.programId.toBase58());
        expect(tree[0]?.innerInstructions).toEqual([
            { programId: tokenProgram.toBase58(), data: [7], instructionName: undefined, innerInstructions: [] },
        ]);
    });

    test('resolves compiled inner instruction program indexes', () => {
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: Keypair.generate().publicKey,
                toPubkey: Keypair.generate().publicKey,
                lamports: 1,
            })
        );
        const tokenProgram = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

        const tree = buildInstructionTree(
            transaction,
            [tokenProgram],
            [
                {
                    index: 0,
                    instructions: [{ programIdIndex: 0, accounts: [], data: bs58.encode(Uint8Array.of(7)) }],
                },
            ]
        );

        expect(tree[0]?.innerInstructions[0]?.programId).toBe(tokenProgram.toBase58());
        expect(tree[0]?.innerInstructions[0]?.data).toEqual([7]);
    });
});
