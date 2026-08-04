import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction, type SendOptions } from '@solana/web3.js';
import nacl from 'tweetnacl';
import type { ApprovalDetails, ProviderRequest } from '@/extension/messages';
import type { SolanaChain } from '@/lib/solana';
import {
    addKeypair,
    addRpc,
    getActiveKeypair,
    getActiveRpc,
    getActiveSigner,
    getVaultStatus,
    listKeypairs,
    listRpcs,
    selectKeypair,
    selectRpc,
    setupVault,
    touchVault,
    unlockVault,
} from '@/extension/keypairs';

const pendingApprovals = new Map<string, { details: ApprovalDetails; resolve: (approved: boolean) => void }>();
const approvalWindows = new Map<number, string>();
const MAINNET_GENESIS_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const TESTNET_GENESIS_HASH = '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY';

export function setupBackground(): void {
    chrome.windows.onRemoved.addListener((windowId) => {
        const id = approvalWindows.get(windowId);
        if (!id) return;
        approvalWindows.delete(windowId);
        const pending = pendingApprovals.get(id);
        if (pending) {
            pendingApprovals.delete(id);
            pending.resolve(false);
        }
    });

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.type === 'provider-request') {
            handleProviderRequest(message.request, sender)
                .then(sendResponse)
                .catch((error) => sendResponse({ __error: error instanceof Error ? error.message : String(error) }));
            return true;
        }

        if (message?.type === 'approval:get') {
            sendResponse(pendingApprovals.get(message.id)?.details || null);
            return;
        }

        if (message?.type === 'approval:resolve') {
            const pending = pendingApprovals.get(message.id);
            if (pending) {
                pendingApprovals.delete(message.id);
                pending.resolve(Boolean(message.approved));
            }
            sendResponse(true);
            return;
        }

        if (message?.type === 'wallet:status') {
            if (!isExtensionPage(sender)) {
                sendResponse({ __error: 'Wallet management is only available from Paranoid' });
                return;
            }
            getWalletStatus()
                .then(sendResponse)
                .catch((error) => sendResponse({ __error: error instanceof Error ? error.message : String(error) }));
            return true;
        }

        if (message?.type === 'wallet:vault-status') {
            if (!isExtensionPage(sender)) {
                sendResponse({ __error: 'Wallet management is only available from Paranoid' });
                return;
            }
            getVaultStatus()
                .then(sendResponse)
                .catch((error) => sendResponse({ __error: error instanceof Error ? error.message : String(error) }));
            return true;
        }

        if (message?.type === 'wallet:setup-vault' || message?.type === 'wallet:unlock') {
            if (!isExtensionPage(sender)) {
                sendResponse({ __error: 'Wallet management is only available from Paranoid' });
                return;
            }
            const operation =
                message.type === 'wallet:setup-vault' ? setupVault(message.password) : unlockVault(message.password);
            operation
                .then(() => sendResponse(true))
                .catch((error) => sendResponse({ __error: error instanceof Error ? error.message : String(error) }));
            return true;
        }

        if (message?.type === 'wallet:import') {
            if (!isExtensionPage(sender)) {
                sendResponse({ __error: 'Wallet management is only available from Paranoid' });
                return;
            }
            const secretKey = new Uint8Array(message.secretKey);
            addKeypair(secretKey)
                .then(({ name, publicKey }) => sendResponse({ name, publicKey }))
                .catch((error) => sendResponse({ __error: error instanceof Error ? error.message : String(error) }))
                .finally(() => secretKey.fill(0));
            return true;
        }

        if (message?.type === 'wallet:select') {
            if (!isExtensionPage(sender)) {
                sendResponse({ __error: 'Wallet management is only available from Paranoid' });
                return;
            }
            selectKeypair(message.name)
                .then(() => sendResponse(true))
                .catch((error) => sendResponse({ __error: error instanceof Error ? error.message : String(error) }));
            return true;
        }

        if (message?.type === 'wallet:add-rpc') {
            if (!isExtensionPage(sender)) {
                sendResponse({ __error: 'Wallet management is only available from Paranoid' });
                return;
            }
            resolveRpcChain(message.url)
                .then((chain) => addRpc(message.url, chain))
                .then(sendResponse)
                .catch((error) => sendResponse({ __error: error instanceof Error ? error.message : String(error) }));
            return true;
        }

        if (message?.type === 'wallet:select-rpc') {
            if (!isExtensionPage(sender)) {
                sendResponse({ __error: 'Wallet management is only available from Paranoid' });
                return;
            }
            selectRpc(message.id)
                .then(() => sendResponse(true))
                .catch((error) => sendResponse({ __error: error instanceof Error ? error.message : String(error) }));
            return true;
        }
    });
}

function isExtensionPage(sender: chrome.runtime.MessageSender): boolean {
    return sender.id === chrome.runtime.id && !sender.tab && Boolean(sender.url?.startsWith(chrome.runtime.getURL('')));
}

async function handleProviderRequest(request: ProviderRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
    const origin = getOrigin(sender);
    const keypair = await getKeypair();

    try {
        const rpc = await requireActiveRpc();
        validateRequestedChain(request, rpc.chain);
        if (request.method === 'signAndSendTransaction' && (await resolveRpcChain(rpc.url)) !== rpc.chain) {
            throw new Error('The active RPC changed clusters after it was added');
        }
        const connection = new Connection(rpc.url, 'confirmed');
        switch (request.method) {
            case 'connect': {
                const onlyIfTrusted = Boolean(
                    (request.params as { onlyIfTrusted?: boolean } | undefined)?.onlyIfTrusted
                );
                const trusted = await isTrusted(origin);
                if (!trusted && onlyIfTrusted) throw new Error('This site is not connected to Paranoid');
                if (!trusted) {
                    await requireApproval(origin, 'Connect to Paranoid?', [
                        `Account: ${keypair.publicKey.toBase58()}`,
                        `Network: Solana ${rpc.name}`,
                    ]);
                    await trust(origin);
                }
                return keypair.publicKey.toBase58();
            }
            case 'disconnect':
                await untrust(origin);
                return null;
            case 'signMessage': {
                await requireTrusted(origin);
                const message = new Uint8Array((request.params as { message: number[] }).message);
                const text = new TextDecoder().decode(message);
                await requireApproval(origin, 'Sign message?', [
                    printable(text) ? text : `${message.length} binary bytes`,
                ]);
                return Array.from(nacl.sign.detached(message, keypair.secretKey));
            }
            case 'signTransaction': {
                await requireTrusted(origin);
                const transaction = deserialize((request.params as { transaction: number[] }).transaction);
                await approveTransaction(origin, transaction, 'Sign transaction?', rpc.name);
                sign(transaction, keypair);
                return Array.from(serialize(transaction));
            }
            case 'signAllTransactions': {
                await requireTrusted(origin);
                const transactions = (request.params as { transactions: number[][] }).transactions.map(deserialize);
                await requireApproval(origin, 'Sign multiple transactions?', [
                    `${transactions.length} transactions`,
                    `Network: Solana ${rpc.name}`,
                ]);
                transactions.forEach((transaction) => sign(transaction, keypair));
                return transactions.map((transaction) => Array.from(serialize(transaction)));
            }
            case 'signAndSendTransaction': {
                await requireTrusted(origin);
                const { transaction: bytes, options } = request.params as {
                    transaction: number[];
                    options?: SendOptions;
                };
                const transaction = deserialize(bytes);
                await approveTransaction(origin, transaction, 'Sign and send transaction?', rpc.name);
                sign(transaction, keypair);
                const simulation =
                    'version' in transaction
                        ? await connection.simulateTransaction(transaction)
                        : await connection.simulateTransaction(transaction);
                if (simulation.value.err) throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
                const signature = await connection.sendRawTransaction(serialize(transaction), options);
                return { signature };
            }
        }
    } finally {
        keypair.secretKey.fill(0);
    }
}

function getOrigin(sender: chrome.runtime.MessageSender): string {
    if (!sender.tab?.url) throw new Error('Requests must come from a browser tab');
    const url = new URL(sender.tab.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Unsupported page origin');
    return url.origin;
}

async function getKeypair(): Promise<Keypair> {
    const keypair = await getActiveSigner();
    if (!keypair) throw new Error('Add a keypair before connecting to Paranoid');
    return keypair;
}

async function requireActiveRpc() {
    const rpc = await getActiveRpc();
    if (!rpc) throw new Error('Add an RPC before connecting to Paranoid');
    return rpc;
}

function validateRequestedChain(request: ProviderRequest, rpcChain: SolanaChain): void {
    if (request.method === 'connect' || request.method === 'disconnect') return;
    const chain = (request.params as { chain?: SolanaChain } | undefined)?.chain;
    if (!chain) return;
    if (chain !== rpcChain) throw new Error(`The dapp requested ${chain}, but the active RPC uses ${rpcChain}`);
}

async function resolveRpcChain(url: string): Promise<SolanaChain> {
    const genesisHash = await new Connection(url, 'confirmed').getGenesisHash();
    if (genesisHash === MAINNET_GENESIS_HASH) return 'solana:mainnet';
    if (genesisHash === DEVNET_GENESIS_HASH) return 'solana:devnet';
    if (genesisHash === TESTNET_GENESIS_HASH) return 'solana:testnet';
    return 'solana:localnet';
}

async function getWalletStatus() {
    touchVault();
    const [stored, active, rpcs, activeRpc] = await Promise.all([
        listKeypairs(),
        getActiveKeypair(),
        listRpcs(),
        getActiveRpc().catch(() => null),
    ]);
    if (active) {
        const publicKey = active.publicKey;
        return {
            active: { name: active.name, publicKey: active.publicKey },
            wallets: stored.map(({ name, publicKey: address }) => ({ name, publicKey: address })),
            activeRpc: activeRpc && {
                id: activeRpc.id,
                name: activeRpc.name,
                kind: activeRpc.kind,
                chain: activeRpc.chain,
                url: activeRpc.url,
            },
            rpcs,
            balance: activeRpc
                ? await new Connection(activeRpc.url, 'confirmed')
                      .getBalance(new PublicKey(publicKey))
                      .catch(() => null)
                : null,
        };
    }
    return {
        active: null,
        wallets: [],
        activeRpc: activeRpc && {
            id: activeRpc.id,
            name: activeRpc.name,
            kind: activeRpc.kind,
            chain: activeRpc.chain,
            url: activeRpc.url,
        },
        rpcs,
        balance: null,
    };
}

async function isTrusted(origin: string): Promise<boolean> {
    const { trustedOrigins = [] } = await chrome.storage.local.get('trustedOrigins');
    return (trustedOrigins as string[]).includes(origin);
}

async function trust(origin: string): Promise<void> {
    const { trustedOrigins = [] } = await chrome.storage.local.get('trustedOrigins');
    await chrome.storage.local.set({ trustedOrigins: [...new Set([...(trustedOrigins as string[]), origin])] });
}

async function untrust(origin: string): Promise<void> {
    const { trustedOrigins = [] } = await chrome.storage.local.get('trustedOrigins');
    await chrome.storage.local.set({ trustedOrigins: (trustedOrigins as string[]).filter((item) => item !== origin) });
}

async function requireTrusted(origin: string): Promise<void> {
    if (!(await isTrusted(origin))) throw new Error('Connect this site before requesting a signature');
}

async function requireApproval(origin: string, title: string, lines: string[]): Promise<void> {
    const id = crypto.randomUUID();
    const approved = new Promise<boolean>((resolve) => {
        pendingApprovals.set(id, { details: { id, origin, title, lines }, resolve });
    });
    const approvalWindow = await chrome.windows.create({
        url: chrome.runtime.getURL(`approval.html?id=${encodeURIComponent(id)}`),
        type: 'popup',
        width: 420,
        height: 560,
        focused: true,
    });
    if (approvalWindow.id !== undefined) approvalWindows.set(approvalWindow.id, id);
    if (!(await approved)) throw new Error('User rejected the request');
}

async function approveTransaction(
    origin: string,
    transaction: Transaction | VersionedTransaction,
    title: string,
    rpcName: string
): Promise<void> {
    const lines = [`Network: Solana ${rpcName}`];
    if ('version' in transaction) {
        lines.push(`Version: ${transaction.version}`);
        lines.push(`Instructions: ${transaction.message.compiledInstructions.length}`);
        for (const instruction of transaction.message.compiledInstructions) {
            lines.push(
                `Program: ${transaction.message.staticAccountKeys[instruction.programIdIndex]?.toBase58() || 'lookup table'}`
            );
        }
    } else {
        lines.push('Version: legacy');
        lines.push(`Instructions: ${transaction.instructions.length}`);
        transaction.instructions.forEach((instruction) => lines.push(`Program: ${instruction.programId.toBase58()}`));
    }
    await requireApproval(origin, title, lines);
}

function deserialize(bytes: number[]): Transaction | VersionedTransaction {
    const serialized = new Uint8Array(bytes);
    try {
        return VersionedTransaction.deserialize(serialized);
    } catch {
        return Transaction.from(serialized);
    }
}

function sign(transaction: Transaction | VersionedTransaction, keypair: Keypair): void {
    if ('version' in transaction) transaction.sign([keypair]);
    else transaction.partialSign(keypair);
}

function serialize(transaction: Transaction | VersionedTransaction): Uint8Array {
    return 'version' in transaction
        ? transaction.serialize()
        : transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
}

function printable(value: string): boolean {
    return value.length > 0 && value.length <= 1000 && !/[\u0000-\u0008\u000e-\u001f]/.test(value);
}
