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
        <WalletFrame eyebrow="PARANOID / DEVNET ONLY" className="welcome">
            <div>
                <h1>Paranoid Wallet</h1>
                <p className="description">A Solana wallet you never have to trust</p>
            </div>
            <div>
                <p className="warning">Disclaimer: Wallet can interact with the Devnet Cluster only</p>
                <button className="launch" onClick={launchApp}>
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
            <h1>Disposable account</h1>
            {status.isError ? (
                <p className="error">{errorMessage(status.error)}</p>
            ) : (
                <>
                    <p className="label">Network</p>
                    <p className="value">{status.data?.cluster ?? 'Loading...'}</p>
                    <p className="label">Address</p>
                    <p className="address">{status.data?.address ?? 'Loading...'}</p>
                </>
            )}
            <p className="warning">The key is stored unencrypted in extension storage. Use devnet assets only.</p>
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
            <h1>{request.data?.title ?? 'Loading request...'}</h1>
            {request.data && (
                <>
                    <p className="origin">{request.data.origin}</p>
                    <ul>
                        {request.data.lines.map((line, index) => (
                            <li key={`${index}:${line}`}>{line}</li>
                        ))}
                    </ul>
                </>
            )}
            <p className="warning">Disposable test key. Never fund this address with real assets.</p>
            {decision.isError && <p className="error">{errorMessage(decision.error)}</p>}
            <div className="actions">
                <button
                    className="secondary"
                    disabled={!request.data || decision.isPending}
                    onClick={() => decision.mutate(false)}
                >
                    Reject
                </button>
                <button disabled={!request.data || decision.isPending} onClick={() => decision.mutate(true)}>
                    Approve
                </button>
            </div>
        </WalletFrame>
    );
}

function WalletFrame({
    eyebrow,
    children,
    className,
}: {
    eyebrow: string;
    children: ReactNode;
    className?: string;
}) {
    return (
        <main className={className}>
            <p className="eyebrow">{eyebrow}</p>
            {children}
        </main>
    );
}

function ErrorView({ message, close = false }: { message: string; close?: boolean }) {
    return (
        <WalletFrame eyebrow="PARANOID / DEVNET ONLY">
            <h1>{message}</h1>
            {close && <button onClick={() => window.close()}>Close</button>}
        </WalletFrame>
    );
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
