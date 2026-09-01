import { describe, expect, test } from 'bun:test';
import { knownProgramDetails } from './instruction-tree';

describe('knownProgramDetails', () => {
    test('uses the System Program IDL discriminator', () => {
        expect(
            knownProgramDetails({
                programId: '11111111111111111111111111111111',
                data: [2, 0, 0, 0],
            })
        ).toEqual({ program: 'System Program', instruction: 'Transfer' });
    });

    test('uses the Token Program IDL discriminator', () => {
        expect(
            knownProgramDetails({
                programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                data: [7],
            })
        ).toEqual({ program: 'Token Program', instruction: 'MintTo' });
    });

    test('does not label unknown programs', () => {
        expect(knownProgramDetails({ programId: 'unknown', data: [1] })).toBeUndefined();
    });
});
