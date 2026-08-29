import {
  decompositionIdempotencySeed,
  deriveDecompositionSuccessor,
  projectHostObservedEvidence,
  projectHostObservedGateEvidence,
  type DecompositionDiagnostic,
  type DecompositionRefusal,
  type RecoverySuccessorCandidate,
  type RecoverySuccessorGap,
  type WorkEvent,
  type WorkItem,
  type WorkRecoveryAssessment,
} from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { readWorkRecoveryAssessment } from './recovery-assessment';
import { proposeRecoverySuccessor } from './recovery-successor';
import { createWorkOrchestrationService } from './server';
import { worktreeBranchFor } from './worktree-executor';

// ============================================================
// Ligação de produção da DECOMPOSIÇÃO GOVERNADA. Fecha a lacuna entre os
// primitives puros (decideRecovery → deriveDecompositionSuccessor →
// validateRecoverySuccessor → proposeRecoverySuccessor) e o estado real: dado um
// work item FALHO cuja política de recuperação recomenda `decompose`, monta o
// diagnóstico DETERMINÍSTICO a partir dos FATOS já persistidos pelo host —
// evidência git observada (checkpoint durável: base, commit, arquivos) e
// evidência de gate observada (qual gate reprovou) — e materializa, idempotente,
// a menor unidade sucessora `proposed` ligada por lineage ao original.
//
// NÃO aprova, classifica, executa nem amplia autoridade. Desfecho máximo:
// `proposed` (a validação de envelope roda dentro de proposeRecoverySuccessor).
// Fail-closed em toda lacuna. Idempotência: a chave é derivada de forma ESTÁVEL
// do commit do checkpoint, de modo que o MESMO estado falho nunca gera dois
// sucessores (a RPC replaya).
//
// A DECISÃO é PURA (`planDecompositionFromFailure`, testável sem banco); a cola de
// I/O (`decomposeFailedWorkItem`) apenas busca os fatos e persiste.
// ============================================================

export type DecompositionBlock =
  | 'assessment_unavailable'
  | 'strategy_not_decompose'
  | 'item_unavailable'
  | 'events_unavailable'
  | 'checkpoint_evidence_missing'
  | 'failing_gate_evidence_missing'
  | 'lineage_read_failed'
  | 'derivation_refused'
  | 'candidate_invalid'
  | 'persistence_failed';

export interface DecompositionPlan {
  readonly diagnostic: DecompositionDiagnostic;
  readonly recoverySequence: number;
  readonly idempotencyKey: string;
  readonly candidate: RecoverySuccessorCandidate;
}

export type DecompositionPlanResult =
  | { readonly ok: true; readonly plan: DecompositionPlan }
  | { readonly ok: false; readonly reason: DecompositionBlock; readonly refusals?: readonly DecompositionRefusal[] };

export type DecompositionFromFailureResult =
  | {
      readonly ok: true;
      readonly successorWorkItemId: string;
      readonly lineageId: string;
      readonly recoverySequence: number;
      readonly replayed: boolean;
    }
  | {
      readonly ok: false;
      readonly reason: DecompositionBlock;
      readonly refusals?: readonly DecompositionRefusal[];
      readonly gaps?: readonly RecoverySuccessorGap[];
      readonly message?: string;
    };

/**
 * UUID v5-shaped DETERMINÍSTICO a partir de uma semente estável. Não é uma UUID
 * RFC 4122 canônica (não usa um namespace real), mas satisfaz o formato exigido
 * pela lineage (versão 5, variante 10xx) e é estável byte-a-byte para a mesma
 * semente — a garantia real de idempotência que precisamos.
 */
export function uuidFromSeed(seed: string): string {
  const hex = createHash('sha256').update(seed, 'utf8').digest('hex');
  const timeLow = hex.slice(0, 8);
  const timeMid = hex.slice(8, 12);
  const timeHiVersion = `5${hex.slice(13, 16)}`;
  const variant = ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0');
  const clockSeq = `${variant}${hex.slice(18, 20)}`;
  const node = hex.slice(20, 32);
  return `${timeLow}-${timeMid}-${timeHiVersion}-${clockSeq}-${node}`;
}

export interface DecompositionFacts {
  readonly original: WorkItem;
  readonly assessment: WorkRecoveryAssessment;
  readonly events: readonly WorkEvent[];
  /** Sequências de lineage já existentes para o original (append-only). */
  readonly existingRecoverySequences: readonly number[];
}

/**
 * PURA e fail-closed. Monta o diagnóstico determinístico a partir dos fatos
 * observados pelo host (git + gate) da MESMA tentativa que o assessment aponta e
 * deriva o candidato governado, com sequência e chave de idempotência estáveis.
 * Não toca o banco.
 */
export function planDecompositionFromFailure(facts: DecompositionFacts): DecompositionPlanResult {
  const { original, assessment, events } = facts;
  if (assessment.decision.action !== 'decompose') return { ok: false, reason: 'strategy_not_decompose' };
  if (original.state !== 'failed') return { ok: false, reason: 'item_unavailable' };

  // Checkpoint durável observado pelo host na branch da tentativa falha. A
  // evidência precisa corresponder EXATAMENTE à tentativa apontada pelo assessment;
  // qualquer divergência é falha fechada (nunca retomamos de um checkpoint alheio).
  const gitEvidence = projectHostObservedEvidence(events);
  if (!gitEvidence || gitEvidence.attemptId !== assessment.sourceAttemptId) {
    return { ok: false, reason: 'checkpoint_evidence_missing' };
  }

  // Gate(s) que efetivamente reprovaram, observados pelo host na MESMA tentativa.
  const gateEvidence = projectHostObservedGateEvidence(events);
  const failingGates = gateEvidence && gateEvidence.attemptId === assessment.sourceAttemptId
    ? gateEvidence.gates.filter(gate => gate.outcome === 'failed').map(gate => ({ label: gate.label, command: gate.command }))
    : [];
  if (failingGates.length === 0) return { ok: false, reason: 'failing_gate_evidence_missing' };

  const diagnostic: DecompositionDiagnostic = {
    failingGates,
    changedFiles: gitEvidence.observedChangedFiles,
    checkpoint: {
      baseSha: gitEvidence.baseSha,
      branch: worktreeBranchFor(assessment.sourceAttemptId),
      commitSha: gitEvidence.observedCommitSha,
    },
  };

  const recoverySequence = facts.existingRecoverySequences.reduce((max, value) => Math.max(max, value), 0) + 1;
  const idempotencyKey = uuidFromSeed(decompositionIdempotencySeed(original.id, gitEvidence.observedCommitSha));

  const derivation = deriveDecompositionSuccessor({ original, assessment, diagnostic, recoverySequence, idempotencyKey });
  if (!derivation.ok) return { ok: false, reason: 'derivation_refused', refusals: derivation.refusals };

  return { ok: true, plan: { diagnostic, recoverySequence, idempotencyKey, candidate: derivation.candidate } };
}

/**
 * Materializa (ou replaya) a decomposição governada de um item falho. Chamável
 * por um usuário autenticado (RLS): lê apenas as próprias linhas; a RPC recarimba
 * proveniência. Puro efeito local: nenhuma integração externa.
 */
export async function decomposeFailedWorkItem(
  client: SupabaseClient<Database>,
  workItemId: string,
): Promise<DecompositionFromFailureResult> {
  const assessment = await readWorkRecoveryAssessment(client, workItemId);
  if (!assessment) return { ok: false, reason: 'assessment_unavailable' };
  if (assessment.decision.action !== 'decompose') return { ok: false, reason: 'strategy_not_decompose' };

  const service = createWorkOrchestrationService(client);
  const [itemResult, eventsResult] = await Promise.all([
    service.getItem(workItemId),
    service.listEvents(workItemId),
  ]);
  if (!itemResult.ok || itemResult.value.state !== 'failed') return { ok: false, reason: 'item_unavailable' };
  if (!eventsResult.ok) return { ok: false, reason: 'events_unavailable' };

  const lineage = await client
    .from('work_recovery_lineage')
    .select('recovery_sequence')
    .eq('original_work_item_id', workItemId);
  if (lineage.error) return { ok: false, reason: 'lineage_read_failed', message: lineage.error.message };
  const existingRecoverySequences = (lineage.data ?? []).map(row => row.recovery_sequence ?? 0);

  const planned = planDecompositionFromFailure({
    original: itemResult.value,
    assessment,
    events: eventsResult.value,
    existingRecoverySequences,
  });
  if (!planned.ok) return { ok: false, reason: planned.reason, refusals: planned.refusals };

  const persisted = await proposeRecoverySuccessor(client, itemResult.value, assessment, planned.plan.candidate);
  if (!persisted.ok) {
    if (persisted.code === 'candidate_invalid') return { ok: false, reason: 'candidate_invalid', gaps: persisted.gaps };
    return { ok: false, reason: 'persistence_failed', message: persisted.message };
  }
  return {
    ok: true,
    successorWorkItemId: persisted.successorWorkItemId,
    lineageId: persisted.lineageId,
    recoverySequence: persisted.recoverySequence,
    replayed: persisted.replayed,
  };
}
