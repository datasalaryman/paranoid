import { describe, expect, test } from 'bun:test';
import {
    Keypair,
    SystemProgram,
    Transaction,
    TransactionMessage,
    VersionedTransaction,
} from '@solana/web3.js';
import nacl from 'tweetnacl';
import { signerFromSecretKey } from './signer';

describe('signerFromSecretKey', () => {
    test('keeps message signatures valid after decrypted bytes are cleared', () => {
        const original = Keypair.generate();
        const decrypted = original.secretKey;
        const signer = signerFromSecretKey(decrypted);
        decrypted.fill(0);
        const message = new TextEncoder().encode('paranoid signing regression');

        const signature = nacl.sign.detached(message, signer.secretKey);

        expect(nacl.sign.detached.verify(message, signature, signer.publicKey.toBytes())).toBe(true);
    });

    test('keeps legacy and versioned transaction signatures valid after decrypted bytes are cleared', () => {
        const original = Keypair.generate();
        const decrypted = original.secretKey;
        const signer = signerFromSecretKey(decrypted);
        decrypted.fill(0);
        const recentBlockhash = Keypair.generate().publicKey.toBase58();
        const instruction = SystemProgram.transfer({
            fromPubkey: signer.publicKey,
            toPubkey: Keypair.generate().publicKey,
            lamports: 1,
        });

        const legacy = new Transaction({ feePayer: signer.publicKey, recentBlockhash }).add(instruction);
        legacy.partialSign(signer);

        const message = new TransactionMessage({
            payerKey: signer.publicKey,
            recentBlockhash,
            instructions: [instruction],
        }).compileToV0Message();
        const versioned = new VersionedTransaction(message);
        versioned.sign([signer]);

        expect(legacy.verifySignatures()).toBe(true);
        expect(nacl.sign.detached.verify(message.serialize(), versioned.signatures[0]!, signer.publicKey.toBytes())).toBe(
            true
        );
    });
});
