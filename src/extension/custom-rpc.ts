export const customRpcOrigins = ['http://*/*', 'https://*/*'];

export function normalizeRpcUrl(value: string): string {
    let url: URL;
    try {
        url = new URL(value.trim());
    } catch {
        throw new Error('Enter a valid RPC URL');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('RPC URL must use http or https');
    return url.toString();
}

export async function requestCustomRpcAccess(): Promise<void> {
    const granted = await chrome.permissions.request({ origins: customRpcOrigins });
    if (!granted) throw new Error('Allow access to custom RPC URLs to continue');
}
