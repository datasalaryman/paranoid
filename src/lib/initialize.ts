import { registerWallet } from '@/lib/register';
import { Wallet } from '@/lib/wallet';
import type { ParanoidProvider } from '@/lib/window';

export function initialize(provider: ParanoidProvider): void {
    registerWallet(new Wallet(provider));
}
