import {
    address,
    blockhash,
    createKeyPairFromBytes,
    decompileTransactionMessage,
    getCompiledTransactionMessageDecoder,
    getCompiledTransactionMessageEncoder,
    getTransactionDecoder,
    getTransactionEncoder,
    partiallySignTransaction,
    type SignatureBytes,
    type Transaction as KitTransaction,
    type TransactionMessageBytes,
} from '@solana/kit';
import { MessageV1, PublicKey, VersionedTransaction, type Signer } from '@solana/web3.js';

function messageView(bytes: TransactionMessageBytes): MessageV1 {
    const compiled = getCompiledTransactionMessageDecoder().decode(bytes);
    if (compiled.version !== 1) throw new Error('Expected a V1 message');
    const encoded = getCompiledTransactionMessageEncoder().encode(compiled);
    if (encoded.length !== bytes.length || encoded.some((byte, index) => byte !== bytes[index])) {
        throw new Error('Invalid V1 message encoding');
    }
    const message = new MessageV1({
        header: {
            numRequiredSignatures: compiled.header.numSignerAccounts,
            numReadonlySignedAccounts: compiled.header.numReadonlySignerAccounts,
            numReadonlyUnsignedAccounts: compiled.header.numReadonlyNonSignerAccounts,
        },
        staticAccountKeys: compiled.staticAccounts.map((key) => new PublicKey(key)),
        recentBlockhash: compiled.lifetimeToken,
        compiledInstructions: compiled.instructionHeaders.map((header, index) => ({
            programIdIndex: header.programAccountIndex,
            accountKeyIndexes: [...compiled.instructionPayloads[index]!.instructionAccountIndices],
            data: new Uint8Array(compiled.instructionPayloads[index]!.instructionData),
        })),
    });
    // web3.js 1.x cannot represent all u64 fees. Keep the canonical config in Kit;
    // refuse an unsafe numeric view instead of rounding a fee that might be displayed.
    Object.defineProperty(message, 'transactionConfig', {
        get() {
            const decoded = decompileTransactionMessage(compiled);
            if (decoded.version !== 1) throw new Error('Expected a V1 message');
            const config = decoded.config ?? {};
            if ((config.priorityFeeLamports ?? 0n) > BigInt(Number.MAX_SAFE_INTEGER)) {
                throw new Error('Use V1Transaction.config for bigint priority fees');
            }
            return {
                computeUnitLimit: config.computeUnitLimit ?? null,
                loadedAccountsDataSizeLimit: config.loadedAccountsDataSizeLimit ?? null,
                heapSize: config.heapSize ?? null,
                priorityFee: config.priorityFeeLamports === undefined ? null : Number(config.priorityFeeLamports),
            };
        },
    });
    return message;
}

/** Wire-format boundary: web3.js 1.x supplies read-only views; Kit owns V1 writes. */
export class V1Transaction extends VersionedTransaction {
    #messageBytes: TransactionMessageBytes;

    constructor(bytes: Uint8Array) {
        if (bytes[0] !== 0x81) throw new Error('Expected a V1 transaction');
        if (bytes.length > 4096) throw new Error('V1 transaction exceeds 4096 bytes');
        const transaction = getTransactionDecoder().decode(bytes);
        const message = messageView(transaction.messageBytes);
        const signatures = message.staticAccountKeys
            .slice(0, message.header.numRequiredSignatures)
            .map((key) => new Uint8Array(transaction.signatures[address(key.toBase58())] ?? new Uint8Array(64)));
        super(message, signatures);
        this.#messageBytes = transaction.messageBytes;
        // Reject non-canonical/trailing bytes rather than silently signing a different payload.
        const encoded = this.serialize();
        if (encoded.length !== bytes.length || encoded.some((byte, index) => byte !== bytes[index])) {
            throw new Error('Invalid V1 transaction encoding');
        }
    }

    get messageBytes(): Uint8Array {
        return new Uint8Array(this.#messageBytes);
    }

    static override deserialize(bytes: Uint8Array): V1Transaction {
        return new V1Transaction(bytes);
    }

    get config() {
        const message = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(this.#messageBytes));
        if (message.version !== 1) throw new Error('Expected a V1 message');
        return message.config ?? {};
    }

    #asKitTransaction(): KitTransaction {
        const signatures: KitTransaction['signatures'] = {};
        this.message.staticAccountKeys.slice(0, this.message.header.numRequiredSignatures).forEach((key, index) => {
            const signature = this.signatures[index]!;
            signatures[address(key.toBase58())] = signature.some((byte) => byte !== 0)
                ? (signature as SignatureBytes)
                : null;
        });
        return { messageBytes: this.#messageBytes, signatures };
    }

    override serialize(): Uint8Array {
        return new Uint8Array(getTransactionEncoder().encode(this.#asKitTransaction()));
    }

    override async sign(signers: Signer[]): Promise<void> {
        const keys = await Promise.all(signers.map((signer) => createKeyPairFromBytes(signer.secretKey)));
        const signed = await partiallySignTransaction(keys, this.#asKitTransaction());
        this.signatures = this.message.staticAccountKeys
            .slice(0, this.message.header.numRequiredSignatures)
            .map((key) => new Uint8Array(signed.signatures[address(key.toBase58())] ?? new Uint8Array(64)));
    }

    replaceRecentBlockhash(value: string): void {
        const compiled = getCompiledTransactionMessageDecoder().decode(this.#messageBytes);
        this.#messageBytes = getCompiledTransactionMessageEncoder().encode({
            ...compiled,
            lifetimeToken: blockhash(value),
        }) as TransactionMessageBytes;
        this.message = messageView(this.#messageBytes);
        this.signatures = this.signatures.map(() => new Uint8Array(64));
    }
}
