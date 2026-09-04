import { describe, expect, test } from 'bun:test';
import { mergeTransactionHistory, type TransactionHistoryItem } from './transaction-history';

const item = (signature: string, slot: number): TransactionHistoryItem => ({
    signature,
    slot,
    blockTime: null,
    confirmationStatus: 'confirmed',
    memo: null,
    failed: false,
});

describe('mergeTransactionHistory', () => {
    test('places the latest page before stored transactions', () => {
        expect(
            mergeTransactionHistory([item('c', 1)], [item('a', 3), item('b', 2)]).map(({ signature }) => signature)
        ).toEqual(['a', 'b', 'c']);
    });

    test('inserts an older page after its cursor', () => {
        const stored = [item('a', 5), item('b', 4), item('e', 1)];
        const incoming = [item('c', 3), item('d', 2)];

        expect(mergeTransactionHistory(stored, incoming, 'b').map(({ signature }) => signature)).toEqual([
            'a',
            'b',
            'c',
            'd',
            'e',
        ]);
    });

    test('replaces overlapping records without duplicates', () => {
        const merged = mergeTransactionHistory([item('a', 1), item('b', 1)], [item('a', 2)]);

        expect(merged.map(({ signature }) => signature)).toEqual(['a', 'b']);
        expect(merged[0]?.slot).toBe(2);
    });
});
