import { showToast } from '@/extension/components/toast';
import type { ActiveRpcSummary } from '@/extension/messages';
import { getSolanaExplorerAccountUrl, getSolanaExplorerTransactionUrl } from '@/lib/solana';

export interface SolanaIdentifierActionsProps {
    value: string;
    kind?: 'address' | 'signature';
    rpc?: ActiveRpcSummary | null;
}

export function SolanaIdentifierActions({ value, kind = 'address', rpc }: SolanaIdentifierActionsProps) {
    const explorerMainnet = rpc?.kind === 'custom' && rpc.explorerMainnet;
    const chain = explorerMainnet ? 'solana:mainnet' : rpc?.chain;
    const customRpcUrl =
        !explorerMainnet && rpc && (rpc.kind === 'custom' || rpc.kind === 'localnet') ? rpc.url : undefined;
    const explorerUrl = chain
        ? (kind === 'address' ? getSolanaExplorerAccountUrl : getSolanaExplorerTransactionUrl)(
              value,
              chain,
              customRpcUrl
          )
        : undefined;
    const actionClassName =
        'inline-flex shrink-0 cursor-pointer rounded-[6px] border border-[#36433a] bg-[#202722] p-1 text-[#b7c8ba] hover:border-[#68f58a] hover:text-[#68f58a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#68f58a]';

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(value);
            showToast(`${kind === 'address' ? 'Address' : 'Signature'} copied to clipboard.`, 'success');
        } catch {
            showToast(`Failed to copy ${kind}. Please try again.`, 'error');
        }
    };

    return (
        <span className="inline-flex shrink-0 items-center gap-1">
            <button
                type="button"
                className={actionClassName}
                aria-label={`Copy ${kind}`}
                title={`Copy ${kind}: ${value}`}
                onClick={copy}
            >
                <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="size-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                >
                    <rect width="13" height="13" x="9" y="9" rx="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
            </button>
            {explorerUrl && (
                <a
                    className={actionClassName}
                    href={explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${kind} in Solana Explorer`}
                    title={`Open ${kind} in Solana Explorer`}
                >
                    <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        className="size-3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                    >
                        <path d="M7 17 17 7M7 7h10v10" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </a>
            )}
        </span>
    );
}
