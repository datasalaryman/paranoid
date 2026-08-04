import type { PublicKey, SendOptions, Transaction, TransactionSignature, VersionedTransaction } from '@solana/web3.js';
import type { SolanaChain } from '@/lib/solana';

export interface Event {
    connect(...args: unknown[]): unknown;
    disconnect(...args: unknown[]): unknown;
    accountChanged(...args: unknown[]): unknown;
}

export interface EventEmitter {
    on<E extends keyof Event>(event: E, listener: Event[E], context?: any): void;
    off<E extends keyof Event>(event: E, listener: Event[E], context?: any): void;
}

export interface ParanoidProvider extends EventEmitter {
    publicKey: PublicKey | null;
    connect(options?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: PublicKey }>;
    disconnect(): Promise<void>;
    signAndSendTransaction<T extends Transaction | VersionedTransaction>(
        transaction: T,
        options?: SendOptions,
        chain?: SolanaChain
    ): Promise<{ signature: TransactionSignature }>;
    signTransaction<T extends Transaction | VersionedTransaction>(transaction: T, chain?: SolanaChain): Promise<T>;
    signAllTransactions<T extends Transaction | VersionedTransaction>(
        transactions: T[],
        chain?: SolanaChain
    ): Promise<T[]>;
    signMessage(message: Uint8Array): Promise<{ signature: Uint8Array }>;
}
