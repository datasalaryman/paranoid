import { describe, expect, test } from 'bun:test';
import { Keypair, PublicKey } from '@solana/web3.js';
import { parseSolAmount, validateSolRecipient } from './send-sol';

describe('SOL send validation', () => {
    test('accepts on-curve addresses and rejects malformed addresses and PDAs', () => {
        const address = Keypair.generate().publicKey;
        expect(validateSolRecipient(` ${address.toBase58()} `).equals(address)).toBe(true);
        const [pda] = PublicKey.findProgramAddressSync([], address);
        expect(() => validateSolRecipient(pda.toBase58())).toThrow('on curve');
        for (const value of ['', 'invalid', '111', null, 123]) {
            expect(() => validateSolRecipient(value)).toThrow('valid Solana address');
        }
    });

    test('converts decimal amounts to exact lamports', () => {
        expect(parseSolAmount('0.000000001')).toBe(1n);
        expect(parseSolAmount('.5')).toBe(500_000_000n);
        expect(parseSolAmount(' 1.123456789 ')).toBe(1_123_456_789n);
        expect(parseSolAmount('18446744073.709551615')).toBe(18_446_744_073_709_551_615n);
    });

    test('rejects invalid numeric syntax, precision, zero, and overflow', () => {
        for (const value of [
            '',
            'NaN',
            'Infinity',
            '1e-9',
            '-1',
            '+1',
            '1,000',
            '1.',
            '0',
            '0.000000000',
            '0.0000000001',
            '1.0000000000',
            '18446744073.709551616',
            null,
            1,
        ]) {
            expect(() => parseSolAmount(value)).toThrow();
        }
    });
});
