import {
    QueryClient,
    QueryClientProvider,
    useInfiniteQuery,
    useMutation,
    useQuery,
    useQueryClient,
} from '@tanstack/react-query';
import { Keypair } from '@solana/web3.js';
import { validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import {
    Link,
    Navigate,
    Outlet,
    RouterProvider,
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    useNavigate,
} from '@tanstack/react-router';
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { BackButton, useBackNavigation } from '@/extension/components/back-button';
import { TransactionInformation } from '@/extension/components/transaction-information';
import { SolanaIdentifierActions } from '@/extension/components/solana-identifier-actions';
import { SignOnlyExplorerLinks } from '@/extension/components/sign-only-explorer-links';
import { showToast, ToastNotification } from '@/extension/components/toast';
import { keypairFromMnemonic } from '@/extension/mnemonic';
import { parseSolAmount, validateSolRecipient } from '@/extension/send-sol';
import type {
    ActiveRpcSummary,
    ApprovalDecision,
    ApprovalDetails,
    SavedTransactionSummary,
    RpcSummary,
    TransactionHistoryDetails,
    TransactionHistoryPage,
    WalletStatus,
    WalletSummary,
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
const backgroundKeepaliveIntervalMs = 20_000;

const rootRoute = createRootRoute({
    component: WalletRoot,
    notFoundComponent: () => <ErrorView message="This wallet page does not exist." />,
});

function WalletRoot() {
    useEffect(() => {
        const reportActivity = () => {
            void chrome.runtime.sendMessage({ type: 'wallet:activity' }).catch(() => undefined);
        };
        const keepBackgroundAlive = () => {
            void chrome.runtime.sendMessage({ type: 'wallet:keepalive' }).catch(() => undefined);
        };
        const keepalive = setInterval(keepBackgroundAlive, backgroundKeepaliveIntervalMs);

        window.addEventListener('pointerdown', reportActivity);
        window.addEventListener('keydown', reportActivity);
        return () => {
            window.removeEventListener('pointerdown', reportActivity);
            window.removeEventListener('keydown', reportActivity);
            clearInterval(keepalive);
        };
    }, []);

    return (
        <>
            <Outlet />
            <ToastNotification />
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

const renameKeypairRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/keypairs/$keypairName/rename',
    component: RenameKeypairPage,
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

const rpcSettingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/rpcs/$rpcId/settings',
    component: RpcSettingsPage,
});

const approvalRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/approval',
    validateSearch: (search: Record<string, unknown>) => ({
        id: typeof search.id === 'string' ? search.id : '',
    }),
    component: ApprovalPage,
});

const sendSolRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/send-sol',
    component: SendSolPage,
});

const savedTransactionsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/saved-transactions',
    component: SavedTransactionsPage,
});

const savedTransactionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/saved-transactions/$transactionId',
    component: SavedTransactionPage,
});

const transactionHistoryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/transaction-history',
    component: TransactionHistoryPageView,
});

const transactionHistoryDetailsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/transaction-history/$signature',
    component: TransactionHistoryDetailsPage,
});

const routeTree = rootRoute.addChildren([
    popupRoute,
    walletRoute,
    createPasswordRoute,
    unlockRoute,
    addKeypairRoute,
    seedPhraseRoute,
    keypairFileRoute,
    renameKeypairRoute,
    addRpcRoute,
    customRpcRoute,
    rpcSettingsRoute,
    approvalRoute,
    sendSolRoute,
    savedTransactionsRoute,
    savedTransactionRoute,
    transactionHistoryRoute,
    transactionHistoryDetailsRoute,
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

function RenameKeypairPage() {
    const { keypairName } = renameKeypairRoute.useParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const status = useQuery({
        queryKey: ['wallet-status'],
        queryFn: getWalletStatus,
    });
    const wallet = status.data?.wallets.find(({ name }) => name === keypairName);
    const [label, setLabel] = useState('');
    const [confirmingRemoval, setConfirmingRemoval] = useState(false);
    const rename = useMutation({
        mutationFn: (value: string) => sendMessage<boolean>({ type: 'wallet:rename', name: keypairName, label: value }),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['wallet-status'] });
            showToast('Keypair label renamed.', 'success');
            await navigate({ to: '/wallet' });
        },
    });
    const remove = useMutation({
        mutationFn: () => sendMessage<boolean>({ type: 'wallet:remove', name: keypairName }),
        onSuccess: async () => {
            queryClient.removeQueries({ queryKey: ['saved-transactions'] });
            await queryClient.invalidateQueries({ queryKey: ['wallet-status'] });
            showToast('Keypair removed.', 'success');
            await navigate({ to: nextWalletPath(await getWalletStatus()) });
        },
    });

    useEffect(() => {
        if (wallet) setLabel(wallet.label);
    }, [wallet]);

    if (status.isError) return <ErrorView message={errorMessage(status.error)} />;
    if (!status.isPending && !wallet) return <ErrorView message="Keypair not found" />;

    return (
        <WalletFrame eyebrow="PARANOID / KEYPAIR SETTINGS">
            <BackButton fallback="/wallet" />
            <h1 className="mt-0 mb-3 text-2xl leading-[1.15] font-bold">Keypair settings</h1>
            <p className="mb-5 text-sm leading-normal text-[#b7c8ba]">
                Choose a label that makes this keypair easy to identify.
            </p>
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    if (label.trim()) rename.mutate(label);
                }}
            >
                <label className={labelClassName} htmlFor="keypair-label">
                    Label
                </label>
                <input
                    id="keypair-label"
                    className={inputClassName}
                    maxLength={40}
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    autoFocus
                />
                {wallet && <p className={`${panelClassName} truncate text-xs text-[#b7c8ba]`}>{wallet.publicKey}</p>}
                {rename.isError && <p className={errorClassName}>{errorMessage(rename.error)}</p>}
                <button
                    className={`${buttonClassName} mt-4 w-full`}
                    disabled={!wallet || !label.trim() || label.trim() === wallet.label || rename.isPending}
                    type="submit"
                >
                    Save label
                </button>
            </form>
            <section className="mt-8 border-t border-[#36433a] pt-5">
                <h2 className="m-0 text-sm font-bold text-[#ff8f8f]">Remove keypair</h2>
                <p className="my-3 text-xs leading-normal text-[#b7c8ba]">
                    This permanently removes the encrypted keypair and its saved transactions from this browser.
                </p>
                {remove.isError && <p className={errorClassName}>{errorMessage(remove.error)}</p>}
                {confirmingRemoval ? (
                    <div className="grid grid-cols-2 gap-2.5">
                        <button
                            className={secondaryButtonClassName}
                            disabled={remove.isPending}
                            type="button"
                            onClick={() => setConfirmingRemoval(false)}
                        >
                            Cancel
                        </button>
                        <button
                            className={`${buttonClassName} bg-[#ff8f8f] text-[#240909]`}
                            disabled={!wallet || remove.isPending}
                            type="button"
                            onClick={() => remove.mutate()}
                        >
                            Remove permanently
                        </button>
                    </div>
                ) : (
                    <button
                        className="w-full cursor-pointer rounded-sm border border-[#7d3f3f] bg-[#2a1717] p-[13px] font-bold text-[#ffb3b3] hover:bg-[#361b1b]"
                        type="button"
                        onClick={() => setConfirmingRemoval(true)}
                    >
                        Remove keypair
                    </button>
                )}
            </section>
        </WalletFrame>
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
                    className={secondaryButtonClassName}
                    disabled={selectRpc.isPending}
                    onClick={() => selectRpc.mutate('sign-only')}
                >
                    Sign Only
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
                The selected RPC can observe your account activity and submitted transactions. Sign Only works across
                clusters without an RPC, simulation, or broadcasting.
            </p>
        </WalletFrame>
    );
}

function CustomRpcPage() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [url, setUrl] = useState('');
    const [localError, setLocalError] = useState('');
    const [addedRpc, setAddedRpc] = useState<RpcSummary | null>(null);
    const explorerDialog = useRef<HTMLDialogElement>(null);
    const addRpc = useMutation({
        mutationFn: (value: string) => sendMessage<RpcSummary>({ type: 'wallet:add-rpc', url: value }),
        onSuccess: (rpc) => {
            setUrl('');
            setAddedRpc(rpc);
        },
    });
    const saveExplorerPreference = useMutation({
        mutationFn: (explorerMainnet: boolean) => {
            if (!addedRpc) throw new Error('Custom RPC not found');
            return sendMessage<boolean>({
                type: 'wallet:set-rpc-explorer-mainnet',
                id: addedRpc.id,
                explorerMainnet,
            });
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['wallet-status'] });
            await navigate({ to: '/wallet' });
        },
    });

    useEffect(() => {
        if (addedRpc) explorerDialog.current?.showModal();
    }, [addedRpc]);

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
                    disabled={!url.trim() || addRpc.isPending || !!addedRpc}
                    type="submit"
                >
                    Add RPC
                </button>
            </form>
            <dialog
                ref={explorerDialog}
                aria-labelledby="rpc-explorer-title"
                aria-describedby="rpc-explorer-description"
                onCancel={(event) => event.preventDefault()}
                className="m-auto w-[calc(100%-32px)] max-w-sm rounded-[6px] border border-[#36433a] bg-[#151a17] p-5 text-[#e7f7e9] backdrop:bg-black/70"
            >
                <h2 id="rpc-explorer-title" className="mt-0 text-lg font-bold">
                    Open explorer links on mainnet?
                </h2>
                <p id="rpc-explorer-description" className="text-sm leading-normal text-[#b7c8ba]">
                    Custom RPC added. Use mainnet for this RPC's explorer links instead of including your RPC URL? This
                    does not change where wallet requests are sent. You can change this in RPC settings.
                </p>
                {saveExplorerPreference.isError && (
                    <p className={errorClassName}>{errorMessage(saveExplorerPreference.error)}</p>
                )}
                <div className="mt-4 grid grid-cols-2 gap-2.5">
                    <button
                        type="button"
                        className={buttonClassName}
                        autoFocus
                        disabled={saveExplorerPreference.isPending}
                        onClick={() => saveExplorerPreference.mutate(true)}
                    >
                        Yes
                    </button>
                    <button
                        type="button"
                        className={secondaryButtonClassName}
                        disabled={saveExplorerPreference.isPending}
                        onClick={() => saveExplorerPreference.mutate(false)}
                    >
                        No
                    </button>
                </div>
            </dialog>
        </WalletFrame>
    );
}

function RpcSettingsPage() {
    const { rpcId } = rpcSettingsRoute.useParams();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const rpc = useQuery({
        queryKey: ['rpc', rpcId],
        queryFn: () => sendMessage<ActiveRpcSummary>({ type: 'wallet:get-rpc', id: rpcId }),
    });
    const [label, setLabel] = useState('');
    const [url, setUrl] = useState('');
    const [explorerMainnet, setExplorerMainnet] = useState(false);
    const [localError, setLocalError] = useState('');
    const [confirmingRemoval, setConfirmingRemoval] = useState(false);
    const update = useMutation({
        mutationFn: ({ label, url, explorerMainnet }: { label: string; url: string; explorerMainnet: boolean }) =>
            sendMessage<boolean>({ type: 'wallet:update-rpc', id: rpcId, label, url, explorerMainnet }),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['wallet-status'] });
            queryClient.removeQueries({ queryKey: ['rpc', rpcId] });
            showToast('Custom RPC updated.', 'success');
            await navigate({ to: '/wallet' });
        },
    });
    const remove = useMutation({
        mutationFn: () => sendMessage<boolean>({ type: 'wallet:remove-rpc', id: rpcId }),
        onSuccess: async () => {
            queryClient.removeQueries({ queryKey: ['rpc', rpcId] });
            queryClient.removeQueries({ queryKey: ['saved-transactions'] });
            await queryClient.invalidateQueries({ queryKey: ['wallet-status'] });
            showToast('Custom RPC removed.', 'success');
            await navigate({ to: '/wallet' });
        },
    });

    useEffect(() => {
        if (!rpc.data) return;
        setLabel(rpc.data.name);
        setUrl(rpc.data.url);
        setExplorerMainnet(rpc.data.explorerMainnet ?? false);
    }, [rpc.data]);

    if (rpc.isError) return <ErrorView message={errorMessage(rpc.error)} />;

    const unchanged =
        label.trim() === rpc.data?.name &&
        url.trim() === rpc.data?.url &&
        explorerMainnet === (rpc.data?.explorerMainnet ?? false);
    return (
        <WalletFrame eyebrow="PARANOID / RPC SETTINGS">
            <BackButton fallback="/wallet" />
            <h1 className="mt-0 mb-3 text-2xl leading-[1.15] font-bold">Custom RPC settings</h1>
            <p className="mb-5 text-sm leading-normal text-[#b7c8ba]">
                Update the label or endpoint. Paranoid verifies the endpoint's Solana cluster before saving it.
            </p>
            <form
                onSubmit={async (event) => {
                    event.preventDefault();
                    setLocalError('');
                    try {
                        const normalized = normalizeRpcUrl(url);
                        const granted = await chrome.permissions.contains({ origins: customRpcOrigins });
                        if (!granted) throw new Error('Allow access to custom RPC URLs to continue');
                        update.mutate({ label, url: normalized, explorerMainnet });
                    } catch (error) {
                        setLocalError(errorMessage(error));
                    }
                }}
            >
                <label className={labelClassName} htmlFor="rpc-label">
                    Label
                </label>
                <input
                    id="rpc-label"
                    className={inputClassName}
                    maxLength={40}
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    autoFocus
                />
                <label className={labelClassName} htmlFor="rpc-settings-url">
                    RPC URL
                </label>
                <input
                    id="rpc-settings-url"
                    className={inputClassName}
                    type="url"
                    inputMode="url"
                    value={url}
                    onChange={(event) => {
                        setUrl(event.target.value);
                        setLocalError('');
                    }}
                />
                <label className="mt-5 flex cursor-pointer items-center justify-between gap-3 text-sm">
                    Open explorer links on mainnet
                    <input
                        type="checkbox"
                        role="switch"
                        checked={explorerMainnet}
                        onChange={(event) => setExplorerMainnet(event.target.checked)}
                        className="relative h-6 w-10 shrink-0 cursor-pointer appearance-none rounded-full border border-[#36433a] bg-[#202722] before:absolute before:top-0.5 before:left-0.5 before:size-4 before:rounded-full before:bg-[#b7c8ba] before:transition-transform checked:bg-[#68f58a] checked:before:translate-x-4 checked:before:bg-[#081009] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#68f58a]"
                    />
                </label>
                <p className="text-xs leading-normal text-[#b7c8ba]">
                    When enabled, explorer links use mainnet without including your RPC URL. Wallet requests still use
                    this endpoint.
                </p>
                {(localError || update.isError) && (
                    <p className={errorClassName}>{localError || errorMessage(update.error)}</p>
                )}
                <button
                    className={`${buttonClassName} mt-4 w-full`}
                    disabled={!rpc.data || !label.trim() || !url.trim() || unchanged || update.isPending}
                    type="submit"
                >
                    Save RPC
                </button>
            </form>
            <section className="mt-8 border-t border-[#36433a] pt-5">
                <h2 className="m-0 text-sm font-bold text-[#ff8f8f]">Remove custom RPC</h2>
                <p className="my-3 text-xs leading-normal text-[#b7c8ba]">
                    This permanently removes the encrypted URL and its saved transactions from this browser.
                </p>
                {remove.isError && <p className={errorClassName}>{errorMessage(remove.error)}</p>}
                {confirmingRemoval ? (
                    <div className="grid grid-cols-2 gap-2.5">
                        <button
                            className={secondaryButtonClassName}
                            disabled={remove.isPending}
                            type="button"
                            onClick={() => setConfirmingRemoval(false)}
                        >
                            Cancel
                        </button>
                        <button
                            className={`${buttonClassName} bg-[#ff8f8f] text-[#240909]`}
                            disabled={!rpc.data || remove.isPending}
                            type="button"
                            onClick={() => remove.mutate()}
                        >
                            Remove permanently
                        </button>
                    </div>
                ) : (
                    <button
                        className="w-full cursor-pointer rounded-sm border border-[#7d3f3f] bg-[#2a1717] p-[13px] font-bold text-[#ffb3b3] hover:bg-[#361b1b]"
                        type="button"
                        onClick={() => setConfirmingRemoval(true)}
                    >
                        Remove custom RPC
                    </button>
                )}
            </section>
        </WalletFrame>
    );
}

function PopupPage() {
    const status = useQuery({
        queryKey: ['wallet-status'],
        queryFn: () => sendMessage<WalletStatus>({ type: 'wallet:status' }),
    });
    const savedTransactions = useSavedTransactions(status.data?.active?.publicKey, status.data?.activeRpc?.id);

    if (!status.isPending && !status.isError && !status.data.active) return <AddKeypairPage />;
    if (!status.isPending && !status.isError && !status.data.activeRpc) return <AddRpcPage />;

    const active = status.data?.active;
    const activeRpc = status.data?.activeRpc;
    const explorerUrl =
        active && activeRpc?.chain
            ? getSolanaExplorerAccountTokensUrl(
                  active.publicKey,
                  activeRpc.kind === 'custom' && activeRpc.explorerMainnet ? 'solana:mainnet' : activeRpc.chain,
                  (activeRpc.kind === 'custom' && !activeRpc.explorerMainnet) || activeRpc.kind === 'localnet'
                      ? activeRpc.url
                      : undefined
              )
            : undefined;
    return (
        <WalletFrame
            eyebrow="PARANOID / TEST WALLET"
            topNav={
                <AccountNavigation
                    wallets={status.data?.wallets ?? []}
                    activeWallet={active ?? null}
                    rpcs={status.data?.rpcs ?? []}
                    activeRpc={activeRpc ?? null}
                />
            }
            bottomNav={
                activeRpc?.chain && (
                    <TransactionNavigation savedTransactionCount={savedTransactions.data?.length ?? 0} />
                )
            }
        >
            <div className="mt-3 mb-6 flex items-center gap-2">
                <h1 className="m-0 font-mono text-2xl leading-[1.15] font-bold">
                    {truncateAddress(active?.publicKey)}
                </h1>
                {active && <SolanaIdentifierActions value={active.publicKey} rpc={activeRpc} />}
            </div>
            {status.isError ? (
                <p className={errorClassName}>{errorMessage(status.error)}</p>
            ) : activeRpc?.kind === 'sign-only' ? (
                active && <SignOnlyExplorerLinks publicKey={active.publicKey} />
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
            <p className={warningClassName}>Keypairs and custom RPC URLs are encrypted at rest.</p>
        </WalletFrame>
    );
}

function SendSolPage() {
    const queryClient = useQueryClient();
    const [recipient, setRecipient] = useState('');
    const [amount, setAmount] = useState('');
    const [errors, setErrors] = useState<{ recipient?: string; amount?: string }>({});
    const status = useQuery({
        queryKey: ['wallet-status'],
        queryFn: () => sendMessage<WalletStatus>({ type: 'wallet:status' }),
    });
    const active = status.data?.active;
    const rpc = status.data?.activeRpc;
    const savedTransactions = useSavedTransactions(active?.publicKey, rpc?.id);
    const send = useMutation({
        mutationFn: () =>
            sendMessage<{ signature: string }>({
                type: 'wallet:send-sol',
                recipient: recipient.trim(),
                amount: amount.trim(),
                publicKey: active?.publicKey,
                rpcId: rpc?.id,
            }),
        onSuccess: () => {
            setAmount('');
            showToast('Transaction submitted', 'success');
            void queryClient.invalidateQueries({ queryKey: ['wallet-status'] });
            void queryClient.invalidateQueries({ queryKey: ['transaction-history'] });
        },
    });
    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (send.isPending) return;
        const nextErrors: typeof errors = {};
        try {
            validateSolRecipient(recipient);
        } catch (error) {
            nextErrors.recipient = errorMessage(error);
        }
        try {
            parseSolAmount(amount);
        } catch (error) {
            nextErrors.amount = errorMessage(error);
        }
        setErrors(nextErrors);
        if (!nextErrors.recipient && !nextErrors.amount) send.mutate();
    };

    if (rpc?.kind === 'sign-only') return <Navigate to="/wallet" replace />;

    return (
        <WalletFrame
            eyebrow="PARANOID / SEND SOL"
            bottomNav={
                <TransactionNavigation active="send" savedTransactionCount={savedTransactions.data?.length ?? 0} />
            }
        >
            <BackButton fallback="/wallet" />
            <h1 className="mt-0 mb-3 text-2xl leading-[1.15] font-bold">Send SOL</h1>
            <p className={panelClassName}>
                From: <span className="break-all font-mono text-xs">{active?.publicKey ?? 'Loading...'}</span>
                <span className="mt-2 block text-xs text-[#b7c8ba]">
                    RPC: {rpc?.name}
                </span>
                <span className="mt-2 block text-xs">Balance: {formatBalance(status.data?.balance)}</span>
            </p>
            <form onSubmit={submit} noValidate className="grid gap-3">
                <label htmlFor="sol-recipient" className={labelClassName}>
                    Solana Address
                </label>
                <input
                    id="sol-recipient"
                    className={inputClassName}
                    value={recipient}
                    disabled={send.isPending}
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={Boolean(errors.recipient)}
                    aria-describedby={errors.recipient ? 'sol-recipient-error' : undefined}
                    onChange={(event) => {
                        setRecipient(event.target.value);
                        setErrors({ ...errors, recipient: undefined });
                        send.reset();
                    }}
                />
                {errors.recipient && (
                    <p id="sol-recipient-error" role="alert" className={errorClassName}>
                        {errors.recipient}
                    </p>
                )}
                <label htmlFor="sol-amount" className={labelClassName}>
                    Amount in SOL
                </label>
                <input
                    id="sol-amount"
                    className={inputClassName}
                    value={amount}
                    disabled={send.isPending}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0.00"
                    aria-invalid={Boolean(errors.amount)}
                    aria-describedby="sol-amount-help sol-amount-error"
                    onChange={(event) => {
                        setAmount(event.target.value);
                        setErrors({ ...errors, amount: undefined });
                        send.reset();
                    }}
                />
                <p id="sol-amount-help" className="m-0 text-xs text-[#b7c8ba]">
                    Up to 9 decimal places. Leave enough SOL for the network fee.
                </p>
                {errors.amount && (
                    <p id="sol-amount-error" role="alert" className={errorClassName}>
                        {errors.amount}
                    </p>
                )}
                <p className={warningClassName}>
                    Review balance changes and instructions in the approval window before signing.
                </p>
                <button className={buttonClassName} disabled={send.isPending || !active || !rpc?.chain} type="submit">
                    {send.isPending ? 'Waiting for approval and submission...' : 'Send'}
                </button>
            </form>
            {(status.isError || send.isError) && (
                <p role="alert" className={errorClassName}>
                    {errorMessage(status.error ?? send.error)}
                </p>
            )}
            {send.data && (
                <div role="status" className={panelClassName}>
                    <p className="mt-0">Transaction submitted. Confirmation is pending.</p>
                    <span className="break-all font-mono text-xs">{send.data.signature}</span>
                    <SolanaIdentifierActions value={send.data.signature} kind="signature" rpc={rpc} />
                </div>
            )}
        </WalletFrame>
    );
}

function TransactionHistoryPageView() {
    const loadMoreRef = useRef<HTMLDivElement>(null);
    const status = useQuery({
        queryKey: ['wallet-status'],
        queryFn: () => sendMessage<WalletStatus>({ type: 'wallet:status' }),
    });
    const active = status.data?.active;
    const rpc = status.data?.activeRpc;
    const savedTransactions = useSavedTransactions(active?.publicKey, rpc?.id);
    const history = useInfiniteQuery({
        queryKey: ['transaction-history', active?.publicKey, rpc?.id],
        enabled: Boolean(active && rpc?.chain),
        initialPageParam: undefined as string | undefined,
        queryFn: ({ pageParam }) => sendMessage<TransactionHistoryPage>({ type: 'history:list', before: pageParam }),
        getNextPageParam: (page) => page.nextBefore,
    });

    useEffect(() => {
        const target = loadMoreRef.current;
        if (!target || !history.hasNextPage) return;
        const observer = new IntersectionObserver(([entry]) => {
            if (entry?.isIntersecting && !history.isFetchingNextPage) void history.fetchNextPage();
        });
        observer.observe(target);
        return () => observer.disconnect();
    }, [history.fetchNextPage, history.hasNextPage, history.isFetchingNextPage]);

    const transactions = history.data?.pages.flatMap((page) => page.transactions) ?? [];

    if (rpc?.kind === 'sign-only') return <Navigate to="/wallet" replace />;

    return (
        <WalletFrame
            eyebrow="PARANOID / TRANSACTION HISTORY"
            bottomNav={
                <TransactionNavigation active="history" savedTransactionCount={savedTransactions.data?.length ?? 0} />
            }
        >
            <BackButton fallback="/wallet" />
            <h1 className="mt-0 mb-3 text-2xl leading-[1.15] font-bold">Transaction History</h1>
            <p className="mb-5 text-sm leading-normal text-[#b7c8ba]">
                Recent transactions that included{' '}
                <span className="inline-flex items-center gap-1 align-middle">
                    {truncateAddress(active?.publicKey)}
                    {active && <SolanaIdentifierActions value={active.publicKey} rpc={rpc} />}
                </span>
                .
            </p>
            {(status.isError || history.isError) && (
                <p className={errorClassName}>{errorMessage(status.error ?? history.error)}</p>
            )}
            {!status.isPending && !history.isPending && transactions.length === 0 && !history.isError && (
                <p className={panelClassName}>There are no transactions for this address.</p>
            )}
            <div className="grid gap-2.5">
                {transactions.map((transaction) => (
                    <div
                        key={transaction.signature}
                        className="relative min-w-0 rounded-[6px] border border-[#36433a] bg-[#151a17] p-[14px] text-left text-[#e7f7e9] hover:border-[#68f58a]"
                    >
                        <div className="flex items-center gap-2">
                            <Link
                                className="min-w-0 truncate font-mono text-sm font-semibold no-underline after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-[#68f58a]"
                                to="/transaction-history/$signature"
                                params={{ signature: transaction.signature }}
                                title={transaction.signature}
                            >
                                {truncateSignature(transaction.signature)}
                            </Link>
                            <span className="relative z-10 inline-flex">
                                <SolanaIdentifierActions value={transaction.signature} kind="signature" rpc={rpc} />
                            </span>
                        </div>
                        <span
                            className={`mt-2 block text-[11px] tracking-[0.08em] uppercase ${
                                transaction.failed ? 'text-[#ff8f8f]' : 'text-[#68f58a]'
                            }`}
                        >
                            {transaction.failed ? 'Failed' : (transaction.confirmationStatus ?? 'Processed')} / Slot{' '}
                            {transaction.slot.toLocaleString()}
                        </span>
                        <span className="mt-1 block truncate text-xs text-[#b7c8ba]">
                            {transaction.blockTime
                                ? new Date(transaction.blockTime * 1000).toLocaleString()
                                : 'Time unavailable'}
                            {transaction.memo ? ` / ${transaction.memo}` : ''}
                        </span>
                    </div>
                ))}
            </div>
            <div ref={loadMoreRef} className="h-8" aria-hidden="true" />
            {history.isFetchingNextPage && <p className="text-center text-xs text-[#b7c8ba]">Loading more...</p>}
        </WalletFrame>
    );
}

function TransactionHistoryDetailsPage() {
    const { signature } = transactionHistoryDetailsRoute.useParams();
    const status = useQuery({
        queryKey: ['wallet-status'],
        queryFn: () => sendMessage<WalletStatus>({ type: 'wallet:status' }),
    });
    const details = useQuery({
        queryKey: ['transaction-history', status.data?.active?.publicKey, status.data?.activeRpc?.id, signature],
        enabled: Boolean(status.data?.activeRpc?.chain),
        queryFn: () => sendMessage<TransactionHistoryDetails>({ type: 'history:get', signature }),
    });
    const rpc = status.data?.activeRpc;

    if (rpc?.kind === 'sign-only') return <Navigate to="/wallet" replace />;

    return (
        <WalletFrame eyebrow="PARANOID / TRANSACTION">
            <BackButton fallback="/transaction-history" />
            <TransactionInformation
                title={details.isPending ? 'Loading transaction...' : truncateSignature(signature)}
                titleActions={<SolanaIdentifierActions value={signature} kind="signature" rpc={rpc} />}
                rpc={rpc}
                isLoading={details.isPending}
                balanceChanges={details.data?.balanceChanges}
                instructionTree={details.data?.instructionTree}
            />
            {(status.isError || details.isError) && (
                <p className={errorClassName}>{errorMessage(status.error ?? details.error)}</p>
            )}
        </WalletFrame>
    );
}

function SavedTransactionsPage() {
    const navigate = useNavigate();
    const status = useQuery({
        queryKey: ['wallet-status'],
        queryFn: () => sendMessage<WalletStatus>({ type: 'wallet:status' }),
    });
    const savedTransactions = useSavedTransactions(status.data?.active?.publicKey, status.data?.activeRpc?.id);
    const freshTransactions = savedTransactions.data?.filter((transaction) => !transaction.expiredBlockhash) ?? [];
    const expiredTransactions = savedTransactions.data?.filter((transaction) => transaction.expiredBlockhash) ?? [];

    if (status.data?.activeRpc?.kind === 'sign-only') return <Navigate to="/wallet" replace />;

    return (
        <WalletFrame
            eyebrow="PARANOID / SAVED TRANSACTIONS"
            bottomNav={
                <TransactionNavigation
                    active="saved-transactions"
                    savedTransactionCount={savedTransactions.data?.length ?? 0}
                />
            }
        >
            <BackButton fallback="/wallet" />
            <h1 className="mt-0 mb-3 text-2xl leading-[1.15] font-bold">Saved Transactions</h1>
            <p className="mb-5 text-sm leading-normal text-[#b7c8ba]">Saved transactions for this keypair and RPC.</p>
            {(status.isError || savedTransactions.isError) && (
                <p className={errorClassName}>{errorMessage(status.error ?? savedTransactions.error)}</p>
            )}
            {!savedTransactions.isPending && savedTransactions.data?.length === 0 && (
                <p className={panelClassName}>There are no saved transactions.</p>
            )}
            <SavedTransactionGroup title="Fresh transactions" transactions={freshTransactions} navigate={navigate} />
            <SavedTransactionGroup title="Expired blockhash" transactions={expiredTransactions} navigate={navigate} />
        </WalletFrame>
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

function SavedTransactionPage() {
    const { transactionId } = savedTransactionRoute.useParams();
    const goBack = useBackNavigation('/saved-transactions');
    const queryClient = useQueryClient();
    const status = useQuery({
        queryKey: ['wallet-status'],
        queryFn: () => sendMessage<WalletStatus>({ type: 'wallet:status' }),
    });
    const request = useQuery({
        queryKey: ['saved-transactions', status.data?.active?.publicKey, status.data?.activeRpc?.id, transactionId],
        enabled: Boolean(status.data?.activeRpc?.chain),
        queryFn: () => sendMessage<SavedTransactionSummary>({ type: 'saved-transactions:get', id: transactionId }),
    });
    const transaction = request.data;
    const decision = useMutation({
        mutationFn: (value: 'sign' | 'save-for-later' | 'refresh-blockhash' | 'remove') =>
            sendMessage<{ signature?: string } | boolean>({ type: `saved-transactions:${value}`, id: transactionId }),
        onSuccess: async (_, value) => {
            if (value === 'sign' && transaction?.method === 'signAndSendTransaction') {
                showToast('Transaction signed and sent successfully.', 'success');
            }
            if (value === 'refresh-blockhash') showToast('Transaction blockhash refreshed.', 'success');
            if (value === 'remove') showToast('Saved transaction removed.', 'success');
            await queryClient.invalidateQueries({ queryKey: ['saved-transactions'] });
            goBack();
        },
        onError: (error, value) => {
            if (value === 'sign' && transaction?.method === 'signAndSendTransaction') {
                showToast(`Transaction failed: ${errorMessage(error)}`, 'error');
            }
        },
    });

    if (status.data?.activeRpc?.kind === 'sign-only') return <Navigate to="/wallet" replace />;

    return (
        <WalletFrame eyebrow="PARANOID / SIGNING REQUEST">
            <BackButton fallback="/saved-transactions" disabled={decision.isPending} />
            {request.isError && <p className={errorClassName}>{errorMessage(request.error)}</p>}
            <TransactionInformation
                title={transaction?.title ?? (request.isPending ? 'Loading transaction...' : 'Transaction unavailable')}
                isLoading={request.isPending}
                origin={transaction?.origin}
                simulationError={transaction?.simulationError}
                balanceChanges={transaction?.balanceChanges}
                instructionTree={transaction?.instructionTree}
                transactionMessage={transaction?.transactionMessage}
                onMessageCopied={() => showToast('Transaction message copied to clipboard.', 'success')}
                onMessageCopyError={(error) =>
                    showToast(`Could not copy transaction message: ${errorMessage(error)}`, 'error')
                }
            />
            <p className={warningClassName}>Review this transaction before signing.</p>
            {decision.isError && <p className={errorClassName}>{errorMessage(decision.error)}</p>}
            <div className={`mt-6 grid gap-2.5 ${transaction?.expiredBlockhash ? 'grid-cols-2' : 'grid-cols-3'}`}>
                <button
                    className={secondaryButtonClassName}
                    disabled={!transaction || decision.isPending}
                    onClick={goBack}
                >
                    Cancel
                </button>
                <button
                    className={secondaryButtonClassName}
                    disabled={!transaction || decision.isPending}
                    onClick={() => decision.mutate('save-for-later')}
                >
                    Save for Later
                </button>
                {transaction?.expiredBlockhash ? (
                    <button
                        className={secondaryButtonClassName}
                        disabled={decision.isPending}
                        onClick={() => decision.mutate('remove')}
                    >
                        Remove
                    </button>
                ) : (
                    <button
                        className={buttonClassName}
                        disabled={!transaction || decision.isPending}
                        onClick={() => decision.mutate('sign')}
                    >
                        Sign
                    </button>
                )}
                {transaction?.expiredBlockhash && (
                    <button
                        className={buttonClassName}
                        disabled={decision.isPending}
                        onClick={() => decision.mutate('refresh-blockhash')}
                    >
                        Refresh blockhash
                    </button>
                )}
            </div>
        </WalletFrame>
    );
}

function useSavedTransactions(publicKey?: string, rpcId?: string) {
    return useQuery({
        queryKey: ['saved-transactions', publicKey, rpcId],
        enabled: Boolean(publicKey && rpcId && rpcId !== 'sign-only'),
        queryFn: () => sendMessage<SavedTransactionSummary[]>({ type: 'saved-transactions:list' }),
    });
}

function TransactionNavigation({
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

function AccountNavigation({
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
    const [permissionError, setPermissionError] = useState('');
    const [isRequestingPermission, setIsRequestingPermission] = useState(false);
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
        setPermissionError('');
        selectWallet.reset();
        selectRpc.reset();
        setOpenMenu(menu);
    };

    const addCustomRpc = async () => {
        setPermissionError('');
        setIsRequestingPermission(true);
        try {
            await requestCustomRpcAccess();
            setOpenMenu(null);
            await navigate({ to: '/add-rpc/custom' });
        } catch (error) {
            setPermissionError(errorMessage(error));
        } finally {
            setIsRequestingPermission(false);
        }
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
                                disabled={selectRpc.isPending || isRequestingPermission}
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
                                disabled={selectRpc.isPending || isRequestingPermission}
                                onClick={() => selectRpc.mutate(rpc.id)}
                            />
                        )
                    )}
                    <SelectorButton
                        label="+ Add Custom RPC"
                        disabled={selectRpc.isPending || isRequestingPermission}
                        onClick={() => void addCustomRpc()}
                    />
                    <p className="text-xs text-[#b7c8ba]">
                        Sign Only signs for any app cluster without simulation. Sending requires an RPC.
                    </p>
                    {(permissionError || selectRpc.isError) && (
                        <p className={errorClassName}>{permissionError || errorMessage(selectRpc.error)}</p>
                    )}
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
            const details = await sendMessage<ApprovalDetails | null>({ type: 'approval:get', id });
            if (!details) throw new Error('This request expired');
            return details;
        },
    });
    const decision = useMutation({
        mutationFn: (value: ApprovalDecision) =>
            sendMessage<boolean>({ type: 'approval:resolve', id, decision: value }),
        onSuccess: () => window.close(),
    });

    if (!id) return <ErrorView message="Missing approval request" close />;
    if (request.isError) return <ErrorView message={errorMessage(request.error)} close />;

    return (
        <WalletFrame eyebrow="PARANOID / SIGNING REQUEST">
            {request.data?.lines?.length ? (
                <div className={`${panelClassName} break-words text-xs leading-relaxed`}>
                    {request.data.lines.map((line, index) => (
                        <p key={index}>{line}</p>
                    ))}
                </div>
            ) : null}
            <TransactionInformation
                title={request.data?.title ?? 'Loading request...'}
                origin={request.data?.origin}
                balanceChanges={request.data?.balanceChanges}
                instructionTree={request.data?.instructionTree}
                transactionMessage={request.data?.transactionMessage}
                onMessageCopied={() => showToast('Transaction message copied to clipboard.', 'success')}
                onMessageCopyError={(error) =>
                    showToast(`Could not copy transaction message: ${errorMessage(error)}`, 'error')
                }
            />
            <p className={warningClassName}>Disposable test key. Never fund this address with real assets.</p>
            {decision.isError && <p className={errorClassName}>{errorMessage(decision.error)}</p>}
            <div className={`mt-6 grid ${request.data?.canSaveForLater ? 'grid-cols-3' : 'grid-cols-2'} gap-2.5`}>
                <button
                    className={`${buttonClassName} bg-[#242b26] text-[#e7f7e9]`}
                    disabled={!request.data || decision.isPending}
                    onClick={() => decision.mutate('cancel')}
                >
                    {request.data?.transaction ? 'Cancel' : 'Reject'}
                </button>
                {request.data?.canSaveForLater && (
                    <button
                        className={secondaryButtonClassName}
                        disabled={decision.isPending}
                        onClick={() => decision.mutate('save-for-later')}
                    >
                        Save for Later
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

function WalletFrame({
    eyebrow,
    children,
    welcome = false,
    topNav,
    bottomNav,
}: {
    eyebrow: string;
    children: ReactNode;
    welcome?: boolean;
    topNav?: ReactNode;
    bottomNav?: ReactNode;
}) {
    if (topNav || bottomNav) {
        return (
            <main className="flex min-h-screen flex-col">
                {topNav}
                <div className="flex-1 p-7">
                    <p className={labelClassName}>{eyebrow}</p>
                    {children}
                </div>
                {bottomNav}
            </main>
        );
    }

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

function truncateSignature(signature: string): string {
    return signature.length > 24 ? `${signature.slice(0, 12)}...${signature.slice(-12)}` : signature;
}

function formatBalance(lamports: number | null | undefined): string {
    if (lamports === undefined) return 'Loading...';
    if (lamports === null) return 'Unavailable';
    return `${(lamports / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 9 })} SOL`;
}
