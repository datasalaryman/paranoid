import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type ReactNode, useEffect, useState } from 'react';
import { SolanaIdentifierActions } from '@/extension/components/blocks/solana-identifier-actions';
import { errorClassName } from '@/extension/components/ui/styles';
import type { ActiveRpcSummary, RpcSummary, WalletSummary } from '@/extension/messages';
import { errorMessage, sendMessage } from '@/extension/runtime-messaging';

function truncateAddress(address: string): string {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function AccountNavigation({
    wallets,
    activeWallet,
    rpcs,
    activeRpc,
}: {
    wallets: WalletSummary[];
    activeWallet: WalletSummary | null;
    rpcs: RpcSummary[];
    activeRpc: ActiveRpcSummary | null;
}) {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [openMenu, setOpenMenu] = useState<'keypair' | 'rpc' | null>(null);
    const selectWallet = useMutation({
        mutationFn: (name: string) => sendMessage<boolean>({ type: 'wallet:select', name }),
        onSuccess: async () => {
            setOpenMenu(null);
            await queryClient.invalidateQueries({ queryKey: ['wallet-status'] });
        },
    });
    const selectRpc = useMutation({
        mutationFn: (id: string) => sendMessage<boolean>({ type: 'wallet:select-rpc', id }),
        onSuccess: async () => {
            setOpenMenu(null);
            await queryClient.invalidateQueries({ queryKey: ['wallet-status'] });
        },
    });

    const open = (menu: 'keypair' | 'rpc') => {
        selectWallet.reset();
        selectRpc.reset();
        setOpenMenu(menu);
    };

    const addCustomRpc = async () => {
        setOpenMenu(null);
        await navigate({ to: '/add-rpc/custom' });
    };

    return (
        <>
            <nav className="grid grid-cols-2 divide-x divide-[#36433a] border-b border-[#36433a] bg-[#151a17]">
                <AccountNavButton
                    label="Active Keypair"
                    value={activeWallet?.label ?? 'Loading...'}
                    onClick={() => open('keypair')}
                />
                <AccountNavButton
                    label="Active RPC"
                    value={activeRpc?.name ?? 'Loading...'}
                    onClick={() => open('rpc')}
                />
            </nav>
            {openMenu === 'keypair' && (
                <SelectorDrawer title="Active Keypair" onClose={() => setOpenMenu(null)}>
                    {wallets.map((wallet) => (
                        <KeypairSelectorRow
                            key={wallet.name}
                            wallet={wallet}
                            rpc={activeRpc}
                            active={wallet.name === activeWallet?.name}
                            disabled={selectWallet.isPending}
                            onSelect={() => selectWallet.mutate(wallet.name)}
                            onRename={() => {
                                setOpenMenu(null);
                                void navigate({
                                    to: '/keypairs/$keypairName/rename',
                                    params: { keypairName: wallet.name },
                                });
                            }}
                        />
                    ))}
                    <SelectorButton
                        label="+ Add keypair"
                        disabled={selectWallet.isPending}
                        onClick={() => {
                            setOpenMenu(null);
                            void navigate({ to: '/add-keypair' });
                        }}
                    />
                    {selectWallet.isError && <p className={errorClassName}>{errorMessage(selectWallet.error)}</p>}
                </SelectorDrawer>
            )}
            {openMenu === 'rpc' && (
                <SelectorDrawer title="Active RPC" onClose={() => setOpenMenu(null)}>
                    {rpcs.map((rpc) =>
                        rpc.kind === 'custom' ? (
                            <RpcSelectorRow
                                key={rpc.id}
                                rpc={rpc}
                                active={rpc.id === activeRpc?.id}
                                disabled={selectRpc.isPending}
                                onSelect={() => selectRpc.mutate(rpc.id)}
                                onSettings={() => {
                                    setOpenMenu(null);
                                    void navigate({ to: '/rpcs/$rpcId/settings', params: { rpcId: rpc.id } });
                                }}
                            />
                        ) : (
                            <SelectorButton
                                key={rpc.id}
                                label={rpc.name}
                                active={rpc.id === activeRpc?.id}
                                disabled={selectRpc.isPending}
                                onClick={() => selectRpc.mutate(rpc.id)}
                            />
                        )
                    )}
                    <SelectorButton
                        label="+ Add Custom RPC"
                        disabled={selectRpc.isPending}
                        onClick={() => void addCustomRpc()}
                    />
                    <p className="text-xs text-[#b7c8ba]">
                        Sign Only signs for any app cluster without simulation. Sending requires an RPC.
                    </p>
                    {selectRpc.isError && <p className={errorClassName}>{errorMessage(selectRpc.error)}</p>}
                </SelectorDrawer>
            )}
        </>
    );
}

function KeypairSelectorRow({
    wallet,
    rpc,
    active,
    disabled,
    onSelect,
    onRename,
}: {
    wallet: WalletSummary;
    rpc: ActiveRpcSummary | null;
    active: boolean;
    disabled: boolean;
    onSelect: () => void;
    onRename: () => void;
}) {
    return (
        <div
            className={`flex overflow-hidden rounded-[6px] border ${
                active ? 'border-[#68f58a] bg-[#142419] text-[#b9ffca]' : 'border-[#36433a] bg-[#151a17] text-[#e7f7e9]'
            }`}
        >
            <div className="min-w-0 flex-1 p-3">
                <button
                    className="block w-full min-w-0 cursor-pointer border-0 bg-transparent text-left text-sm hover:text-[#68f58a] disabled:cursor-wait disabled:opacity-45"
                    type="button"
                    disabled={disabled}
                    aria-pressed={active}
                    onClick={onSelect}
                >
                    <span className="block truncate font-semibold">{wallet.label}</span>
                    {active && <span className="mt-1 block text-[10px] tracking-[0.08em] uppercase">Active</span>}
                </button>
                <div className="mt-1 flex items-center gap-1 text-xs text-[#829486]">
                    <span className="font-mono" title={wallet.publicKey}>
                        {truncateAddress(wallet.publicKey)}
                    </span>
                    <SolanaIdentifierActions value={wallet.publicKey} rpc={rpc} />
                </div>
            </div>
            <button
                className="flex w-11 shrink-0 cursor-pointer items-center justify-center border-0 border-l border-[#36433a] bg-transparent text-[#b7c8ba] hover:bg-[#202722] hover:text-[#e7f7e9] disabled:cursor-wait disabled:opacity-45"
                type="button"
                disabled={disabled}
                aria-label={`Rename ${wallet.label}`}
                onClick={onRename}
            >
                <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <circle cx="4" cy="10" r="1.5" />
                    <circle cx="10" cy="10" r="1.5" />
                    <circle cx="16" cy="10" r="1.5" />
                </svg>
            </button>
        </div>
    );
}

function RpcSelectorRow({
    rpc,
    active,
    disabled,
    onSelect,
    onSettings,
}: {
    rpc: RpcSummary;
    active: boolean;
    disabled: boolean;
    onSelect: () => void;
    onSettings: () => void;
}) {
    return (
        <div
            className={`flex overflow-hidden rounded-[6px] border ${
                active ? 'border-[#68f58a] bg-[#142419] text-[#b9ffca]' : 'border-[#36433a] bg-[#151a17] text-[#e7f7e9]'
            }`}
        >
            <button
                className="min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-3 text-left text-sm hover:bg-[#202722] disabled:cursor-wait disabled:opacity-45"
                type="button"
                disabled={disabled}
                aria-pressed={active}
                onClick={onSelect}
            >
                <span className="block truncate font-semibold">{rpc.name} (Custom)</span>
                {active && <span className="mt-1 block text-[10px] tracking-[0.08em] uppercase">Active</span>}
            </button>
            <button
                className="flex w-11 shrink-0 cursor-pointer items-center justify-center border-0 border-l border-[#36433a] bg-transparent text-[#b7c8ba] hover:bg-[#202722] hover:text-[#e7f7e9] disabled:cursor-wait disabled:opacity-45"
                type="button"
                disabled={disabled}
                aria-label={`Edit ${rpc.name}`}
                onClick={onSettings}
            >
                <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <circle cx="4" cy="10" r="1.5" />
                    <circle cx="10" cy="10" r="1.5" />
                    <circle cx="16" cy="10" r="1.5" />
                </svg>
            </button>
        </div>
    );
}

function AccountNavButton({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
    return (
        <button
            className="min-w-0 cursor-pointer border-0 bg-transparent px-3 py-3.5 text-center text-[#e7f7e9] hover:bg-[#202722]"
            type="button"
            aria-haspopup="dialog"
            onClick={onClick}
        >
            <span className="block text-[10px] tracking-[0.1em] text-[#68f58a] uppercase">{label}</span>
            <span className="mt-1 block truncate text-xs font-semibold">{value}</span>
        </button>
    );
}

function SelectorDrawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
    useEffect(() => {
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', closeOnEscape);
        return () => window.removeEventListener('keydown', closeOnEscape);
    }, [onClose]);

    return (
        <div
            className="fixed inset-0 z-40 bg-black/70 transition-opacity duration-300 ease-out starting:opacity-0 motion-reduce:transition-none"
            role="dialog"
            aria-modal="true"
            aria-labelledby="selector-drawer-title"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <section className="max-h-[85vh] w-full translate-y-0 overflow-y-auto overscroll-contain rounded-b-[8px] border-x border-b border-[#36433a] bg-[#101411] p-4 shadow-2xl transition-transform duration-300 ease-out starting:-translate-y-full motion-reduce:transition-none">
                <div className="mb-3 flex items-center justify-between gap-4">
                    <h2 id="selector-drawer-title" className="m-0 text-lg font-bold">
                        {title}
                    </h2>
                    <button
                        className="cursor-pointer border-0 bg-transparent p-1 text-xl leading-none text-[#b7c8ba]"
                        type="button"
                        aria-label={`Close ${title}`}
                        onClick={onClose}
                    >
                        &times;
                    </button>
                </div>
                <div className="grid gap-2">{children}</div>
            </section>
        </div>
    );
}

function SelectorButton({
    label,
    active = false,
    disabled = false,
    onClick,
}: {
    label: string;
    active?: boolean;
    disabled?: boolean;
    onClick: () => void;
}) {
    return (
        <button
            className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-[6px] border p-3 text-left text-sm disabled:cursor-wait disabled:opacity-45 ${
                active
                    ? 'border-[#68f58a] bg-[#142419] text-[#b9ffca]'
                    : 'border-[#36433a] bg-[#151a17] text-[#e7f7e9] hover:bg-[#202722]'
            }`}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={onClick}
        >
            <span className="truncate font-semibold">{label}</span>
            {active && <span className="text-[10px] tracking-[0.08em] uppercase">Active</span>}
        </button>
    );
}
