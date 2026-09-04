import {
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    VersionedTransaction,
    type ParsedInnerInstruction,
    type SendOptions,
} from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import type {
    ApprovalDecision,
    ApprovalDetails,
    InstructionTreeNode,
    ProviderRequest,
    QueuedTransactionSummary,
    SolBalanceChange,
    TransactionHistoryPage,
} from '@/extension/messages';
import type { SolanaChain } from '@/lib/solana';
import {
    addKeypair,
    addRpc,
    getActiveKeypair,
    getActiveRpc,
    getActiveSigner,
    getRpc,
    getVaultStatus,
    listKeypairs,
    listRpcs,
    removeKeypair,
    removeRpc,
    refreshVaultSession,
    renameKeypair,
    selectKeypair,
    selectRpc,
    setupVault,
    unlockVault,
    updateRpc,
} from '@/extension/keypairs';
import {
    claimQueuedTransaction,
    enqueueTransaction,
    listQueuedTransactions,
    moveQueuedTransactionToTop,
    refreshQueuedTransaction,
    releaseQueuedTransaction,
    removeQueuedTransaction,
    type QueuedTransaction,
    type QueuedTransactionMethod,
} from '@/extension/transaction-queue';
import {
    hasStoredTransaction,
    listTransactionHistory,
    storeTransactionHistory,
    toTransactionHistoryItem,
} from '@/extension/transaction-history';

const pendingApprovals = new Map<string, { details: ApprovalDetails; resolve: (decision: ApprovalDecision) => void }>();
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
            pending.resolve('cancel');
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
                pending.resolve(
                    message.decision === 'defer' || message.decision === 'cancel' || message.decision === 'approve'
                        ? message.decision
                        : message.approved
                          ? 'approve'
                          : 'cancel'
                );
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

        if (message?.type === 'wallet:activity') {
            if (!isExtensionPage(sender)) {
                sendResponse({ __error: 'Wallet management is only available from Paranoid' });
                return;
            }
            refreshVaultSession()
                .then(() => sendResponse(true))
                .catch((error) => sendResponse({ __error: error instanceof Error ? error.message : String(error) }));
            return true;
        }

        if (message?.type === 'wallet:keepalive') {
            if (!isExtensionPage(sender)) {
                sendResponse({ __error: 'Wallet management is only available from Paranoid' });
                return;
            }
            sendResponse(true);
            return;
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

        if (message?.type === 'wallet:rename') {
            if (!isExtensionPage(sender)) {
                sendResponse({ __error: 'Wallet management is only available from Paranoid' });
                return;
            }
            renameKeypair(message.name, message.label)
                .then(() => sendResponse(true))
                .catch((error) => sendResponse({ __error: error instanceof Error ? error.message : String(error) }));
            return true;
        }

        if (message?.type === 'wallet:remove') {
            if (!isExtensionPage(sender)) {
                sendResponse({ __error: 'Wallet management is only available from Paranoid' });
                return;
            }
            removeKeypair(message.name)
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

        if (message?.type === 'wallet:get-rpc') {
            if (!isExtensionPage(sender)) {
                sendResponse({ __error: 'Wallet management is only available from Paranoid' });
                return;
            }
            getRpc(message.id)
                .then(sendResponse)
                .catch((error) => sendResponse({ __error: error instanceof Error ? error.message : String(error) }));
            return true;
        }

        if (message?.type === 'wallet:update-rpc') {
            if (!isExtensionPage(sender)) {
                sendResponse({ __error: 'Wallet management is only available from Paranoid' });
                return;
            }
            resolveRpcChain(message.url)
                .then((chain) => updateRpc(message.id, message.label, message.url, chain))
                .then(() => sendResponse(true))
                .catch((error) => sendResponse({ __error: error instanceof Error ? error.message : String(error) }));
            return true;
        }

        if (message?.type === 'wallet:remove-rpc') {
            if (!isExtensionPage(sender)) {
                sendResponse({ __error: 'Wallet management is only available from Paranoid' });
                return;
            }
            removeRpc(message.id)
                .then(() => sendResponse(true))
                .catch((error) => sendResponse({ __error: error instanceof Error ? error.message : String(error) }));
            return true;
        }

        if (message?.type === 'queue:list') {
            if (!isExtensionPage(sender)) {
                sendResponse({ __error: 'The transaction queue is only available from Paranoid' });
                return;
            }
            getActiveQueueSummaries()
                .then(sendResponse)
                .catch((error) => sendResponse({ __error: error instanceof Error ? error.message : String(error) }));
            return true;
        }

        if (message?.type === 'history:list') {
            if (!isExtensionPage(sender)) {
                sendResponse({ __error: 'Transaction history is only available from Paranoid' });
                return;
            }
            getActiveTransactionHistory(typeof message.before === 'string' ? message.before : undefined)
                .then(sendResponse)
                .catch((error) => sendResponse({ __error: error instanceof Error ? error.message : String(error) }));
            return true;
        }

        if (message?.type === 'queue:get') {
            if (!isExtensionPage(sender)) {
                sendResponse({ __error: 'The transaction queue is only available from Paranoid' });
                return;
            }
            getActiveQueueSummary(message.id)
                .then(sendResponse)
                .catch((error) => sendResponse({ __error: error instanceof Error ? error.message : String(error) }));
            return true;
        }

        if (message?.type === 'queue:sign') {
            if (!isExtensionPage(sender)) {
                sendResponse({ __error: 'The transaction queue is only available from Paranoid' });
                return;
            }
            signQueuedTransaction(message.id)
                .then(sendResponse)
                .catch((error) => sendResponse({ __error: error instanceof Error ? error.message : String(error) }));
            return true;
        }

        if (message?.type === 'queue:defer') {
            if (!isExtensionPage(sender)) {
                sendResponse({ __error: 'The transaction queue is only available from Paranoid' });
                return;
            }
            moveActiveQueuedTransactionToTop(message.id)
                .then(() => sendResponse(true))
                .catch((error) => sendResponse({ __error: error instanceof Error ? error.message : String(error) }));
            return true;
        }

        if (message?.type === 'queue:refresh-blockhash') {
            if (!isExtensionPage(sender)) {
                sendResponse({ __error: 'The transaction queue is only available from Paranoid' });
                return;
            }
            refreshActiveQueuedTransactionBlockhash(message.id)
                .then(() => sendResponse(true))
                .catch((error) => sendResponse({ __error: error instanceof Error ? error.message : String(error) }));
            return true;
        }

        if (message?.type === 'queue:remove') {
            if (!isExtensionPage(sender)) {
                sendResponse({ __error: 'The transaction queue is only available from Paranoid' });
                return;
            }
            removeActiveQueuedTransaction(message.id)
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
                const bytes = (request.params as { transaction: number[] }).transaction;
                const transaction = deserialize(bytes);
                await approveOrDeferTransaction(
                    origin,
                    transaction,
                    bytes,
                    'signTransaction',
                    undefined,
                    keypair,
                    rpc,
                    connection
                );
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
                await approveOrDeferTransaction(
                    origin,
                    transaction,
                    bytes,
                    'signAndSendTransaction',
                    options,
                    keypair,
                    rpc,
                    connection
                );
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
    await refreshVaultSession();
    const [stored, active, rpcs, activeRpc] = await Promise.all([
        listKeypairs(),
        getActiveKeypair(),
        listRpcs(),
        getActiveRpc().catch(() => null),
    ]);
    if (active) {
        const publicKey = active.publicKey;
        return {
            active: { name: active.name, label: active.label ?? active.name, publicKey: active.publicKey },
            wallets: stored.map(({ name, label, publicKey }) => ({ name, label: label ?? name, publicKey })),
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
    const decision = new Promise<ApprovalDecision>((resolve) => {
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
    if ((await decision) !== 'approve') throw new Error('User rejected the request');
}

async function approveOrDeferTransaction(
    origin: string,
    transaction: Transaction | VersionedTransaction,
    bytes: number[],
    method: QueuedTransactionMethod,
    options: SendOptions | undefined,
    keypair: Keypair,
    rpc: Awaited<ReturnType<typeof requireActiveRpc>>,
    connection: Connection
): Promise<void> {
    const title = method === 'signTransaction' ? 'Sign transaction' : 'Sign and send transaction';
    const lines = transactionLines(transaction, rpc.name);
    const { balanceChanges, instructionTree } = await simulateTransactionDetails(connection, transaction);
    const transactionMessage = transactionMessageBase64(transaction);
    const decision = await requestApproval({
        origin,
        title,
        lines,
        transaction: true,
        balanceChanges,
        instructionTree,
        transactionMessage,
    });
    if (decision === 'approve') return;
    if (decision === 'defer') {
        await enqueueTransaction(keypair.publicKey.toBase58(), rpc.id, {
            origin,
            title,
            lines,
            balanceChanges,
            instructionTree,
            transaction: [...bytes],
            method,
            options,
        });
        throw new Error('Transaction deferred');
    }
    throw new Error('User cancelled the request');
}

function transactionLines(transaction: Transaction | VersionedTransaction, rpcName: string): string[] {
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
    return lines;
}

async function simulateTransactionDetails(
    connection: Connection,
    transaction: Transaction | VersionedTransaction
): Promise<{ balanceChanges: SolBalanceChange[]; instructionTree: InstructionTreeNode[] }> {
    const accountKeys = await transactionAccountKeys(connection, transaction);
    const addresses = accountKeys.map((key) => key.toBase58());
    const simulatedTransaction =
        transaction instanceof VersionedTransaction
            ? transaction
            : new VersionedTransaction(transaction.compileMessage());
    const [before, simulation] = await Promise.all([
        connection.getMultipleAccountsInfo(accountKeys, 'confirmed'),
        connection.simulateTransaction(simulatedTransaction, {
            commitment: 'confirmed',
            sigVerify: false,
            innerInstructions: true,
            accounts: { encoding: 'base64', addresses },
        }),
    ]);
    if (simulation.value.err) throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
    if (!simulation.value.accounts) throw new Error('Simulation did not return account balances');
    return {
        balanceChanges: calculateSolBalanceChanges(
            addresses,
            before.map((account) => account?.lamports ?? null),
            simulation.value.accounts.map((account) => account?.lamports ?? null)
        ),
        instructionTree: buildInstructionTree(transaction, accountKeys, simulation.value.innerInstructions ?? []),
    };
}

export function buildInstructionTree(
    transaction: Transaction | VersionedTransaction,
    accountKeys: PublicKey[],
    innerInstructionGroups: ParsedInnerInstruction[]
): InstructionTreeNode[] {
    const innerByOuterIndex = new Map(innerInstructionGroups.map((group) => [group.index, group.instructions]));
    const outerInstructions =
        transaction instanceof VersionedTransaction
            ? transaction.message.compiledInstructions.map((instruction) => ({
                  programId: accountKeys[instruction.programIdIndex]?.toBase58() ?? 'Unknown',
                  data: [...instruction.data],
              }))
            : transaction.instructions.map((instruction) => ({
                  programId: instruction.programId.toBase58(),
                  data: [...instruction.data],
              }));

    return outerInstructions.map((instruction, index) => ({
        ...instruction,
        innerInstructions: (innerByOuterIndex.get(index) ?? []).map((innerInstruction) => ({
            programId: innerInstruction.programId.toBase58(),
            data: 'data' in innerInstruction ? [...bs58.decode(innerInstruction.data)] : [],
            instructionName:
                'parsed' in innerInstruction && typeof innerInstruction.parsed?.type === 'string'
                    ? formatInstructionName(innerInstruction.parsed.type)
                    : undefined,
            innerInstructions: [],
        })),
    }));
}

function formatInstructionName(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

async function transactionAccountKeys(
    connection: Connection,
    transaction: Transaction | VersionedTransaction
): Promise<PublicKey[]> {
    if (!('version' in transaction)) return transaction.compileMessage().accountKeys;
    const lookupTables = await Promise.all(
        transaction.message.addressTableLookups.map(async ({ accountKey }) => {
            const { value } = await connection.getAddressLookupTable(accountKey, { commitment: 'confirmed' });
            if (!value) throw new Error(`Address lookup table not found: ${accountKey.toBase58()}`);
            return value;
        })
    );
    return transaction.message.getAccountKeys({ addressLookupTableAccounts: lookupTables }).keySegments().flat();
}

export function calculateSolBalanceChanges(
    addresses: string[],
    beforeLamports: Array<number | null>,
    afterLamports: Array<number | null>
): SolBalanceChange[] {
    if (addresses.length !== beforeLamports.length || addresses.length !== afterLamports.length) {
        throw new Error('Simulation returned an unexpected number of accounts');
    }
    return addresses.map((address, index) => ({
        address,
        lamports: (afterLamports[index] ?? 0) - (beforeLamports[index] ?? 0),
    }));
}

async function requestApproval(details: Omit<ApprovalDetails, 'id'>): Promise<ApprovalDecision> {
    const id = crypto.randomUUID();
    const decision = new Promise<ApprovalDecision>((resolve) => {
        pendingApprovals.set(id, { details: { ...details, id }, resolve });
    });
    const approvalWindow = await chrome.windows.create({
        url: chrome.runtime.getURL(`approval.html?id=${encodeURIComponent(id)}`),
        type: 'popup',
        width: 420,
        height: 560,
        focused: true,
    });
    if (approvalWindow.id !== undefined) approvalWindows.set(approvalWindow.id, id);
    return decision;
}

async function getActiveQueueSummaries(): Promise<QueuedTransactionSummary[]> {
    const [keypair, rpc] = await Promise.all([getActiveKeypair(), getActiveRpc()]);
    if (!keypair || !rpc) return [];
    const transactions = await listQueuedTransactions(keypair.publicKey, rpc.id);
    const connection = new Connection(rpc.url, 'confirmed');
    const validityByBlockhash = new Map<string, Promise<boolean>>();
    return Promise.all(
        transactions.map(async (transaction) => {
            const deserialized = deserialize(transaction.transaction);
            const blockhash = recentBlockhash(deserialized);
            let validity = validityByBlockhash.get(blockhash);
            if (!validity) {
                validity = connection.isBlockhashValid(blockhash).then(({ value }) => value);
                validityByBlockhash.set(blockhash, validity);
            }
            return toQueueSummary(transaction, !(await validity), deserialized);
        })
    );
}

async function getActiveTransactionHistory(before?: string): Promise<TransactionHistoryPage> {
    const pageSize = 10;
    const [keypair, rpc] = await Promise.all([getActiveKeypair(), getActiveRpc()]);
    if (!keypair || !rpc) return { transactions: [] };

    const cached = await listTransactionHistory(keypair.publicKey, rpc.id, before, pageSize);
    const connection = new Connection(rpc.url, 'confirmed');
    let fetched;
    try {
        fetched = await connection.getSignaturesForAddress(new PublicKey(keypair.publicKey), {
            before,
            limit: pageSize,
        });
    } catch (error) {
        if (!cached.length) throw error;
        return {
            transactions: cached,
            nextBefore: cached.length === pageSize ? cached.at(-1)?.signature : undefined,
        };
    }

    const overlapsCache = await hasStoredTransaction(
        keypair.publicKey,
        rpc.id,
        fetched.map(({ signature }) => signature)
    );
    await storeTransactionHistory(keypair.publicKey, rpc.id, fetched.map(toTransactionHistoryItem), before);

    // A fully new page preloads the next ten signatures. The following scroll can then render the overlap from storage.
    if (!overlapsCache && fetched.length === pageSize) {
        const remainderBefore = fetched.at(-1)!.signature;
        const remainder = await connection
            .getSignaturesForAddress(new PublicKey(keypair.publicKey), {
                before: remainderBefore,
                limit: pageSize,
            })
            .catch(() => []);
        await storeTransactionHistory(
            keypair.publicKey,
            rpc.id,
            remainder.map(toTransactionHistoryItem),
            remainderBefore
        );
    }

    const transactions = await listTransactionHistory(keypair.publicKey, rpc.id, before, pageSize);
    return {
        transactions,
        nextBefore: fetched.length === pageSize ? transactions.at(-1)?.signature : undefined,
    };
}

async function getActiveQueueSummary(id: string): Promise<QueuedTransactionSummary> {
    const [keypair, rpc] = await Promise.all([getActiveKeypair(), getActiveRpc()]);
    if (!keypair || !rpc) throw new Error('Select a keypair and RPC first');
    const queued = (await listQueuedTransactions(keypair.publicKey, rpc.id)).find(
        (transaction) => transaction.id === id
    );
    if (!queued) throw new Error('Queued transaction not found');

    const connection = new Connection(rpc.url, 'confirmed');
    const transaction = deserialize(queued.transaction);
    const expiredBlockhash = !(await connection.isBlockhashValid(recentBlockhash(transaction))).value;
    if (expiredBlockhash) return toQueueSummary(queued, true, transaction);
    return {
        ...toQueueSummary(queued, false, transaction),
        ...(await simulateTransactionDetails(connection, transaction)),
    };
}

function toQueueSummary(
    transaction: QueuedTransaction,
    expiredBlockhash: boolean,
    deserialized: Transaction | VersionedTransaction
): QueuedTransactionSummary {
    const { id, origin, title, lines, method, createdAt, balanceChanges, instructionTree } = transaction;
    return {
        id,
        origin,
        title,
        lines,
        method,
        createdAt,
        expiredBlockhash,
        balanceChanges,
        instructionTree,
        transactionMessage: transactionMessageBase64(deserialized),
    };
}

async function moveActiveQueuedTransactionToTop(id: string): Promise<void> {
    const [keypair, rpc] = await Promise.all([getActiveKeypair(), getActiveRpc()]);
    if (!keypair || !rpc) throw new Error('Select a keypair and RPC first');
    await moveQueuedTransactionToTop(keypair.publicKey, rpc.id, id);
}

async function removeActiveQueuedTransaction(id: string): Promise<void> {
    const [keypair, rpc] = await Promise.all([getActiveKeypair(), getActiveRpc()]);
    if (!keypair || !rpc) throw new Error('Select a keypair and RPC first');
    await removeQueuedTransaction(keypair.publicKey, rpc.id, id);
}

async function refreshActiveQueuedTransactionBlockhash(id: string): Promise<void> {
    const [keypair, rpc] = await Promise.all([getActiveKeypair(), requireActiveRpc()]);
    if (!keypair) throw new Error('Select a keypair first');
    const transactions = await listQueuedTransactions(keypair.publicKey, rpc.id);
    const queued = transactions.find((transaction) => transaction.id === id);
    if (!queued) throw new Error('Queued transaction not found');

    const connection = new Connection(rpc.url, 'confirmed');
    const transaction = deserialize(queued.transaction);
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    replaceRecentBlockhash(transaction, blockhash);
    await refreshQueuedTransaction(keypair.publicKey, rpc.id, id, [...serialize(transaction)]);
}

export function replaceRecentBlockhash(transaction: Transaction | VersionedTransaction, blockhash: string): void {
    if ('version' in transaction) {
        transaction.message.recentBlockhash = blockhash;
        transaction.signatures = transaction.signatures.map((signature) => new Uint8Array(signature.length));
    } else {
        transaction.recentBlockhash = blockhash;
        transaction.signatures.forEach((signature) => (signature.signature = null));
    }
}

async function signQueuedTransaction(id: string): Promise<{ signature?: string }> {
    const [storedKeypair, rpc] = await Promise.all([getActiveKeypair(), requireActiveRpc()]);
    if (!storedKeypair) throw new Error('Select a keypair first');
    const queued = await claimQueuedTransaction(storedKeypair.publicKey, rpc.id, id);

    let keypair: Keypair | null = null;
    try {
        keypair = await getKeypair();
        if (keypair.publicKey.toBase58() !== storedKeypair.publicKey) {
            throw new Error('The active keypair changed before signing');
        }
        if ((await getActiveRpc())?.id !== rpc.id) throw new Error('The active RPC changed before signing');
        const transaction = deserialize(queued.transaction);
        sign(transaction, keypair);
        let signature: string | undefined;
        if (queued.method === 'signAndSendTransaction') {
            if ((await resolveRpcChain(rpc.url)) !== rpc.chain) {
                throw new Error('The active RPC changed clusters after it was added');
            }
            const connection = new Connection(rpc.url, 'confirmed');
            const simulation =
                'version' in transaction
                    ? await connection.simulateTransaction(transaction)
                    : await connection.simulateTransaction(transaction);
            if (simulation.value.err) throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
            signature = await connection.sendRawTransaction(serialize(transaction), queued.options);
        }
        await removeQueuedTransaction(storedKeypair.publicKey, rpc.id, id);
        return signature ? { signature } : {};
    } catch (error) {
        await releaseQueuedTransaction(storedKeypair.publicKey, rpc.id, id).catch(() => undefined);
        throw error;
    } finally {
        keypair?.secretKey.fill(0);
    }
}

function deserialize(bytes: number[]): Transaction | VersionedTransaction {
    const serialized = new Uint8Array(bytes);
    try {
        return VersionedTransaction.deserialize(serialized);
    } catch {
        return Transaction.from(serialized);
    }
}

function recentBlockhash(transaction: Transaction | VersionedTransaction): string {
    const blockhash = 'version' in transaction ? transaction.message.recentBlockhash : transaction.recentBlockhash;
    if (!blockhash) throw new Error('Queued transaction does not have a recent blockhash');
    return blockhash;
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

export function transactionMessageBase64(transaction: Transaction | VersionedTransaction): string {
    const message = 'version' in transaction ? transaction.message.serialize() : transaction.serializeMessage();
    let binary = '';
    for (const byte of message) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function printable(value: string): boolean {
    return value.length > 0 && value.length <= 1000 && !/[\u0000-\u0008\u000e-\u001f]/.test(value);
}
