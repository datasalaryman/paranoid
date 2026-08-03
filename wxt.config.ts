import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
    srcDir: 'src',
    modules: ['@wxt-dev/module-react'],
    vite: () => ({
        plugins: [tailwindcss()],
    }),
    manifest: {
        name: 'Paranoid Devnet Wallet',
        description: 'Disposable Solana devnet wallet for local Wallet Standard testing.',
        permissions: ['storage'],
        host_permissions: ['https://api.devnet.solana.com/*'],
        web_accessible_resources: [
            {
                resources: ['inpage.js'],
                matches: ['http://*/*', 'https://*/*'],
            },
        ],
    },
});
