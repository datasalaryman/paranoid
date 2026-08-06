import { describe, expect, test } from 'bun:test';
import { Keypair, Transaction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { replaceRecentBlockhash } from './background';

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
