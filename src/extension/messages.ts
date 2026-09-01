export type ProviderMethod =
    'connect' | 'disconnect' | 'signAndSendTransaction' | 'signTransaction' | 'signAllTransactions' | 'signMessage';

export interface ProviderRequest {
    channel: 'paranoid:page';
    id: string;
    method: ProviderMethod;
    params?: unknown;
}

export interface ProviderResponse {
    channel: 'paranoid:extension';
    id: string;
    result?: unknown;
    error?: string;
}

export interface ApprovalDetails {
    id: string;
    origin: string;
    title: string;
    lines: string[];
    transaction?: boolean;
    balanceChanges?: SolBalanceChange[];
    instructionTree?: InstructionTreeNode[];
    transactionMessage?: string;
}

export type ApprovalDecision = 'approve' | 'cancel' | 'defer';

export interface QueuedTransactionSummary {
    id: string;
    origin: string;
    title: string;
    lines: string[];
    method: 'signTransaction' | 'signAndSendTransaction';
    createdAt: number;
    expiredBlockhash: boolean;
    balanceChanges?: SolBalanceChange[];
    instructionTree?: InstructionTreeNode[];
    transactionMessage: string;
}

export interface InstructionTreeNode {
    programId: string;
    data: number[];
    instructionName?: string;
    innerInstructions: InstructionTreeNode[];
}

export interface SolBalanceChange {
    address: string;
    lamports: number;
}

export interface WalletSummary {
    name: string;
    label: string;
    publicKey: string;
}

export interface WalletStatus {
    active: WalletSummary | null;
    wallets: WalletSummary[];
    activeRpc: ActiveRpcSummary | null;
    rpcs: RpcSummary[];
    balance: number | null;
}

export interface RpcSummary {
    id: string;
    name: string;
    kind: 'localnet' | 'devnet' | 'testnet' | 'custom';
    chain: SolanaChain;
}

export interface ActiveRpcSummary extends RpcSummary {
    url: string;
}

export interface VaultStatus {
    configured: boolean;
    unlocked: boolean;
}
import type { SolanaChain } from '@/lib/solana';
