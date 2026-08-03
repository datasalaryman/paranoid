import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ExtensionApp } from '@/extension/app';
import '@/extension/wallet.css';

createRoot(document.querySelector('#root')!).render(
    <StrictMode>
        <ExtensionApp initialPath="/" />
    </StrictMode>
);
