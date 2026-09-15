import { describe, expect, spyOn, test } from 'bun:test';
import {
    AccountRole,
    address,
    appendTransactionMessageInstructions,
    blockhash,
    compileTransaction,
    createTransactionMessage,
    getTransactionDecoder,
    getTransactionEncoder,
    pipe,
    setTransactionMessageConfig,
    setTransactionMessageFeePayer,
    setTransactionMessageLifetimeUsingBlockhash,
    type V1TransactionConfig,
} from '@solana/kit';
import { ComputeBudgetProgram, Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { deserializeTransaction } from '../lib/solana';
import { V1Transaction } from '../lib/transaction-v1';
import { Wallet } from '../lib/wallet';
import type { ParanoidProvider } from '../lib/window';
import {
    buildInstructionTree,
    replaceRecentBlockhash,
    setupBackground,
    transactionLines,
    transactionMessageBase64,
} from './background';
import * as keypairs from './keypairs';

const payer = Keypair.generate();
const cosigner = Keypair.generate();
const lifetime = blockhash(Keypair.generate().publicKey.toBase58());

function fixture(
    dataSize = 2000,
    config: V1TransactionConfig = {
        computeUnitLimit: 30000,
        loadedAccountsDataSizeLimit: 65536,
        priorityFeeLamports: 5000n,
    }
) {
    const message = pipe(
        createTransactionMessage({ version: 1 }),
        (message) => setTransactionMessageFeePayer(address(payer.publicKey.toBase58()), message),
        (message) =>
            setTransactionMessageLifetimeUsingBlockhash({ blockhash: lifetime, lastValidBlockHeight: 100n }, message),
        (message) => setTransactionMessageConfig(config, message),
        (message) =>
            appendTransactionMessageInstructions(
                [
                    {
                        programAddress: address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
                        accounts: [
                            { address: address(cosigner.publicKey.toBase58()), role: AccountRole.READONLY_SIGNER },
                        ],
                        data: new Uint8Array(dataSize).fill(42),
                    },
                    {
                        programAddress: address(ComputeBudgetProgram.programId.toBase58()),
                        data: ComputeBudgetProgram.setComputeUnitLimit({ units: 123 }).data,
                    },
                ],
                message
            )
    );
    return new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
}

describe('V1 transaction support', () => {
    test('round-trips large transactions and preserves message bytes and co-signatures', async () => {
        const bytes = fixture();
        expect(bytes.length).toBeGreaterThan(1232);
        expect(bytes[0]).toBe(0x81);
        const transaction = deserializeTransaction(bytes) as V1Transaction;
        expect(transaction).toBeInstanceOf(V1Transaction);
        expect(transaction.serialize()).toEqual(bytes);
        const messageBytes = transaction.messageBytes;
        await transaction.sign([cosigner]);
        const cosignature = transaction.signatures[1]!.slice();
        await transaction.sign([payer]);
        expect(transaction.messageBytes).toEqual(messageBytes);
        expect(transaction.signatures[1]).toEqual(cosignature);
        for (const [index, signer] of [payer, cosigner].entries()) {
            expect(
                nacl.sign.detached.verify(messageBytes, transaction.signatures[index]!, signer.publicKey.toBytes())
            ).toBe(true);
        }
        const encoded = transaction.serialize();
        expect(encoded.slice(-128, -64)).toEqual(transaction.signatures[0]!);
        expect(encoded.slice(-64)).toEqual(cosignature);
        expect(getTransactionDecoder().decode(encoded).messageBytes).toEqual(messageBytes);
        expect(deserializeTransaction(encoded).serialize()).toEqual(encoded);
        await expect(transaction.sign([Keypair.generate()])).rejects.toThrow();
        expect(transaction.serialize()).toEqual(encoded);
    });

    test('uses exact message config fees and limits rather than no-op ComputeBudget instructions', () => {
        const transaction = new V1Transaction(
            fixture(2000, {
                computeUnitLimit: 30000,
                loadedAccountsDataSizeLimit: 65536,
                priorityFeeLamports: 9007199254740993n,
            })
        );
        const lines = transactionLines(transaction, 'Devnet');
        expect(lines).toContain('Compute unit limit: 30000 CU');
        expect(lines).toContain('Loaded accounts data size limit: 65536 bytes');
        expect(lines).toContain('Priority fee (total): 9007199254740993 lamports');
        expect(lines).toContain('Heap size: 32768 bytes');
        const tree = buildInstructionTree(transaction, transaction.message.staticAccountKeys, []);
        expect(tree).toHaveLength(2);
        expect(tree[0]!.data).toHaveLength(2000);
        expect(tree[1]!.programId).toBe(ComputeBudgetProgram.programId.toBase58());
        expect(Buffer.from(transactionMessageBase64(transaction), 'base64')).toEqual(
            Buffer.from(transaction.messageBytes)
        );
    });

    test('shows zero limits when omitted, and refreshes only the lifetime while clearing all signatures', async () => {
        const transaction = new V1Transaction(fixture(10, {}));
        expect(transactionLines(transaction, 'Sign Only')).toContain('Compute unit limit: 0 CU');
        expect(transactionLines(transaction, 'Sign Only')).toContain('Loaded accounts data size limit: 0 bytes');
        await transaction.sign([payer, cosigner]);
        const previous = transaction.messageBytes;
        const next = Keypair.generate().publicKey.toBase58();
        replaceRecentBlockhash(transaction, next);
        expect(transaction.message.recentBlockhash).toBe(next);
        expect(transaction.messageBytes).not.toEqual(previous);
        expect(transaction.signatures.every((signature) => signature.every((byte) => byte === 0))).toBe(true);
        expect(new V1Transaction(transaction.serialize()).config).toEqual({});
        await transaction.sign([payer]);
        expect(
            nacl.sign.detached.verify(transaction.messageBytes, transaction.signatures[0]!, payer.publicKey.toBytes())
        ).toBe(true);
    });

    test('accepts the 4096-byte boundary and rejects oversized, truncated, and trailing payloads', () => {
        const overhead = fixture(0).length;
        const bytes = fixture(4096 - overhead);
        expect(bytes.length).toBe(4096);
        expect(new V1Transaction(bytes).serialize()).toEqual(bytes);
        expect(() => deserializeTransaction(fixture(4097 - overhead))).toThrow();
        expect(() => deserializeTransaction(bytes.slice(0, -1))).toThrow();
        expect(() => deserializeTransaction(new Uint8Array([0x81]))).toThrow();
        const smaller = fixture(10);
        expect(() => deserializeTransaction(new Uint8Array([...smaller, 0]))).toThrow();
    });

    test('Wallet Standard advertises V1 and returns V1 bytes for single, batch, and send requests', async () => {
        const sign = async <T extends VersionedTransaction>(transaction: T) => {
            await transaction.sign([payer]);
            return transaction;
        };
        const provider = {
            publicKey: payer.publicKey,
            on() {},
            off() {},
            signTransaction: sign,
            signAllTransactions: (transactions: VersionedTransaction[]) => Promise.all(transactions.map(sign)),
            async signAndSendTransaction(transaction: VersionedTransaction) {
                await sign(transaction);
                expect(transaction.serialize()[0]).toBe(0x81);
                return { signature: '1'.repeat(64) };
            },
        } as unknown as ParanoidProvider;
        const wallet = new Wallet(provider);
        const feature = wallet.features['solana:signTransaction'];
        const send = wallet.features['solana:signAndSendTransaction'];
        expect(feature.supportedTransactionVersions).toEqual(['legacy', 0, 1]);
        expect(send.supportedTransactionVersions).toEqual(['legacy', 0, 1]);
        const input = { transaction: fixture(), account: wallet.accounts[0]!, chain: 'solana:devnet' };
        for (const inputs of [[input], [input, input]]) {
            const outputs = await feature.signTransaction(...inputs);
            expect(outputs).toHaveLength(inputs.length);
            for (const output of outputs) {
                const transaction = new V1Transaction(output.signedTransaction);
                expect(
                    nacl.sign.detached.verify(
                        transaction.messageBytes,
                        transaction.signatures[0]!,
                        payer.publicKey.toBytes()
                    )
                ).toBe(true);
            }
        }
        expect((await send.signAndSendTransaction(input))[0]!.signature).toHaveLength(64);
    });

    test('RPC simulation and broadcast encode large V1 payloads as base64', async () => {
        const calls: { method: string; params: any[] }[] = [];
        const connection = new Connection('http://localhost:8899', {
            commitment: 'confirmed',
            fetch: async (_url, options) => {
                const request = JSON.parse(options!.body as string);
                calls.push(request);
                const result =
                    request.method === 'simulateTransaction'
                        ? { context: { slot: 1 }, value: { err: null, logs: [] } }
                        : 'submitted';
                return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
            },
        });
        const transaction = new V1Transaction(fixture());
        await connection.simulateTransaction(transaction, { sigVerify: false });
        await transaction.sign([payer, cosigner]);
        await connection.sendRawTransaction(transaction.serialize());
        expect(calls.map(({ method }) => method)).toEqual(['simulateTransaction', 'sendTransaction']);
        for (const call of calls) {
            expect(call.params[1].encoding).toBe('base64');
            const bytes = new Uint8Array(Buffer.from(call.params[0], 'base64'));
            expect(bytes.length).toBeGreaterThan(1232);
            expect(new V1Transaction(bytes).messageBytes).toEqual(transaction.messageBytes);
        }
    });

    test('RPC reads decode V1 config and inline accounts with the version-one opt-in', async () => {
        const view = new V1Transaction(fixture()).message;
        let config: unknown;
        const connection = new Connection('http://localhost:8899', {
            fetch: async (_url, options) => {
                const request = JSON.parse(options!.body as string);
                config = request.params[1];
                return new Response(
                    JSON.stringify({
                        jsonrpc: '2.0',
                        id: request.id,
                        result: {
                            slot: 1,
                            blockTime: null,
                            version: 1,
                            transaction: {
                                signatures: ['1'.repeat(64), '1'.repeat(64)],
                                message: {
                                    header: view.header,
                                    accountKeys: view.staticAccountKeys.map((key) => key.toBase58()),
                                    recentBlockhash: view.recentBlockhash,
                                    transactionConfig: {
                                        computeUnitLimit: 30000,
                                        loadedAccountsDataSizeLimit: 65536,
                                        heapSize: null,
                                        priorityFee: 5000,
                                    },
                                    instructions: view.compiledInstructions.map((instruction) => ({
                                        programIdIndex: instruction.programIdIndex,
                                        accounts: instruction.accountKeyIndexes,
                                        data: bs58.encode(instruction.data),
                                    })),
                                },
                            },
                            meta: {
                                err: null,
                                fee: 15000,
                                preBalances: [20000, 0, 0, 0],
                                postBalances: [5000, 0, 0, 0],
                            },
                        },
                    })
                );
            },
        });
        const result = await connection.getTransaction('1'.repeat(64), { maxSupportedTransactionVersion: 1 });
        expect(config).toMatchObject({ maxSupportedTransactionVersion: 1 });
        const message = result!.transaction.message;
        expect(message.version).toBe(1);
        if (message.version !== 1) throw new Error('Expected V1');
        expect(message.transactionConfig.priorityFee).toBe(5000);
        expect(message.getAccountKeys().staticAccountKeys).toEqual(view.staticAccountKeys);
        expect(buildInstructionTree(new VersionedTransaction(message), message.staticAccountKeys, [])).toHaveLength(2);
    });

    test('background approvals await V1 signatures, including batches, before clearing key material', async () => {
        const originalChrome = globalThis.chrome;
        let listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0];
        const approvalSender = { id: 'paranoid', url: 'chrome-extension://paranoid/approval.html?id=test' };
        let decision = 'approve';
        const approvals: any[] = [];
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
                    listener({ type: 'approval:get', id }, approvalSender, (details) => approvals.push(details));
                    listener({ type: 'approval:resolve', id, decision }, approvalSender, () => {});
                    return {};
                },
            },
        } as unknown as typeof chrome;
        const rpc = spyOn(keypairs, 'getActiveRpc').mockResolvedValue({
            id: 'devnet',
            name: 'Devnet',
            kind: 'devnet',
            chain: 'solana:devnet',
            url: 'https://api.devnet.solana.com',
        });
        let secret = new Uint8Array();
        const signer = spyOn(keypairs, 'getActiveSigner').mockImplementation(async () => {
            secret = new Uint8Array(payer.secretKey);
            return { publicKey: payer.publicKey, secretKey: secret } as Keypair;
        });
        const genesis = spyOn(Connection.prototype, 'getGenesisHash').mockResolvedValue(
            'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'
        );
        const accounts = spyOn(Connection.prototype, 'getMultipleAccountsInfo').mockResolvedValue([
            null,
            null,
            null,
            null,
        ]);
        const simulation = spyOn(Connection.prototype, 'simulateTransaction').mockResolvedValue({
            context: { slot: 1 },
            value: { err: null, logs: [], accounts: [null, null, null, null] },
        });
        const broadcast = spyOn(Connection.prototype, 'sendRawTransaction').mockResolvedValue('submitted');
        const signing = spyOn(V1Transaction.prototype, 'sign');
        const history = spyOn(Connection.prototype, 'getTransaction').mockResolvedValue(null);
        try {
            setupBackground();
            const bytes = fixture();
            const source = new V1Transaction(bytes);
            await source.sign([cosigner]);
            signing.mockClear();
            const send = (method: string) =>
                new Promise<any>((resolve) =>
                    listener(
                        {
                            type: 'provider-request',
                            request: {
                                channel: 'paranoid:page',
                                id: 'test',
                                method,
                                params: {
                                    transaction: [...source.serialize()],
                                    transactions: [[...source.serialize()], [...source.serialize()]],
                                },
                            },
                        },
                        { tab: { url: 'https://dapp.example/' } as chrome.tabs.Tab },
                        resolve
                    )
                );
            decision = 'cancel';
            expect((await send('signTransaction')).__error).toContain('cancelled');
            expect(signing).not.toHaveBeenCalled();
            expect(broadcast).not.toHaveBeenCalled();
            decision = 'approve';
            for (const method of ['signTransaction', 'signAllTransactions', 'signAndSendTransaction']) {
                const result = await send(method);
                expect(result.__error).toBeUndefined();
                const transactions =
                    method === 'signAllTransactions'
                        ? result
                        : [method === 'signTransaction' ? result : broadcast.mock.calls[0]![0]];
                for (const bytes of transactions) {
                    const signed = new V1Transaction(new Uint8Array(bytes));
                    expect(signed.messageBytes).toEqual(source.messageBytes);
                    expect(signed.signatures[1]).toEqual(source.signatures[1]);
                    expect(
                        nacl.sign.detached.verify(signed.messageBytes, signed.signatures[0]!, payer.publicKey.toBytes())
                    ).toBe(true);
                }
                expect(secret.every((byte) => byte === 0)).toBe(true);
                const review = approvals.at(-1);
                expect(review.transactions?.[0]?.lines ?? review.lines).toContain(
                    'Priority fee (total): 5000 lamports'
                );
                expect(review.canSaveForLater).toBe(true);
            }
            expect(broadcast).toHaveBeenCalledTimes(1);
            await new Promise((resolve) =>
                listener(
                    { type: 'history:get', signature: 'test' },
                    {
                        id: 'paranoid',
                        url: 'chrome-extension://paranoid/popup.html',
                    },
                    resolve
                )
            );
            expect(history).toHaveBeenCalledWith('test', {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 1,
            });
            simulation.mockResolvedValueOnce({
                context: { slot: 1 },
                value: { err: 'MaxLoadedAccountsDataSizeExceeded', logs: [] },
            });
            const count = signing.mock.calls.length;
            expect((await send('signAndSendTransaction')).__error).toContain('Simulation failed');
            expect(signing).toHaveBeenCalledTimes(count);
            expect(broadcast).toHaveBeenCalledTimes(1);
        } finally {
            for (const spy of [rpc, signer, genesis, accounts, simulation, broadcast, signing, history])
                spy.mockRestore();
            globalThis.chrome = originalChrome;
        }
    });
});
