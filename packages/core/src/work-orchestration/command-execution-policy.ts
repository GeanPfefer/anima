// ============================================================
// CommandExecutionPolicy — EXEC é uma autoridade DISTINTA de READ e WRITE
// (Coding Harness V3, 3ª fatia: SHELL/TEST/GIT governados).
//
// O modelo NUNCA recebe shell do host. Ele pede uma ação ESTRUTURADA
// ({program, args, timeoutMs}); o HOST valida contra esta política (pura,
// host-side, model-agnostic), confina o cwd à worktree, executa SEM shell
// arbitrário, captura stdout/stderr/exit code, limita volume e devolve a
// observação. Governança nas FRONTEIRAS — nunca se confia no modelo.
//
// Três autoridades conceituais SEPARADAS (nenhuma implica a outra):
//   • READ authority  — ler/buscar (WorkspaceAccessPolicy.readScope).
//   • WRITE authority — editar (WorkspaceAccessPolicy.writeScope).
//   • EXEC authority  — rodar comandos permitidos (esta política).
// Poder ler não concede escrever; poder escrever não concede executar; poder
// rodar testes não concede rede nem comandos destrutivos.
//
// Honestidade de enforcement (o que é FORTE vs POLICY-LEVEL):
//   FORTE (determinístico):
//     - allowlist de programas; um programa fora da lista é recusado;
//     - git é READ-ONLY por allowlist de subcomando (status/diff/log/show) — commit/
//       reset/push/fetch/pull/merge/rebase/checkout/clean/add/tag/branch recusados;
//     - npm/pnpm só `run`/`test` — install/ci/publish/exec recusados (sem package install);
//     - args sem metacaracteres de shell (sem `&`/`|`/`;`/pipe/redirect/expansão) e sem `..`
//       ⇒ mesmo com shell:true na borda (npm.cmd no Windows) não há como encadear/injetar;
//     - cwd confinado à worktree (safeJoin na borda).
//   POLICY-LEVEL / BEST-EFFORT (NÃO é sandbox de kernel):
//     - `network: 'denied'` bloqueia os VETORES óbvios (curl/wget fora da allowlist,
//       git fetch/pull/push por subcomando, npm install). Mas um `npm test` cujo CÓDIGO
//       de teste faça uma chamada de rede NÃO é impedido por um sandbox — é o mesmo risco
//       que o HOST já aceita ao rodar gates na worktree. Documentado, não prometido forte.
//
// Módulo PURO (sem I/O). A execução real fica em `GitWorktree.runCommand`.
// ============================================================

import type { AgenticRuntimeMode } from './agentic-runtime-policy';

export type CommandNetworkPolicy = 'denied' | 'allowed';

export interface CommandExecutionPolicyV1 {
  readonly schemaVersion: 1;
  readonly mode: AgenticRuntimeMode;
  /** Default 'denied'. Enforcement policy-level (ver cabeçalho), não sandbox de kernel. */
  readonly network: CommandNetworkPolicy;
  /** Programas permitidos (minúsculos). Um programa fora daqui é recusado. */
  readonly allowedPrograms: readonly string[];
  readonly defaultTimeoutMs: number;
  readonly maxTimeoutMs: number;
  /** Cap de VOLUME por stream servido ao modelo (compactação, não terminal). */
  readonly maxOutputChars: number;
}

export interface CommandExecutionRequest {
  readonly program: string;
  readonly args: readonly string[];
  readonly timeoutMs?: number;
}

export type CommandCategory = 'dev' | 'git-read';

export type CommandExecutionDecision =
  | { readonly ok: true; readonly program: string; readonly args: readonly string[]; readonly timeoutMs: number; readonly category: CommandCategory }
  | { readonly ok: false; readonly reason: string };

/** Subcomandos git READ-ONLY permitidos ao coder. A branch/worktree pertence ao
 * executor/Governor — o coder VÊ seu trabalho, não controla a história. */
export const READONLY_GIT_SUBCOMMANDS: readonly string[] = ['status', 'diff', 'log', 'show'];
/** Subcomandos npm/pnpm permitidos: sem install/ci/publish/exec (sem package install/rede). */
const NPM_ALLOWED_SUBCOMMANDS = new Set(['run', 'test']);
/** Flags git que ESCREVEM arquivo (redirection embutida) — recusadas mesmo em subcomando read-only. */
const GIT_OUTPUT_FLAGS = /^(?:--output(?:=|$)|-o$)/;

/** Charset seguro de argumento: palavra + `. / @ : = + -`. Sem espaço nem
 * metacaractere de shell. Espelha o passthrough já usado no GATE_PATTERN. */
const SAFE_ARG = /^[\w./@:=+-]+$/;
const MAX_ARG_LEN = 200;
const MAX_ARGS = 32;

const clampInt = (raw: unknown, min: number, max: number, fallback: number): number => {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(Math.floor(raw), max));
};

/** Perfil de comandos do self-dev SUPERVISIONADO: dev toolchain + git read-only. */
export const SUPERVISED_COMMAND_EXECUTION_POLICY_V1: CommandExecutionPolicyV1 = {
  schemaVersion: 1,
  mode: 'supervised',
  network: 'denied',
  allowedPrograms: ['npm', 'pnpm', 'npx', 'node', 'tsc', 'jest', 'vitest', 'git'],
  defaultTimeoutMs: 120_000,
  maxTimeoutMs: 300_000,
  maxOutputChars: 8_000,
};

/** Perfil AUTÔNOMO: mais conservador (menos programas, timeouts menores). */
export const AUTONOMOUS_COMMAND_EXECUTION_POLICY_V1: CommandExecutionPolicyV1 = {
  schemaVersion: 1,
  mode: 'autonomous',
  network: 'denied',
  allowedPrograms: ['npm', 'node', 'tsc', 'jest', 'git'],
  defaultTimeoutMs: 60_000,
  maxTimeoutMs: 120_000,
  maxOutputChars: 8_000,
};

export function resolveCommandExecutionPolicy(mode: AgenticRuntimeMode): CommandExecutionPolicyV1 {
  return mode === 'autonomous'
    ? AUTONOMOUS_COMMAND_EXECUTION_POLICY_V1
    : SUPERVISED_COMMAND_EXECUTION_POLICY_V1;
}

/**
 * Valida um pedido de execução contra a política, fail-closed. Devolve o comando
 * normalizado a rodar (program + args + timeout clampado + categoria) ou uma recusa
 * com motivo legível (que o laço devolve ao modelo como observação recuperável).
 * NÃO executa nada.
 */
export function resolveCommandExecution(
  request: CommandExecutionRequest,
  policy: CommandExecutionPolicyV1,
): CommandExecutionDecision {
  const program = typeof request.program === 'string' ? request.program.trim().toLowerCase() : '';
  if (!program) return { ok: false, reason: 'programa ausente.' };
  if (!policy.allowedPrograms.includes(program)) {
    return { ok: false, reason: `programa não permitido: "${program}". Permitidos: ${policy.allowedPrograms.join(', ')}.` };
  }
  const rawArgs = Array.isArray(request.args) ? request.args : [];
  if (rawArgs.length > MAX_ARGS) return { ok: false, reason: `no máximo ${MAX_ARGS} argumentos.` };
  const args: string[] = [];
  for (const raw of rawArgs) {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_ARG_LEN) {
      return { ok: false, reason: 'argumento vazio ou grande demais.' };
    }
    if (!SAFE_ARG.test(raw)) {
      return { ok: false, reason: `argumento com caractere não permitido (sem metacaractere de shell): ${raw.slice(0, 40)}` };
    }
    if (raw.includes('..')) return { ok: false, reason: `argumento com ".." recusado (sem traversal): ${raw.slice(0, 40)}` };
    args.push(raw);
  }

  let category: CommandCategory = 'dev';
  if (program === 'git') {
    category = 'git-read';
    const sub = args[0];
    if (!sub || !READONLY_GIT_SUBCOMMANDS.includes(sub)) {
      return { ok: false, reason: `git só é permitido em leitura: ${READONLY_GIT_SUBCOMMANDS.join('/')} (commit/reset/push/fetch/pull/merge/rebase/checkout/clean/add/tag/branch são recusados).` };
    }
    if (args.some(a => GIT_OUTPUT_FLAGS.test(a))) {
      return { ok: false, reason: 'flags de saída de arquivo (--output/-o) são recusadas no git.' };
    }
  } else if (program === 'npm' || program === 'pnpm') {
    const sub = args[0];
    if (!sub || !NPM_ALLOWED_SUBCOMMANDS.has(sub)) {
      return { ok: false, reason: `${program} só permite "run"/"test" (install/ci/publish/exec são recusados — sem package install nem rede).` };
    }
  }
  // node/tsc/jest/vitest/npx: sem subcomando restrito além do charset seguro. A rede
  // continua policy-level (ver cabeçalho). npx roda a partir do node_modules local
  // (o executor injeta node_modules/.bin no PATH); busca no registry não é sandbox-bloqueada.

  const timeoutMs = clampInt(request.timeoutMs, 1_000, policy.maxTimeoutMs, policy.defaultTimeoutMs);
  return { ok: true, program, args, timeoutMs, category };
}
