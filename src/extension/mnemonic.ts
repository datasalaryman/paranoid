import { Keypair } from '@solana/web3.js';
import { mnemonicToSeedSync } from '@scure/bip39';

export function keypairFromMnemonic(mnemonic: string): Keypair {
    const seed = mnemonicToSeedSync(mnemonic);
    try {
        return Keypair.fromSeed(seed.slice(0, 32));
    } finally {
        seed.fill(0);
    }
}
