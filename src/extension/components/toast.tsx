import { useEffect, useState } from 'react';

type Toast = { message: string; tone: 'success' | 'error' };

export function showToast(message: string, tone: Toast['tone']): void {
    window.dispatchEvent(new CustomEvent<Toast>('paranoid:toast', { detail: { message, tone } }));
}

export function ToastNotification() {
    const [toast, setToast] = useState<Toast | null>(null);

    useEffect(() => {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const listener = (event: Event) => {
            setToast((event as CustomEvent<Toast>).detail);
            if (timeout) clearTimeout(timeout);
            timeout = setTimeout(() => setToast(null), 4000);
        };
        window.addEventListener('paranoid:toast', listener);
        return () => {
            window.removeEventListener('paranoid:toast', listener);
            if (timeout) clearTimeout(timeout);
        };
    }, []);

    return (
        <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="pointer-events-none fixed right-4 bottom-4 left-4 z-[100]"
        >
            {toast && (
                <div
                    className={`rounded-[6px] border p-3 text-sm font-semibold shadow-lg ${
                        toast.tone === 'success'
                            ? 'border-[#68f58a] bg-[#142419] text-[#b9ffca]'
                            : 'border-[#ff8f8f] bg-[#2a1717] text-[#ffd0d0]'
                    }`}
                >
                    {toast.message}
                </div>
            )}
        </div>
    );
}
