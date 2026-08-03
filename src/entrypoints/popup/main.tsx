import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ExtensionApp } from '@/extension/app';
import '@/extension/wallet.css';

async function renderPopup() {
    const { welcomeCompleted } = await chrome.storage.local.get('welcomeCompleted');

    createRoot(document.querySelector('#root')!).render(
        <StrictMode>
            <ExtensionApp initialPath={welcomeCompleted ? '/wallet' : '/'} />
        </StrictMode>
    );
}

void renderPopup();
