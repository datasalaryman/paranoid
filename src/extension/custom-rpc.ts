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

export function customRpcOrigin(value: string): string {
    return `${new URL(normalizeRpcUrl(value)).origin}/*`;
}

export async function requestCustomRpcAccess(value: string): Promise<void> {
    const granted = await chrome.permissions.request({ origins: [customRpcOrigin(value)] });
    if (!granted) throw new Error('Allow access to this custom RPC URL to continue');
}

export async function withCustomRpcAccess<T>(value: string, request: () => Promise<T>): Promise<T> {
    const origin = customRpcOrigin(value);
    if (await chrome.permissions.contains({ origins: [origin] })) return request();

    try {
        return await request();
    } catch (error) {
        if (!isNetworkAccessError(error)) throw error;
        await requestCustomRpcAccess(value);
        return request();
    }
}

function isNetworkAccessError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /failed to fetch|networkerror|load failed/i.test(message);
}
