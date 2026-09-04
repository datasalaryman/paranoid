import type { ConfirmedSignatureInfo } from '@solana/web3.js';

export interface TransactionHistoryItem {
    signature: string;
    slot: number;
    blockTime: number | null;
    confirmationStatus: ConfirmedSignatureInfo['confirmationStatus'];
    memo: string | null;
    failed: boolean;
}

interface StoredTransactionHistory {
    scope: string;
    transactions: TransactionHistoryItem[];
}

const DATABASE_NAME = 'paranoid-wallet';
const DATABASE_VERSION = 4;
const TRANSACTION_HISTORY_STORE = 'transactionHistories';

export async function listTransactionHistory(
    publicKey: string,
    rpcId: string,
    before?: string,
    limit = 10
): Promise<TransactionHistoryItem[]> {
    const transactions = await readTransactionHistory(publicKey, rpcId);
    const start = before ? transactions.findIndex(({ signature }) => signature === before) + 1 : 0;
    if (before && start === 0) return [];
    return transactions.slice(start, start + limit);
}

export async function hasStoredTransaction(publicKey: string, rpcId: string, signatures: string[]): Promise<boolean> {
    const stored = new Set((await readTransactionHistory(publicKey, rpcId)).map(({ signature }) => signature));
    return signatures.some((signature) => stored.has(signature));
}

export async function storeTransactionHistory(
    publicKey: string,
    rpcId: string,
    transactions: TransactionHistoryItem[],
    before?: string
): Promise<void> {
    if (!transactions.length) return;
    const database = await openDatabase();
    const transaction = database.transaction(TRANSACTION_HISTORY_STORE, 'readwrite');
    const store = transaction.objectStore(TRANSACTION_HISTORY_STORE);
    const historyScope = scope(publicKey, rpcId);
    const stored = await request<StoredTransactionHistory | undefined>(store.get(historyScope));
    store.put({
        scope: historyScope,
        transactions: mergeTransactionHistory(stored?.transactions ?? [], transactions, before),
    } satisfies StoredTransactionHistory);
    await transactionDone(transaction);
    database.close();
}

export function mergeTransactionHistory(
    stored: TransactionHistoryItem[],
    incoming: TransactionHistoryItem[],
    before?: string
): TransactionHistoryItem[] {
    const incomingSignatures = new Set(incoming.map(({ signature }) => signature));
    const existing = stored.filter(({ signature }) => !incomingSignatures.has(signature));
    const insertionIndex = before ? existing.findIndex(({ signature }) => signature === before) + 1 : 0;
    return insertionIndex > 0
        ? [...existing.slice(0, insertionIndex), ...incoming, ...existing.slice(insertionIndex)]
        : [...incoming, ...existing];
}

export function toTransactionHistoryItem(transaction: ConfirmedSignatureInfo): TransactionHistoryItem {
    return {
        signature: transaction.signature,
        slot: transaction.slot,
        blockTime: transaction.blockTime ?? null,
        confirmationStatus: transaction.confirmationStatus,
        memo: transaction.memo,
        failed: transaction.err !== null,
    };
}

async function readTransactionHistory(publicKey: string, rpcId: string): Promise<TransactionHistoryItem[]> {
    const database = await openDatabase();
    const stored = await request<StoredTransactionHistory | undefined>(
        database
            .transaction(TRANSACTION_HISTORY_STORE)
            .objectStore(TRANSACTION_HISTORY_STORE)
            .get(scope(publicKey, rpcId))
    );
    database.close();
    return stored?.transactions ?? [];
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
            if (!open.result.objectStoreNames.contains('transactionQueues')) {
                open.result.createObjectStore('transactionQueues', { keyPath: 'scope' });
            }
            if (!open.result.objectStoreNames.contains(TRANSACTION_HISTORY_STORE)) {
                open.result.createObjectStore(TRANSACTION_HISTORY_STORE, { keyPath: 'scope' });
            }
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error ?? new Error('Could not open transaction history'));
    });
}

function request<T>(value: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        value.onsuccess = () => resolve(value.result);
        value.onerror = () => reject(value.error ?? new Error('Transaction history request failed'));
    });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('Transaction history update failed'));
        transaction.onabort = () => reject(transaction.error ?? new Error('Transaction history update was aborted'));
    });
}
