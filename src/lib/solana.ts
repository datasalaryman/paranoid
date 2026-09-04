// This is copied from @solana/wallet-standard-chains

import type { IdentifierString } from '@wallet-standard/base';
import { Transaction, VersionedTransaction } from '@solana/web3.js';

/** Solana Mainnet (beta) cluster, e.g. https://api.mainnet-beta.solana.com */
export const SOLANA_MAINNET_CHAIN = 'solana:mainnet';

/** Solana Devnet cluster, e.g. https://api.devnet.solana.com */
export const SOLANA_DEVNET_CHAIN = 'solana:devnet';

/** Solana Testnet cluster, e.g. https://api.testnet.solana.com */
export const SOLANA_TESTNET_CHAIN = 'solana:testnet';

/** Solana Localnet cluster, e.g. http://localhost:8899 */
export const SOLANA_LOCALNET_CHAIN = 'solana:localnet';

/** Array of all Solana clusters */
export const SOLANA_CHAINS = [
    SOLANA_MAINNET_CHAIN,
    SOLANA_DEVNET_CHAIN,
    SOLANA_TESTNET_CHAIN,
    SOLANA_LOCALNET_CHAIN,
] as const;

/** Type of all Solana clusters */
export type SolanaChain = (typeof SOLANA_CHAINS)[number];

/**
 * Check if a chain corresponds with one of the Solana clusters.
 */
export function isSolanaChain(chain: IdentifierString): chain is SolanaChain {
    return SOLANA_CHAINS.includes(chain as SolanaChain);
}

export function getSolanaExplorerAccountTokensUrl(address: string, chain: SolanaChain, customRpcUrl?: string): string {
    const explorerUrl = new URL(`/address/${encodeURIComponent(address)}/tokens`, 'https://explorer.solana.com');

    if (customRpcUrl) {
        explorerUrl.searchParams.set('cluster', 'custom');
        explorerUrl.searchParams.set('customUrl', customRpcUrl);
    } else if (chain !== SOLANA_MAINNET_CHAIN) {
        explorerUrl.searchParams.set('cluster', chain.replace('solana:', ''));
    }

    return explorerUrl.toString();
}

export function getSolanaExplorerTransactionUrl(signature: string, chain: SolanaChain, customRpcUrl?: string): string {
    const explorerUrl = new URL(`/tx/${encodeURIComponent(signature)}`, 'https://explorer.solana.com');

    if (customRpcUrl) {
        explorerUrl.searchParams.set('cluster', 'custom');
        explorerUrl.searchParams.set('customUrl', customRpcUrl);
    } else if (chain !== SOLANA_MAINNET_CHAIN) {
        explorerUrl.searchParams.set('cluster', chain.replace('solana:', ''));
    }

    return explorerUrl.toString();
}

export function isVersionedTransaction(
    transaction: Transaction | VersionedTransaction
): transaction is VersionedTransaction {
    return 'version' in transaction;
}

export function deserializeTransaction(transaction: Uint8Array): Transaction | VersionedTransaction {
    try {
        return VersionedTransaction.deserialize(transaction);
    } catch {
        return Transaction.from(transaction);
    }
}
