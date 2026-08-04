import { describe, expect, test } from 'bun:test';
import { keypairFromMnemonic } from './mnemonic';

describe('keypairFromMnemonic', () => {
    test('matches the default solana-keygen derivation', () => {
        const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

        expect(keypairFromMnemonic(mnemonic).publicKey.toBase58()).toBe(
            'EHqmfkN89RJ7Y33CXM6uCzhVeuywHoJXZZLszBHHZy7o'
        );
    });
});
