import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
    srcDir: 'src',
    modules: ['@wxt-dev/module-react'],
    vite: () => ({
        plugins: [tailwindcss()],
    }),
    manifest: {
        name: 'Paranoid Wallet',
        description: 'Encrypted Solana development wallet with Wallet Standard support.',
        icons: {
            16: 'icons/icon-16.png',
            32: 'icons/icon-32.png',
            48: 'icons/icon-48.png',
            128: 'icons/icon-128.png',
        },
        action: {
            default_icon: {
                16: 'icons/icon-16.png',
                32: 'icons/icon-32.png',
                48: 'icons/icon-48.png',
                128: 'icons/icon-128.png',
            },
        },
        permissions: ['storage'],
        host_permissions: [
            'http://127.0.0.1:8899/*',
            'http://localhost:8899/*',
            'https://api.devnet.solana.com/*',
            'https://api.testnet.solana.com/*',
        ],
        optional_host_permissions: ['http://*/*', 'https://*/*'],
        web_accessible_resources: [
            {
                resources: ['inpage.js'],
                matches: ['http://*/*', 'https://*/*'],
            },
        ],
    },
});
