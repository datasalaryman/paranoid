import { injectScript } from 'wxt/utils/inject-script';
import { setupContent } from '@/extension/content';

export default defineContentScript({
    matches: ['http://*/*', 'https://*/*'],
    runAt: 'document_start',
    async main() {
        setupContent();
        await injectScript('/inpage.js');
    },
});
