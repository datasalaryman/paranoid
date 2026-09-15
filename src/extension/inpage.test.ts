import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import {
    AccountRole,
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
import {
    Keypair,
    SystemProgram,
    Transaction,
    TransactionInstruction,
    TransactionMessage,
    VersionedTransaction,
} from '@solana/web3.js';
import type { WindowRegisterWalletEvent } from '@wallet-standard/base';
import nacl from 'tweetnacl';
import { Wallet } from '../lib/wallet';
import type { ParanoidProvider } from '../lib/window';
import { V1Transaction } from '../lib/transaction-v1';
import { setupBackground, transactionMessageBase64 } from './background';
import { setupContent } from './content';
import { setupInpage } from './inpage';
import * as keypairs from './keypairs';

const payer = Keypair.generate();
const cosigner = Keypair.generate();
const lifetime = Keypair.generate().publicKey.toBase58();

// A caller-owned V1 class with writable message methods, as in web3.js 3.x.
// These methods must remain available after crossing the extension boundary.
class AppV1Transaction extends V1Transaction {
    constructor(bytes: Uint8Array) {
        super(bytes);
        this.message.serialize = () => this.messageBytes;
    }

    static override deserialize(bytes: Uint8Array): AppV1Transaction {
        return new AppV1Transaction(bytes);
    }
}

// Models the asynchronous legacy serialization contract introduced in web3.js 3.x.
class AsyncAppTransaction {
    constructor(readonly transaction: Transaction) {}

    async serialize(options?: Parameters<Transaction['serialize']>[0]) {
        return this.transaction.serialize(options);
    }

    static from(bytes: Uint8Array): AsyncAppTransaction {
        return new AsyncAppTransaction(Transaction.from(bytes));
    }
}

function v1(): AppV1Transaction {
    return new AppV1Transaction(
        new Uint8Array(
            getTransactionEncoder().encode(
                compileTransaction(
                    pipe(
                        createTransactionMessage({ version: 1 }),
                        (message) => setTransactionMessageFeePayer(address(payer.publicKey.toBase58()), message),
                        (message) =>
                            setTransactionMessageLifetimeUsingBlockhash(
                                { blockhash: blockhash(lifetime), lastValidBlockHeight: 100n },
                                message
                            ),
                        (message) =>
                            setTransactionMessageConfig(
                                {
                                    computeUnitLimit: 30000,
                                    loadedAccountsDataSizeLimit: 65536,
                                    priorityFeeLamports: 5000n,
                                },
                                message
                            ),
                        (message) =>
                            appendTransactionMessageInstruction(
                                {
                                    programAddress: address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
                                    accounts: [
                                        {
                                            address: address(cosigner.publicKey.toBase58()),
                                            role: AccountRole.READONLY_SIGNER,
                                        },
                                    ],
                                    data: new Uint8Array(2000).fill(42),
                                },
                                message
                            )
                    )
                )
            )
        )
    );
}

function v0(): VersionedTransaction {
    return new VersionedTransaction(
        new TransactionMessage({
            payerKey: payer.publicKey,
            recentBlockhash: lifetime,
            instructions: [
                new TransactionInstruction({ programId: SystemProgram.programId, keys: [], data: Buffer.from([1]) }),
            ],
        }).compileToV0Message()
    );
}

class Page extends EventTarget {
    paranoid!: ParanoidProvider;

    postMessage(data: unknown): void {
        const copy = structuredClone(data);
        queueMicrotask(() => {
            const event = new Event('message');
            Object.defineProperties(event, { data: { value: copy }, source: { value: this } });
            this.dispatchEvent(event);
        });
    }
}

describe('inpage → content → background → app batch interoperability', () => {
    let previousWindow: PropertyDescriptor | undefined;
    let previousChrome: typeof chrome;
    let page: Page;
    let wallet: Wallet;
    let spies: Array<{ mockRestore(): void }>;

    beforeEach(() => {
        previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
        previousChrome = globalThis.chrome;
        page = new Page();
        Object.defineProperty(globalThis, 'window', { configurable: true, value: page });
        page.addEventListener('wallet-standard:register-wallet', (event) => {
            (event as WindowRegisterWalletEvent).detail({
                register(value) {
                    wallet = value as Wallet;
                    return () => {};
                },
            });
        });
        let listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0];
        const approvalSender = { id: 'paranoid', url: 'chrome-extension://paranoid/approval.html?id=test' };
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
                sendMessage(message: unknown) {
                    return new Promise((resolve) =>
                        listener(message, { tab: { url: 'https://dapp.example/' } as chrome.tabs.Tab }, resolve)
                    );
                },
            },
            windows: {
                onRemoved: { addListener() {} },
                async create({ url }: { url: string }) {
                    const id = new URL(url).searchParams.get('id')!;
                    listener({ type: 'approval:resolve', id, decision: 'approve' }, approvalSender, () => {});
                    return {};
                },
            },
        } as unknown as typeof chrome;
        const rpc = spyOn(keypairs, 'getActiveRpc').mockResolvedValue({
            id: 'sign-only',
            name: 'Sign Only',
            kind: 'sign-only',
            chain: null,
            url: '',
        });
        const signer = spyOn(keypairs, 'getActiveSigner').mockImplementation(
            async () =>
                ({
                    publicKey: payer.publicKey,
                    secretKey: new Uint8Array(payer.secretKey),
                }) as Keypair
        );
        spies = [rpc, signer];
        setupBackground();
        setupContent();
        setupInpage();
    });

    afterEach(() => {
        spies.forEach((spy) => spy.mockRestore());
        globalThis.chrome = previousChrome;
        if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
        else Reflect.deleteProperty(globalThis, 'window');
    });

    test('returns the app V1 class, writable message APIs, unchanged messages and preserved co-signatures', async () => {
        const inputs = [v1(), v1()];
        for (const input of inputs) await input.sign([cosigner]);
        const before = inputs.map((input) => input.serialize());
        const outputs = await page.paranoid.signAllTransactions(inputs);
        expect(outputs).toHaveLength(2);
        for (const [index, output] of outputs.entries()) {
            expect(output).toBeInstanceOf(AppV1Transaction);
            expect(output.message.serialize()).toEqual(inputs[index]!.message.serialize());
            expect(output.signatures[1]).toEqual(inputs[index]!.signatures[1]);
            expect(output.serialize().length).toBeGreaterThan(1232);
            expect(
                nacl.sign.detached.verify(output.message.serialize(), output.signatures[0]!, payer.publicKey.toBytes())
            ).toBe(true);
            expect(inputs[index]!.serialize()).toEqual(before[index]!);
        }
        const single = await page.paranoid.signTransaction(inputs[0]!);
        expect(single).toBeInstanceOf(AppV1Transaction);
        expect(single.message.serialize()).toEqual(inputs[0]!.message.serialize());
    });

    test('awaits caller-side asynchronous legacy serialization for single and batch signing', async () => {
        const makeTransaction = () =>
            new AsyncAppTransaction(
                new Transaction({ feePayer: payer.publicKey, recentBlockhash: lifetime }).add(
                    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: cosigner.publicKey, lamports: 1 })
                )
            );
        const inputs = [makeTransaction(), makeTransaction()];
        const outputs = (await page.paranoid.signAllTransactions(
            inputs as unknown as Transaction[]
        )) as unknown as AsyncAppTransaction[];
        for (const [index, output] of outputs.entries()) {
            expect(output).toBeInstanceOf(AsyncAppTransaction);
            expect(output.transaction.verifySignatures()).toBe(true);
            expect(output.transaction.serializeMessage()).toEqual(inputs[index]!.transaction.serializeMessage());
        }
        const output = (await page.paranoid.signTransaction(
            makeTransaction() as unknown as Transaction
        )) as unknown as AsyncAppTransaction;
        expect(output).toBeInstanceOf(AsyncAppTransaction);
        expect(output.transaction.verifySignatures()).toBe(true);
    });

    test('Wallet Standard mixed V0/V1 batches return valid wire bytes through the complete bridge', async () => {
        await wallet.features['standard:connect'].connect();
        const inputs = [v0(), v1()];
        const encoded = inputs.map((transaction) => transaction.serialize());
        const outputs = await wallet.features['solana:signTransaction'].signTransaction(
            ...encoded.map((transaction) => ({
                transaction,
                account: wallet.accounts[0]!,
                chain: 'solana:devnet',
            }))
        );
        expect(outputs).toHaveLength(2);
        for (const [index, output] of outputs.entries()) {
            const signed =
                index === 0
                    ? VersionedTransaction.deserialize(output.signedTransaction)
                    : new V1Transaction(output.signedTransaction);
            const message = Buffer.from(transactionMessageBase64(signed), 'base64');
            expect(transactionMessageBase64(signed)).toBe(transactionMessageBase64(inputs[index]!));
            expect(nacl.sign.detached.verify(message, signed.signatures[0]!, payer.publicKey.toBytes())).toBe(true);
            expect(inputs[index]!.serialize()).toEqual(encoded[index]!);
        }
    });
});
