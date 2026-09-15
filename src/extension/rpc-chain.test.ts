import { expect, spyOn, test } from 'bun:test';
import { Connection } from '@solana/web3.js';
import { IDBFactory } from 'fake-indexeddb';
import { resolveRpcChain, validateRequestedChain } from './background';
import { addRpc, getActiveRpc, getRpc, getVaultStatus, listRpcs, selectRpc, setupVault, updateRpc } from './keypairs';
import { listSavedTransactions, saveTransaction } from './saved-transactions';

test('custom RPCs default to mainnet while recognized networks and built-in localnet retain their chains', async () => {
    const genesis = spyOn(Connection.prototype, 'getGenesisHash');
    try {
        for (const [hash, chain] of [
            ['5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'solana:mainnet'],
            ['EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', 'solana:devnet'],
            ['4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY', 'solana:testnet'],
        ] as const) {
            genesis.mockResolvedValue(hash);
            expect(await resolveRpcChain('https://rpc.example')).toBe(chain);
        }
        genesis.mockResolvedValue('custom-fork-genesis');
        expect(await resolveRpcChain('https://fork.example')).toBe('solana:mainnet');
        expect(await resolveRpcChain('http://127.0.0.1:8899', 'custom')).toBe('solana:mainnet');
        expect(await resolveRpcChain('http://127.0.0.1:8899', 'localnet')).toBe('solana:localnet');
        genesis.mockRejectedValueOnce(new Error('RPC unavailable'));
        await expect(resolveRpcChain('https://rpc.example')).rejects.toThrow('RPC unavailable');
    } finally {
        genesis.mockRestore();
    }
});

test('existing encrypted custom RPCs use mainnet without losing their URLs, IDs, or saved transactions', async () => {
    const originalChrome = globalThis.chrome;
    const originalIndexedDB = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    const session: Record<string, unknown> = {};
    globalThis.chrome = {
        storage: {
            session: {
                async get() {
                    return structuredClone(session);
                },
                async set(values: Record<string, unknown>) {
                    Object.assign(session, structuredClone(values));
                },
                async remove(keys: string[]) {
                    keys.forEach((key) => delete session[key]);
                },
            },
        },
    } as unknown as typeof chrome;
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: new IDBFactory() });
    try {
        await setupVault('rpc-migration-test-password');
        const url = 'https://fork.example/rpc?token=test-fixture';
        // Seed the old stored label through the storage API. Its authenticated
        // encryption metadata still includes solana:localnet.
        const stored = await addRpc(url, 'solana:localnet');
        const saved = await saveTransaction('wallet', stored.id, {
            origin: 'https://dapp.example',
            title: 'Saved request',
            lines: [],
            transaction: [1, 2, 3],
            method: 'signTransaction',
        });
        expect((await listRpcs()).find(({ id }) => id === stored.id)?.chain).toBe('solana:mainnet');
        expect(await getRpc(stored.id)).toMatchObject({ id: stored.id, url, chain: 'solana:mainnet' });
        const active = await getActiveRpc();
        expect(active).toMatchObject({ id: stored.id, url, chain: 'solana:mainnet', kind: 'custom' });
        expect(() =>
            validateRequestedChain(
                {
                    channel: 'paranoid:page',
                    id: 'test',
                    method: 'signAllTransactions',
                    params: { chain: 'solana:mainnet' },
                },
                active!.chain
            )
        ).not.toThrow();
        expect(await listSavedTransactions('wallet', stored.id)).toEqual([saved]);

        await updateRpc(stored.id, 'Mainnet fork', url, 'solana:mainnet', true);
        expect(await getRpc(stored.id)).toMatchObject({
            id: stored.id,
            name: 'Mainnet fork',
            url,
            chain: 'solana:mainnet',
        });
        expect(await listSavedTransactions('wallet', stored.id)).toEqual([saved]);

        for (const chain of ['solana:devnet', 'solana:testnet'] as const) {
            const custom = await addRpc(`https://${chain.split(':')[1]}.example`, chain);
            expect((await getRpc(custom.id)).chain).toBe(chain);
            expect((await getActiveRpc())?.chain).toBe(chain);
        }
        await selectRpc('localnet');
        const localnet = await getActiveRpc();
        expect(localnet).toMatchObject({ kind: 'localnet', chain: 'solana:localnet' });
        expect(() =>
            validateRequestedChain(
                {
                    channel: 'paranoid:page',
                    id: 'test',
                    method: 'signAllTransactions',
                    params: { chain: 'solana:mainnet' },
                },
                localnet!.chain
            )
        ).toThrow('active RPC uses solana:localnet');
    } finally {
        // Expire the test vault so its idle timer and unlocked key do not leak into other tests.
        const now = spyOn(Date, 'now').mockReturnValue(Date.now() + 5 * 60 * 1000 + 1);
        try {
            await getVaultStatus();
        } finally {
            now.mockRestore();
        }
        globalThis.chrome = originalChrome;
        if (originalIndexedDB) Object.defineProperty(globalThis, 'indexedDB', originalIndexedDB);
        else Reflect.deleteProperty(globalThis, 'indexedDB');
    }
});
