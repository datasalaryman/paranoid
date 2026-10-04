import { useNavigate } from '@tanstack/react-router';

export function TransactionNavigation({
    active,
    savedTransactionCount,
}: {
    active?: 'saved-transactions' | 'history' | 'send';
    savedTransactionCount: number;
}) {
    const navigate = useNavigate();
    return (
        <nav className="sticky bottom-0 grid grid-cols-3 divide-x divide-[#36433a] border-t border-[#36433a] bg-[#151a17]">
            <TransactionNavButton
                label="Send SOL"
                value="Transfer"
                active={active === 'send'}
                onClick={() => navigate({ to: '/send-sol' })}
            />
            <TransactionNavButton
                label="Saved Transactions"
                value={`${savedTransactionCount} saved`}
                active={active === 'saved-transactions'}
                onClick={() => navigate({ to: '/saved-transactions' })}
            />
            <TransactionNavButton
                label="Transaction History"
                value="Recent activity"
                active={active === 'history'}
                onClick={() => navigate({ to: '/transaction-history' })}
            />
        </nav>
    );
}

function TransactionNavButton({
    label,
    value,
    active,
    onClick,
}: {
    label: string;
    value: string;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            className={`min-w-0 cursor-pointer border-0 px-3 py-3.5 text-center hover:bg-[#202722] ${
                active ? 'bg-[#142419] text-[#b9ffca]' : 'bg-transparent text-[#e7f7e9]'
            }`}
            type="button"
            aria-current={active ? 'page' : undefined}
            onClick={active ? undefined : onClick}
        >
            <span className="block text-[10px] tracking-[0.1em] text-[#68f58a] uppercase">{label}</span>
            <span className="mt-1 block truncate text-xs font-semibold">{value}</span>
        </button>
    );
}
