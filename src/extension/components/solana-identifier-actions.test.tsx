import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ActiveRpcSummary } from '@/extension/messages';
import { getSolanaExplorerAccountUrl, getSolanaExplorerTransactionUrl, type SolanaChain } from '@/lib/solana';
import { SolanaIdentifierActions } from './solana-identifier-actions';
import { InstructionTree } from './instruction-tree';

test('account and transaction Explorer URLs preserve cluster behavior and encode identifiers', () => {
    for (const [getUrl, path] of [
        [getSolanaExplorerAccountUrl, 'address'],
        [getSolanaExplorerTransactionUrl, 'tx'],
    ] as const) {
        for (const [chain, cluster] of [
            ['solana:mainnet', null],
            ['solana:devnet', 'devnet'],
            ['solana:testnet', 'testnet'],
            ['solana:localnet', 'localnet'],
        ] as const) {
            const url = new URL(getUrl('full/value?', chain));
            expect(url.origin).toBe('https://explorer.solana.com');
            expect(url.pathname).toBe(`/${path}/full%2Fvalue%3F`);
            expect(url.searchParams.get('cluster')).toBe(cluster);
            expect(url.searchParams.has('customUrl')).toBe(false);
        }
        for (const chain of ['solana:mainnet', 'solana:localnet'] as SolanaChain[]) {
            const customUrl = 'http://localhost:8899/?key=a&other=b';
            const url = new URL(getUrl('value', chain, customUrl));
            expect(url.searchParams.get('cluster')).toBe('custom');
            expect(url.searchParams.get('customUrl')).toBe(customUrl);
        }
    }
});

test('identifier actions put accessible copy before Explorer and omit links without an RPC', () => {
    for (const rpc of [undefined, null]) {
        const markup = renderToStaticMarkup(<SolanaIdentifierActions value="full-address" rpc={rpc} />);
        expect(markup).toContain('aria-label="Copy address"');
        expect(markup).toContain('title="Copy address: full-address"');
        expect(markup).not.toContain('<a ');
    }
    for (const kind of ['devnet', 'testnet', 'custom', 'localnet'] as const) {
        const rpc: ActiveRpcSummary = {
            id: kind,
            name: kind,
            kind,
            chain: kind === 'custom' ? 'solana:mainnet' : `solana:${kind}`,
            url: 'http://localhost:8899',
        };
        for (const identifierKind of ['address', 'signature'] as const) {
            const markup = renderToStaticMarkup(
                <SolanaIdentifierActions value="full-value" kind={identifierKind} rpc={rpc} />
            );
            expect(markup.indexOf('<button')).toBeLessThan(markup.indexOf('<a '));
            expect(markup).toContain(`aria-label="Copy ${identifierKind}"`);
            expect(markup).toContain(`/${identifierKind === 'address' ? 'address' : 'tx'}/full-value?`);
            expect(markup).toContain(`cluster=${kind === 'localnet' ? 'custom' : kind}`);
            expect(markup.includes('customUrl=')).toBe(kind === 'custom' || kind === 'localnet');
            expect(markup).toContain('target="_blank" rel="noreferrer"');
        }
    }
});

test('recursive instruction actions include named programs and remain outside expand buttons', () => {
    const programIds = [
        '11111111111111111111111111111111',
        'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        'unknown-program',
    ];
    const markup = renderToStaticMarkup(
        <InstructionTree
            rpc={{
                id: 'local',
                name: 'Local',
                kind: 'localnet',
                chain: 'solana:localnet',
                url: 'http://localhost:8899',
            }}
            instructions={[
                {
                    programId: programIds[0]!,
                    data: [2, 0, 0, 0],
                    innerInstructions: [
                        {
                            programId: programIds[1]!,
                            data: [7],
                            innerInstructions: [{ programId: programIds[2]!, data: [1], innerInstructions: [] }],
                        },
                    ],
                },
            ]}
        />
    );
    expect(markup).toContain('System Program');
    expect(markup).toContain('Token Program');
    for (const programId of programIds) {
        expect(markup).toContain(`title="Copy address: ${programId}"`);
        expect(markup).toContain(`/address/${programId}?cluster=custom`);
    }
    const buttons = [...markup.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)];
    expect(buttons).toHaveLength(5);
    expect(buttons.filter(([button]) => button.includes('aria-expanded="true"'))).toHaveLength(2);
    for (const [, content] of buttons) {
        expect(content).not.toMatch(/<(?:button|a)\b/);
    }
});
