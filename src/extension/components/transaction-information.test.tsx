import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { TransactionInformation } from './transaction-information';

test('shows simulation errors before saved balance changes without hiding transaction details', () => {
    const markup = renderToStaticMarkup(
        <TransactionInformation
            title="Queued transfer"
            origin="https://example.com"
            simulationError={'Simulation failed: {"InstructionError":[7,{"Custom":6010}]}'}
            balanceChanges={[{ address: '11111111111111111111111111111111', lamports: -1_000_000_000 }]}
            instructionTree={[{ programId: '11111111111111111111111111111111', data: [], innerInstructions: [] }]}
            transactionMessage="dGVzdA=="
        />
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('border-[#ff8f8f]');
    expect(markup).toContain('Simulation failed:');
    expect(markup.indexOf('Simulation failed:')).toBeLessThan(markup.indexOf('Account SOL changes'));
    expect(markup).toContain('previously saved details');
    expect(markup).toContain('Queued transfer');
    expect(markup).toContain('https://example.com');
    expect(markup).toContain('-1 SOL');
    expect(markup).toContain('11111111111111111111111111111111');
    expect(markup).toContain('Base64 message');
});

test('does not show a simulation error box for successful details', () => {
    const markup = renderToStaticMarkup(<TransactionInformation title="Queued transfer" balanceChanges={[]} />);

    expect(markup).not.toContain('role="alert"');
    expect(markup).toContain('No SOL balance changes');
});
