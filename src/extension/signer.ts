import { Keypair } from '@solana/web3.js';

export function signerFromSecretKey(secretKey: Uint8Array): Keypair {
    return Keypair.fromSecretKey(new Uint8Array(secretKey));
}
