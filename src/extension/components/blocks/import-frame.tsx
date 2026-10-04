import type { ReactNode } from 'react';
import { WalletFrame } from '@/extension/components/blocks/wallet-frame';
import { errorClassName, warningClassName } from '@/extension/components/ui/styles';

export function ImportFrame({
    title,
    error,
    onBack,
    children,
}: {
    title: string;
    error: string;
    onBack: () => void;
    children: ReactNode;
}) {
    return (
        <WalletFrame eyebrow="PARANOID / ADD KEYPAIR">
            <button className="mb-4 cursor-pointer border-0 bg-transparent p-0 text-xs text-[#b7c8ba]" onClick={onBack}>
                &lt; Back
            </button>
            <h1 className="mt-0 mb-5 text-2xl leading-[1.15] font-bold">{title}</h1>
            {children}
            {error && <p className={errorClassName}>{error}</p>}
            <p className={warningClassName}>Never import a seed phrase or keypair that holds real assets.</p>
        </WalletFrame>
    );
}
