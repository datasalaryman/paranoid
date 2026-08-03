import { Keypair } from '@solana/web3.js';

export interface StoredKeypair {
    name: string;
    publicKey: string;
    secretKey: number[];
    createdAt: number;
}

const DATABASE_NAME = 'paranoid-wallet';
const DATABASE_VERSION = 1;
const KEYPAIR_STORE = 'keypairs';
const SETTINGS_STORE = 'settings';
const ACTIVE_KEY = 'activeKeypair';

const colors = [
    'Amber',
    'Blue',
    'Coral',
    'Gold',
    'Green',
    'Indigo',
    'Ivory',
    'Orange',
    'Pink',
    'Purple',
    'Red',
    'Silver',
    'Teal',
    'Violet',
];
const animals = [
    'Badger',
    'Bear',
    'Crane',
    'Dolphin',
    'Falcon',
    'Fox',
    'Gecko',
    'Horse',
    'Koala',
    'Otter',
    'Panda',
    'Raven',
    'Tiger',
    'Wolf',
];

export async function listKeypairs(): Promise<StoredKeypair[]> {
    const database = await openDatabase();
    const keypairs = await request<StoredKeypair[]>(
        database.transaction(KEYPAIR_STORE).objectStore(KEYPAIR_STORE).getAll()
    );
    database.close();
    return keypairs.sort((left, right) => left.createdAt - right.createdAt);
}

export async function addKeypair(secretKey: Uint8Array): Promise<StoredKeypair> {
    const keypair = Keypair.fromSecretKey(secretKey);
    const database = await openDatabase();
    const transaction = database.transaction([KEYPAIR_STORE, SETTINGS_STORE], 'readwrite');
    const store = transaction.objectStore(KEYPAIR_STORE);
    const existingNames = new Set((await request<StoredKeypair[]>(store.getAll())).map(({ name }) => name));
    const stored: StoredKeypair = {
        name: createName(existingNames),
        publicKey: keypair.publicKey.toBase58(),
        secretKey: Array.from(keypair.secretKey),
        createdAt: Date.now(),
    };
    store.add(stored);
    transaction.objectStore(SETTINGS_STORE).put({ key: ACTIVE_KEY, value: stored.name });
    await transactionDone(transaction);
    database.close();
    return stored;
}

export async function getActiveKeypair(): Promise<StoredKeypair | null> {
    const database = await openDatabase();
    const transaction = database.transaction([KEYPAIR_STORE, SETTINGS_STORE]);
    const keypairs = transaction.objectStore(KEYPAIR_STORE);
    const setting = await request<{ key: string; value: string } | undefined>(
        transaction.objectStore(SETTINGS_STORE).get(ACTIVE_KEY)
    );
    const active = setting ? await request<StoredKeypair | undefined>(keypairs.get(setting.value)) : undefined;
    const fallback = active ?? (await request<StoredKeypair[]>(keypairs.getAll()))[0] ?? null;
    database.close();
    return fallback;
}

export async function selectKeypair(name: string): Promise<void> {
    const database = await openDatabase();
    const transaction = database.transaction([KEYPAIR_STORE, SETTINGS_STORE], 'readwrite');
    const exists = await request<StoredKeypair | undefined>(transaction.objectStore(KEYPAIR_STORE).get(name));
    if (!exists) throw new Error('Keypair not found');
    transaction.objectStore(SETTINGS_STORE).put({ key: ACTIVE_KEY, value: name });
    await transactionDone(transaction);
    database.close();
}

function createName(existingNames: Set<string>): string {
    const available = colors
        .flatMap((color) => animals.map((animal) => `${color} ${animal}`))
        .filter((name) => !existingNames.has(name));
    if (!available.length) throw new Error('No keypair names are available');
    const randomValue = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
    return available[randomValue % available.length]!;
}

function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const open = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
        open.onupgradeneeded = () => {
            if (!open.result.objectStoreNames.contains(KEYPAIR_STORE)) {
                open.result.createObjectStore(KEYPAIR_STORE, { keyPath: 'name' });
            }
            if (!open.result.objectStoreNames.contains(SETTINGS_STORE)) {
                open.result.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
            }
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error ?? new Error('Could not open wallet storage'));
    });
}

function request<T>(value: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        value.onsuccess = () => resolve(value.result);
        value.onerror = () => reject(value.error ?? new Error('Wallet storage request failed'));
    });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('Wallet storage transaction failed'));
        transaction.onabort = () => reject(transaction.error ?? new Error('Wallet storage transaction was aborted'));
    });
}
