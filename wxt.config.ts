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
        description: 'Encrypted Solana wallet for local Wallet Standard testing.',
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
