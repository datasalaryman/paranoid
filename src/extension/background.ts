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
    SavedTransactionSummary,
    SolBalanceChange,
    TransactionHistoryDetails,
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
    setRpcExplorerMainnet,
    setupVault,
    unlockVault,
    updateRpc,
} from '@/extension/keypairs';
import {
    claimSavedTransaction,
    completeSavedTransaction,
    setSavedTransactionPinned,
    saveTransaction,
    listSavedTransactions,
    moveSavedTransactionToTop,
    refreshSavedTransaction,
    releaseSavedTransaction,
    removeSavedTransaction,
    type SavedTransaction,
    type SavedTransactionMethod,
} from '@/extension/saved-transactions';
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
                    message.decision === 'save-for-later' ||
                        message.decision === 'cancel' ||
                        message.decision === 'approve'
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
            if (typeof message.explorerMainnet !== 'boolean') {
                sendResponse({ __error: 'Explorer mainnet preference must be a boolean' });
                return;
            }
            resolveRpcChain(message.url)
                .then((chain) => updateRpc(message.id, message.label, message.url, chain, message.explorerMainnet))
                .then(() => sendResponse(true))
                .catch((error) => sendResponse({ __error: error instanceof Error ? error.message : String(error) }));
            return true;
        }

        if (message?.type === 'wallet:set-rpc-explorer-mainnet') {
            if (!isExtensionPage(sender)) {
                sendResponse({ __error: 'Wallet management is only available from Paranoid' });
                return;
            }
            if (typeof message.explorerMainnet !== 'boolean') {
                sendResponse({ __error: 'Explorer mainnet preference must be a boolean' });
                return;
            }
            setRpcExplorerMainnet(message.id, message.explorerMainnet)
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

        if (message?.type === 'saved-transactions:list') {
            if (!isExtensionPage(sender)) {
                sendResponse({ __error: 'Saved transactions are only available from Paranoid' });
                return;
            }
            getActiveSavedTransactionSummaries()
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

        if (message?.type === 'history:get') {
            if (!isExtensionPage(sender)) {
                sendResponse({ __error: 'Transaction history is only available from Paranoid' });
                return;
            }
            getActiveTransactionHistoryDetails(message.signature)
                .then(sendResponse)
                .catch((error) => sendResponse({ __error: error instanceof Error ? error.message : String(error) }));
            return true;
        }

        if (message?.type === 'saved-transactions:get') {
            if (!isExtensionPage(sender)) {
                sendResponse({ __error: 'Saved transactions are only available from Paranoid' });
                return;
            }
            getActiveSavedTransactionSummary(message.id)
                .then(sendResponse)
                .catch((error) => sendResponse({ __error: error instanceof Error ? error.message : String(error) }));
            return true;
        }

        if (message?.type === 'saved-transactions:sign') {
            if (!isExtensionPage(sender)) {
                sendResponse({ __error: 'Saved transactions are only available from Paranoid' });
                return;
            }
            signSavedTransaction(message.id)
                .then(sendResponse)
                .catch((error) => sendResponse({ __error: error instanceof Error ? error.message : String(error) }));
            return true;
        }

        if (message?.type === 'saved-transactions:save-for-later') {
            if (!isExtensionPage(sender)) {
                sendResponse({ __error: 'Saved transactions are only available from Paranoid' });
                return;
            }
            moveActiveSavedTransactionToTop(message.id)
                .then(() => sendResponse(true))
                .catch((error) => sendResponse({ __error: error instanceof Error ? error.message : String(error) }));
            return true;
        }

        if (message?.type === 'saved-transactions:refresh-blockhash') {
            if (!isExtensionPage(sender)) {
                sendResponse({ __error: 'Saved transactions are only available from Paranoid' });
                return;
            }
            refreshActiveSavedTransactionBlockhash(message.id)
                .then(() => sendResponse(true))
                .catch((error) => sendResponse({ __error: error instanceof Error ? error.message : String(error) }));
            return true;
        }

        if (message?.type === 'saved-transactions:set-pinned') {
            if (!isExtensionPage(sender)) {
                sendResponse({ __error: 'Saved transactions are only available from Paranoid' });
                return;
            }
            setActiveSavedTransactionPinned(message.id, message.pinned)
                .then(() => sendResponse(true))
                .catch((error) => sendResponse({ __error: error instanceof Error ? error.message : String(error) }));
            return true;
        }

        if (message?.type === 'saved-transactions:remove') {
            if (!isExtensionPage(sender)) {
                sendResponse({ __error: 'Saved transactions are only available from Paranoid' });
                return;
            }
            removeActiveSavedTransaction(message.id)
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
        const connection = rpc.chain ? new Connection(rpc.url, 'confirmed') : null;
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
                        `Network: ${rpc.chain ? `Solana ${rpc.name}` : 'Sign Only (any cluster)'}`,
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
                await approveOrSaveTransactionForLater(
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
                    `Network: ${rpc.chain ? `Solana ${rpc.name}` : 'Sign Only (any cluster). Not simulated.'}`,
                ]);
                transactions.forEach((transaction) => sign(transaction, keypair));
                return transactions.map((transaction) => Array.from(serialize(transaction)));
            }
            case 'signAndSendTransaction': {
                if (!connection) throw new Error('Select an RPC to sign and send transactions');
                await requireTrusted(origin);
                const { transaction: bytes, options } = request.params as {
                    transaction: number[];
                    options?: SendOptions;
                };
                const transaction = deserialize(bytes);
                await approveOrSaveTransactionForLater(
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

export function validateRequestedChain(request: ProviderRequest, rpcChain: SolanaChain | null): void {
    if (rpcChain === null) {
        if (request.method === 'signAndSendTransaction') {
            throw new Error('Select an RPC to sign and send transactions');
        }
        return;
    }
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
                explorerMainnet: activeRpc.explorerMainnet,
                url: activeRpc.url,
            },
            rpcs,
            balance: activeRpc?.chain
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
            explorerMainnet: activeRpc.explorerMainnet,
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

async function approveOrSaveTransactionForLater(
    origin: string,
    transaction: Transaction | VersionedTransaction,
    bytes: number[],
    method: SavedTransactionMethod,
    options: SendOptions | undefined,
    keypair: Keypair,
    rpc: Awaited<ReturnType<typeof requireActiveRpc>>,
    connection: Connection | null
): Promise<void> {
    const title = method === 'signTransaction' ? 'Sign transaction' : 'Sign and send transaction';
    const lines = transactionLines(transaction, rpc.name);
    if (!connection) {
        lines.push('Sign Only: cluster is not checked. Transaction is not simulated or broadcast.');
    }
    const { balanceChanges, instructionTree } = connection
        ? await simulateTransactionDetails(connection, transaction)
        : {
              balanceChanges: undefined,
              instructionTree: buildInstructionTree(
                  transaction,
                  'version' in transaction
                      ? transaction.message.staticAccountKeys
                      : transaction.compileMessage().accountKeys,
                  []
              ),
          };
    const transactionMessage = transactionMessageBase64(transaction);
    const decision = await requestApproval({
        origin,
        title,
        lines,
        transaction: true,
        canSaveForLater: Boolean(connection),
        balanceChanges,
        instructionTree,
        transactionMessage,
    });
    if (decision === 'approve') return;
    if (decision === 'save-for-later') {
        if (!connection) throw new Error('Saving transactions is unavailable in Sign Only mode');
        await saveTransaction(keypair.publicKey.toBase58(), rpc.id, {
            origin,
            title,
            lines,
            balanceChanges,
            instructionTree,
            transaction: [...bytes],
            method,
            options,
        });
        throw new Error('Transaction saved for later');
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
    innerInstructionGroups: TransactionInnerInstructionGroup[]
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
            programId:
                'programId' in innerInstruction
                    ? innerInstruction.programId.toBase58()
                    : (accountKeys[innerInstruction.programIdIndex]?.toBase58() ?? 'Unknown'),
            data: 'data' in innerInstruction ? [...bs58.decode(innerInstruction.data)] : [],
            instructionName:
                'parsed' in innerInstruction && typeof innerInstruction.parsed?.type === 'string'
                    ? formatInstructionName(innerInstruction.parsed.type)
                    : undefined,
            innerInstructions: [],
        })),
    }));
}

type TransactionInnerInstruction =
    ParsedInnerInstruction['instructions'][number] | { programIdIndex: number; data: string };

type TransactionInnerInstructionGroup = {
    index: number;
    instructions: TransactionInnerInstruction[];
};

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

async function getActiveSavedTransactionSummaries(): Promise<SavedTransactionSummary[]> {
    const [keypair, rpc] = await Promise.all([getActiveKeypair(), getActiveRpc()]);
    if (!keypair || !rpc?.chain) return [];
    const transactions = await listSavedTransactions(keypair.publicKey, rpc.id);
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
            return toSavedTransactionSummary(transaction, !(await validity), deserialized);
        })
    );
}

async function getActiveTransactionHistory(before?: string): Promise<TransactionHistoryPage> {
    const pageSize = 10;
    const [keypair, rpc] = await Promise.all([getActiveKeypair(), getActiveRpc()]);
    if (!keypair || !rpc?.chain) return { transactions: [] };

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

async function getActiveTransactionHistoryDetails(signature: string): Promise<TransactionHistoryDetails> {
    if (typeof signature !== 'string' || !signature) throw new Error('Transaction signature is required');
    const rpc = await getActiveRpc();
    if (!rpc?.chain) throw new Error('Select an RPC first');

    const response = await new Connection(rpc.url, 'confirmed').getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
    });
    if (!response) throw new Error('Transaction not found');
    if (!response.meta) throw new Error('Transaction details are unavailable');

    const message = response.transaction.message;
    const accountKeys = message
        .getAccountKeys({ accountKeysFromLookups: response.meta.loadedAddresses })
        .keySegments()
        .flat();
    const addresses = accountKeys.map((key) => key.toBase58());

    return {
        balanceChanges: calculateSolBalanceChanges(addresses, response.meta.preBalances, response.meta.postBalances),
        instructionTree: buildInstructionTree(
            new VersionedTransaction(message),
            accountKeys,
            response.meta.innerInstructions ?? []
        ),
    };
}

async function getActiveSavedTransactionSummary(id: string): Promise<SavedTransactionSummary> {
    const [keypair, rpc] = await Promise.all([getActiveKeypair(), getActiveRpc()]);
    if (!keypair || !rpc?.chain) throw new Error('Select a keypair and RPC first');
    const savedTransaction = (await listSavedTransactions(keypair.publicKey, rpc.id)).find(
        (transaction) => transaction.id === id
    );
    if (!savedTransaction) throw new Error('Saved transaction not found');

    const transaction = deserialize(savedTransaction.transaction);
    const connection = new Connection(rpc.url, 'confirmed');
    const expiredBlockhash = !(await connection.isBlockhashValid(recentBlockhash(transaction))).value;
    if (expiredBlockhash) return toSavedTransactionSummary(savedTransaction, true, transaction);
    const summary = toSavedTransactionSummary(savedTransaction, false, transaction);
    try {
        return { ...summary, ...(await simulateTransactionDetails(connection, transaction)) };
    } catch (error) {
        return {
            ...summary,
            simulationError: error instanceof Error ? error.message : String(error),
        };
    }
}

function toSavedTransactionSummary(
    transaction: SavedTransaction,
    expiredBlockhash: boolean,
    deserialized: Transaction | VersionedTransaction
): SavedTransactionSummary {
    const { id, origin, title, lines, method, createdAt, balanceChanges, instructionTree } = transaction;
    return {
        id,
        origin,
        title,
        lines,
        method,
        createdAt,
        expiredBlockhash,
        pinned: Boolean(transaction.pinned),
        balanceChanges,
        instructionTree,
        transactionMessage: transactionMessageBase64(deserialized),
    };
}

async function moveActiveSavedTransactionToTop(id: string): Promise<void> {
    const [keypair, rpc] = await Promise.all([getActiveKeypair(), getActiveRpc()]);
    if (!keypair || !rpc?.chain) throw new Error('Select a keypair and RPC first');
    await moveSavedTransactionToTop(keypair.publicKey, rpc.id, id);
}

async function setActiveSavedTransactionPinned(id: string, pinned: boolean): Promise<void> {
    if (typeof pinned !== 'boolean') throw new Error('Invalid pin state');
    const [keypair, rpc] = await Promise.all([getActiveKeypair(), getActiveRpc()]);
    if (!keypair || !rpc?.chain) throw new Error('Select a keypair and RPC first');
    await setSavedTransactionPinned(keypair.publicKey, rpc.id, id, pinned);
}

async function removeActiveSavedTransaction(id: string): Promise<void> {
    const [keypair, rpc] = await Promise.all([getActiveKeypair(), getActiveRpc()]);
    if (!keypair || !rpc?.chain) throw new Error('Select a keypair and RPC first');
    await removeSavedTransaction(keypair.publicKey, rpc.id, id);
}

async function refreshActiveSavedTransactionBlockhash(id: string): Promise<void> {
    const [keypair, rpc] = await Promise.all([getActiveKeypair(), requireActiveRpc()]);
    if (!rpc.chain) throw new Error('Blockhash refresh is unavailable in Sign Only mode');
    if (!keypair) throw new Error('Select a keypair first');
    const transactions = await listSavedTransactions(keypair.publicKey, rpc.id);
    const savedTransaction = transactions.find((transaction) => transaction.id === id);
    if (!savedTransaction) throw new Error('Saved transaction not found');

    const connection = new Connection(rpc.url, 'confirmed');
    const transaction = deserialize(savedTransaction.transaction);
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    replaceRecentBlockhash(transaction, blockhash);
    await refreshSavedTransaction(keypair.publicKey, rpc.id, id, [...serialize(transaction)]);
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

async function signSavedTransaction(id: string): Promise<{ signature?: string }> {
    const [storedKeypair, rpc] = await Promise.all([getActiveKeypair(), requireActiveRpc()]);
    if (!rpc.chain) throw new Error('Saved transactions are unavailable in Sign Only mode');
    if (!storedKeypair) throw new Error('Select a keypair first');
    const savedTransaction = await claimSavedTransaction(storedKeypair.publicKey, rpc.id, id);

    let keypair: Keypair | null = null;
    try {
        validateRequestedChain({ channel: 'paranoid:page', id, method: savedTransaction.method }, rpc.chain);
        keypair = await getKeypair();
        if (keypair.publicKey.toBase58() !== storedKeypair.publicKey) {
            throw new Error('The active keypair changed before signing');
        }
        if ((await getActiveRpc())?.id !== rpc.id) throw new Error('The active RPC changed before signing');
        const transaction = deserialize(savedTransaction.transaction);
        sign(transaction, keypair);
        let signature: string | undefined;
        if (savedTransaction.method === 'signAndSendTransaction') {
            if ((await resolveRpcChain(rpc.url)) !== rpc.chain) {
                throw new Error('The active RPC changed clusters after it was added');
            }
            const connection = new Connection(rpc.url, 'confirmed');
            const simulation =
                'version' in transaction
                    ? await connection.simulateTransaction(transaction)
                    : await connection.simulateTransaction(transaction);
            if (simulation.value.err) throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
            signature = await connection.sendRawTransaction(serialize(transaction), savedTransaction.options);
        }
        await completeSavedTransaction(storedKeypair.publicKey, rpc.id, id);
        return signature ? { signature } : {};
    } catch (error) {
        await releaseSavedTransaction(storedKeypair.publicKey, rpc.id, id).catch(() => undefined);
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
    if (!blockhash) throw new Error('Saved transaction does not have a recent blockhash');
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
