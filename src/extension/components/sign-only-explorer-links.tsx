import { getSolanaExplorerAccountUrl } from '@/lib/solana';

export function SignOnlyExplorerLinks({ publicKey }: { publicKey: string }) {
    return (
        <div>
            <p className="my-[1em] text-[11px] tracking-[0.12em] text-[#68f58a] uppercase">View Account in Explorer</p>
            <div className="grid grid-cols-2 gap-2.5">
                {(['localnet', 'testnet', 'devnet', 'mainnet'] as const).map((cluster) => (
                    <a
                        key={cluster}
                        className="rounded-[6px] border border-[#36433a] bg-[#151a17] p-[14px] text-sm text-[#68f58a] capitalize hover:border-[#68f58a]"
                        href={getSolanaExplorerAccountUrl(
                            publicKey,
                            `solana:${cluster}`,
                            cluster === 'localnet' ? 'http://127.0.0.1:8899' : undefined
                        )}
                        target="_blank"
                        rel="noreferrer"
                    >
                        {cluster}
                    </a>
                ))}
            </div>
        </div>
    );
}
