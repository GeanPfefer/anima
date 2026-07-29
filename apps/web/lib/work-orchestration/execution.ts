import { isAbsolute } from 'node:path';
import {
  validateWorkExecutorTranscript,
  type AutonomousExecutionSpecV1,
  type WorkContextReference,
  type WorkExecutorAdapter,
  type WorkExecutorRequest,
  type WorkExecutorSignal,
  type WorkRoutingCandidateV1,
  type WorkItem,
  type CreateWorkProposalCommand,
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

export const UX02_DETERMINISTIC_PROOF_PHRASE =
  'Anima, prepare a prova determinística do UX-02 para eu revisar antes de executar.';

/**
 * Ponte local de ratificação. A especificação só é acrescentada quando as duas
 * condições explícitas coincidem: flag de prova e frase exata. Qualquer variação
 * preserva o comando normal do chat, sem alvo ou permissão inventados.
 */
export const configureUx02DeterministicProof = (
  message: string,
  command: CreateWorkProposalCommand,
): CreateWorkProposalCommand => process.env.ANIMA_UX02_DETERMINISTIC_PROOF === '1'
  && message.trim() === UX02_DETERMINISTIC_PROOF_PHRASE
  ? {
      ...command,
      capability: 'programming',
      intent: {
        ...command.intent,
        execution_spec: {
          schema_version: 1,
          target: { kind: 'project', reference: 'ux02-deterministic-decision' },
          permissions: ['workspace_read', 'workspace_write_isolated'],
          validation_criteria: [{ label: 'Retomar somente do checkpoint persistido' }],
          limits: { max_attempts: 3, max_duration_minutes: 5 },
        },
      },
    }
  : command;

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

/**
 * Adaptador local a partir do ambiente, ou `null` quando o nó não está configurado.
 *
 * `emitCheckpoints` é opt-in do chamador: só o laço supervisionado o liga, para
 * persistir checkpoints mid-flight. O caminho comandado (INT-04) não passa a
 * flag e segue single-shot, preservando a fronteira ratificada em 2B.1.
 */
export const localRunnerFromEnvironment = (options: { readonly emitCheckpoints?: boolean } = {}): LocalRunnerAdapter | null => {
  const runnerRoot = process.env.ANIMA_LOCAL_RUNNER_ROOT;
  const targets = targetsFromEnvironment();
  if (!runnerRoot || !isAbsolute(runnerRoot) || !targets) return null;
  return new LocalRunnerAdapter({
    runnerRoot, model: process.env.ANIMA_LOCAL_RUNNER_MODEL,
    targets: { resolve: reference => targets[reference] ?? null },
    emitCheckpoints: options.emitCheckpoints ?? false,
    deterministicDecisionProof: process.env.ANIMA_UX02_DETERMINISTIC_PROOF === '1',
  });
};

export interface ConfiguredWorkRoute {
  readonly candidate: WorkRoutingCandidateV1;
  readonly adapter: WorkExecutorAdapter;
}

/**
 * Catálogo real inicial do INTEL-02. A política pura não conhece estes nomes:
 * o nó local declara uma rota e suas capacidades, ou não oferece candidato.
 */
export const localRunnerRouteFromEnvironment = (
  options: { readonly emitCheckpoints?: boolean } = {},
): ConfiguredWorkRoute | null => {
  const adapter = localRunnerFromEnvironment(options);
  if (!adapter) return null;
  const configuredEffort = process.env.ANIMA_LOCAL_RUNNER_EFFORT;
  const effort = configuredEffort === 'light' || configuredEffort === 'strong'
    ? configuredEffort
    : 'standard';
  return {
    adapter,
    candidate: {
      schemaVersion: 1,
      routeId: 'local-runner-v1:configured',
      executorId: adapter.id,
      providerRef: 'local-node',
      modelRef: process.env.ANIMA_LOCAL_RUNNER_MODEL ?? 'runner-default',
      effort,
      capabilities: ['programming'],
      availability: 'available',
      latency: 'normal',
      priority: 100,
    },
  };
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
  | {
      readonly ok: false;
      readonly defect: string;
      // 'control' = pausa/cancelamento cooperativo aplicado num checkpoint (UX-01).
      readonly cause: 'transcript' | 'checkpoint' | 'budget' | 'control';
      readonly reason?: string;
      readonly claimReleased?: boolean;
    };

/**
 * Porta de persistência de checkpoints mid-flight. O laço injeta a implementação
 * real (uma RPC); o consumidor genérico não conhece o transporte nem o Supabase.
 */
export interface CheckpointSink {
  /** Persiste um checkpoint recebido, ANTES de consumir o próximo sinal. */
  persistCheckpoint(signal: WorkExecutorSignal): Promise<
    | { readonly ok: true }
    | {
        readonly ok: false;
        readonly message: string;
        readonly cause?: 'checkpoint' | 'budget' | 'control';
        readonly reason?: string;
        readonly claimReleased?: boolean;
      }
  >;
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
      if (!persisted.ok) return {
        ok: false,
        defect: persisted.message,
        cause: persisted.cause ?? 'checkpoint',
        ...(persisted.reason ? { reason: persisted.reason } : {}),
        ...(persisted.claimReleased === undefined ? {} : { claimReleased: persisted.claimReleased }),
      };
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

export const recordWorkDecisionRequired = (
  client: SupabaseClient<Database>,
  input: { readonly workItemId: string; readonly expectedProposalVersion: number; readonly attemptId: string; readonly signal: WorkExecutorSignal },
) => client.rpc('record_work_decision_required', {
  p_work_item_id: input.workItemId,
  p_expected_proposal_version: input.expectedProposalVersion,
  p_attempt_id: input.attemptId,
  p_signal: input.signal as unknown as Json,
});
