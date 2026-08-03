import { QueryClient, QueryClientProvider, useMutation, useQuery } from '@tanstack/react-query';
import {
    Outlet,
    RouterProvider,
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    useNavigate,
} from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import type { ApprovalDetails } from '@/extension/messages';

interface WalletStatus {
    address: string;
    cluster: string;
}

const labelClassName = 'my-[1em] text-[11px] tracking-[0.12em] text-[#68f58a] uppercase';
const panelClassName = 'my-[1em] rounded-[6px] border border-[#29332c] bg-[#151a17] p-[14px]';
const warningClassName = 'my-[1em] text-xs leading-normal text-[#ffce73]';
const errorClassName = 'my-[1em] text-xs leading-normal text-[#ff8f8f]';
const buttonClassName =
    'cursor-pointer rounded-sm border-0 bg-[#68f58a] p-[13px] font-bold text-[#081009] disabled:cursor-wait disabled:opacity-45';

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

const approvalRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/approval',
    validateSearch: (search: Record<string, unknown>) => ({
        id: typeof search.id === 'string' ? search.id : '',
    }),
    component: ApprovalPage,
});

const routeTree = rootRoute.addChildren([popupRoute, walletRoute, approvalRoute]);

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
        await navigate({ to: '/wallet' });
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

function PopupPage() {
    const status = useQuery({
        queryKey: ['wallet-status'],
        queryFn: () => chrome.runtime.sendMessage({ type: 'wallet:status' }) as Promise<WalletStatus>,
    });

    return (
        <WalletFrame eyebrow="PARANOID / TEST WALLET">
            <h1 className="mt-3 mb-5 text-2xl leading-[1.15] font-bold">Disposable account</h1>
            {status.isError ? (
                <p className={errorClassName}>{errorMessage(status.error)}</p>
            ) : (
                <>
                    <p className={labelClassName}>Network</p>
                    <p className={panelClassName}>{status.data?.cluster ?? 'Loading...'}</p>
                    <p className={labelClassName}>Address</p>
                    <p className={`${panelClassName} [overflow-wrap:anywhere]`}>
                        {status.data?.address ?? 'Loading...'}
                    </p>
                </>
            )}
            <p className={warningClassName}>
                The key is stored unencrypted in extension storage. Use devnet assets only.
            </p>
        </WalletFrame>
    );
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
