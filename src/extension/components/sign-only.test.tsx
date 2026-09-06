import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { SolanaIdentifierActions } from './solana-identifier-actions';
import { SignOnlyExplorerLinks } from './sign-only-explorer-links';

test('Sign Only keeps copying available without linking to an unrelated Explorer cluster', () => {
    const markup = renderToStaticMarkup(
        <SolanaIdentifierActions
            value="account"
            rpc={{ id: 'sign-only', name: 'Sign Only', kind: 'sign-only', chain: null, url: '' }}
        />
    );
    expect(markup).toContain('Copy address');
    expect(markup).not.toContain('href=');
});

test('Sign Only offers explicit account Explorer links for all four clusters', () => {
    const markup = renderToStaticMarkup(<SignOnlyExplorerLinks publicKey="account" />);
    const urls = [...markup.matchAll(/href="([^"]+)"/g)].map((match) => new URL(match[1]!.replaceAll('&amp;', '&')));
    expect(urls).toHaveLength(4);
    expect(
        urls.every((url) => url.origin === 'https://explorer.solana.com' && url.pathname === '/address/account')
    ).toBe(true);
    expect(urls.map((url) => url.searchParams.get('cluster'))).toEqual(['custom', 'testnet', 'devnet', null]);
    expect(urls[0]!.searchParams.get('customUrl')).toBe('http://127.0.0.1:8899');
    expect(markup).not.toContain('Balance');
    expect(markup).not.toContain('Saved Transactions');
    expect(markup).not.toContain('Transaction History');
});
