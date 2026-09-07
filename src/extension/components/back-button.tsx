import { useCanGoBack, useRouter } from '@tanstack/react-router';

type BackDestination = '/wallet' | '/saved-transactions' | '/transaction-history';

export function useBackNavigation(fallback: BackDestination) {
    const router = useRouter();
    const canGoBack = useCanGoBack();

    return () => {
        if (canGoBack) {
            router.history.back();
        } else {
            // A popup can start directly on a page with no previous history entry.
            void router.navigate({ to: fallback, replace: true });
        }
    };
}

export function BackButton({ fallback, disabled = false }: { fallback: BackDestination; disabled?: boolean }) {
    const goBack = useBackNavigation(fallback);

    return (
        <button
            type="button"
            disabled={disabled}
            onClick={goBack}
            className="mb-4 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[6px] border border-[#36433a] bg-[#202722] px-3 py-2 text-sm font-semibold text-[#e7f7e9] transition-colors hover:border-[#68f58a] hover:bg-[#29332c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#68f58a] active:bg-[#142419] disabled:cursor-wait disabled:opacity-45"
        >
            <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
                className="shrink-0 text-[#68f58a]"
            >
                <path d="m12 5-7 7 7 7M5 12h14" />
            </svg>
            Back
        </button>
    );
}
