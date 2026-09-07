import { expect, test } from 'bun:test';
import { createMemoryHistory, createRootRoute, createRouter, RouterContextProvider } from '@tanstack/react-router';
import { renderToStaticMarkup } from 'react-dom/server';
import { BackButton, useBackNavigation } from './back-button';

function setup(initialEntries: string[], fallback: Parameters<typeof useBackNavigation>[0]) {
    const history = createMemoryHistory({ initialEntries });
    const router = createRouter({ routeTree: createRootRoute(), history });
    let goBack!: () => void;
    function Probe() {
        goBack = useBackNavigation(fallback);
        return <BackButton fallback={fallback} />;
    }
    const markup = renderToStaticMarkup(
        <RouterContextProvider router={router}>
            <Probe />
        </RouterContextProvider>
    );
    return { history, goBack, markup };
}

test('back control has a visible label, large decorative arrow, and keyboard focus styling', () => {
    const { markup } = setup(['/wallet', '/send-sol'], '/wallet');
    expect(markup).toContain('type="button"');
    expect(markup).toContain('Back</button>');
    expect(markup).toContain('width="24"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('min-h-11');
    expect(markup).toContain('focus-visible:outline-2');
});

test.each([
    ['/wallet', '/send-sol', '/wallet'],
    ['/wallet', '/saved-transactions', '/wallet'],
    ['/send-sol', '/transaction-history', '/wallet'],
    ['/wallet', '/keypairs/example/rename', '/wallet'],
    ['/wallet', '/rpcs/example/settings', '/wallet'],
    ['/transaction-history', '/transaction-history/signature', '/transaction-history'],
    ['/saved-transactions', '/saved-transactions/transaction', '/saved-transactions'],
] as const)('Back from %s -> %s pops history instead of pushing the fallback', (previous, current, fallback) => {
    const { history, goBack } = setup([previous, current], fallback);
    goBack();
    expect(history.location.pathname).toBe(previous);
    expect(history.length).toBe(2);
    expect(history.location.state.__TSR_index).toBe(0);
});

test.each(['/wallet', '/saved-transactions', '/transaction-history'] as const)(
    'direct entry replaces the current page with fallback %s',
    (fallback) => {
        const { history, goBack } = setup(['/direct-entry'], fallback);
        goBack();
        expect(history.location.pathname).toBe(fallback);
        expect(history.length).toBe(1);
        expect(history.location.state.__TSR_index).toBe(0);
    }
);
