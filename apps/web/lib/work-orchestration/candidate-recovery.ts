import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readCandidateRecoveryAuthorization, type CandidateRecoveryAuthorization } from '@anima/core';
import type { Database, Json } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runProcess } from './worktree';
import { projectRoot } from './executor-selection';
import { uuidFromSeed } from './decomposition-orchestration';
import { readWorkRetryReadiness } from './retry-readiness';

// ============================================================
// Recuperação governada de CANDIDATO com defeito real (ato humano).
// O host confere o que o banco não enxerga — o commit candidato existe, o branch
// `anima-work/<attempt>` resolve para ele, ele descende de `base_sha` e o registro de
// evidência existe — e a RPC `authorize_candidate_recovery` revalida sob lock os fatos da
// falha e materializa exatamente UM sucessor `proposed` que retoma o checkpoint. Não é
// retry: nada é aprovado, preferido, pago ou executado aqui. O requestId é derivado do
// evento de falha: repetir o ato é replay. O backend NÃO é restringido aqui (a RPC decide).
// ============================================================

/** Diagnóstico humano: a autorização sem `requestId` (derivado do evento de falha). */
export type CandidateRecoveryRequest = Omit<CandidateRecoveryAuthorization, 'requestId'>;

export interface CandidateRecoveryGitPort {
  /** SHA completo de um commit existente, ou null. */
  readonly resolveCommit: (ref: string) => Promise<string | null>;
  /** Commit para o qual o branch resolve, ou null. */
  readonly resolveBranch: (branch: string) => Promise<string | null>;
  /** `ancestor` é ancestral (ou igual) de `descendant`? */
  readonly isAncestor: (ancestor: string, descendant: string) => Promise<boolean>;
  readonly changedFilesBetween: (start: string, end: string) => Promise<readonly string[] | null>;
  readonly fileExists: (relativePath: string) => boolean;
}

export type CandidateRecoveryResult =
  | { readonly ok: true; readonly recoveryId: string; readonly successorWorkItemId: string; readonly lineageId: string;
      readonly sourceAttemptId: string; readonly checkpointCommitSha: string; readonly replayed: boolean;
      readonly authorization: CandidateRecoveryAuthorization }
  | { readonly ok: false; readonly code: string; readonly message: string; readonly rejected: boolean };

const fail = (code: string, message: string, rejected = true): CandidateRecoveryResult => ({ ok: false, code, message, rejected });
const SHA = /^[0-9a-f]{40}$/;

export function gitCandidatePort(root: string = projectRoot()): CandidateRecoveryGitPort {
  const git = (args: string[]) => runProcess('git', ['-C', root, ...args], { cwd: root, timeoutMs: 15_000 }).catch(() => null);
  const revParse = async (ref: string): Promise<string | null> => {
    const r = await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    const sha = r?.stdout.trim().toLowerCase() ?? '';
    return r && r.exitCode === 0 && SHA.test(sha) ? sha : null;
  };
  return {
    resolveCommit: async ref => (SHA.test(ref) ? revParse(ref) : null),
    resolveBranch: async branch => (/^anima-work\/[0-9a-f-]{36}$/.test(branch) ? revParse(`refs/heads/${branch}`) : null),
    isAncestor: async (ancestor, descendant) => (await git(['merge-base', '--is-ancestor', ancestor, descendant]))?.exitCode === 0,
    changedFilesBetween: async (start, end) => {
      if (!SHA.test(start) || !SHA.test(end)) return null;
      const r = await git(['diff', '--name-only', '-z', start + '..' + end]);
      return r?.exitCode === 0 ? r.stdout.split('\0').filter(Boolean) : null;
    },
    fileExists: path => /^docs\/registros\/[A-Za-z0-9_-]+\.md$/.test(path) && existsSync(join(root, path)),
  };
}

/** `base_sha` observado pelo host para a attempt de origem (evidência já persistida). */
async function readObservedEvidence(client: SupabaseClient<Database>, workItemId: string, attemptId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await client.from('work_events').select('payload')
    .eq('work_item_id', workItemId).eq('event_type', 'host_observed_evidence_recorded').eq('author', 'system')
    .order('seq', { ascending: false }).limit(20);
  if (error || !Array.isArray(data)) return null;
  for (const row of data as { payload: unknown }[]) {
    const evidence = ((row.payload as { data?: { evidence?: Record<string, unknown> } } | null)?.data?.evidence) ?? null;
    if (evidence && evidence.attemptId === attemptId && typeof evidence.baseSha === 'string' && SHA.test(evidence.baseSha)) return evidence;
  }
  return null;
}

export async function recoverFromFailedCandidate(
  client: SupabaseClient<Database>,
  workItemId: string,
  request: unknown,
  git: CandidateRecoveryGitPort = gitCandidatePort(),
): Promise<CandidateRecoveryResult> {
  const readiness = await readWorkRetryReadiness(client, workItemId);
  if (readiness.reason === 'read_failed') return fail('read_failed', 'Não foi possível ler o estado de retry do item.', false);
  // Com tentativas restantes o caminho canônico é `work retry`, não uma recuperação.
  // O esgotamento sai dos FATOS da prontidão, não do `reason` (SDC-02: failure_not_retryable com 1/1).
  const budgetExhausted = readiness.maxAttempts > 0 && readiness.attemptsUsed >= readiness.maxAttempts && readiness.remainingAttempts === 0;
  if (readiness.status !== 'BLOCKED' || !budgetExhausted || !readiness.failureEventId || !readiness.sourceAttemptId || readiness.proposalVersion === null) {
    return fail('budget_not_exhausted_or_not_failed', `A recuperação de candidato exige item failed com tentativas esgotadas (estado de retry: ${readiness.reason}).`);
  }

  const draft = typeof request === 'object' && request !== null && !Array.isArray(request) ? request as Record<string, unknown> : null;
  const authorization = draft && !('requestId' in draft) ? readCandidateRecoveryAuthorization({
    ...draft, requestId: uuidFromSeed(`candidate_recovery:${workItemId}:${readiness.failureEventId}`),
  }) : null;
  if (!authorization) {
    return fail('authorization_invalid', 'Diagnóstico inválido (campos exatos, kinds fechados e sem repetição, textos nos limites, path relativo, sem requestId).');
  }
  if (readiness.sourceAttemptId !== authorization.sourceAttemptId) {
    return fail('source_attempt_mismatch', 'O diagnóstico aponta para uma attempt diferente da última falha do item.');
  }

  const commit = await git.resolveCommit(authorization.candidateCommitSha);
  if (commit !== authorization.candidateCommitSha) return fail('candidate_commit_unknown', `Commit candidato não encontrado: ${authorization.candidateCommitSha.slice(0, 7)}.`);
  const branchCommit = await git.resolveBranch(`anima-work/${authorization.sourceAttemptId}`);
  if (branchCommit !== commit) return fail('candidate_branch_mismatch', 'O branch da attempt não resolve para o commit candidato.');
  const evidence = await readObservedEvidence(client, workItemId, authorization.sourceAttemptId);
  const baseSha = evidence?.baseSha as string | undefined;
  if (!baseSha) return fail('base_sha_unknown', 'Evidência host do base_sha da attempt não encontrada.');
  if (baseSha === commit || !(await git.isAncestor(baseSha, commit))) return fail('candidate_not_descendant_of_base', 'O commit candidato não descende do base_sha observado.');
  const item = await client.from('work_items').select('intent').eq('id', workItemId).single();
  if (item.error || !item.data) return fail('read_failed', 'Não foi possível ler o checkpoint do item.', false);
  const intent = item.data.intent as { execution_spec?: Record<string, unknown> } | null;
  const spec = intent?.execution_spec;
  if (spec && Object.prototype.hasOwnProperty.call(spec, 'resume_from_checkpoint')) {
    const resume = spec.resume_from_checkpoint;
    const checkpointSha = typeof resume === 'object' && resume !== null && !Array.isArray(resume)
      ? (resume as Record<string, unknown>).commit_sha : null;
    if (typeof checkpointSha !== 'string' || !SHA.test(checkpointSha) || checkpointSha === commit
      || (await git.resolveCommit(checkpointSha)) !== checkpointSha || !(await git.isAncestor(checkpointSha, commit))) {
      return fail('checkpoint_not_ancestor', 'Checkpoint inválido ou não ancestral distinto do candidato.');
    }
    const delta = evidence?.observedChangedFilesSinceStart;
    if (!Array.isArray(delta) || !delta.every((file): file is string => typeof file === 'string')) {
      return fail('checkpoint_delta_evidence_missing', 'Delta host do checkpoint ausente ou inválido para a attempt.');
    }
    const observed = await git.changedFilesBetween(checkpointSha, commit);
    const expected = new Set(delta);
    const actual = observed === null ? null : new Set(observed);
    if (!actual || actual.size !== expected.size || [...actual].some(file => !expected.has(file))) {
      return fail('checkpoint_delta_mismatch', 'Delta Git do checkpoint diverge da evidência persistida.');
    }
  }
  if (!git.fileExists(authorization.evidenceReference)) return fail('evidence_missing', `Registro de evidência inexistente: ${authorization.evidenceReference}.`);

  const { data, error } = await client.rpc('authorize_candidate_recovery', {
    p_work_item_id: workItemId, p_expected_proposal_version: readiness.proposalVersion,
    p_failure_event_id: readiness.failureEventId, p_authorization: authorization as unknown as Json,
  });
  if (error) return fail(error.code ?? 'rpc_failed', error.message, ['22023', '55000', '42501', 'P0002'].includes(error.code ?? ''));
  const value = data as Record<string, unknown> | null;
  if (!value || typeof value.recoveryId !== 'string' || typeof value.successorWorkItemId !== 'string'
    || typeof value.lineageId !== 'string' || typeof value.sourceAttemptId !== 'string'
    || typeof value.checkpointCommitSha !== 'string' || typeof value.replayed !== 'boolean') {
    return fail('response_invalid', 'Resposta inválida da recuperação.', false);
  }
  return { ok: true, recoveryId: value.recoveryId, successorWorkItemId: value.successorWorkItemId, lineageId: value.lineageId,
    sourceAttemptId: value.sourceAttemptId, checkpointCommitSha: value.checkpointCommitSha, replayed: value.replayed, authorization };
}
