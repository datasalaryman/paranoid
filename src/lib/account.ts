// This is copied with modification from @wallet-standard/wallet

import {
    SolanaSignAndSendTransaction,
    SolanaSignMessage,
    SolanaSignTransaction,
} from '@solana/wallet-standard-features';
import type { WalletAccount as WalletStandardAccount } from '@wallet-standard/base';
import { SOLANA_CHAINS } from './solana.js';

const chains = SOLANA_CHAINS;
const features = [SolanaSignAndSendTransaction, SolanaSignTransaction, SolanaSignMessage] as const;

export class WalletAccount implements WalletStandardAccount {
    readonly #address: WalletStandardAccount['address'];
    readonly #publicKey: WalletStandardAccount['publicKey'];
    readonly #chains: WalletStandardAccount['chains'];
    readonly #features: WalletStandardAccount['features'];
    readonly #label: WalletStandardAccount['label'];
    readonly #icon: WalletStandardAccount['icon'];

    get address() {
        return this.#address;
    }

    get publicKey() {
        return this.#publicKey.slice();
    }

    get chains() {
        return this.#chains.slice();
    }

    get features() {
        return this.#features.slice();
    }

    get label() {
        return this.#label;
    }

    get icon() {
        return this.#icon;
    }

    constructor({ address, publicKey, label, icon }: Omit<WalletStandardAccount, 'chains' | 'features'>) {
        if (new.target === WalletAccount) {
            Object.freeze(this);
        }

        this.#address = address;
        this.#publicKey = publicKey;
        this.#chains = chains;
        this.#features = features;
        this.#label = label;
        this.#icon = icon;
    }
}
