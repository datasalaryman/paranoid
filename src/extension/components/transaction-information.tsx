import type { SolBalanceChange } from '@/extension/messages';

export interface TransactionInformationProps {
    title: string;
    origin?: string;
    balanceChanges?: readonly SolBalanceChange[];
    transactionMessage?: string;
    onMessageCopied?: () => void;
    onMessageCopyError?: (error: unknown) => void;
}

export function TransactionInformation({
    title,
    origin,
    balanceChanges,
    transactionMessage,
    onMessageCopied,
    onMessageCopyError,
}: TransactionInformationProps) {
    const changedBalances = balanceChanges?.filter(({ lamports }) => lamports !== 0);

    return (
        <>
            <h1 className="mt-3 mb-5 text-2xl leading-[1.15] font-bold">{title}</h1>
            {origin !== undefined && (
                <p className="my-[1em] rounded-[6px] border border-[#29332c] bg-[#151a17] p-[14px] [overflow-wrap:anywhere]">
                    {origin}
                </p>
            )}
            {changedBalances && (
                <section className="my-[1em]">
                    <h2 className="my-[1em] text-[11px] tracking-[0.12em] text-[#68f58a] uppercase">
                        Account SOL changes
                    </h2>
                    {changedBalances.length > 0 ? (
                        <div className="max-h-[220px] overflow-auto rounded-[6px] border border-[#29332c] bg-[#151a17]">
                            <table className="w-full border-collapse" aria-label="Account SOL balance changes">
                                <tbody>
                                    {changedBalances.map(({ address, lamports }) => (
                                        <tr className="[&+&]:border-t [&+&]:border-[#29332c]" key={address}>
                                            <td className="p-[14px] font-mono text-sm text-[#b7c8ba]" title={address}>
                                                {truncateAddress(address)}
                                            </td>
                                            <td
                                                className={`p-[14px] text-right font-semibold whitespace-nowrap ${
                                                    lamports > 0 ? 'text-[#68f58a]' : 'text-[#ff8f8f]'
                                                }`}
                                            >
                                                {formatSolChange(lamports)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <p className="rounded-[6px] border border-[#29332c] bg-[#151a17] p-[14px] text-[#b7c8ba]">
                            No SOL balance changes
                        </p>
                    )}
                </section>
            )}
            {transactionMessage && (
                <TransactionMessageCopy
                    message={transactionMessage}
                    onCopied={onMessageCopied}
                    onCopyError={onMessageCopyError}
                />
            )}
        </>
    );
}

function TransactionMessageCopy({
    message,
    onCopied,
    onCopyError,
}: {
    message: string;
    onCopied?: () => void;
    onCopyError?: (error: unknown) => void;
}) {
    const copyMessage = async () => {
        try {
            await navigator.clipboard.writeText(message);
            onCopied?.();
        } catch (error) {
            onCopyError?.(error);
        }
    };

    return (
        <section className="my-[1em]">
            <h2 className="my-[1em] text-[11px] tracking-[0.12em] text-[#68f58a] uppercase">Transaction message</h2>
            <div className="flex items-center gap-3 rounded-[6px] border border-[#29332c] bg-[#151a17] p-[14px]">
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#e7f7e9]">Base64 message</p>
                    <p className="mt-1 truncate font-mono text-xs text-[#829486]" title={message}>
                        {message}
                    </p>
                </div>
                <button
                    type="button"
                    className="shrink-0 cursor-pointer rounded-[6px] border border-[#36433a] bg-[#202722] p-2 text-[#b7c8ba] hover:border-[#68f58a] hover:text-[#68f58a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#68f58a]"
                    aria-label="Copy base64 transaction message"
                    title="Copy base64 transaction message"
                    onClick={copyMessage}
                >
                    <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        className="size-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                    >
                        <rect width="13" height="13" x="9" y="9" rx="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                </button>
            </div>
        </section>
    );
}

function formatSolChange(lamports: number): string {
    if (lamports === 0) return 'No change';
    const amount = (Math.abs(lamports) / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 9 });
    return `${lamports > 0 ? '+' : '-'}${amount} SOL`;
}

function truncateAddress(address: string): string {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
}
