import { isAbsolute } from 'node:path';
import {
  validateWorkExecutorTranscript,
  type AutonomousExecutionSpecV1,
  type WorkContextReference,
  type WorkExecutorAdapter,
  type WorkExecutorRequest,
  type WorkExecutorSignal,
  type WorkItem,
} from '@anima/core';
import type { Database, Json } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LocalRunnerAdapter } from './local-runner';

// Preparação, execução e terminal compartilhados pelos dois caminhos que hoje
// chegam a um executor real: a execução comandada do INT-04 e a volta do
// Supervisor V0. O corpo é único de propósito — duas cópias que precisassem
// concordar são como assimetrias nascem (lição registrada no SUP-05).

const object = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;

export const targetsFromEnvironment = (): Readonly<Record<string, string>> | null => {
  try {
    const parsed = object(JSON.parse(process.env.ANIMA_LOCAL_TARGETS_JSON ?? 'null') as unknown);
    if (!parsed) return null;
    const targets: Record<string, string> = {};
    for (const [reference, path] of Object.entries(parsed)) {
      if (!reference.trim() || typeof path !== 'string' || !isAbsolute(path)) return null;
      targets[reference] = path;
    }
    return targets;
  } catch { return null; }
};

/** Adaptador local a partir do ambiente, ou `null` quando o nó não está configurado. */
export const localRunnerFromEnvironment = (): LocalRunnerAdapter | null => {
  const runnerRoot = process.env.ANIMA_LOCAL_RUNNER_ROOT;
  const targets = targetsFromEnvironment();
  if (!runnerRoot || !isAbsolute(runnerRoot) || !targets) return null;
  return new LocalRunnerAdapter({
    runnerRoot, model: process.env.ANIMA_LOCAL_RUNNER_MODEL,
    targets: { resolve: reference => targets[reference] ?? null },
  });
};

export interface ExecutorRequestInput {
  readonly item: WorkItem;
  readonly spec: AutonomousExecutionSpecV1;
  readonly attemptId: string;
  readonly contextReferences: readonly WorkContextReference[];
  readonly carriedContext?: WorkExecutorRequest['carriedContext'];
}

/**
 * Entrada delimitada do executor (INT-01). O escopo vem da proposta aprovada e
 * os limites do `execution_spec` já validado — nunca de sessão ou memória.
 */
export const buildExecutorRequest = ({ item, spec, attemptId, contextReferences, carriedContext }: ExecutorRequestInput): WorkExecutorRequest => ({
  attemptId,
  workItemId: item.id,
  approvedProposalVersion: item.proposalVersion,
  capability: item.capability,
  objective: item.proposal.data.objective,
  includedScope: item.proposal.data.includedScope,
  excludedScope: item.proposal.data.excludedScope,
  target: spec.target,
  permissions: spec.permissions,
  validationCriteria: spec.validationCriteria,
  limits: spec.limits,
  contextReferences,
  ...(carriedContext ? { carriedContext } : {}),
});

export type ExecutorRun =
  | { readonly ok: true; readonly terminal: WorkExecutorSignal }
  // Falha antes de um terminal confiável. `cause` distingue transcrição inválida
  // (fora do contrato do INT-01) de falha ao persistir um checkpoint mid-flight.
  // Em ambos não existe terminal confiável — inventar um seria afirmar o não
  // observado —, então a tentativa fica aberta para o SUP-04.
  | { readonly ok: false; readonly defect: string; readonly cause: 'transcript' | 'checkpoint' };

/**
 * Porta de persistência de checkpoints mid-flight. O laço injeta a implementação
 * real (uma RPC); o consumidor genérico não conhece o transporte nem o Supabase.
 */
export interface CheckpointSink {
  /** Persiste um checkpoint recebido, ANTES de consumir o próximo sinal. */
  persistCheckpoint(signal: WorkExecutorSignal): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
  /** progress não é persistido nesta etapa; só observabilidade opcional. */
  observeProgress?(signal: WorkExecutorSignal): void;
}

/**
 * Consome a transcrição do executor INCREMENTALMENTE e persiste cada checkpoint
 * assim que chega, antes do próximo sinal — para que uma tentativa cujo processo
 * morra antes do terminal preserve todos os checkpoints já confirmados.
 *
 * - `progress`: não-terminal, não persistido (só observado);
 * - `checkpoint`: persistido imediatamente; falha na persistência interrompe o
 *   consumo e devolve `cause: 'checkpoint'`, sem processar terminal e sem
 *   inventar desfecho;
 * - terminal único: nada é aceito depois dele; a transcrição inteira é validada
 *   pelo contrato fechado do INT-01 (sequência, correlação, terminal único).
 */
export const runExecutorStreamed = async (
  adapter: WorkExecutorAdapter,
  request: WorkExecutorRequest,
  signal: AbortSignal,
  sink: CheckpointSink,
): Promise<ExecutorRun> => {
  const signals: WorkExecutorSignal[] = [];
  let terminalSeen = false;
  for await (const value of adapter.execute(request, signal)) {
    signals.push(value);
    // Depois de um terminal, apenas acumula: o validador rejeita qualquer sinal
    // que o suceda, e nenhum checkpoint tardio é persistido.
    if (terminalSeen) continue;
    if (value.kind === 'checkpoint') {
      const persisted = await sink.persistCheckpoint(value);
      if (!persisted.ok) return { ok: false, defect: persisted.message, cause: 'checkpoint' };
      continue;
    }
    if (value.kind === 'progress') { sink.observeProgress?.(value); continue; }
    terminalSeen = true;
  }
  const defect = validateWorkExecutorTranscript(signals);
  if (defect) return { ok: false, defect, cause: 'transcript' };
  return { ok: true, terminal: signals.at(-1)! };
};

// Caminho comandado (INT-04): single-shot, sem persistir checkpoints mid-flight.
// Rejeita fail-closed qualquer checkpoint que apareça — o LocalRunnerAdapter
// emite zero, então na prática o consumo é idêntico ao anterior.
const rejectCheckpoints: CheckpointSink = {
  persistCheckpoint: async () => ({ ok: false, message: 'Checkpoints mid-flight não são persistidos no caminho comandado.' }),
};

/** Consome a transcrição inteira do executor e valida o contrato fechado do INT-01. */
export const runExecutorOnce = (
  adapter: WorkExecutorAdapter,
  request: WorkExecutorRequest,
  signal: AbortSignal,
): Promise<ExecutorRun> => runExecutorStreamed(adapter, request, signal, rejectCheckpoints);

/**
 * Fronteira ratificada de término da tentativa.
 *
 * A RPC valida por correlação do `execution_started` — que
 * `private.begin_work_attempt` emite tanto no início comandado quanto no
 * supervisionado — e não por origem. Por isso ela serve aos dois caminhos, e
 * ambos herdam a mesma guarda do SUP-04 contra sinal tardio de tentativa
 * abandonada. O nome nasceu estreito; o contrato nunca foi.
 */
export const recordExecutionTerminal = (
  client: SupabaseClient<Database>,
  input: { readonly workItemId: string; readonly expectedProposalVersion: number; readonly attemptId: string; readonly terminal: WorkExecutorSignal },
) => client.rpc('record_commanded_work_terminal', {
  work_item_id: input.workItemId,
  expected_proposal_version: input.expectedProposalVersion,
  attempt_id: input.attemptId,
  signal: input.terminal as unknown as Json,
});
