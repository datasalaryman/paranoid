import type { ProviderRequest, ProviderResponse } from './messages.js';

const script = document.createElement('script');
script.src = chrome.runtime.getURL('inpage.js');
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);

window.addEventListener('message', async (event: MessageEvent<ProviderRequest>) => {
    if (event.source !== window || event.data?.channel !== 'paranoid:page') return;

    let response: ProviderResponse;
    try {
        const result = await chrome.runtime.sendMessage({ type: 'provider-request', request: event.data });
        if (result?.__error) throw new Error(result.__error);
        response = { channel: 'paranoid:extension', id: event.data.id, result };
    } catch (error) {
        response = {
            channel: 'paranoid:extension',
            id: event.data.id,
            error: error instanceof Error ? error.message : String(error),
        };
    }
    window.postMessage(response, '*');
});
