import {
  buildHostObservedExecutionContext,
  EXECUTION_ACTOR_KINDS,
  EXECUTION_MODES,
  EXECUTION_RUNNER_KINDS,
  type ExecutionActorKind,
  type ExecutionMode,
  type ExecutionRunnerKind,
  type HostObservedExecutionContextV1,
} from '@anima/core';
import type { Database, Json } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

// Persistência do fato de CONTEXTO DE EXECUÇÃO (A2-0, Recorte 1). O host DECLARA modo/ator/runner;
// quem decide é a RPC `record_host_observed_execution_context`, que só aceita o Trusted System
// Writer e cruza a declaração com o ledger (autoridade, leases, atos humanos, attempt, versão).
// Nada aqui concede autoridade: `unattended` declarado sem sustentação no ledger é recusado.
//
// FAIL-OPEN para o desfecho da attempt (como a evidência de coder): falhar em registrar o contexto
// só significa "sem fato de modo" ⇒ a métrica de autonomia permanece em `unknown`/`human_observed`.

export interface ExecutionContextCorrelation {
  readonly workItemId: string;
  readonly attemptId: string;
  readonly approvedProposalVersion: number;
}

/** O que o processo declara. `authenticatedUserId` NUNCA vem do ambiente: o chamador o deriva da sessão. */
export interface ExecutionContextClaim {
  readonly executionMode: ExecutionMode;
  readonly actorKind: ExecutionActorKind;
  readonly runner: {
    readonly kind: ExecutionRunnerKind;
    readonly authenticatedUserId: string;
    readonly instanceId: string;
  };
}

export interface ExecutionContextSink {
  record(evidence: HostObservedExecutionContextV1): Promise<
    | { readonly ok: true; readonly action: 'recorded' | 'replayed' }
    | { readonly ok: false; readonly message: string }
  >;
}

export type ExecutionContextOutcome =
  | { readonly ok: true; readonly action: 'recorded' | 'replayed'; readonly evidence: HostObservedExecutionContextV1 }
  // `skipped` = o processo não declarou modo (sem fato; nada é inventado); `build` = declaração inválida;
  // `persist` = a RPC recusou (inclui declaração sem sustentação no ledger). Todos NÃO-FATAIS.
  | { readonly ok: false; readonly stage: 'skipped' | 'build' | 'persist'; readonly reason: string };

export async function persistHostObservedExecutionContext(
  correlation: ExecutionContextCorrelation,
  claim: ExecutionContextClaim | null,
  sink: ExecutionContextSink,
  now: () => Date = () => new Date(),
): Promise<ExecutionContextOutcome> {
  if (claim === null) return { ok: false, stage: 'skipped', reason: 'execution mode not declared' };
  const built = buildHostObservedExecutionContext({
    workItemId: correlation.workItemId,
    attemptId: correlation.attemptId,
    approvedProposalVersion: correlation.approvedProposalVersion,
    executionMode: claim.executionMode,
    actorKind: claim.actorKind,
    runner: claim.runner,
    observedAt: now().toISOString(),
  });
  if (!built.ok) return { ok: false, stage: 'build', reason: built.explanation };
  const persisted = await sink.record(built.value).catch((error: unknown) =>
    ({ ok: false as const, message: error instanceof Error ? error.message : String(error) }));
  if (!persisted.ok) return { ok: false, stage: 'persist', reason: persisted.message };
  return { ok: true, action: persisted.action, evidence: built.value };
}

/** Sink real: RPC restrita ao Trusted System Writer. A correlação vem da própria evidência. */
export const executionContextSinkFor = (client: SupabaseClient<Database>): ExecutionContextSink => ({
  record: async (evidence) => {
    const { data, error } = await client.rpc('record_host_observed_execution_context', {
      work_item_id: evidence.workItemId,
      expected_proposal_version: evidence.approvedProposalVersion,
      attempt_id: evidence.attemptId,
      evidence: evidence as unknown as Json,
    });
    if (error) return { ok: false, message: error.message };
    const action = (data as { action?: string } | null)?.action === 'replayed' ? 'replayed' : 'recorded';
    return { ok: true, action };
  },
});

const oneOf = <T extends string>(values: readonly T[], value: string | undefined): T | null =>
  values.find(candidate => candidate === value) ?? null;

/**
 * Declaração do processo a partir do ambiente do SERVIDOR. Sem `ANIMA_EXECUTION_MODE` válido ⇒ `null`
 * (nenhum fato é inventado). `unattended` NÃO é inferido de nada: precisa ser declarado e o banco o
 * confirma contra o ledger. O ator padrão é o único coerente com o modo; combinação incoerente ⇒ `null`.
 * A identidade autenticada do runner é fornecida pelo chamador (derivada da sessão RLS), não do ambiente.
 */
export function executionContextClaimFromEnvironment(
  authenticatedUserId: string,
  env: NodeJS.ProcessEnv = process.env,
): ExecutionContextClaim | null {
  const executionMode = oneOf(EXECUTION_MODES, env.ANIMA_EXECUTION_MODE?.trim());
  if (!executionMode) return null;
  const defaultActor: ExecutionActorKind = executionMode === 'manual' ? 'human_operator' : 'automated_runner';
  const declaredActor = env.ANIMA_EXECUTION_ACTOR?.trim();
  const actorKind = declaredActor === undefined || declaredActor === '' ? defaultActor : oneOf(EXECUTION_ACTOR_KINDS, declaredActor);
  const kind = oneOf(EXECUTION_RUNNER_KINDS, env.ANIMA_EXECUTION_RUNNER_KIND?.trim() || 'single_item_cli');
  if (!actorKind || !kind) return null;
  return {
    executionMode,
    actorKind,
    runner: { kind, authenticatedUserId, instanceId: env.ANIMA_EXECUTION_RUNNER_INSTANCE?.trim() || 'unspecified' },
  };
}

/**
 * Identidade autenticada do runner derivada do FATO de RLS: a sessão do runner só enxerga o item se
 * `auth.uid()` for o dono. Não aceita valor declarado pelo chamador.
 */
export async function readRunnerIdentityViaRls(
  client: SupabaseClient<Database>,
  workItemId: string,
): Promise<string | null> {
  try {
    const { data, error } = await client.from('work_items').select('user_id').eq('id', workItemId).single();
    return error || !data ? null : data.user_id;
  } catch {
    return null;
  }
}

/**
 * Declaração efetiva do processo para um item: sem modo no ambiente ⇒ `null` sem consultar nada; com
 * modo, a identidade do runner é lida via RLS (nunca declarada). Sessão ilegível ⇒ `null` (sem fato).
 */
export async function resolveExecutionContextClaim(
  client: SupabaseClient<Database>,
  workItemId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ExecutionContextClaim | null> {
  if (!oneOf(EXECUTION_MODES, env.ANIMA_EXECUTION_MODE?.trim())) return null;
  const userId = await readRunnerIdentityViaRls(client, workItemId);
  return userId === null ? null : executionContextClaimFromEnvironment(userId, env);
}
