import { PublicKey, Transaction, VersionedTransaction, type SendOptions } from '@solana/web3.js';
import type { ProviderMethod, ProviderRequest, ProviderResponse } from '@/extension/messages';
import { initialize } from '@/lib/index';
import type { SolanaChain } from '@/lib/solana';
import type { Event, ParanoidProvider } from '@/lib/window';

type Listener = (...args: unknown[]) => unknown;

class ExtensionProvider implements ParanoidProvider {
    publicKey: PublicKey | null = null;
    readonly #listeners = new Map<keyof Event, Set<Listener>>();

    on<E extends keyof Event>(event: E, listener: Event[E]): void {
        const listeners = this.#listeners.get(event) || new Set();
        listeners.add(listener);
        this.#listeners.set(event, listeners);
    }

    off<E extends keyof Event>(event: E, listener: Event[E]): void {
        this.#listeners.get(event)?.delete(listener);
    }

    #emit(event: keyof Event): void {
        this.#listeners.get(event)?.forEach((listener) => listener());
    }

    #request<T>(method: ProviderMethod, params?: unknown): Promise<T> {
        const id = crypto.randomUUID();
        const request: ProviderRequest = { channel: 'paranoid:page', id, method, params };

        return new Promise((resolve, reject) => {
            const receive = (event: MessageEvent<ProviderResponse>) => {
                if (event.source !== window || event.data?.channel !== 'paranoid:extension' || event.data.id !== id)
                    return;
                window.removeEventListener('message', receive);
                if (event.data.error) reject(new Error(event.data.error));
                else resolve(event.data.result as T);
            };

            window.addEventListener('message', receive);
            window.postMessage(request, '*');
        });
    }

    async connect(options?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: PublicKey }> {
        const address = await this.#request<string>('connect', options);
        this.publicKey = new PublicKey(address);
        this.#emit('connect');
        return { publicKey: this.publicKey };
    }

    async disconnect(): Promise<void> {
        await this.#request('disconnect');
        this.publicKey = null;
        this.#emit('disconnect');
    }

    async signAndSendTransaction<T extends Transaction | VersionedTransaction>(
        transaction: T,
        options?: SendOptions,
        chain?: SolanaChain
    ): Promise<{ signature: string }> {
        return this.#request('signAndSendTransaction', {
            transaction: Array.from(serializeUnsigned(transaction)),
            options,
            chain,
        });
    }

    async signTransaction<T extends Transaction | VersionedTransaction>(
        transaction: T,
        chain?: SolanaChain
    ): Promise<T> {
        const bytes = await this.#request<number[]>('signTransaction', {
            transaction: Array.from(serializeUnsigned(transaction)),
            chain,
        });
        return deserializeLike(transaction, bytes) as T;
    }

    async signAllTransactions<T extends Transaction | VersionedTransaction>(
        transactions: T[],
        chain?: SolanaChain
    ): Promise<T[]> {
        const bytes = await this.#request<number[][]>('signAllTransactions', {
            transactions: transactions.map((transaction) => Array.from(serializeUnsigned(transaction))),
            chain,
        });
        return bytes.map((serialized, index) => deserializeLike(transactions[index]!, serialized) as T);
    }

    async signMessage(message: Uint8Array): Promise<{ signature: Uint8Array }> {
        const signature = await this.#request<number[]>('signMessage', { message: Array.from(message) });
        return { signature: new Uint8Array(signature) };
    }
}

function deserializeLike(original: Transaction | VersionedTransaction, bytes: number[]) {
    return 'version' in original
        ? VersionedTransaction.deserialize(new Uint8Array(bytes))
        : Transaction.from(new Uint8Array(bytes));
}

function serializeUnsigned(transaction: Transaction | VersionedTransaction): Uint8Array {
    return 'version' in transaction
        ? transaction.serialize()
        : transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
}

export function setupInpage(): void {
    const provider = new ExtensionProvider();
    initialize(provider);

    try {
        Object.defineProperty(window, 'paranoid', { value: provider });
    } catch (error) {
        console.error('Paranoid could not expose its legacy provider', error);
    }
}
