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
}
