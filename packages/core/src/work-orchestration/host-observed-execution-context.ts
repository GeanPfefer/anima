import type { ProposalVersion, WorkEvent, WorkItemId } from './types';

// ============================================================
// Fato de CONTEXTO DE EXECUÇÃO observado pelo host (A2-0, Recorte 1).
//
// Registra, por attempt, COMO a execução ocorreu (`execution_mode`) e QUEM a executou
// (`actor_kind`), de modo que a métrica de autonomia deixe de depender de ausência de
// eventos humanos e passe a ter um fato positivo, correlacionado e com proveniência.
//
// Quatro papéis distintos — nunca confundir:
//   1. Autoridade humana (ou política) que CONCEDE: derivada pelo BANCO a partir do ledger
//      (work_approved + work_intelligence_classified), nunca declarada pelo cliente.
//   2. Runner autenticado: a identidade GoTrue do processo que executou a attempt. É uma
//      DECLARAÇÃO do host, conferida pelo banco contra o dono do item.
//   3. Trusted System Writer: a única identidade que pode gravar este fato (author=system).
//   4. Modo de execução: DECLARAÇÃO do host, validada contra o ledger. `unattended` só é
//      aceito quando o ledger o sustenta; `supervised`/`manual` são rebaixamentos seguros.
//
// Este módulo é PURO: construtor/validador do que o host declara e leitor do fato persistido.
// A decisão autoritativa (cruzar com o ledger) vive na RPC `record_host_observed_execution_context`.
// ============================================================

export const EXECUTION_CONTEXT_EVENT_TYPE = 'host_observed_execution_context_recorded' as const;

export const EXECUTION_MODES = ['unattended', 'supervised', 'manual'] as const;
export type ExecutionMode = typeof EXECUTION_MODES[number];

export const EXECUTION_ACTOR_KINDS = ['automated_runner', 'human_operator'] as const;
export type ExecutionActorKind = typeof EXECUTION_ACTOR_KINDS[number];

export const EXECUTION_RUNNER_KINDS = ['resident_host', 'single_item_cli', 'scheduled_launcher', 'interactive_ui'] as const;
export type ExecutionRunnerKind = typeof EXECUTION_RUNNER_KINDS[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const INSTANCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

export interface ExecutionRunnerIdentityV1 {
  readonly kind: ExecutionRunnerKind;
  /** `auth.uid()` da sessão que executou. Conferido pelo banco contra o dono do item. */
  readonly authenticatedUserId: string;
  /** Rótulo opaco da instância (sem caminho, host ou segredo). Informativo, não-confiável. */
  readonly instanceId: string;
}

export interface HostObservedExecutionContextV1 {
  readonly schemaVersion: 1;
  readonly workItemId: WorkItemId;
  readonly attemptId: string;
  readonly approvedProposalVersion: ProposalVersion;
  readonly executionMode: ExecutionMode;
  readonly actorKind: ExecutionActorKind;
  readonly runner: ExecutionRunnerIdentityV1;
  readonly observedAt: string;
}

export type HostObservedExecutionContextDefect =
  | 'invalid_correlation'
  | 'invalid_mode'
  | 'invalid_actor_kind'
  | 'mode_actor_incompatible'
  | 'invalid_runner'
  | 'invalid_timestamp';

export type HostObservedExecutionContextResult =
  | { readonly ok: true; readonly value: HostObservedExecutionContextV1 }
  | { readonly ok: false; readonly defect: HostObservedExecutionContextDefect; readonly explanation: string };

export type BuildHostObservedExecutionContextInput = Omit<HostObservedExecutionContextV1, 'schemaVersion'>;

const fail = (defect: HostObservedExecutionContextDefect, explanation: string): HostObservedExecutionContextResult =>
  ({ ok: false, defect, explanation });
const nonBlank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/** `unattended` exige runner automático; `manual` exige operador humano; `supervised` admite ambos. */
export function executionModeAllowsActor(mode: ExecutionMode, actor: ExecutionActorKind): boolean {
  if (mode === 'unattended') return actor === 'automated_runner';
  if (mode === 'manual') return actor === 'human_operator';
  return true;
}

/**
 * Constrói e valida o que o host DECLARA. Fail-closed: valores fora dos conjuntos fechados,
 * combinação modo×ator incoerente, runner sem identidade UUID, instância com caracteres fora
 * do padrão (bloqueia caminhos, URLs e segredos) e timestamp inválido.
 */
export function buildHostObservedExecutionContext(
  input: BuildHostObservedExecutionContextInput,
): HostObservedExecutionContextResult {
  if (!nonBlank(input.workItemId) || !nonBlank(input.attemptId)
    || !Number.isInteger(input.approvedProposalVersion) || input.approvedProposalVersion < 1) {
    return fail('invalid_correlation', 'O contexto exige item, attempt e versão aprovada válidos.');
  }
  if (!(EXECUTION_MODES as readonly string[]).includes(input.executionMode)) {
    return fail('invalid_mode', 'execution_mode precisa ser unattended, supervised ou manual.');
  }
  if (!(EXECUTION_ACTOR_KINDS as readonly string[]).includes(input.actorKind)) {
    return fail('invalid_actor_kind', 'actor_kind precisa ser automated_runner ou human_operator.');
  }
  if (!executionModeAllowsActor(input.executionMode, input.actorKind)) {
    return fail('mode_actor_incompatible', 'A combinação execution_mode × actor_kind é incoerente.');
  }
  const runner = input.runner as ExecutionRunnerIdentityV1 | undefined;
  if (!runner || !(EXECUTION_RUNNER_KINDS as readonly string[]).includes(runner.kind)
    || typeof runner.authenticatedUserId !== 'string' || !UUID.test(runner.authenticatedUserId)
    || typeof runner.instanceId !== 'string' || !INSTANCE.test(runner.instanceId)
    || Object.keys(runner).length !== 3) {
    return fail('invalid_runner', 'O runner exige kind válido, usuário autenticado UUID e instância opaca.');
  }
  if (!nonBlank(input.observedAt) || Number.isNaN(Date.parse(input.observedAt))) {
    return fail('invalid_timestamp', 'observedAt precisa ser um instante ISO-8601 válido.');
  }
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      workItemId: input.workItemId,
      attemptId: input.attemptId,
      approvedProposalVersion: input.approvedProposalVersion,
      executionMode: input.executionMode,
      actorKind: input.actorKind,
      runner: { kind: runner.kind, authenticatedUserId: runner.authenticatedUserId, instanceId: runner.instanceId },
      observedAt: input.observedAt,
    },
  };
}

/**
 * Identidade de "mesmo fato" para idempotência: tudo menos `observedAt`.
 * O banco aplica a mesma regra (`evidence - 'observedAt'`).
 */
export function sameExecutionContext(a: HostObservedExecutionContextV1, b: HostObservedExecutionContextV1): boolean {
  return a.workItemId === b.workItemId && a.attemptId === b.attemptId
    && a.approvedProposalVersion === b.approvedProposalVersion
    && a.executionMode === b.executionMode && a.actorKind === b.actorKind
    && a.runner.kind === b.runner.kind && a.runner.authenticatedUserId === b.runner.authenticatedUserId
    && a.runner.instanceId === b.runner.instanceId;
}

// ------------------------------------------------------------
// Leitor do fato PERSISTIDO (consumidores: métrica de autonomia, Evolution).
// ------------------------------------------------------------

export interface PersistedExecutionContextFact {
  readonly eventSeq: number | undefined;
  readonly attemptId: string;
  readonly approvedProposalVersion: number;
  readonly executionMode: ExecutionMode;
  readonly actorKind: ExecutionActorKind;
  readonly authority: PersistedExecutionAuthority;
}

/** Autoridade derivada do ledger PELO BANCO no momento do registro. */
export interface PersistedExecutionAuthority {
  readonly approvalAuthor: 'user' | 'system';
  readonly approvalAuthority: 'human' | 'autonomous_policy';
  readonly approvedSeq: number;
  readonly classifiedSeq: number;
  readonly leasesObserved: number;
  readonly humanActsAfterMandate: number;
}

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/**
 * Lê um evento e devolve o fato somente se TODA a proveniência bate: tipo certo, autor `system`,
 * origem `host`, registrado pelo Trusted System Writer, campos de topo iguais aos da evidência
 * assinada, combinação modo×ator coerente e autoridade completa. Qualquer divergência ⇒ `null`
 * (evento histórico, adulterado ou de outra versão nunca vira fato válido).
 */
export function readPersistedExecutionContext(event: WorkEvent): PersistedExecutionContextFact | null {
  if (event.type !== EXECUTION_CONTEXT_EVENT_TYPE || event.author !== 'system') return null;
  const data = object(object(event.payload).data);
  const evidence = object(data.evidence);
  const authority = object(data.authority);
  if (data.origin !== 'host' || data.recorded_by !== 'trusted_system_writer') return null;
  const mode = data.execution_mode;
  const actor = data.actor_kind;
  if (!(EXECUTION_MODES as readonly string[]).includes(mode as string)
    || !(EXECUTION_ACTOR_KINDS as readonly string[]).includes(actor as string)) return null;
  if (evidence.executionMode !== mode || evidence.actorKind !== actor) return null;
  if (!executionModeAllowsActor(mode as ExecutionMode, actor as ExecutionActorKind)) return null;
  if (typeof data.attempt_id !== 'string' || evidence.attemptId !== data.attempt_id) return null;
  if (!Number.isInteger(data.approved_proposal_version) || evidence.approvedProposalVersion !== data.approved_proposal_version) return null;
  if (event.proposalVersion !== undefined && event.proposalVersion !== data.approved_proposal_version) return null;
  const ints = [authority.approved_seq, authority.classified_seq, authority.leases_observed, authority.human_acts_after_mandate];
  if (!ints.every(v => Number.isInteger(v) && (v as number) >= 0)) return null;
  const approvalAuthor = authority.approval_author;
  const approvalAuthority = authority.approval_authority;
  if ((approvalAuthor !== 'user' && approvalAuthor !== 'system')
    || (approvalAuthority !== 'human' && approvalAuthority !== 'autonomous_policy')) return null;
  return {
    eventSeq: event.seq,
    attemptId: data.attempt_id,
    approvedProposalVersion: data.approved_proposal_version as number,
    executionMode: mode as ExecutionMode,
    actorKind: actor as ExecutionActorKind,
    authority: {
      approvalAuthor, approvalAuthority,
      approvedSeq: authority.approved_seq as number, classifiedSeq: authority.classified_seq as number,
      leasesObserved: authority.leases_observed as number,
      humanActsAfterMandate: authority.human_acts_after_mandate as number,
    },
  };
}
