import type { SendOptions } from '@solana/web3.js';
import type { InstructionTreeNode, SolBalanceChange } from '@/extension/messages';

export type SavedTransactionMethod = 'signTransaction' | 'signAndSendTransaction';

export interface SavedTransaction {
    id: string;
    origin: string;
    title: string;
    lines: string[];
    balanceChanges?: SolBalanceChange[];
    instructionTree?: InstructionTreeNode[];
    transaction: number[];
    method: SavedTransactionMethod;
    options?: SendOptions;
    createdAt: number;
    processingAt?: number;
    pinned?: boolean;
}

interface StoredSavedTransactions {
    scope: string;
    transactions: SavedTransaction[];
}

const DATABASE_NAME = 'paranoid-wallet';
const DATABASE_VERSION = 5;
const SAVED_TRANSACTIONS_STORE = 'savedTransactions';

export async function listSavedTransactions(publicKey: string, rpcId: string): Promise<SavedTransaction[]> {
    const database = await openDatabase();
    const stored = await request<StoredSavedTransactions | undefined>(
        database
            .transaction(SAVED_TRANSACTIONS_STORE)
            .objectStore(SAVED_TRANSACTIONS_STORE)
            .get(scope(publicKey, rpcId))
    );
    database.close();
    return (stored?.transactions ?? []).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
}

export async function saveTransaction(
    publicKey: string,
    rpcId: string,
    transaction: Omit<SavedTransaction, 'id' | 'createdAt'>
): Promise<SavedTransaction> {
    const saved = { ...transaction, id: crypto.randomUUID(), createdAt: Date.now() };
    await updateSavedTransactions(publicKey, rpcId, (transactions) => [saved, ...transactions]);
    return saved;
}

export async function removeSavedTransaction(publicKey: string, rpcId: string, id: string): Promise<void> {
    await updateSavedTransactions(publicKey, rpcId, (transactions) =>
        transactions.filter((transaction) => transaction.id !== id)
    );
}

export async function claimSavedTransaction(publicKey: string, rpcId: string, id: string): Promise<SavedTransaction> {
    const database = await openDatabase();
    const transaction = database.transaction(SAVED_TRANSACTIONS_STORE, 'readwrite');
    const store = transaction.objectStore(SAVED_TRANSACTIONS_STORE);
    const savedScope = scope(publicKey, rpcId);
    const stored = await request<StoredSavedTransactions | undefined>(store.get(savedScope));
    const saved = stored?.transactions.find((item) => item.id === id);
    if (!saved) {
        database.close();
        throw new Error('Saved transaction not found');
    }
    if (saved.processingAt && Date.now() - saved.processingAt < 2 * 60 * 1000) {
        database.close();
        throw new Error('This transaction is already being signed');
    }
    const claimed = { ...saved, processingAt: Date.now() };
    store.put({
        scope: savedScope,
        transactions: stored!.transactions.map((item) => (item.id === id ? claimed : item)),
    } satisfies StoredSavedTransactions);
    await transactionDone(transaction);
    database.close();
    return claimed;
}

export async function setSavedTransactionPinned(
    publicKey: string,
    rpcId: string,
    id: string,
    pinned: boolean
): Promise<void> {
    await updateSavedTransactions(publicKey, rpcId, (transactions) => {
        if (!transactions.some((transaction) => transaction.id === id)) throw new Error('Saved transaction not found');
        return transactions.map((transaction) => (transaction.id === id ? { ...transaction, pinned } : transaction));
    });
}

export async function completeSavedTransaction(publicKey: string, rpcId: string, id: string): Promise<void> {
    await updateSavedTransactions(publicKey, rpcId, (transactions) =>
        transactions.flatMap((transaction) => {
            if (transaction.id !== id) return [transaction];
            if (!transaction.pinned) return [];
            const { processingAt: _, ...saved } = transaction;
            return [saved];
        })
    );
}

export async function releaseSavedTransaction(publicKey: string, rpcId: string, id: string): Promise<void> {
    await updateSavedTransactions(publicKey, rpcId, (transactions) =>
        transactions.map((transaction) => {
            if (transaction.id !== id) return transaction;
            const { processingAt: _, ...saved } = transaction;
            return saved;
        })
    );
}

export async function moveSavedTransactionToTop(publicKey: string, rpcId: string, id: string): Promise<void> {
    await updateSavedTransactions(publicKey, rpcId, (transactions) => {
        const transaction = transactions.find((item) => item.id === id);
        if (!transaction) throw new Error('Saved transaction not found');
        return [transaction, ...transactions.filter((item) => item.id !== id)];
    });
}

export async function refreshSavedTransaction(
    publicKey: string,
    rpcId: string,
    id: string,
    serializedTransaction: number[]
): Promise<void> {
    await updateSavedTransactions(publicKey, rpcId, (transactions) => {
        const transaction = transactions.find((item) => item.id === id);
        if (!transaction) throw new Error('Saved transaction not found');
        const { processingAt: _, ...saved } = transaction;
        return [{ ...saved, transaction: serializedTransaction }, ...transactions.filter((item) => item.id !== id)];
    });
}

async function updateSavedTransactions(
    publicKey: string,
    rpcId: string,
    update: (transactions: SavedTransaction[]) => SavedTransaction[]
): Promise<void> {
    const database = await openDatabase();
    const transaction = database.transaction(SAVED_TRANSACTIONS_STORE, 'readwrite');
    const store = transaction.objectStore(SAVED_TRANSACTIONS_STORE);
    const savedScope = scope(publicKey, rpcId);
    const stored = await request<StoredSavedTransactions | undefined>(store.get(savedScope));
    store.put({
        scope: savedScope,
        transactions: update(stored?.transactions ?? []),
    } satisfies StoredSavedTransactions);
    await transactionDone(transaction);
    database.close();
}

function scope(publicKey: string, rpcId: string): string {
    return `${publicKey}:${rpcId}`;
}

function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const open = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
        open.onupgradeneeded = () => {
            if (!open.result.objectStoreNames.contains('keypairs')) {
                open.result.createObjectStore('keypairs', { keyPath: 'name' });
            }
            if (!open.result.objectStoreNames.contains('rpcs')) {
                open.result.createObjectStore('rpcs', { keyPath: 'id' });
            }
            if (!open.result.objectStoreNames.contains('settings')) {
                open.result.createObjectStore('settings', { keyPath: 'key' });
            }
            if (!open.result.objectStoreNames.contains(SAVED_TRANSACTIONS_STORE)) {
                open.result.createObjectStore(SAVED_TRANSACTIONS_STORE, { keyPath: 'scope' });
            }
            if (!open.result.objectStoreNames.contains('transactionHistories')) {
                open.result.createObjectStore('transactionHistories', { keyPath: 'scope' });
            }
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error ?? new Error('Could not open saved transactions'));
    });
}

function request<T>(value: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        value.onsuccess = () => resolve(value.result);
        value.onerror = () => reject(value.error ?? new Error('Saved transactions request failed'));
    });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('Saved transactions update failed'));
        transaction.onabort = () => reject(transaction.error ?? new Error('Saved transactions update was aborted'));
    });
}
