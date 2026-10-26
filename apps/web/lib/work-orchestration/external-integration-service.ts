import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import {
  compareExternalTargetIdentity, evaluateVerifierRequirement, projectIntegrationCompleted, projectIntegrationStatus, projectLatestWorkResult,
  readExternalCandidate, readExternalTarget, type WorkEvent, type WorkItem, type WorkOrchestrationService,
} from '@anima/core';
import type { Database, Json } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createExternalReviewDeps, externalAcceptanceRefusal } from './external-candidate-review';
import {
  authorizeExternalIntegrationEffect, executeAuthorizedExternalIntegration, ExternalGitIntegrationProvider, operatorWorkTreeOptions,
  resolveExternalIntegrationConfig, supabaseExternalLeasePort, type AuthorizeExternalIntegrationOutcome, type ExecuteExternalIntegrationDeps,
  type ExternalIntegrationConfigResult, type ExternalIntegrationOutcome, type ExternalLeasePort,
} from './external-integration';
import { readExecutionContract } from './executor-selection';
import { verifyExternalTargetForContract } from './external-target-resolver';
import type { PersistIntegrationReceipt } from './integration-effect';
import { createTrustedGitRunner } from './trusted-git';
import { checkTrustedSystemWriterReady, trustedSystemWriterFromEnvironment } from './trusted-system-writer';

// ============================================================
// Serviço de INTEGRAÇÃO EXTERNA para a CLI oficial (Project Builder V1-01).
//
// NÃO é um pipeline novo: compõe, sem duplicar, o que o T5 já provou — `authorizeExternalIntegrationEffect` (RPC humana),
// `executeAuthorizedExternalIntegration` (identidade física, lease, CAS/ff, recibo) e o Trusted System Writer. Aqui ficam só a
// fiação (a mesma do script operacional), a prontidão do writer, a geração do identificador de autorização e a leitura somente
// leitura (`inspect`) que mostra ao operador o que ele está prestes a autorizar/executar.
// ============================================================

type Env = Readonly<Record<string, string | undefined>>;

export interface ExternalIntegrationRuntime {
  /** Config de um único target (legado/testes). Com `configFor` presente, ele manda: o destino é resolvido pela REFERÊNCIA do item. */
  readonly config: ExternalIntegrationConfigResult;
  readonly configFor?: (reference: string) => ExternalIntegrationConfigResult;
  readonly common: Pick<ExecuteExternalIntegrationDeps, 'getItem' | 'listEvents' | 'verifyTarget' | 'gitFor' | 'exists'>;
  readonly rpc: (args: Database['public']['Functions']['authorize_external_integration_effect']['Args']) => Promise<{ readonly data: Json | null; readonly error: { readonly message: string } | null }>;
  readonly lease: ExternalLeasePort;
  readonly humanReviewRefusal: ExecuteExternalIntegrationDeps['humanReviewRefusal'];
  readonly persist: PersistIntegrationReceipt;
  /** O Trusted System Writer autentica? (login real; nenhum segredo é exposto). Sem isso o recibo não poderia ser gravado DEPOIS do Git. */
  readonly writerReady: () => Promise<boolean>;
  readonly workTreeOptions: readonly string[];
  readonly newAuthorizationId: (reference: string) => string;
  readonly ownerInstanceId: () => string;
}

const operatorGit = (args: readonly string[]): string | null => {
  try { return execFileSync('git', [...args], { encoding: 'utf8', cwd: tmpdir(), windowsHide: true }).trim(); } catch { return null; }
};

/** Mesma fiação do script operacional (T5): sessão humana para ler/autorizar, writer de sistema só para o recibo. */
export function createExternalIntegrationRuntime(
  client: SupabaseClient<Database>, userId: string, service: Pick<WorkOrchestrationService, 'getItem' | 'listEvents' | 'attachContext'>,
  options: { readonly env?: Env } = {},
): ExternalIntegrationRuntime {
  const env = options.env ?? process.env;
  const reviewDeps = createExternalReviewDeps(client, userId, service, { env });
  return {
    config: { ok: false, code: 'external_integration_reference_required', message: 'O destino é resolvido pela referência do item.' },
    configFor: reference => resolveExternalIntegrationConfig(env, reference),
    common: {
      getItem: id => service.getItem(id as never), listEvents: id => service.listEvents(id as never),
      verifyTarget: contract => verifyExternalTargetForContract(contract, env),
      gitFor: gitDir => createTrustedGitRunner({ gitDir }), exists: existsSync,
    },
    rpc: async args => { const { data, error } = await client.rpc('authorize_external_integration_effect', args); return { data, error: error ? { message: error.message } : null }; },
    lease: supabaseExternalLeasePort(client),
    humanReviewRefusal: id => externalAcceptanceRefusal(id, reviewDeps),
    persist: trustedSystemWriterFromEnvironment(env as NodeJS.ProcessEnv).integrationReceipt,
    writerReady: () => checkTrustedSystemWriterReady(env as NodeJS.ProcessEnv),
    workTreeOptions: operatorWorkTreeOptions(operatorGit),
    newAuthorizationId: reference => `ext-int-${reference.replace(/^ext:/, '')}-${randomUUID()}`,
    ownerInstanceId: () => `external-integration-${process.pid}-${Date.now().toString(36)}`,
  };
}

const configOf = (rt: ExternalIntegrationRuntime, reference: string): ExternalIntegrationConfigResult => rt.configFor ? rt.configFor(reference) : rt.config;
const referenceOf = (item: WorkItem): string | null => {
  const t = readExternalTarget(((item.intent as Record<string, unknown> | null)?.['execution_spec'] as Record<string, unknown> | undefined)?.['target']);
  return t.ok ? t.target.reference : null;
};

// ─── authorize ───────────────────────────────────────────────────────────────────────

export type AuthorizeExternalIntegrationResult =
  | { readonly ok: true; readonly authorizationId: string; readonly action: 'recorded' | 'replayed'; readonly operationKey: string; readonly expectedTargetSha: string; readonly targetRef: string }
  | { readonly ok: false; readonly code: string; readonly message: string; readonly rejected: boolean };

const AUTH_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
export const isValidAuthorizationId = (value: unknown): value is string => typeof value === 'string' && AUTH_ID.test(value);

/** Ato HUMANO: registra a autorização `ff_only` (NÃO executa). `authorizationId` ausente ⇒ identificador novo e único. */
export async function authorizeExternalIntegration(workItemId: string, rt: ExternalIntegrationRuntime, authorizationId?: string): Promise<AuthorizeExternalIntegrationResult> {
  const item = await rt.common.getItem(workItemId);
  if (!item.ok) return { ok: false, code: 'work_item_unavailable', message: item.error.message, rejected: false };
  const target = readExternalTarget(((item.value.intent as Record<string, unknown> | null)?.['execution_spec'] as Record<string, unknown> | undefined)?.['target']);
  if (!target.ok) return { ok: false, code: 'not_external_work', message: 'O item não é trabalho externo materializado.', rejected: true };
  const config = configOf(rt, target.target.reference);
  if (!config.ok) return { ok: false, code: config.code, message: config.message, rejected: true };
  const id = authorizationId ?? rt.newAuthorizationId(target.target.reference);
  if (!isValidAuthorizationId(id)) return { ok: false, code: 'authorization_id_invalid', message: 'Identificador de autorização inválido.', rejected: true };
  const outcome: AuthorizeExternalIntegrationOutcome = await authorizeExternalIntegrationEffect({ workItemId, authorizationId: id }, { ...rt.common, config: config.config, rpc: rt.rpc });
  if (!outcome.ok) return { ok: false, code: outcome.reason, message: `Autorização recusada: ${outcome.reason}.`, rejected: !/unreadable|ambiguous|ancestry/.test(outcome.reason) };
  return { ok: true, authorizationId: id, action: outcome.action, operationKey: outcome.operationKey, expectedTargetSha: outcome.expectedTargetSha, targetRef: outcome.targetRef };
}

// ─── execute ─────────────────────────────────────────────────────────────────────────

/** Executa EXATAMENTE o efeito autorizado. Falha fechado antes do Git se o writer (recibo) ou a configuração não estiverem prontos. */
export async function executeExternalIntegration(workItemId: string, authorizationId: string, rt: ExternalIntegrationRuntime): Promise<ExternalIntegrationOutcome> {
  if (!isValidAuthorizationId(authorizationId)) return { status: 'denied', reason: 'authorization_id_invalid' };
  const item = await rt.common.getItem(workItemId);
  if (!item.ok) return { status: 'retryable', reason: 'persisted_state_unreadable' };
  const reference = referenceOf(item.value);
  if (reference === null) return { status: 'denied', reason: 'not_external_work' };
  const config = configOf(rt, reference);
  if (!config.ok) return { status: 'denied', reason: config.code };
  if (!(await rt.writerReady())) return { status: 'denied', reason: 'trusted_system_writer_unavailable' };
  const events = await rt.common.listEvents(workItemId);
  if (events.ok) {
    const done = projectIntegrationCompleted(events.value);
    if (done && done.authorizationId !== authorizationId) return { status: 'denied', reason: 'already_integrated_by_another_authorization' };
  }
  return executeAuthorizedExternalIntegration({ workItemId, integrationAuthorizationId: authorizationId }, {
    ...rt.common, config: config.config, lease: rt.lease, humanReviewRefusal: rt.humanReviewRefusal, persist: rt.persist,
    workTreeOptions: rt.workTreeOptions, ownerInstanceId: rt.ownerInstanceId(),
  });
}

// ─── inspect (somente leitura) ───────────────────────────────────────────────────────

export interface ExternalIntegrationInspection {
  readonly workItemId: string;
  readonly reference: string | null;
  readonly state: string;
  readonly proposalVersion: number;
  readonly repoRoot: string | null;
  readonly destination: string | null;
  readonly currentDestinationSha: string | null;
  readonly candidateCommitSha: string | null;
  readonly baseSha: string | null;
  readonly attemptId: string | null;
  readonly accepted: boolean;
  readonly verifier: 'verified' | 'not_verified';
  readonly humanReview: 'ok' | string;
  readonly fastForwardPossible: boolean | null;
  readonly checkout: 'none' | 'main_worktree' | 'linked_worktree' | null;
  readonly workingTree: 'clean' | string | null;
  readonly integration: 'integrated' | 'not_integrated' | 'invalid_receipt';
  readonly authorizations: readonly { readonly authorizationId: string; readonly expectedTargetSha: string; readonly targetRef: string; readonly current: boolean }[];
  readonly writerReady: boolean;
  readonly blockers: readonly string[];
  /** Nada impede autorizar/executar agora (as pré-condições conhecidas estão satisfeitas). */
  readonly ready: boolean;
}

const dataOf = (event: WorkEvent): Record<string, unknown> => ((event.payload as { data?: Record<string, unknown> } | null)?.data ?? {});

/** Mostra o que o operador está prestes a autorizar/executar. NÃO escreve (nem no banco, nem no repositório, nem lease). */
export async function inspectExternalIntegration(workItemId: string, rt: ExternalIntegrationRuntime): Promise<{ readonly ok: true; readonly inspection: ExternalIntegrationInspection } | { readonly ok: false; readonly code: string; readonly message: string }> {
  const [item, events] = await Promise.all([rt.common.getItem(workItemId), rt.common.listEvents(workItemId)]);
  if (!item.ok) return { ok: false, code: 'work_item_unavailable', message: item.error.message };
  if (!events.ok) return { ok: false, code: 'work_events_unavailable', message: events.error.message };
  const blockers: string[] = [];
  const it: WorkItem = item.value;
  const target = readExternalTarget(((it.intent as Record<string, unknown> | null)?.['execution_spec'] as Record<string, unknown> | undefined)?.['target']);
  if (!target.ok) return { ok: false, code: 'not_external_work', message: 'O item não é trabalho externo materializado.' };

  const config = configOf(rt, target.target.reference);
  if (!config.ok) blockers.push(config.code);
  else if (config.config.reference !== target.target.reference) blockers.push('reference_not_configured');
  const destination = config.ok ? config.config.targetRef : null;

  const latest = projectLatestWorkResult(events.value);
  const acceptedEvent = [...events.value].reverse().find(e => e.type === 'result_accepted');
  const accepted = it.state === 'completed' && acceptedEvent !== undefined && dataOf(acceptedEvent)['accepted_result_event_id'] === latest?.eventId;
  if (!accepted) blockers.push(it.state === 'completed' ? 'accepted_result_changed' : `item_not_completed:${it.state}`);
  const verified = latest ? evaluateVerifierRequirement(it, events.value, latest.eventId).satisfied : false;
  if (!verified) blockers.push('verifier_not_verified');
  const review = await rt.humanReviewRefusal(workItemId);
  if (review) blockers.push(review.code);
  const candidate = readExternalCandidate(it, events.value);
  if (!candidate.ok) blockers.push(candidate.reason);

  const integration = projectIntegrationStatus(events.value);
  if (integration === 'integrated') blockers.push('already_integrated');
  if (integration === 'invalid_receipt') blockers.push('invalid_receipt');

  let repoRoot: string | null = null;
  let current: string | null = null;
  let ff: boolean | null = null;
  let checkout: ExternalIntegrationInspection['checkout'] = null;
  let workingTree: string | null = null;
  const verifiedTarget = await rt.common.verifyTarget(readExecutionContract(it.intent));
  if (!verifiedTarget.ok) blockers.push(verifiedTarget.code);
  else if (compareExternalTargetIdentity(target.target.identity, verifiedTarget.identity)) blockers.push('external_target_identity_changed');
  else {
    repoRoot = verifiedTarget.repoRoot;
    if (destination) {
      const git = new ExternalGitIntegrationProvider(rt.common.gitFor(verifiedTarget.identity.gitCommonDirCanonical), verifiedTarget.repoRoot, verifiedTarget.identity.gitCommonDirCanonical, rt.common.exists, rt.workTreeOptions);
      try {
        current = await git.readTarget(destination);
        if (candidate.ok) {
          ff = await git.isAncestor(current, candidate.facts.candidateCommitSha);
          if (!ff) blockers.push(integration === 'integrated' ? 'destination_already_contains_candidate' : 'ff_not_possible');
        }
        checkout = await git.checkout(destination);
        if (checkout === 'linked_worktree') blockers.push('target_checked_out_in_linked_worktree');
        if (checkout === 'main_worktree') {
          const refusal = await git.workingTreeRefusal(destination, current);
          workingTree = refusal ?? 'clean';
          if (refusal) blockers.push(`target_checked_out:${refusal}`);
        }
      } catch (error) { blockers.push(error instanceof Error ? `git_unreadable:${error.message}` : 'git_unreadable'); }
    }
  }

  const writerReady = await rt.writerReady();
  if (!writerReady) blockers.push('trusted_system_writer_unavailable');

  const authorizations = events.value.filter(e => e.type === 'integration_effect_authorized' && e.author === 'user').map(e => {
    const d = dataOf(e);
    const expected = String(d['expected_target_sha'] ?? '');
    return { authorizationId: String(d['authorization_id'] ?? ''), expectedTargetSha: expected, targetRef: String(d['target_ref'] ?? ''), current: current !== null && expected === current && d['target_ref'] === destination };
  });

  return { ok: true, inspection: {
    workItemId, reference: target.target.reference, state: it.state, proposalVersion: it.proposalVersion, repoRoot, destination, currentDestinationSha: current,
    candidateCommitSha: candidate.ok ? candidate.facts.candidateCommitSha : null, baseSha: candidate.ok ? candidate.facts.baseSha : target.target.identity.baseSha,
    attemptId: candidate.ok ? candidate.facts.attemptId : null, accepted, verifier: verified ? 'verified' : 'not_verified', humanReview: review ? review.code : 'ok',
    fastForwardPossible: ff, checkout, workingTree, integration, authorizations, writerReady, blockers, ready: blockers.length === 0,
  } };
}
