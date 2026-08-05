import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Keypair } from '@solana/web3.js';
import { validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import {
    Outlet,
    RouterProvider,
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    useNavigate,
} from '@tanstack/react-router';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { keypairFromMnemonic } from '@/extension/mnemonic';
import type {
    ActiveRpcSummary,
    ApprovalDecision,
    ApprovalDetails,
    QueuedTransactionSummary,
    RpcSummary,
    WalletStatus,
} from '@/extension/messages';
import { getSolanaExplorerAccountTokensUrl } from '@/lib/solana';

const labelClassName = 'my-[1em] text-[11px] tracking-[0.12em] text-[#68f58a] uppercase';
const panelClassName = 'my-[1em] rounded-[6px] border border-[#29332c] bg-[#151a17] p-[14px]';
const warningClassName = 'my-[1em] text-xs leading-normal text-[#ffce73]';
const errorClassName = 'my-[1em] text-xs leading-normal text-[#ff8f8f]';
const buttonClassName =
    'cursor-pointer rounded-sm border-0 bg-[#68f58a] p-[13px] font-bold text-[#081009] disabled:cursor-wait disabled:opacity-45';
const secondaryButtonClassName = `${buttonClassName} border border-[#36433a] bg-[#202722] text-[#e7f7e9]`;
const inputClassName =
    'w-full rounded-[6px] border border-[#36433a] bg-[#101411] p-3 text-sm text-[#e7f7e9] outline-none focus:border-[#68f58a]';
const customRpcOrigins = ['http://*/*', 'https://*/*'];

const rootRoute = createRootRoute({
    component: WalletRoot,
    notFoundComponent: () => <ErrorView message="This wallet page does not exist." />,
});

type Toast = { message: string; tone: 'success' | 'error' };

function WalletRoot() {
    const [toast, setToast] = useState<Toast | null>(null);

    useEffect(() => {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const listener = (event: Event) => {
            const detail = (event as CustomEvent<Toast>).detail;
            setToast(detail);
            if (timeout) clearTimeout(timeout);
            timeout = setTimeout(() => setToast(null), 4000);
        };
        window.addEventListener('paranoid:toast', listener);
        return () => {
            window.removeEventListener('paranoid:toast', listener);
            if (timeout) clearTimeout(timeout);
        };
    }, []);

    return (
        <>
            <Outlet />
            {toast && (
                <div
                    className={`fixed right-4 bottom-4 left-4 z-50 rounded-[6px] border p-3 text-sm font-semibold shadow-lg ${
                        toast.tone === 'success'
                            ? 'border-[#68f58a] bg-[#142419] text-[#b9ffca]'
                            : 'border-[#ff8f8f] bg-[#2a1717] text-[#ffd0d0]'
                    }`}
                    role="status"
                    aria-live="polite"
                >
                    {toast.message}
                </div>
            )}
        </>
    );
}

const popupRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: WelcomePage,
});

const walletRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/wallet',
    component: PopupPage,
});

const createPasswordRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/create-password',
    component: CreatePasswordPage,
});

const unlockRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/unlock',
    component: UnlockPage,
});

const addKeypairRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/add-keypair',
    component: AddKeypairPage,
});

const seedPhraseRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/add-keypair/seed-phrase',
    component: SeedPhrasePage,
});

const keypairFileRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/add-keypair/file',
    component: KeypairFilePage,
});

const addRpcRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/add-rpc',
    component: AddRpcPage,
});

const customRpcRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/add-rpc/custom',
    component: CustomRpcPage,
});

const approvalRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/approval',
    validateSearch: (search: Record<string, unknown>) => ({
        id: typeof search.id === 'string' ? search.id : '',
    }),
    component: ApprovalPage,
});

const transactionQueueRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/transaction-queue',
    component: TransactionQueuePage,
});

const queuedTransactionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/transaction-queue/$transactionId',
    component: QueuedTransactionPage,
});

const routeTree = rootRoute.addChildren([
    popupRoute,
    walletRoute,
    createPasswordRoute,
    unlockRoute,
    addKeypairRoute,
    seedPhraseRoute,
    keypairFileRoute,
    addRpcRoute,
    customRpcRoute,
    approvalRoute,
    transactionQueueRoute,
    queuedTransactionRoute,
]);

export function ExtensionApp({ initialPath }: { initialPath: string }) {
    const [queryClient] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: { retry: false },
                    mutations: { retry: false },
                },
            })
    );
    const [router] = useState(() =>
        createRouter({
            routeTree,
            history: createMemoryHistory({ initialEntries: [initialPath] }),
        })
    );

    return (
        <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
        </QueryClientProvider>
    );
}

function WelcomePage() {
    const navigate = useNavigate();
    const launchApp = async () => {
        await chrome.storage.local.set({ welcomeCompleted: true });
        await navigate({ to: '/create-password' });
    };

    return (
        <WalletFrame eyebrow="PARANOID / SOLANA WALLET" welcome>
            <div>
                <h1 className="mt-3 mb-2.5 text-[32px] leading-[1.15] font-bold">Paranoid Wallet</h1>
                <p className="m-0 text-[15px] leading-normal text-[#b7c8ba]">A Solana wallet you never have to trust</p>
            </div>
            <div>
                <p className={warningClassName}>Use disposable test keys and review the selected RPC before signing.</p>
                <button className={`${buttonClassName} mt-4 w-full`} onClick={launchApp}>
                    Launch app
                </button>
            </div>
        </WalletFrame>
    );
}

function CreatePasswordPage() {
    const navigate = useNavigate();
    const [password, setPassword] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [localError, setLocalError] = useState('');
    const setup = useMutation({
        mutationFn: (value: string) => sendMessage<boolean>({ type: 'wallet:setup-vault', password: value }),
        onSuccess: async () => {
            setPassword('');
            setConfirmation('');
            const status = await sendMessage<WalletStatus>({ type: 'wallet:status' });
            await navigate({ to: nextWalletPath(status) });
        },
    });

    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (password.length < 8) {
            setLocalError('Use at least 8 characters. A longer password is safer.');
            return;
        }
        if (password !== confirmation) {
            setLocalError('Passwords do not match.');
            return;
        }
        setLocalError('');
        setup.mutate(password);
    };

    return (
        <WalletFrame eyebrow="PARANOID / SECURE WALLET">
            <h1 className="mt-3 mb-3 text-2xl leading-[1.15] font-bold">Create a password</h1>
            <p className="mb-5 text-sm leading-normal text-[#b7c8ba]">
                Your password encrypts every keypair before it is stored. Paranoid cannot recover it.
            </p>
            <form onSubmit={submit}>
                <label className={labelClassName} htmlFor="password">
                    Password
                </label>
                <input
                    id="password"
                    className={inputClassName}
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => {
                        setPassword(event.target.value);
                        setLocalError('');
                    }}
                    autoFocus
                />
                <label className={labelClassName} htmlFor="confirm-password">
                    Confirm password
                </label>
                <input
                    id="confirm-password"
                    className={inputClassName}
                    type="password"
                    autoComplete="new-password"
                    value={confirmation}
                    onChange={(event) => {
                        setConfirmation(event.target.value);
                        setLocalError('');
                    }}
                />
                {(localError || setup.isError) && (
                    <p className={errorClassName}>{localError || errorMessage(setup.error)}</p>
                )}
                <p className={warningClassName}>The wallet locks after 5 minutes without activity.</p>
                <button className={`${buttonClassName} mt-4 w-full`} disabled={setup.isPending} type="submit">
                    Create password
                </button>
            </form>
        </WalletFrame>
    );
}

function UnlockPage() {
    const navigate = useNavigate();
    const [password, setPassword] = useState('');
    const unlock = useMutation({
        mutationFn: (value: string) => sendMessage<boolean>({ type: 'wallet:unlock', password: value }),
        onSuccess: async () => {
            setPassword('');
            const status = await sendMessage<WalletStatus>({ type: 'wallet:status' });
            await navigate({ to: nextWalletPath(status) });
        },
    });

    return (
        <WalletFrame eyebrow="PARANOID / WALLET LOCKED">
            <h1 className="mt-3 mb-3 text-2xl leading-[1.15] font-bold">Unlock wallet</h1>
            <p className="mb-5 text-sm leading-normal text-[#b7c8ba]">
                Enter your password to decrypt keypairs in memory. The wallet locks after 5 minutes without activity.
            </p>
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    if (password) unlock.mutate(password);
                }}
            >
                <label className={labelClassName} htmlFor="unlock-password">
                    Password
                </label>
                <input
                    id="unlock-password"
                    className={inputClassName}
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoFocus
                />
                {unlock.isError && <p className={errorClassName}>{errorMessage(unlock.error)}</p>}
                <button
                    className={`${buttonClassName} mt-4 w-full`}
                    disabled={!password || unlock.isPending}
                    type="submit"
                >
                    Unlock
                </button>
            </form>
        </WalletFrame>
    );
}

function AddKeypairPage() {
    const navigate = useNavigate();

    return (
        <WalletFrame eyebrow="PARANOID / ADD KEYPAIR">
            <h1 className="mt-3 mb-3 text-2xl leading-[1.15] font-bold">Add Keypair</h1>
            <p className="mb-5 text-sm leading-normal text-[#b7c8ba]">
                Create a new Solana keypair in your terminal, then import it here.
            </p>
            <code className={`${panelClassName} block [overflow-wrap:anywhere] text-[#68f58a]`}>
                solana-keygen new -o ./&lt;your custom filename&gt;.json
            </code>
            <p className={warningClassName}>Use a disposable keypair that does not hold real assets.</p>
            <div className="mt-6 grid gap-2.5">
                <button className={buttonClassName} onClick={() => navigate({ to: '/add-keypair/seed-phrase' })}>
                    Import seed phrase
                </button>
                <button className={secondaryButtonClassName} onClick={() => navigate({ to: '/add-keypair/file' })}>
                    Select keypair JSON
                </button>
            </div>
        </WalletFrame>
    );
}

function SeedPhrasePage() {
    const navigate = useNavigate();
    const [phrase, setPhrase] = useState('');
    const importKeypair = useImportKeypair();

    const submit = () => {
        const normalized = phrase.trim().toLowerCase().replace(/\s+/g, ' ');
        const words = normalized ? normalized.split(' ') : [];
        if ((words.length !== 12 && words.length !== 24) || !validateMnemonic(normalized, wordlist)) {
            importKeypair.setLocalError('Enter a valid 12 or 24 word seed phrase.');
            return;
        }
        importKeypair.mutate(Array.from(keypairFromMnemonic(normalized).secretKey), {
            onSuccess: async () => navigate({ to: nextWalletPath(await getWalletStatus()) }),
        });
    };

    return (
        <ImportFrame
            title="Import seed phrase"
            error={importKeypair.error}
            back={() => navigate({ to: '/add-keypair' })}
        >
            <label className={labelClassName} htmlFor="seed-phrase">
                12 or 24 words
            </label>
            <textarea
                id="seed-phrase"
                className={`${inputClassName} min-h-32 resize-none`}
                value={phrase}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                    setPhrase(event.target.value);
                    importKeypair.setLocalError('');
                }}
                placeholder="word one word two ..."
            />
            <button className={`${buttonClassName} mt-4 w-full`} disabled={importKeypair.isPending} onClick={submit}>
                Import keypair
            </button>
        </ImportFrame>
    );
}

function KeypairFilePage() {
    const navigate = useNavigate();
    const [fileName, setFileName] = useState('No file selected');
    const [secretKey, setSecretKey] = useState<number[] | null>(null);
    const importKeypair = useImportKeypair();

    const selectFile = async (file: File | undefined) => {
        if (!file) return;
        setFileName(file.name);
        importKeypair.setLocalError('');
        try {
            const parsed: unknown = JSON.parse(await file.text());
            if (
                !Array.isArray(parsed) ||
                parsed.length !== 64 ||
                parsed.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
            ) {
                throw new Error('Select a Solana keypair JSON file containing 64 bytes.');
            }
            Keypair.fromSecretKey(new Uint8Array(parsed));
            setSecretKey(parsed as number[]);
        } catch (error) {
            setSecretKey(null);
            importKeypair.setLocalError(errorMessage(error));
        }
    };

    return (
        <ImportFrame
            title="Select keypair file"
            error={importKeypair.error}
            back={() => navigate({ to: '/add-keypair' })}
        >
            <p className="mb-4 text-sm leading-normal text-[#b7c8ba]">Choose the JSON file created by solana-keygen.</p>
            <label className={`${secondaryButtonClassName} block text-center`}>
                Choose .json file
                <input
                    className="hidden"
                    type="file"
                    accept="application/json,.json"
                    onChange={(event) => void selectFile(event.target.files?.[0])}
                />
            </label>
            <p className={`${panelClassName} truncate text-sm`}>{fileName}</p>
            <button
                className={`${buttonClassName} mt-4 w-full`}
                disabled={!secretKey || importKeypair.isPending}
                onClick={() =>
                    secretKey &&
                    importKeypair.mutate(secretKey, {
                        onSuccess: async () => navigate({ to: nextWalletPath(await getWalletStatus()) }),
                    })
                }
            >
                Import keypair
            </button>
        </ImportFrame>
    );
}

function AddRpcPage() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [permissionError, setPermissionError] = useState('');
    const selectRpc = useMutation({
        mutationFn: (id: string) => sendMessage<boolean>({ type: 'wallet:select-rpc', id }),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['wallet-status'] });
            await navigate({ to: '/wallet' });
        },
    });

    return (
        <WalletFrame eyebrow="PARANOID / ADD RPC">
            <h1 className="mt-3 mb-3 text-2xl leading-[1.15] font-bold">Add RPC</h1>
            <p className="mb-5 text-sm leading-normal text-[#b7c8ba]">
                Choose where Paranoid sends Solana requests. You can change this from the account page.
            </p>
            <div className="grid gap-2.5">
                <button
                    className={buttonClassName}
                    disabled={selectRpc.isPending}
                    onClick={() => selectRpc.mutate('localnet')}
                >
                    Use Localnet
                </button>
                <button
                    className={buttonClassName}
                    disabled={selectRpc.isPending}
                    onClick={() => selectRpc.mutate('devnet')}
                >
                    Use Devnet
                </button>
                <button
                    className={secondaryButtonClassName}
                    disabled={selectRpc.isPending}
                    onClick={() => selectRpc.mutate('testnet')}
                >
                    Use Testnet
                </button>
                <button
                    className={`${secondaryButtonClassName} mt-2`}
                    disabled={selectRpc.isPending}
                    onClick={async () => {
                        setPermissionError('');
                        try {
                            await requestCustomRpcAccess();
                            await navigate({ to: '/add-rpc/custom' });
                        } catch (error) {
                            setPermissionError(errorMessage(error));
                        }
                    }}
                >
                    Use Custom RPC
                </button>
            </div>
            {(permissionError || selectRpc.isError) && (
                <p className={errorClassName}>{permissionError || errorMessage(selectRpc.error)}</p>
            )}
            <p className={warningClassName}>
                The selected RPC can observe your account activity and submitted transactions.
            </p>
        </WalletFrame>
    );
}

function CustomRpcPage() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [url, setUrl] = useState('');
    const [localError, setLocalError] = useState('');
    const addRpc = useMutation({
        mutationFn: (value: string) => sendMessage<RpcSummary>({ type: 'wallet:add-rpc', url: value }),
        onSuccess: async () => {
            setUrl('');
            await queryClient.invalidateQueries({ queryKey: ['wallet-status'] });
            await navigate({ to: '/wallet' });
        },
    });

    return (
        <WalletFrame eyebrow="PARANOID / ADD RPC">
            <button
                className="mb-4 cursor-pointer border-0 bg-transparent p-0 text-xs text-[#b7c8ba]"
                onClick={() => navigate({ to: '/add-rpc' })}
            >
                &lt; Back
            </button>
            <h1 className="mt-0 mb-3 text-2xl leading-[1.15] font-bold">Custom RPC</h1>
            <p className="mb-5 text-sm leading-normal text-[#b7c8ba]">
                The full URL is encrypted with your wallet password before it is stored.
            </p>
            <form
                onSubmit={async (event) => {
                    event.preventDefault();
                    setLocalError('');
                    try {
                        const normalized = normalizeRpcUrl(url);
                        const granted = await chrome.permissions.contains({ origins: customRpcOrigins });
                        if (!granted) throw new Error('Select Add Custom RPC to allow RPC access first');
                        addRpc.mutate(normalized);
                    } catch (error) {
                        setLocalError(errorMessage(error));
                    }
                }}
            >
                <label className={labelClassName} htmlFor="rpc-url">
                    RPC URL
                </label>
                <input
                    id="rpc-url"
                    className={inputClassName}
                    type="url"
                    inputMode="url"
                    placeholder="https://rpc.example.com"
                    value={url}
                    onChange={(event) => {
                        setUrl(event.target.value);
                        setLocalError('');
                    }}
                    autoFocus
                />
                {(localError || addRpc.isError) && (
                    <p className={errorClassName}>{localError || errorMessage(addRpc.error)}</p>
                )}
                <button
                    className={`${buttonClassName} mt-4 w-full`}
                    disabled={!url.trim() || addRpc.isPending}
                    type="submit"
                >
                    Add RPC
                </button>
            </form>
        </WalletFrame>
    );
}

function PopupPage() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const status = useQuery({
        queryKey: ['wallet-status'],
        queryFn: () => sendMessage<WalletStatus>({ type: 'wallet:status' }),
    });
    const selectWallet = useMutation({
        mutationFn: (name: string) => sendMessage<boolean>({ type: 'wallet:select', name }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['wallet-status'] }),
    });
    const queue = useTransactionQueue(status.data?.active?.publicKey, status.data?.activeRpc?.id);

    if (!status.isPending && !status.isError && !status.data.active) return <AddKeypairPage />;
    if (!status.isPending && !status.isError && !status.data.activeRpc) return <AddRpcPage />;

    const active = status.data?.active;
    const activeRpc = status.data?.activeRpc;
    const explorerUrl =
        active && activeRpc
            ? getSolanaExplorerAccountTokensUrl(
                  active.publicKey,
                  activeRpc.chain,
                  activeRpc.kind === 'custom' || activeRpc.kind === 'localnet' ? activeRpc.url : undefined
              )
            : undefined;
    return (
        <WalletFrame eyebrow="PARANOID / TEST WALLET">
            <div className="mt-3 mb-6 flex items-start justify-between gap-3">
                <div>
                    <h1 className="m-0 font-mono text-2xl leading-[1.15] font-bold">
                        {truncateAddress(active?.publicKey)}
                    </h1>
                </div>
                <select
                    aria-label="Active keypair"
                    className="max-w-40 rounded-[6px] border border-[#36433a] bg-[#151a17] px-2.5 py-2 text-xs text-[#e7f7e9] outline-none"
                    disabled={!active || selectWallet.isPending}
                    value={active?.name ?? ''}
                    onChange={(event) => {
                        if (event.target.value === '__add__') void navigate({ to: '/add-keypair' });
                        else selectWallet.mutate(event.target.value);
                    }}
                >
                    {status.data?.wallets.map((wallet) => (
                        <option key={wallet.name} value={wallet.name}>
                            {wallet.name}
                        </option>
                    ))}
                    <option value="__add__">+ Add keypair</option>
                </select>
            </div>
            <RpcSelect rpcs={status.data?.rpcs ?? []} active={activeRpc ?? null} />
            {status.isError ? (
                <p className={errorClassName}>{errorMessage(status.error)}</p>
            ) : (
                <div>
                    <p className={labelClassName}>Balance</p>
                    <p className={panelClassName}>{formatBalance(status.data?.balance)}</p>
                    {explorerUrl && (
                        <div className="my-[1em] rounded-[6px] border border-[#36433a] bg-[#101411] p-[14px] text-xs leading-relaxed text-[#b7c8ba]">
                            Paranoid will not show your token balances. To view them, visit Solana Explorer{' '}
                            <a
                                className="inline-flex items-center gap-1 font-semibold text-[#68f58a] underline decoration-[#68f58a]/50 underline-offset-2 hover:decoration-[#68f58a]"
                                href={explorerUrl}
                                target="_blank"
                                rel="noreferrer"
                            >
                                here
                                <svg
                                    aria-hidden="true"
                                    className="size-3"
                                    viewBox="0 0 16 16"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.75"
                                >
                                    <path d="M5 11 11 5M6 5h5v5" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            </a>
                            .
                        </div>
                    )}
                </div>
            )}
            {selectWallet.isError && <p className={errorClassName}>{errorMessage(selectWallet.error)}</p>}
            <p className={warningClassName}>Keypairs and custom RPC URLs are encrypted at rest.</p>
            <button
                className="mt-8 flex w-full cursor-pointer items-center justify-between rounded-[6px] border border-[#36433a] bg-[#151a17] p-[14px] text-left font-semibold text-[#e7f7e9]"
                onClick={() => navigate({ to: '/transaction-queue' })}
            >
                <span>Transaction Queue</span>
                <span className="min-w-6 rounded-full bg-[#68f58a] px-1.5 py-0.5 text-center text-xs font-bold text-[#081009]">
                    {queue.data?.length ?? 0}
                </span>
            </button>
        </WalletFrame>
    );
}

function TransactionQueuePage() {
    const navigate = useNavigate();
    const status = useQuery({
        queryKey: ['wallet-status'],
        queryFn: () => sendMessage<WalletStatus>({ type: 'wallet:status' }),
    });
    const queue = useTransactionQueue(status.data?.active?.publicKey, status.data?.activeRpc?.id);

    return (
        <WalletFrame eyebrow="PARANOID / TRANSACTION QUEUE">
            <button
                className="mb-4 cursor-pointer border-0 bg-transparent p-0 text-xs text-[#b7c8ba]"
                onClick={() => navigate({ to: '/wallet' })}
            >
                &lt; Account
            </button>
            <h1 className="mt-0 mb-3 text-2xl leading-[1.15] font-bold">Transaction Queue</h1>
            <p className="mb-5 text-sm leading-normal text-[#b7c8ba]">
                Deferred transactions for this keypair and RPC.
            </p>
            {(status.isError || queue.isError) && (
                <p className={errorClassName}>{errorMessage(status.error ?? queue.error)}</p>
            )}
            {!queue.isPending && queue.data?.length === 0 && (
                <p className={panelClassName}>There are no deferred transactions.</p>
            )}
            <div className="grid gap-2.5">
                {queue.data?.map((transaction) => (
                    <button
                        key={transaction.id}
                        className="cursor-pointer rounded-[6px] border border-[#36433a] bg-[#151a17] p-[14px] text-left text-[#e7f7e9]"
                        onClick={() =>
                            navigate({
                                to: '/transaction-queue/$transactionId',
                                params: { transactionId: transaction.id },
                            })
                        }
                    >
                        <span className="block font-semibold">{transaction.title}</span>
                        <span className="mt-1 block truncate text-xs text-[#b7c8ba]">{transaction.origin}</span>
                        <span className="mt-2 block text-[11px] tracking-[0.08em] text-[#68f58a] uppercase">
                            {new Date(transaction.createdAt).toLocaleString()}
                        </span>
                    </button>
                ))}
            </div>
        </WalletFrame>
    );
}

function QueuedTransactionPage() {
    const { transactionId } = queuedTransactionRoute.useParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const queue = useQuery({
        queryKey: ['transaction-queue'],
        queryFn: () => sendMessage<QueuedTransactionSummary[]>({ type: 'queue:list' }),
    });
    const transaction = queue.data?.find((item) => item.id === transactionId);
    const decision = useMutation({
        mutationFn: (value: 'sign' | 'defer') =>
            sendMessage<{ signature?: string } | boolean>({ type: `queue:${value}`, id: transactionId }),
        onSuccess: async (_, value) => {
            if (value === 'sign' && transaction?.method === 'signAndSendTransaction') {
                showToast('Transaction signed and sent successfully.', 'success');
            }
            await queryClient.invalidateQueries({ queryKey: ['transaction-queue'] });
            await navigate({ to: '/transaction-queue' });
        },
        onError: (error, value) => {
            if (value === 'sign' && transaction?.method === 'signAndSendTransaction') {
                showToast(`Transaction failed: ${errorMessage(error)}`, 'error');
            }
        },
    });

    if (queue.isError) return <ErrorView message={errorMessage(queue.error)} />;
    if (!queue.isPending && !transaction) return <ErrorView message="Queued transaction not found" />;

    return (
        <WalletFrame eyebrow="PARANOID / SIGNING REQUEST">
            <h1 className="mt-3 mb-5 text-2xl leading-[1.15] font-bold">
                {transaction?.title ?? 'Loading transaction...'}
            </h1>
            {transaction && (
                <>
                    <p className={`${panelClassName} [overflow-wrap:anywhere]`}>{transaction.origin}</p>
                    <TransactionLines lines={transaction.lines} />
                </>
            )}
            <p className={warningClassName}>Review this transaction before signing.</p>
            {decision.isError && <p className={errorClassName}>{errorMessage(decision.error)}</p>}
            <div className="mt-6 grid grid-cols-3 gap-2.5">
                <button
                    className={secondaryButtonClassName}
                    disabled={!transaction || decision.isPending}
                    onClick={() => navigate({ to: '/transaction-queue' })}
                >
                    Cancel
                </button>
                <button
                    className={secondaryButtonClassName}
                    disabled={!transaction || decision.isPending}
                    onClick={() => decision.mutate('defer')}
                >
                    Defer
                </button>
                <button
                    className={buttonClassName}
                    disabled={!transaction || decision.isPending}
                    onClick={() => decision.mutate('sign')}
                >
                    Sign
                </button>
            </div>
        </WalletFrame>
    );
}

function useTransactionQueue(publicKey?: string, rpcId?: string) {
    return useQuery({
        queryKey: ['transaction-queue', publicKey, rpcId],
        enabled: Boolean(publicKey && rpcId),
        queryFn: () => sendMessage<QueuedTransactionSummary[]>({ type: 'queue:list' }),
    });
}

function RpcSelect({ rpcs, active }: { rpcs: RpcSummary[]; active: ActiveRpcSummary | null }) {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [permissionError, setPermissionError] = useState('');
    const [isRequestingPermission, setIsRequestingPermission] = useState(false);
    const selectRpc = useMutation({
        mutationFn: (id: string) => sendMessage<boolean>({ type: 'wallet:select-rpc', id }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['wallet-status'] }),
    });

    return (
        <div className="mb-5">
            <label className={labelClassName} htmlFor="active-rpc">
                Active RPC
            </label>
            <select
                id="active-rpc"
                className={inputClassName}
                disabled={!active || selectRpc.isPending || isRequestingPermission}
                value={active?.id ?? ''}
                onChange={async (event) => {
                    if (event.target.value !== '__add__') {
                        setPermissionError('');
                        selectRpc.mutate(event.target.value);
                        return;
                    }
                    setPermissionError('');
                    setIsRequestingPermission(true);
                    try {
                        await requestCustomRpcAccess();
                        await navigate({ to: '/add-rpc/custom' });
                    } catch (error) {
                        setPermissionError(errorMessage(error));
                    } finally {
                        setIsRequestingPermission(false);
                    }
                }}
            >
                {rpcs.map((rpc) => (
                    <option key={rpc.id} value={rpc.id}>
                        {rpc.name}
                        {rpc.kind === 'custom' ? ' (Custom)' : ''}
                    </option>
                ))}
                <option value="__add__">+ Add Custom RPC</option>
            </select>
            {(permissionError || selectRpc.isError) && (
                <p className={errorClassName}>{permissionError || errorMessage(selectRpc.error)}</p>
            )}
        </div>
    );
}

function ImportFrame({
    title,
    error,
    back,
    children,
}: {
    title: string;
    error: string;
    back: () => void;
    children: ReactNode;
}) {
    return (
        <WalletFrame eyebrow="PARANOID / ADD KEYPAIR">
            <button className="mb-4 cursor-pointer border-0 bg-transparent p-0 text-xs text-[#b7c8ba]" onClick={back}>
                &lt; Back
            </button>
            <h1 className="mt-0 mb-5 text-2xl leading-[1.15] font-bold">{title}</h1>
            {children}
            {error && <p className={errorClassName}>{error}</p>}
            <p className={warningClassName}>Never import a seed phrase or keypair that holds real assets.</p>
        </WalletFrame>
    );
}

function useImportKeypair() {
    const [localError, setLocalError] = useState('');
    const mutation = useMutation({
        mutationFn: (secretKey: number[]) =>
            sendMessage<{ name: string; publicKey: string }>({ type: 'wallet:import', secretKey }),
    });
    return {
        ...mutation,
        error: localError || (mutation.isError ? errorMessage(mutation.error) : ''),
        setLocalError,
    };
}

function ApprovalPage() {
    const { id } = approvalRoute.useSearch();
    const request = useQuery({
        queryKey: ['approval', id],
        enabled: Boolean(id),
        queryFn: async () => {
            const details = (await chrome.runtime.sendMessage({ type: 'approval:get', id })) as ApprovalDetails | null;
            if (!details) throw new Error('This request expired');
            return details;
        },
    });
    const decision = useMutation({
        mutationFn: (value: ApprovalDecision) =>
            chrome.runtime.sendMessage({ type: 'approval:resolve', id, decision: value }),
        onSuccess: () => window.close(),
    });

    if (!id) return <ErrorView message="Missing approval request" close />;
    if (request.isError) return <ErrorView message={errorMessage(request.error)} close />;

    return (
        <WalletFrame eyebrow="PARANOID / SIGNING REQUEST">
            <h1 className="mt-3 mb-5 text-2xl leading-[1.15] font-bold">
                {request.data?.title ?? 'Loading request...'}
            </h1>
            {request.data && (
                <>
                    <p className={`${panelClassName} [overflow-wrap:anywhere]`}>{request.data.origin}</p>
                    <TransactionLines lines={request.data.lines} />
                </>
            )}
            <p className={warningClassName}>Disposable test key. Never fund this address with real assets.</p>
            {decision.isError && <p className={errorClassName}>{errorMessage(decision.error)}</p>}
            <div className={`mt-6 grid ${request.data?.transaction ? 'grid-cols-3' : 'grid-cols-2'} gap-2.5`}>
                <button
                    className={`${buttonClassName} bg-[#242b26] text-[#e7f7e9]`}
                    disabled={!request.data || decision.isPending}
                    onClick={() => decision.mutate('cancel')}
                >
                    {request.data?.transaction ? 'Cancel' : 'Reject'}
                </button>
                {request.data?.transaction && (
                    <button
                        className={secondaryButtonClassName}
                        disabled={decision.isPending}
                        onClick={() => decision.mutate('defer')}
                    >
                        Defer
                    </button>
                )}
                <button
                    className={buttonClassName}
                    disabled={!request.data || decision.isPending}
                    onClick={() => decision.mutate('approve')}
                >
                    {request.data?.transaction ? 'Sign' : 'Approve'}
                </button>
            </div>
        </WalletFrame>
    );
}

function TransactionLines({ lines }: { lines: string[] }) {
    return (
        <ul className={`${panelClassName} max-h-[220px] list-none overflow-auto`}>
            {lines.map((line, index) => (
                <li
                    className="[overflow-wrap:anywhere] [&+&]:mt-[9px] [&+&]:border-t [&+&]:border-[#29332c] [&+&]:pt-[9px]"
                    key={`${index}:${line}`}
                >
                    {line}
                </li>
            ))}
        </ul>
    );
}

function WalletFrame({
    eyebrow,
    children,
    welcome = false,
}: {
    eyebrow: string;
    children: ReactNode;
    welcome?: boolean;
}) {
    return (
        <main className={welcome ? 'flex min-h-[460px] flex-col justify-between p-7' : 'p-7'}>
            <p className={`${labelClassName} ${welcome ? 'mb-auto' : ''}`}>{eyebrow}</p>
            {children}
        </main>
    );
}

function ErrorView({ message, close = false }: { message: string; close?: boolean }) {
    return (
        <WalletFrame eyebrow="PARANOID / WALLET">
            <h1 className="mt-3 mb-5 text-2xl leading-[1.15] font-bold">{message}</h1>
            {close && (
                <button className={buttonClassName} onClick={() => window.close()}>
                    Close
                </button>
            )}
        </WalletFrame>
    );
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function showToast(message: string, tone: Toast['tone']): void {
    window.dispatchEvent(new CustomEvent<Toast>('paranoid:toast', { detail: { message, tone } }));
}

async function sendMessage<T>(message: Record<string, unknown>): Promise<T> {
    const response = (await chrome.runtime.sendMessage(message)) as T | { __error: string };
    if (response && typeof response === 'object' && '__error' in response) throw new Error(response.__error);
    return response;
}

function getWalletStatus(): Promise<WalletStatus> {
    return sendMessage<WalletStatus>({ type: 'wallet:status' });
}

function nextWalletPath(status: WalletStatus): '/add-keypair' | '/add-rpc' | '/wallet' {
    if (!status.active) return '/add-keypair';
    return status.activeRpc ? '/wallet' : '/add-rpc';
}

function normalizeRpcUrl(value: string): string {
    let url: URL;
    try {
        url = new URL(value.trim());
    } catch {
        throw new Error('Enter a valid RPC URL');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('RPC URL must use http or https');
    return url.toString();
}

async function requestCustomRpcAccess(): Promise<void> {
    const granted = await chrome.permissions.request({ origins: customRpcOrigins });
    if (!granted) throw new Error('Allow access to custom RPC URLs to continue');
}

function truncateAddress(address: string | undefined): string {
    return address ? `${address.slice(0, 4)}...${address.slice(-4)}` : 'Loading...';
}

function formatBalance(lamports: number | null | undefined): string {
    if (lamports === undefined) return 'Loading...';
    if (lamports === null) return 'Unavailable';
    return `${(lamports / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 9 })} SOL`;
}
