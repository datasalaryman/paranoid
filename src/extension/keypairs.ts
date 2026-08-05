import { Keypair } from '@solana/web3.js';
import { signerFromSecretKey } from '@/extension/signer';
import type { SolanaChain } from '@/lib/solana';

export interface StoredKeypair {
    name: string;
    publicKey: string;
    encryptedSecretKey: EncryptedValue;
    createdAt: number;
}

export interface RpcSummary {
    id: string;
    name: string;
    kind: 'localnet' | 'devnet' | 'testnet' | 'custom';
    chain: SolanaChain;
}

interface StoredRpc {
    id: string;
    name: string;
    chain: SolanaChain;
    encryptedUrl: EncryptedValue;
    createdAt: number;
}

export interface ActiveRpc extends RpcSummary {
    url: string;
}

interface LegacyStoredKeypair extends Omit<StoredKeypair, 'encryptedSecretKey'> {
    secretKey: number[];
    encryptedSecretKey?: never;
}

interface EncryptedValue {
    iv: number[];
    ciphertext: number[];
}

interface VaultSettings {
    version: 1;
    salt: number[];
    iterations: number;
    verifier: EncryptedValue;
}

const DATABASE_NAME = 'paranoid-wallet';
const DATABASE_VERSION = 3;
const KEYPAIR_STORE = 'keypairs';
const RPC_STORE = 'rpcs';
const SETTINGS_STORE = 'settings';
const TRANSACTION_QUEUE_STORE = 'transactionQueues';
const ACTIVE_KEY = 'activeKeypair';
const ACTIVE_RPC_KEY = 'activeRpc';
const VAULT_KEY = 'vault';
const PBKDF2_ITERATIONS = 600_000;
const VAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const VAULT_VERIFIER = new TextEncoder().encode('paranoid-wallet-vault-v1');
let unlockedVaultKey: CryptoKey | null = null;
let vaultLockTimer: ReturnType<typeof setTimeout> | null = null;
let vaultLastUsedAt = 0;

const BUILT_IN_RPCS: ActiveRpc[] = [
    {
        id: 'localnet',
        name: 'Localnet',
        kind: 'localnet',
        chain: 'solana:localnet',
        url: 'http://127.0.0.1:8899',
    },
    {
        id: 'devnet',
        name: 'Devnet',
        kind: 'devnet',
        chain: 'solana:devnet',
        url: 'https://api.devnet.solana.com',
    },
    {
        id: 'testnet',
        name: 'Testnet',
        kind: 'testnet',
        chain: 'solana:testnet',
        url: 'https://api.testnet.solana.com',
    },
];

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

export async function getVaultStatus(): Promise<{ configured: boolean; unlocked: boolean }> {
    lockVaultIfIdle();
    const settings = await getSetting<VaultSettings>(VAULT_KEY);
    return { configured: Boolean(settings), unlocked: Boolean(settings && unlockedVaultKey) };
}

export async function setupVault(password: string): Promise<void> {
    if (typeof password !== 'string' || password.length < 8) throw new Error('Password must be at least 8 characters');
    if (await getSetting<VaultSettings>(VAULT_KEY)) throw new Error('A password has already been set');

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveVaultKey(password, salt, PBKDF2_ITERATIONS);
    const verifier = await encrypt(key, VAULT_VERIFIER, verifierAdditionalData());
    const existing = await readAllKeypairs();
    const migrated = await Promise.all(
        existing.map(async (stored): Promise<StoredKeypair> => {
            if (!isLegacyKeypair(stored)) return stored;
            const secretKey = new Uint8Array(stored.secretKey);
            try {
                Keypair.fromSecretKey(secretKey);
                return {
                    name: stored.name,
                    publicKey: stored.publicKey,
                    encryptedSecretKey: await encrypt(key, secretKey, keypairAdditionalData(stored)),
                    createdAt: stored.createdAt,
                };
            } finally {
                secretKey.fill(0);
            }
        })
    );

    const database = await openDatabase();
    const transaction = database.transaction([KEYPAIR_STORE, SETTINGS_STORE], 'readwrite');
    const keypairs = transaction.objectStore(KEYPAIR_STORE);
    migrated.forEach((stored) => keypairs.put(stored));
    transaction.objectStore(SETTINGS_STORE).add({
        key: VAULT_KEY,
        value: {
            version: 1,
            salt: Array.from(salt),
            iterations: PBKDF2_ITERATIONS,
            verifier,
        } satisfies VaultSettings,
    });
    await transactionDone(transaction);
    database.close();
    unlockedVaultKey = key;
    touchVault();
}

export async function unlockVault(password: string): Promise<void> {
    if (typeof password !== 'string') throw new Error('Incorrect password');
    unlockedVaultKey = null;
    const settings = await getSetting<VaultSettings>(VAULT_KEY);
    if (!settings) throw new Error('Create a password before unlocking the wallet');
    if (settings.version !== 1) throw new Error('This wallet uses an unsupported encryption version');

    const key = await deriveVaultKey(password, new Uint8Array(settings.salt), settings.iterations);
    try {
        const verifier = await decrypt(key, settings.verifier, verifierAdditionalData());
        const valid =
            verifier.length === VAULT_VERIFIER.length &&
            verifier.every((byte, index) => byte === VAULT_VERIFIER[index]);
        verifier.fill(0);
        if (!valid) throw new Error('Incorrect password');
    } catch {
        throw new Error('Incorrect password');
    }
    unlockedVaultKey = key;
    touchVault();
}

export async function listKeypairs(): Promise<StoredKeypair[]> {
    const keypairs = await readAllKeypairs();
    return keypairs.filter((stored): stored is StoredKeypair => !isLegacyKeypair(stored));
}

export async function addKeypair(secretKey: Uint8Array): Promise<StoredKeypair> {
    const key = requireUnlockedVault();
    const keypair = Keypair.fromSecretKey(secretKey);
    const existingNames = new Set((await readAllKeypairs()).map(({ name }) => name));
    const metadata = {
        name: createName(existingNames),
        publicKey: keypair.publicKey.toBase58(),
        createdAt: Date.now(),
    };
    const stored: StoredKeypair = {
        ...metadata,
        encryptedSecretKey: await encrypt(key, keypair.secretKey, keypairAdditionalData(metadata)),
    };
    const database = await openDatabase();
    const transaction = database.transaction([KEYPAIR_STORE, SETTINGS_STORE], 'readwrite');
    const store = transaction.objectStore(KEYPAIR_STORE);
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
    const active = setting
        ? await request<StoredKeypair | LegacyStoredKeypair | undefined>(keypairs.get(setting.value))
        : undefined;
    const fallback =
        active ?? (await request<Array<StoredKeypair | LegacyStoredKeypair>>(keypairs.getAll()))[0] ?? null;
    database.close();
    if (fallback && isLegacyKeypair(fallback)) throw new Error('Create a password to encrypt existing keypairs');
    return fallback;
}

export async function getActiveSigner(): Promise<Keypair | null> {
    const stored = await getActiveKeypair();
    if (!stored) return null;
    const plaintext = await decrypt(requireUnlockedVault(), stored.encryptedSecretKey, keypairAdditionalData(stored));
    try {
        return signerFromSecretKey(plaintext);
    } finally {
        plaintext.fill(0);
    }
}

export async function selectKeypair(name: string): Promise<void> {
    touchVault();
    const database = await openDatabase();
    const transaction = database.transaction([KEYPAIR_STORE, SETTINGS_STORE], 'readwrite');
    const exists = await request<StoredKeypair | undefined>(transaction.objectStore(KEYPAIR_STORE).get(name));
    if (!exists) throw new Error('Keypair not found');
    transaction.objectStore(SETTINGS_STORE).put({ key: ACTIVE_KEY, value: name });
    await transactionDone(transaction);
    database.close();
}

export async function listRpcs(): Promise<RpcSummary[]> {
    const custom = await readAllRpcs();
    return [
        ...BUILT_IN_RPCS.map(({ id, name, kind, chain }) => ({ id, name, kind, chain })),
        ...custom.map(({ id, name, chain }) => ({ id, name, kind: 'custom' as const, chain })),
    ];
}

export async function addRpc(value: string, chain: SolanaChain): Promise<RpcSummary> {
    const key = requireUnlockedVault();
    const url = normalizeRpcUrl(value);
    const existing = await readAllRpcs();
    const id = crypto.randomUUID();
    const name = createRpcName(new Set(existing.map((rpc) => rpc.name)));
    const metadata = { id, name, chain };
    const plaintext = new TextEncoder().encode(url);
    let stored: StoredRpc;
    try {
        stored = {
            ...metadata,
            encryptedUrl: await encrypt(key, plaintext, rpcAdditionalData(metadata)),
            createdAt: Date.now(),
        };
    } finally {
        plaintext.fill(0);
    }

    const database = await openDatabase();
    const transaction = database.transaction([RPC_STORE, SETTINGS_STORE], 'readwrite');
    transaction.objectStore(RPC_STORE).add(stored);
    transaction.objectStore(SETTINGS_STORE).put({ key: ACTIVE_RPC_KEY, value: stored.id });
    await transactionDone(transaction);
    database.close();
    return { id, name, kind: 'custom', chain };
}

export async function selectRpc(id: string): Promise<void> {
    touchVault();
    const builtIn = BUILT_IN_RPCS.some((rpc) => rpc.id === id);
    const database = await openDatabase();
    const transaction = database.transaction([RPC_STORE, SETTINGS_STORE], 'readwrite');
    const custom = builtIn
        ? undefined
        : await request<StoredRpc | undefined>(transaction.objectStore(RPC_STORE).get(id));
    if (!builtIn && !custom) {
        database.close();
        throw new Error('RPC not found');
    }
    transaction.objectStore(SETTINGS_STORE).put({ key: ACTIVE_RPC_KEY, value: id });
    await transactionDone(transaction);
    database.close();
}

export async function getActiveRpc(): Promise<ActiveRpc | null> {
    const id = await getSetting<string>(ACTIVE_RPC_KEY);
    if (!id) return null;
    const builtIn = BUILT_IN_RPCS.find((rpc) => rpc.id === id);
    if (builtIn) return builtIn;

    const database = await openDatabase();
    const stored = await request<StoredRpc | undefined>(database.transaction(RPC_STORE).objectStore(RPC_STORE).get(id));
    database.close();
    if (!stored) return null;
    const plaintext = await decrypt(requireUnlockedVault(), stored.encryptedUrl, rpcAdditionalData(stored));
    try {
        return {
            id: stored.id,
            name: stored.name,
            kind: 'custom',
            chain: stored.chain,
            url: new TextDecoder().decode(plaintext),
        };
    } finally {
        plaintext.fill(0);
    }
}

function requireUnlockedVault(): CryptoKey {
    lockVaultIfIdle();
    if (!unlockedVaultKey) throw new Error('Wallet is locked. Open Paranoid to unlock it');
    touchVault();
    return unlockedVaultKey;
}

export function touchVault(): void {
    lockVaultIfIdle();
    if (!unlockedVaultKey) throw new Error('Wallet is locked. Open Paranoid to unlock it');
    vaultLastUsedAt = Date.now();
    if (vaultLockTimer) clearTimeout(vaultLockTimer);
    vaultLockTimer = setTimeout(lockVault, VAULT_IDLE_TIMEOUT_MS);
}

function lockVaultIfIdle(): void {
    if (unlockedVaultKey && vaultLastUsedAt > 0 && Date.now() - vaultLastUsedAt >= VAULT_IDLE_TIMEOUT_MS) lockVault();
}

function lockVault(): void {
    unlockedVaultKey = null;
    vaultLastUsedAt = 0;
    if (vaultLockTimer) clearTimeout(vaultLockTimer);
    vaultLockTimer = null;
}

async function deriveVaultKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
    const passwordBytes = new TextEncoder().encode(password);
    try {
        const material = await crypto.subtle.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveKey']);
        return crypto.subtle.deriveKey(
            { name: 'PBKDF2', hash: 'SHA-256', salt: asArrayBuffer(salt), iterations },
            material,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    } finally {
        passwordBytes.fill(0);
    }
}

async function encrypt(key: CryptoKey, plaintext: Uint8Array, additionalData: Uint8Array): Promise<EncryptedValue> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: asArrayBuffer(additionalData) },
        key,
        asArrayBuffer(plaintext)
    );
    return { iv: Array.from(iv), ciphertext: Array.from(new Uint8Array(ciphertext)) };
}

async function decrypt(key: CryptoKey, encrypted: EncryptedValue, additionalData: Uint8Array): Promise<Uint8Array> {
    const plaintext = await crypto.subtle.decrypt(
        {
            name: 'AES-GCM',
            iv: new Uint8Array(encrypted.iv),
            additionalData: asArrayBuffer(additionalData),
        },
        key,
        asArrayBuffer(new Uint8Array(encrypted.ciphertext))
    );
    return new Uint8Array(plaintext);
}

function verifierAdditionalData(): Uint8Array {
    return new TextEncoder().encode('paranoid-wallet:verifier:v1');
}

function keypairAdditionalData(stored: { name: string; publicKey: string }): Uint8Array {
    return new TextEncoder().encode(`paranoid-wallet:keypair:${stored.name}:${stored.publicKey}:v1`);
}

function rpcAdditionalData(stored: { id: string; name: string; chain: SolanaChain }): Uint8Array {
    return new TextEncoder().encode(`paranoid-wallet:rpc:${stored.id}:${stored.name}:${stored.chain}:v1`);
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
}

function isLegacyKeypair(stored: StoredKeypair | LegacyStoredKeypair): stored is LegacyStoredKeypair {
    return 'secretKey' in stored;
}

async function readAllKeypairs(): Promise<Array<StoredKeypair | LegacyStoredKeypair>> {
    const database = await openDatabase();
    const keypairs = await request<Array<StoredKeypair | LegacyStoredKeypair>>(
        database.transaction(KEYPAIR_STORE).objectStore(KEYPAIR_STORE).getAll()
    );
    database.close();
    return keypairs.sort((left, right) => left.createdAt - right.createdAt);
}

async function readAllRpcs(): Promise<StoredRpc[]> {
    const database = await openDatabase();
    const rpcs = await request<StoredRpc[]>(database.transaction(RPC_STORE).objectStore(RPC_STORE).getAll());
    database.close();
    return rpcs.sort((left, right) => left.createdAt - right.createdAt);
}

async function getSetting<T>(key: string): Promise<T | undefined> {
    const database = await openDatabase();
    const setting = await request<{ key: string; value: T } | undefined>(
        database.transaction(SETTINGS_STORE).objectStore(SETTINGS_STORE).get(key)
    );
    database.close();
    return setting?.value;
}

function createName(existingNames: Set<string>): string {
    const available = colors
        .flatMap((color) => animals.map((animal) => `${color} ${animal}`))
        .filter((name) => !existingNames.has(name));
    if (!available.length) throw new Error('No keypair names are available');
    const randomValue = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
    return available[randomValue % available.length]!;
}

function createRpcName(existingNames: Set<string>): string {
    const available = animals.map((animal) => `${animal}net`).filter((name) => !existingNames.has(name));
    if (!available.length) throw new Error('No RPC names are available');
    const randomValue = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
    return available[randomValue % available.length]!;
}

function normalizeRpcUrl(value: string): string {
    let url: URL;
    try {
        url = new URL(value.trim());
    } catch {
        throw new Error('Enter a valid RPC URL');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('RPC URL must use http or https');
    }
    return url.toString();
}

function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const open = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
        open.onupgradeneeded = () => {
            if (!open.result.objectStoreNames.contains(KEYPAIR_STORE)) {
                open.result.createObjectStore(KEYPAIR_STORE, { keyPath: 'name' });
            }
            if (!open.result.objectStoreNames.contains(RPC_STORE)) {
                open.result.createObjectStore(RPC_STORE, { keyPath: 'id' });
            }
            if (!open.result.objectStoreNames.contains(SETTINGS_STORE)) {
                open.result.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
            }
            if (!open.result.objectStoreNames.contains(TRANSACTION_QUEUE_STORE)) {
                open.result.createObjectStore(TRANSACTION_QUEUE_STORE, { keyPath: 'scope' });
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
