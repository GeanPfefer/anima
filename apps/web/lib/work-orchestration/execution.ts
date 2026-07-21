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
}

/**
 * Entrada delimitada do executor (INT-01). O escopo vem da proposta aprovada e
 * os limites do `execution_spec` já validado — nunca de sessão ou memória.
 */
export const buildExecutorRequest = ({ item, spec, attemptId, contextReferences }: ExecutorRequestInput): WorkExecutorRequest => ({
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
});

export type ExecutorRun =
  | { readonly ok: true; readonly terminal: WorkExecutorSignal }
  // Transcrição inválida: o executor falou, mas fora do contrato. Não existe
  // terminal confiável para gravar — inventar um seria afirmar o não observado.
  | { readonly ok: false; readonly defect: string };

/** Consome a transcrição inteira do executor e valida o contrato fechado do INT-01. */
export const runExecutorOnce = async (
  adapter: WorkExecutorAdapter,
  request: WorkExecutorRequest,
  signal: AbortSignal,
): Promise<ExecutorRun> => {
  const signals: WorkExecutorSignal[] = [];
  for await (const value of adapter.execute(request, signal)) signals.push(value);
  const defect = validateWorkExecutorTranscript(signals);
  if (defect) return { ok: false, defect };
  return { ok: true, terminal: signals.at(-1)! };
};

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
