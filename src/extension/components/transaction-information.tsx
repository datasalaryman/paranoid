import type { SolBalanceChange } from '@/extension/messages';

export interface TransactionInformationProps {
    title: string;
    origin?: string;
    balanceChanges?: readonly SolBalanceChange[];
}

export function TransactionInformation({ title, origin, balanceChanges }: TransactionInformationProps) {
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
        </>
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
