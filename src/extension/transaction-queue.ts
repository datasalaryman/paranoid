import type { SendOptions } from '@solana/web3.js';
import type { SolBalanceChange } from '@/extension/messages';

export type QueuedTransactionMethod = 'signTransaction' | 'signAndSendTransaction';

export interface QueuedTransaction {
    id: string;
    origin: string;
    title: string;
    lines: string[];
    balanceChanges?: SolBalanceChange[];
    transaction: number[];
    method: QueuedTransactionMethod;
    options?: SendOptions;
    createdAt: number;
    processingAt?: number;
}

interface StoredTransactionQueue {
    scope: string;
    transactions: QueuedTransaction[];
}

const DATABASE_NAME = 'paranoid-wallet';
const DATABASE_VERSION = 3;
const TRANSACTION_QUEUE_STORE = 'transactionQueues';

export async function listQueuedTransactions(publicKey: string, rpcId: string): Promise<QueuedTransaction[]> {
    const database = await openDatabase();
    const stored = await request<StoredTransactionQueue | undefined>(
        database.transaction(TRANSACTION_QUEUE_STORE).objectStore(TRANSACTION_QUEUE_STORE).get(scope(publicKey, rpcId))
    );
    database.close();
    return stored?.transactions ?? [];
}

export async function enqueueTransaction(
    publicKey: string,
    rpcId: string,
    transaction: Omit<QueuedTransaction, 'id' | 'createdAt'>
): Promise<QueuedTransaction> {
    const queued = { ...transaction, id: crypto.randomUUID(), createdAt: Date.now() };
    await updateQueue(publicKey, rpcId, (transactions) => [queued, ...transactions]);
    return queued;
}

export async function removeQueuedTransaction(publicKey: string, rpcId: string, id: string): Promise<void> {
    await updateQueue(publicKey, rpcId, (transactions) => transactions.filter((transaction) => transaction.id !== id));
}

export async function claimQueuedTransaction(publicKey: string, rpcId: string, id: string): Promise<QueuedTransaction> {
    const database = await openDatabase();
    const transaction = database.transaction(TRANSACTION_QUEUE_STORE, 'readwrite');
    const store = transaction.objectStore(TRANSACTION_QUEUE_STORE);
    const queueScope = scope(publicKey, rpcId);
    const stored = await request<StoredTransactionQueue | undefined>(store.get(queueScope));
    const queued = stored?.transactions.find((item) => item.id === id);
    if (!queued) {
        database.close();
        throw new Error('Queued transaction not found');
    }
    if (queued.processingAt && Date.now() - queued.processingAt < 2 * 60 * 1000) {
        database.close();
        throw new Error('This transaction is already being signed');
    }
    const claimed = { ...queued, processingAt: Date.now() };
    store.put({
        scope: queueScope,
        transactions: stored!.transactions.map((item) => (item.id === id ? claimed : item)),
    } satisfies StoredTransactionQueue);
    await transactionDone(transaction);
    database.close();
    return claimed;
}

export async function releaseQueuedTransaction(publicKey: string, rpcId: string, id: string): Promise<void> {
    await updateQueue(publicKey, rpcId, (transactions) =>
        transactions.map((transaction) => {
            if (transaction.id !== id) return transaction;
            const { processingAt: _, ...queued } = transaction;
            return queued;
        })
    );
}

export async function moveQueuedTransactionToTop(publicKey: string, rpcId: string, id: string): Promise<void> {
    await updateQueue(publicKey, rpcId, (transactions) => {
        const transaction = transactions.find((item) => item.id === id);
        if (!transaction) throw new Error('Queued transaction not found');
        return [transaction, ...transactions.filter((item) => item.id !== id)];
    });
}

export async function refreshQueuedTransaction(
    publicKey: string,
    rpcId: string,
    id: string,
    serializedTransaction: number[]
): Promise<void> {
    await updateQueue(publicKey, rpcId, (transactions) => {
        const transaction = transactions.find((item) => item.id === id);
        if (!transaction) throw new Error('Queued transaction not found');
        const { processingAt: _, ...queued } = transaction;
        return [{ ...queued, transaction: serializedTransaction }, ...transactions.filter((item) => item.id !== id)];
    });
}

async function updateQueue(
    publicKey: string,
    rpcId: string,
    update: (transactions: QueuedTransaction[]) => QueuedTransaction[]
): Promise<void> {
    const database = await openDatabase();
    const transaction = database.transaction(TRANSACTION_QUEUE_STORE, 'readwrite');
    const store = transaction.objectStore(TRANSACTION_QUEUE_STORE);
    const queueScope = scope(publicKey, rpcId);
    const stored = await request<StoredTransactionQueue | undefined>(store.get(queueScope));
    store.put({ scope: queueScope, transactions: update(stored?.transactions ?? []) } satisfies StoredTransactionQueue);
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
            if (!open.result.objectStoreNames.contains(TRANSACTION_QUEUE_STORE)) {
                open.result.createObjectStore(TRANSACTION_QUEUE_STORE, { keyPath: 'scope' });
            }
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error ?? new Error('Could not open transaction queue'));
    });
}

function request<T>(value: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        value.onsuccess = () => resolve(value.result);
        value.onerror = () => reject(value.error ?? new Error('Transaction queue request failed'));
    });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('Transaction queue update failed'));
        transaction.onabort = () => reject(transaction.error ?? new Error('Transaction queue update was aborted'));
    });
}
