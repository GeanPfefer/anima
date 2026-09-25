import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readHarnessDefectRecoveryAuthorization, type HarnessDefectRecoveryAuthorization } from '@anima/core';
import type { Database, Json } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runProcess } from './worktree';
import { projectRoot } from './executor-selection';
import { uuidFromSeed } from './decomposition-orchestration';
import { readWorkRetryReadiness } from './retry-readiness';

// ============================================================
// Recuperação governada após DEFEITO DE HARNESS já corrigido (ato humano).
// O host confere o que o banco não enxerga — os commits do fix existem e estão no
// HEAD que o Resident Host executa; o registro de evidência existe no repositório — e
// a RPC `authorize_harness_fix_recovery` revalida sob lock os fatos da falha e
// materializa exatamente UM sucessor `proposed`. Nada é aprovado, preferido, pago ou
// executado aqui. O requestId é derivado do evento de falha: repetir o ato é replay.
// ============================================================

export interface HarnessRecoveryRequest {
  readonly fixCommits: readonly string[];
  readonly evidenceReference: string;
  readonly reason: string;
}

export interface HarnessRecoveryGitPort {
  /** SHA completo de um commit existente, ou null. */
  readonly resolveCommit: (ref: string) => Promise<string | null>;
  /** O commit está contido no HEAD atual (o código que o Resident Host executa)? */
  readonly containedInHead: (sha: string) => Promise<boolean>;
  readonly fileExists: (relativePath: string) => boolean;
}

export type HarnessRecoveryResult =
  | { readonly ok: true; readonly recoveryId: string; readonly successorWorkItemId: string; readonly lineageId: string;
      readonly sourceAttemptId: string; readonly replayed: boolean; readonly authorization: HarnessDefectRecoveryAuthorization }
  | { readonly ok: false; readonly code: string; readonly message: string; readonly rejected: boolean };

const fail = (code: string, message: string, rejected = true): HarnessRecoveryResult => ({ ok: false, code, message, rejected });

export function gitRecoveryPort(root: string = projectRoot()): HarnessRecoveryGitPort {
  const git = (args: string[]) => runProcess('git', ['-C', root, ...args], { cwd: root, timeoutMs: 15_000 }).catch(() => null);
  return {
    resolveCommit: async ref => {
      if (!/^[0-9a-f]{7,40}$/i.test(ref)) return null;
      const r = await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
      const sha = r?.stdout.trim().toLowerCase() ?? '';
      return r && r.exitCode === 0 && /^[0-9a-f]{40}$/.test(sha) ? sha : null;
    },
    containedInHead: async sha => (await git(['merge-base', '--is-ancestor', sha, 'HEAD']))?.exitCode === 0,
    fileExists: path => /^docs\/registros\/[A-Za-z0-9_-]+\.md$/.test(path) && existsSync(join(root, path)),
  };
}

export async function recoverFromHarnessDefect(
  client: SupabaseClient<Database>,
  workItemId: string,
  request: HarnessRecoveryRequest,
  git: HarnessRecoveryGitPort = gitRecoveryPort(),
): Promise<HarnessRecoveryResult> {
  const readiness = await readWorkRetryReadiness(client, workItemId);
  if (readiness.reason === 'read_failed') return fail('read_failed', 'Não foi possível ler o estado de retry do item.', false);
  // Com tentativas restantes o caminho canônico é `work retry`, não uma recuperação.
  if (readiness.reason !== 'attempt_budget_exhausted' || !readiness.failureEventId || readiness.proposalVersion === null) {
    return fail('budget_not_exhausted_or_not_failed', `A recuperação de harness exige item failed com tentativas esgotadas (estado de retry: ${readiness.reason}).`);
  }
  const fixCommits: string[] = [];
  for (const ref of request.fixCommits) {
    const sha = await git.resolveCommit(ref);
    if (!sha) return fail('fix_commit_unknown', `Commit do fix não encontrado: ${ref}.`);
    if (!(await git.containedInHead(sha))) return fail('fix_commit_not_in_head', `O fix ${sha.slice(0, 7)} não está no HEAD que o Resident Host executa.`);
    fixCommits.push(sha);
  }
  if (!git.fileExists(request.evidenceReference)) return fail('evidence_missing', `Registro de evidência inexistente: ${request.evidenceReference}.`);

  const authorization = readHarnessDefectRecoveryAuthorization({
    schemaVersion: 1, kind: 'harness_defect_fixed_v1',
    requestId: uuidFromSeed(`harness_defect_recovery:${workItemId}:${readiness.failureEventId}`),
    reason: request.reason.trim(), failureClass: 'harness', fixCommits,
    evidenceReference: request.evidenceReference, additionalAttempts: 1,
  });
  if (!authorization) return fail('authorization_invalid', 'Autoridade de recuperação inválida (motivo 10–500 caracteres, 1–4 commits distintos).');

  const { data, error } = await client.rpc('authorize_harness_fix_recovery', {
    p_work_item_id: workItemId, p_expected_proposal_version: readiness.proposalVersion,
    p_failure_event_id: readiness.failureEventId, p_authorization: authorization as unknown as Json,
  });
  if (error) return fail(error.code ?? 'rpc_failed', error.message, ['22023', '55000', '42501', 'P0002'].includes(error.code ?? ''));
  const value = data as Record<string, unknown> | null;
  if (!value || typeof value.recoveryId !== 'string' || typeof value.successorWorkItemId !== 'string'
    || typeof value.lineageId !== 'string' || typeof value.sourceAttemptId !== 'string' || typeof value.replayed !== 'boolean') {
    return fail('response_invalid', 'Resposta inválida da recuperação.', false);
  }
  return { ok: true, recoveryId: value.recoveryId, successorWorkItemId: value.successorWorkItemId, lineageId: value.lineageId,
    sourceAttemptId: value.sourceAttemptId, replayed: value.replayed, authorization };
}
