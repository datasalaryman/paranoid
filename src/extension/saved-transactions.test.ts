import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
    claimSavedTransaction,
    completeSavedTransaction,
    listSavedTransactions,
    refreshSavedTransaction,
    removeSavedTransaction,
    saveTransaction,
    setSavedTransactionPinned,
    type SavedTransaction,
} from './saved-transactions';

const publicKey = 'wallet';
const rpcId = 'devnet';
const input = {
    origin: 'https://example.com',
    title: 'Saved transaction',
    lines: ['Transfer SOL'],
    transaction: [1, 2, 3],
    method: 'signTransaction' as const,
};

describe('saved transaction pinning', () => {
    let originalIndexedDB: PropertyDescriptor | undefined;

    beforeEach(() => {
        originalIndexedDB = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
        const records = new Map<string, { scope: string; transactions: SavedTransaction[] }>();
        // Only the existing-store success path is needed. Clone both ways like IndexedDB,
        // so mutating a returned record cannot accidentally persist changes in these tests.
        const database = {
            close() {},
            transaction() {
                const transaction = {
                    oncomplete: undefined as (() => void) | undefined,
                    objectStore: () => ({
                        get(key: string) {
                            const request = {
                                result: structuredClone(records.get(key)),
                                onsuccess: undefined as (() => void) | undefined,
                            };
                            queueMicrotask(() => request.onsuccess?.());
                            return request;
                        },
                        put(value: { scope: string; transactions: SavedTransaction[] }) {
                            records.set(value.scope, structuredClone(value));
                            queueMicrotask(() => transaction.oncomplete?.());
                        },
                    }),
                };
                return transaction;
            },
        };
        Object.defineProperty(globalThis, 'indexedDB', {
            configurable: true,
            value: {
                open() {
                    const request = { result: database, onsuccess: undefined as (() => void) | undefined };
                    queueMicrotask(() => request.onsuccess?.());
                    return request;
                },
            },
        });
    });

    afterEach(() => {
        if (originalIndexedDB) Object.defineProperty(globalThis, 'indexedDB', originalIndexedDB);
        else Reflect.deleteProperty(globalThis, 'indexedDB');
    });

    test('persists pin and unpin changes across reads without changing other records or scopes', async () => {
        const saved = await saveTransaction(publicKey, rpcId, input);
        const other = await saveTransaction(publicKey, rpcId, input);
        const otherWallet = await saveTransaction('other-wallet', rpcId, input);
        const otherRpc = await saveTransaction(publicKey, 'mainnet', input);

        await setSavedTransactionPinned(publicKey, rpcId, saved.id, true);
        const listed = await listSavedTransactions(publicKey, rpcId);
        expect(listed).toEqual([{ ...saved, pinned: true }, other]);
        listed[0]!.pinned = false;
        expect(await listSavedTransactions(publicKey, rpcId)).toEqual([{ ...saved, pinned: true }, other]);

        await setSavedTransactionPinned(publicKey, rpcId, saved.id, false);
        expect(await listSavedTransactions(publicKey, rpcId)).toEqual([other, { ...saved, pinned: false }]);
        expect(await listSavedTransactions('other-wallet', rpcId)).toEqual([otherWallet]);
        expect(await listSavedTransactions(publicKey, 'mainnet')).toEqual([otherRpc]);
    });

    test('lists pinned first stably and fresh/expired UI filters retain backend order', async () => {
        const titles = [
            'pinned-fresh-old',
            'pinned-expired-old',
            'unpinned-fresh-old',
            'unpinned-expired-old',
            'pinned-fresh-new',
            'pinned-expired-new',
            'unpinned-fresh-new',
            'unpinned-expired-new',
        ];
        const saved: SavedTransaction[] = [];
        for (const title of titles) saved.push(await saveTransaction(publicKey, rpcId, { ...input, title }));
        for (const transaction of saved.filter(({ title }) => title.startsWith('pinned-'))) {
            await setSavedTransactionPinned(publicKey, rpcId, transaction.id, true);
        }

        const listed = await listSavedTransactions(publicKey, rpcId);
        expect(listed.map(({ title }) => title)).toEqual([
            'pinned-expired-new',
            'pinned-fresh-new',
            'pinned-expired-old',
            'pinned-fresh-old',
            'unpinned-expired-new',
            'unpinned-fresh-new',
            'unpinned-expired-old',
            'unpinned-fresh-old',
        ]);
        // Model the backend's expiry annotation and the UI's two order-preserving filters.
        const annotated = listed.map((transaction) => ({
            ...transaction,
            expiredBlockhash: transaction.title.includes('-expired-'),
        }));
        expect(annotated.filter((transaction) => !transaction.expiredBlockhash).map(({ title }) => title)).toEqual([
            'pinned-fresh-new',
            'pinned-fresh-old',
            'unpinned-fresh-new',
            'unpinned-fresh-old',
        ]);
        expect(annotated.filter((transaction) => transaction.expiredBlockhash).map(({ title }) => title)).toEqual([
            'pinned-expired-new',
            'pinned-expired-old',
            'unpinned-expired-new',
            'unpinned-expired-old',
        ]);
        expect(await listSavedTransactions(publicKey, rpcId)).toEqual(listed);
    });

    test('successful completion preserves a pinned record and clears its claim for reuse', async () => {
        const saved = await saveTransaction(publicKey, rpcId, { ...input, pinned: true });
        const other = await saveTransaction(publicKey, rpcId, input);
        const claimed = await claimSavedTransaction(publicKey, rpcId, saved.id);
        expect(claimed.pinned).toBe(true);
        expect(claimed.processingAt).toEqual(expect.any(Number));
        expect(await listSavedTransactions(publicKey, rpcId)).toEqual([claimed, other]);

        await completeSavedTransaction(publicKey, rpcId, saved.id);
        const listed = await listSavedTransactions(publicKey, rpcId);
        expect(listed).toEqual([saved, other]);
        expect(listed[0]).not.toHaveProperty('processingAt');
        expect((await claimSavedTransaction(publicKey, rpcId, saved.id)).processingAt).toEqual(expect.any(Number));
    });

    test.each([false, undefined])('completion removes unpinned or legacy records (pinned=%s)', async (pinned) => {
        const saved = await saveTransaction(publicKey, rpcId, {
            ...input,
            ...(pinned === undefined ? {} : { pinned }),
        });
        const other = await saveTransaction(publicKey, rpcId, { ...input, pinned: true });
        if (pinned === undefined) expect(saved).not.toHaveProperty('pinned');
        await claimSavedTransaction(publicKey, rpcId, saved.id);

        await completeSavedTransaction(publicKey, rpcId, saved.id);

        expect(await listSavedTransactions(publicKey, rpcId)).toEqual([other]);
    });

    test.each([true, false])('completion uses current pin state changed during claim to %s', async (pinned) => {
        const saved = await saveTransaction(publicKey, rpcId, { ...input, pinned: !pinned });
        const claimed = await claimSavedTransaction(publicKey, rpcId, saved.id);
        await setSavedTransactionPinned(publicKey, rpcId, saved.id, pinned);
        expect(claimed.pinned).toBe(!pinned);
        expect(await listSavedTransactions(publicKey, rpcId)).toEqual([{ ...claimed, pinned }]);

        await completeSavedTransaction(publicKey, rpcId, saved.id);

        expect(await listSavedTransactions(publicKey, rpcId)).toEqual(pinned ? [{ ...saved, pinned }] : []);
    });

    test('refresh retains the pin, replaces bytes, clears processingAt and moves to the top of pinned records', async () => {
        const saved = await saveTransaction(publicKey, rpcId, { ...input, pinned: true });
        const otherPinned = await saveTransaction(publicKey, rpcId, { ...input, pinned: true });
        const unpinned = await saveTransaction(publicKey, rpcId, input);
        await claimSavedTransaction(publicKey, rpcId, saved.id);

        await refreshSavedTransaction(publicKey, rpcId, saved.id, [4, 5, 6]);

        const listed = await listSavedTransactions(publicKey, rpcId);
        expect(listed).toEqual([{ ...saved, transaction: [4, 5, 6] }, otherPinned, unpinned]);
        expect(listed[0]).not.toHaveProperty('processingAt');
    });

    test('explicit removal still deletes a pinned record', async () => {
        const saved = await saveTransaction(publicKey, rpcId, { ...input, pinned: true });
        const other = await saveTransaction(publicKey, rpcId, input);

        await removeSavedTransaction(publicKey, rpcId, saved.id);

        expect(await listSavedTransactions(publicKey, rpcId)).toEqual([other]);
    });
});
