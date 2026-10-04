import type { ReactNode } from 'react';
import { labelClassName } from '@/extension/components/ui/styles';

export function WalletFrame({
    eyebrow,
    children,
    welcome = false,
    topNav,
    bottomNav,
}: {
    eyebrow: string;
    children: ReactNode;
    welcome?: boolean;
    topNav?: ReactNode;
    bottomNav?: ReactNode;
}) {
    if (topNav || bottomNav) {
        return (
            <main className="flex min-h-screen flex-col">
                {topNav}
                <div className="flex-1 p-7">
                    <p className={labelClassName}>{eyebrow}</p>
                    {children}
                </div>
                {bottomNav}
            </main>
        );
    }

    return (
        <main className={welcome ? 'flex min-h-[460px] flex-col justify-between p-7' : 'p-7'}>
            <p className={`${labelClassName} ${welcome ? 'mb-auto' : ''}`}>{eyebrow}</p>
            {children}
        </main>
    );
}
