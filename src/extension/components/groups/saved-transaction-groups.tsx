import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type useNavigate } from '@tanstack/react-router';
import { useId, useState } from 'react';
import {
    buttonClassName,
    errorClassName,
    labelClassName,
    secondaryButtonClassName,
} from '@/extension/components/ui/styles';
import { showToast } from '@/extension/components/ui/toast';
import type { SavedTransactionSummary } from '@/extension/messages';
import { errorMessage, sendMessage } from '@/extension/runtime-messaging';

export function SavedTransactionGroups({
    freshTransactions,
    expiredTransactions,
    navigate,
}: {
    freshTransactions: SavedTransactionSummary[];
    expiredTransactions: SavedTransactionSummary[];
    navigate: ReturnType<typeof useNavigate>;
}) {
    return (
        <>
            <SavedTransactionGroup title="Fresh transactions" transactions={freshTransactions} navigate={navigate} />
            <SavedTransactionGroup title="Expired blockhash" transactions={expiredTransactions} navigate={navigate} />
        </>
    );
}

function SavedTransactionGroup({
    title,
    transactions,
    navigate,
}: {
    title: string;
    transactions: SavedTransactionSummary[];
    navigate: ReturnType<typeof useNavigate>;
}) {
    return (
        <section className="mb-5">
            <h2 className={labelClassName}>
                {title} ({transactions.length})
            </h2>
            <div className="grid gap-2.5">
                {transactions.map((transaction) => (
                    <SavedTransactionItem key={transaction.id} transaction={transaction} navigate={navigate} />
                ))}
            </div>
        </section>
    );
}

function SavedTransactionItem({
    transaction,
    navigate,
}: {
    transaction: SavedTransactionSummary;
    navigate: ReturnType<typeof useNavigate>;
}) {
    const [expanded, setExpanded] = useState(false);
    const actionsId = useId();
    const queryClient = useQueryClient();
    const pin = useMutation({
        mutationFn: () =>
            sendMessage<boolean>({
                type: 'saved-transactions:set-pinned',
                id: transaction.id,
                pinned: !transaction.pinned,
            }),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['saved-transactions'] });
        },
    });
    const decision = useMutation({
        mutationFn: (value: 'refresh-blockhash' | 'remove') =>
            sendMessage<boolean>({ type: `saved-transactions:${value}`, id: transaction.id }),
        onSuccess: async (_, value) => {
            showToast(
                value === 'remove' ? 'Saved transaction removed.' : 'Transaction blockhash refreshed.',
                'success'
            );
            await queryClient.invalidateQueries({ queryKey: ['saved-transactions'] });
        },
    });

    return (
        <div className="relative min-w-0 rounded-[6px] border border-[#36433a] bg-[#151a17] text-[#e7f7e9]">
            <button
                type="button"
                className={`absolute top-2 right-2 flex size-9 cursor-pointer items-center justify-center rounded-sm border-0 hover:bg-[#29332c] focus-visible:outline-2 focus-visible:outline-[#68f58a] disabled:cursor-wait disabled:opacity-45 ${transaction.pinned ? 'bg-[#29332c] text-[#68f58a]' : 'bg-transparent text-[#b7c8ba]'}`}
                aria-label={transaction.pinned ? 'Unpin transaction' : 'Pin transaction'}
                aria-pressed={Boolean(transaction.pinned)}
                title={transaction.pinned ? 'Unpin transaction' : 'Pin transaction to keep it after signing'}
                disabled={pin.isPending || decision.isPending}
                onClick={() => pin.mutate()}
            >
                <svg
                    aria-hidden="true"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill={transaction.pinned ? 'currentColor' : 'none'}
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <path d="M16 3H8l1 7-4 4v3h14v-3l-4-4 1-7Z" />
                    <path d="M12 17v5" />
                </svg>
            </button>
            <button
                className="flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent p-[14px] pr-14 text-left text-inherit"
                aria-expanded={expanded}
                aria-controls={actionsId}
                onClick={() => setExpanded(!expanded)}
            >
                <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{transaction.title}</span>
                    <span className="mt-1 block truncate text-xs text-[#b7c8ba]">{transaction.origin}</span>
                    <span className="mt-2 block text-[11px] tracking-[0.08em] text-[#68f58a] uppercase">
                        {new Date(transaction.createdAt).toLocaleString()}
                    </span>
                </span>
                <span aria-hidden="true" className="text-[#68f58a]">
                    {expanded ? '-' : '+'}
                </span>
            </button>
            {pin.isError && <p className={`${errorClassName} px-[14px]`}>{errorMessage(pin.error)}</p>}
            <div id={actionsId} hidden={!expanded} className="border-t border-[#36433a] p-[14px]">
                <div className="grid grid-cols-2 gap-2.5">
                    <button
                        className={buttonClassName}
                        disabled={decision.isPending}
                        onClick={() =>
                            navigate({
                                to: '/saved-transactions/$transactionId',
                                params: { transactionId: transaction.id },
                            })
                        }
                    >
                        View
                    </button>
                    <button className={secondaryButtonClassName} onClick={() => setExpanded(false)}>
                        Cancel
                    </button>
                    <button
                        className={secondaryButtonClassName}
                        disabled={decision.isPending}
                        onClick={() => decision.mutate('remove')}
                    >
                        Remove
                    </button>
                    {transaction.expiredBlockhash && (
                        <button
                            className={secondaryButtonClassName}
                            disabled={decision.isPending}
                            onClick={() => decision.mutate('refresh-blockhash')}
                        >
                            Refresh Blockhash
                        </button>
                    )}
                </div>
                {decision.isError && <p className={errorClassName}>{errorMessage(decision.error)}</p>}
            </div>
        </div>
    );
}
