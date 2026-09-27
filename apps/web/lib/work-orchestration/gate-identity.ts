import { createHash } from 'node:crypto';
import { parseGateCommand } from './worktree';

export type GateKindV1 = 'test';

/** Identidade semântica versionada; comando bruto executa e o sanitizado só exibe. */
export function gateIdentityFromExecution(input: {
  readonly kind: GateKindV1;
  readonly program: string;
  readonly args: readonly string[];
}): string {
  const canonical = {
    schemaVersion: 1,
    kind: input.kind,
    program: input.program.toLowerCase().replace(/\.cmd$/, ''),
    // A policy já recusa absolutos/traversal/shell; barras não dependem do SO.
    args: input.args.map(arg => arg.replace(/\\/g, '/')),
  } as const;
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

/** Deriva a identidade do gate declarado ANTES de qualquer sanitização. */
export function gateIdentityFromCommand(command: string): string | null {
  const parsed = parseGateCommand(command);
  return parsed ? gateIdentityFromExecution({ kind: 'test', program: parsed.file, args: parsed.args }) : null;
}
