export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export async function sendMessage<T>(message: Record<string, unknown>): Promise<T> {
    const response = (await chrome.runtime.sendMessage(message)) as T | { __error: string };
    if (response && typeof response === 'object' && '__error' in response) throw new Error(response.__error);
    return response;
}
