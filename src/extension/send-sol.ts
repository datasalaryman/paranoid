import { PublicKey } from '@solana/web3.js';

export function validateSolRecipient(value: unknown): PublicKey {
    if (typeof value !== 'string') throw new Error('Enter a valid Solana address.');
    let address: PublicKey;
    try {
        const text = value.trim();
        address = new PublicKey(text);
        if (address.toBase58() !== text) throw new Error('Invalid address');
    } catch {
        throw new Error('Enter a valid Solana address.');
    }
    if (!PublicKey.isOnCurve(address.toBytes())) throw new Error('The Solana address must be on curve.');
    return address;
}

export function parseSolAmount(value: unknown): bigint {
    if (typeof value !== 'string' || !/^(?:\d+|\d*\.\d+)$/.test(value.trim())) {
        throw new Error('Enter a numeric SOL amount (no exponent notation).');
    }
    const [whole, fraction = ''] = value.trim().split('.');
    if (fraction.length > 9) throw new Error('SOL amounts can have at most 9 decimal places.');
    const lamports = BigInt(whole || '0') * 1_000_000_000n + BigInt(fraction.padEnd(9, '0'));
    if (lamports === 0n) throw new Error('The amount must be greater than zero.');
    if (lamports > 18_446_744_073_709_551_615n) throw new Error('The SOL amount is too large.');
    return lamports;
}
