import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Keypair } from '@solana/web3.js';
import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
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
import { derivePath } from 'ed25519-hd-key';
import { type FormEvent, type ReactNode, useState } from 'react';
import type { ApprovalDetails, WalletStatus } from '@/extension/messages';

const labelClassName = 'my-[1em] text-[11px] tracking-[0.12em] text-[#68f58a] uppercase';
const panelClassName = 'my-[1em] rounded-[6px] border border-[#29332c] bg-[#151a17] p-[14px]';
const warningClassName = 'my-[1em] text-xs leading-normal text-[#ffce73]';
const errorClassName = 'my-[1em] text-xs leading-normal text-[#ff8f8f]';
const buttonClassName =
    'cursor-pointer rounded-sm border-0 bg-[#68f58a] p-[13px] font-bold text-[#081009] disabled:cursor-wait disabled:opacity-45';
const secondaryButtonClassName = `${buttonClassName} border border-[#36433a] bg-[#202722] text-[#e7f7e9]`;
const inputClassName =
    'w-full rounded-[6px] border border-[#36433a] bg-[#101411] p-3 text-sm text-[#e7f7e9] outline-none focus:border-[#68f58a]';

const rootRoute = createRootRoute({
    component: () => <Outlet />,
    notFoundComponent: () => <ErrorView message="This wallet page does not exist." />,
});

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

const approvalRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/approval',
    validateSearch: (search: Record<string, unknown>) => ({
        id: typeof search.id === 'string' ? search.id : '',
    }),
    component: ApprovalPage,
});

const routeTree = rootRoute.addChildren([
    popupRoute,
    walletRoute,
    createPasswordRoute,
    unlockRoute,
    addKeypairRoute,
    seedPhraseRoute,
    keypairFileRoute,
    approvalRoute,
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
        <WalletFrame eyebrow="PARANOID / DEVNET ONLY" welcome>
            <div>
                <h1 className="mt-3 mb-2.5 text-[32px] leading-[1.15] font-bold">Paranoid Wallet</h1>
                <p className="m-0 text-[15px] leading-normal text-[#b7c8ba]">A Solana wallet you never have to trust</p>
            </div>
            <div>
                <p className={warningClassName}>Disclaimer: Wallet can interact with the Devnet Cluster only</p>
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
            await navigate({ to: status.active ? '/wallet' : '/add-keypair' });
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
            await navigate({ to: status.active ? '/wallet' : '/add-keypair' });
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
            <p className={warningClassName}>Use this wallet with Devnet assets only.</p>
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
        const seed = mnemonicToSeedSync(normalized);
        const derived = derivePath("m/44'/501'/0'/0'", bytesToHex(seed));
        importKeypair.mutate(Array.from(Keypair.fromSeed(derived.key).secretKey), {
            onSuccess: () => navigate({ to: '/wallet' }),
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
                    secretKey && importKeypair.mutate(secretKey, { onSuccess: () => navigate({ to: '/wallet' }) })
                }
            >
                Import keypair
            </button>
        </ImportFrame>
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

    if (!status.isPending && !status.isError && !status.data.active) return <AddKeypairPage />;

    const active = status.data?.active;

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
            {status.isError ? (
                <p className={errorClassName}>{errorMessage(status.error)}</p>
            ) : (
                <>
                    <div className="grid grid-cols-2 gap-2.5">
                        <div>
                            <p className={labelClassName}>Cluster</p>
                            <p className={`${panelClassName} capitalize`}>{status.data?.cluster ?? 'Loading...'}</p>
                        </div>
                        <div>
                            <p className={labelClassName}>Balance</p>
                            <p className={panelClassName}>{formatBalance(status.data?.balance)}</p>
                        </div>
                    </div>
                </>
            )}
            {selectWallet.isError && <p className={errorClassName}>{errorMessage(selectWallet.error)}</p>}
            <p className={warningClassName}>Keypairs are encrypted at rest. Use devnet assets only.</p>
        </WalletFrame>
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
            <p className={warningClassName}>Never use a seed phrase or keypair that holds Mainnet assets.</p>
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
        mutationFn: (approved: boolean) => chrome.runtime.sendMessage({ type: 'approval:resolve', id, approved }),
        onSuccess: () => window.close(),
    });

    if (!id) return <ErrorView message="Missing approval request" close />;
    if (request.isError) return <ErrorView message={errorMessage(request.error)} close />;

    return (
        <WalletFrame eyebrow="PARANOID / DEVNET ONLY">
            <h1 className="mt-3 mb-5 text-2xl leading-[1.15] font-bold">
                {request.data?.title ?? 'Loading request...'}
            </h1>
            {request.data && (
                <>
                    <p className={`${panelClassName} [overflow-wrap:anywhere]`}>{request.data.origin}</p>
                    <ul className={`${panelClassName} max-h-[220px] list-none overflow-auto`}>
                        {request.data.lines.map((line, index) => (
                            <li
                                className="[overflow-wrap:anywhere] [&+&]:mt-[9px] [&+&]:border-t [&+&]:border-[#29332c] [&+&]:pt-[9px]"
                                key={`${index}:${line}`}
                            >
                                {line}
                            </li>
                        ))}
                    </ul>
                </>
            )}
            <p className={warningClassName}>Disposable test key. Never fund this address with real assets.</p>
            {decision.isError && <p className={errorClassName}>{errorMessage(decision.error)}</p>}
            <div className="mt-6 grid grid-cols-2 gap-2.5">
                <button
                    className={`${buttonClassName} bg-[#242b26] text-[#e7f7e9]`}
                    disabled={!request.data || decision.isPending}
                    onClick={() => decision.mutate(false)}
                >
                    Reject
                </button>
                <button
                    className={buttonClassName}
                    disabled={!request.data || decision.isPending}
                    onClick={() => decision.mutate(true)}
                >
                    Approve
                </button>
            </div>
        </WalletFrame>
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
        <WalletFrame eyebrow="PARANOID / DEVNET ONLY">
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

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function truncateAddress(address: string | undefined): string {
    return address ? `${address.slice(0, 4)}...${address.slice(-4)}` : 'Loading...';
}

function formatBalance(lamports: number | null | undefined): string {
    if (lamports === undefined) return 'Loading...';
    if (lamports === null) return 'Unavailable';
    return `${(lamports / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL`;
}
