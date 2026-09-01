import { useId, useState } from 'react';
import type { InstructionTreeNode } from '@/extension/messages';

const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

// Instruction discriminators from the System and SPL Token program IDLs.
const SYSTEM_INSTRUCTIONS = [
    'CreateAccount',
    'Assign',
    'Transfer',
    'CreateAccountWithSeed',
    'AdvanceNonceAccount',
    'WithdrawNonceAccount',
    'InitializeNonceAccount',
    'AuthorizeNonceAccount',
    'Allocate',
    'AllocateWithSeed',
    'AssignWithSeed',
    'TransferWithSeed',
    'UpgradeNonceAccount',
] as const;

const TOKEN_INSTRUCTIONS = [
    'InitializeMint',
    'InitializeAccount',
    'InitializeMultisig',
    'Transfer',
    'Approve',
    'Revoke',
    'SetAuthority',
    'MintTo',
    'Burn',
    'CloseAccount',
    'FreezeAccount',
    'ThawAccount',
    'TransferChecked',
    'ApproveChecked',
    'MintToChecked',
    'BurnChecked',
    'InitializeAccount2',
    'SyncNative',
    'InitializeAccount3',
    'InitializeMultisig2',
    'InitializeMint2',
    'GetAccountDataSize',
    'InitializeImmutableOwner',
    'AmountToUiAmount',
    'UiAmountToAmount',
] as const;

export function InstructionTree({ instructions }: { instructions: readonly InstructionTreeNode[] }) {
    return (
        <section className="my-[1em]">
            <h2 className="my-[1em] text-[11px] tracking-[0.12em] text-[#68f58a] uppercase">Instructions</h2>
            <div className="overflow-auto rounded-[6px] border border-[#29332c] bg-[#151a17] p-[14px]">
                {instructions.length > 0 ? (
                    <ul
                        className="min-w-max font-mono text-sm text-[#b7c8ba]"
                        aria-label="Transaction instruction tree"
                    >
                        {instructions.map((instruction, index) => (
                            <InstructionNode
                                instruction={instruction}
                                key={`${index}:${instruction.programId}`}
                                prefix=""
                                last={index === instructions.length - 1}
                            />
                        ))}
                    </ul>
                ) : (
                    <p className="text-[#b7c8ba]">No instructions</p>
                )}
            </div>
        </section>
    );
}

function InstructionNode({
    instruction,
    prefix,
    last,
}: {
    instruction: InstructionTreeNode;
    prefix: string;
    last: boolean;
}) {
    const [expanded, setExpanded] = useState(true);
    const childrenId = useId();
    const hasChildren = instruction.innerInstructions.length > 0;
    const childPrefix = `${prefix}${last ? '    ' : '│   '}`;
    const row = (
        <>
            <span className="text-[#526157]">{`${prefix}${last ? '└── ' : '├── '}`}</span>
            {hasChildren && (
                <span className="mr-1 inline-block w-3 text-center text-[#829486]" aria-hidden="true">
                    {expanded ? '▾' : '▸'}
                </span>
            )}
            <InstructionLabel instruction={instruction} />
        </>
    );

    return (
        <li>
            {hasChildren ? (
                <button
                    type="button"
                    className="cursor-pointer leading-6 whitespace-pre hover:text-[#e7f7e9] focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#68f58a]"
                    aria-expanded={expanded}
                    aria-controls={childrenId}
                    onClick={() => setExpanded((value) => !value)}
                >
                    {row}
                </button>
            ) : (
                <div className="leading-6 whitespace-pre">{row}</div>
            )}
            {hasChildren && expanded && (
                <ul id={childrenId}>
                    {instruction.innerInstructions.map((innerInstruction, index) => (
                        <InstructionNode
                            instruction={innerInstruction}
                            key={`${index}:${innerInstruction.programId}`}
                            prefix={childPrefix}
                            last={index === instruction.innerInstructions.length - 1}
                        />
                    ))}
                </ul>
            )}
        </li>
    );
}

function InstructionLabel({ instruction }: { instruction: InstructionTreeNode }) {
    const knownProgram = knownProgramDetails(instruction);
    if (knownProgram) {
        return (
            <>
                <span className="text-[#e7f7e9]">{knownProgram.program}: </span>
                <span className="text-[#68f58a]">{knownProgram.instruction}</span>
            </>
        );
    }

    return (
        <span title={instruction.programId}>
            <span className="text-[#e7f7e9]">{truncateAddress(instruction.programId)}: </span>
            <span className="text-[#d5a6ff]">({instruction.data[0] ?? '?'})</span>
        </span>
    );
}

export function knownProgramDetails(
    instruction: Pick<InstructionTreeNode, 'programId' | 'data' | 'instructionName'>
): { program: string; instruction: string } | undefined {
    if (instruction.programId === SYSTEM_PROGRAM_ID) {
        const discriminator =
            instruction.data.length >= 4
                ? instruction.data[0]! |
                  (instruction.data[1]! << 8) |
                  (instruction.data[2]! << 16) |
                  (instruction.data[3]! << 24)
                : -1;
        return {
            program: 'System Program',
            instruction: instruction.instructionName ?? SYSTEM_INSTRUCTIONS[discriminator] ?? 'Unknown',
        };
    }
    if (instruction.programId === TOKEN_PROGRAM_ID) {
        return {
            program: 'Token Program',
            instruction: instruction.instructionName ?? TOKEN_INSTRUCTIONS[instruction.data[0] ?? -1] ?? 'Unknown',
        };
    }
}

function truncateAddress(address: string): string {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
}
