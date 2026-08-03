import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ExtensionApp } from '@/extension/app';
import type { WalletStatus } from '@/extension/messages';
import '@/extension/wallet.css';

async function renderPopup() {
    const { welcomeCompleted } = await chrome.storage.local.get('welcomeCompleted');
    const status = welcomeCompleted
        ? ((await chrome.runtime.sendMessage({ type: 'wallet:status' })) as WalletStatus | { __error: string })
        : null;
    const hasWallet = status && !('__error' in status) && Boolean(status.active);

    createRoot(document.querySelector('#root')!).render(
        <StrictMode>
            <ExtensionApp initialPath={welcomeCompleted ? (hasWallet ? '/wallet' : '/add-keypair') : '/'} />
        </StrictMode>
    );
}

void renderPopup();
