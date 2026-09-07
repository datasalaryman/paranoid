import { describe, expect, test } from 'bun:test';
import {
    Keypair,
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
