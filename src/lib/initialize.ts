import { registerWallet } from './register.js';
import { Wallet } from './wallet.js';
import type { ParanoidProvider } from './window.js';

export function initialize(provider: ParanoidProvider): void {
    registerWallet(new Wallet(provider));
}
