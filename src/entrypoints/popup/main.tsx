import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ExtensionApp } from '@/extension/app';
import type { VaultStatus, WalletStatus } from '@/extension/messages';
import '@/extension/wallet.css';

async function renderPopup() {
    const { welcomeCompleted } = await chrome.storage.local.get('welcomeCompleted');
    const vault = welcomeCompleted
        ? ((await chrome.runtime.sendMessage({ type: 'wallet:vault-status' })) as VaultStatus | { __error: string })
        : null;
    let initialPath = '/';
    if (welcomeCompleted && vault && !('__error' in vault)) {
        if (!vault.configured) initialPath = '/create-password';
        else if (!vault.unlocked) initialPath = '/unlock';
        else {
            const status = (await chrome.runtime.sendMessage({ type: 'wallet:status' })) as
                WalletStatus | { __error: string };
            initialPath =
                '__error' in status
                    ? '/wallet'
                    : !status.active
                      ? '/add-keypair'
                      : status.activeRpc
                        ? '/wallet'
                        : '/add-rpc';
        }
    }

    createRoot(document.querySelector('#root')!).render(
        <StrictMode>
            <ExtensionApp initialPath={initialPath} />
        </StrictMode>
    );
}

void renderPopup();
