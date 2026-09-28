// Allowlist de comandos de GATE (`validation_criteria[].command`) — fonte ÚNICA.
//
// Antes vivia só no executor de worktree (`apps/web/.../worktree.ts`), que recusa
// na ENTRADA da attempt um comando fora da lista. Mandated Envelope Hardening V0:
// o Envelope V1 de auto-aprovação passa a aplicar o MESMO predicado na fronteira
// de aprovação — o planner não consegue transformar um gate em execução de
// comando arbitrário dentro de um mandato.
//
// Só `npm test` e `npm run typecheck|test|build|lint`, opcionalmente escopados por
// `--workspace=` ou com passthrough `-- args` restrito. Charset dos passthrough
// sem metacaracteres de encadeamento, redirecionamento ou expansão
// (`& | ; > < $ * ? ( )`): nem com shell há como injetar um segundo comando.
// Puro.

export const GATE_COMMAND_POLICY_VERSION = 'gate-command-allowlist-v1' as const;

export const GATE_COMMAND_PATTERN =
  /^npm(?:\.cmd)? (?:run (?:typecheck|test|build|lint)|test)(?: --workspace=[@a-z0-9._/-]+)?(?: -- [\w./@:=-]+(?: [\w./@:=-]+)*)?$/i;

export function isAllowedGateCommand(command: unknown): command is string {
  return typeof command === 'string' && GATE_COMMAND_PATTERN.test(command.trim());
}
