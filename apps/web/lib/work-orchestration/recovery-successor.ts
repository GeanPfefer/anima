import {
  validateCorrectionSuccessor,
  validateRecoverySuccessor,
  type RecoverySuccessorCandidate,
  type RecoverySuccessorGap,
  type WorkItem,
  type WorkRecoveryAssessment,
} from '@anima/core';
import type { Database, Json } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ProposeRecoverySuccessorResult =
  | { readonly ok: true; readonly successorWorkItemId: string; readonly lineageId: string; readonly recoverySequence: number; readonly replayed: boolean }
  | { readonly ok: false; readonly code: 'candidate_invalid'; readonly gaps: readonly RecoverySuccessorGap[] }
  | { readonly ok: false; readonly code: 'persistence_failed' | 'response_invalid'; readonly message: string };

const proposalJson = (candidate: RecoverySuccessorCandidate): Json => ({
  schema_version: 1,
  data: {
    summary: candidate.proposal.data.summary,
    objective: candidate.proposal.data.objective,
    included_scope: [...candidate.proposal.data.includedScope],
    excluded_scope: [...candidate.proposal.data.excludedScope],
    expected_effects: [...candidate.proposal.data.expectedEffects],
    risks: [...candidate.proposal.data.risks],
  },
});
const object = (value: Json): Record<string, Json | undefined> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, Json | undefined> : null;

/** Boundary máximo `proposed`: nunca aprova, classifica, cria claim/attempt ou executa. */
export async function proposeRecoverySuccessor(
  client: SupabaseClient<Database>, original: WorkItem, assessment: WorkRecoveryAssessment,
  candidate: RecoverySuccessorCandidate,
): Promise<ProposeRecoverySuccessorResult> {
  const validation = validateRecoverySuccessor(original, assessment, candidate);
  if (!validation.valid) return { ok: false, code: 'candidate_invalid', gaps: validation.gaps };
  const result = await client.rpc('propose_recovery_successor', {
    p_original_work_item_id: original.id,
    p_recovery_sequence: candidate.recoverySequence,
    p_impact_level: candidate.impactLevel,
    p_capability: candidate.capability,
    p_intent: candidate.intent as unknown as Json,
    p_proposal: proposalJson(candidate),
    p_recovery_reason: candidate.recoveryReason,
    p_idempotency_key: candidate.idempotencyKey,
  });
  if (result.error) return { ok: false, code: 'persistence_failed', message: result.error.message };
  return readSuccessorEnvelope(result.data);
}

/** Boundary máximo `proposed`: correção por RETOMADA de uma revisão. Mesma RPC e
 * mesmo boundary do sucessor de recuperação; só a VALIDAÇÃO difere (revisão em vez
 * de falha — `validateCorrectionSuccessor` exige `changes_requested`). */
export async function proposeCorrectionSuccessor(
  client: SupabaseClient<Database>, original: WorkItem, candidate: RecoverySuccessorCandidate,
): Promise<ProposeRecoverySuccessorResult> {
  const validation = validateCorrectionSuccessor(original, candidate);
  if (!validation.valid) return { ok: false, code: 'candidate_invalid', gaps: validation.gaps };
  const result = await client.rpc('propose_recovery_successor', {
    p_original_work_item_id: original.id,
    p_recovery_sequence: candidate.recoverySequence,
    p_impact_level: candidate.impactLevel,
    p_capability: candidate.capability,
    p_intent: candidate.intent as unknown as Json,
    p_proposal: proposalJson(candidate),
    p_recovery_reason: candidate.recoveryReason,
    p_idempotency_key: candidate.idempotencyKey,
  });
  if (result.error) return { ok: false, code: 'persistence_failed', message: result.error.message };
  return readSuccessorEnvelope(result.data);
}

function readSuccessorEnvelope(data: Json): ProposeRecoverySuccessorResult {
  const root = object(data);
  const successorWorkItemId = root?.['successorWorkItemId'];
  const lineageId = root?.['lineageId'];
  const recoverySequence = root?.['recoverySequence'];
  const replayed = root?.['replayed'];
  if (typeof successorWorkItemId !== 'string' || typeof lineageId !== 'string'
      || typeof recoverySequence !== 'number' || typeof replayed !== 'boolean') {
    return { ok: false, code: 'response_invalid', message: 'A RPC de recovery retornou um envelope inválido.' };
  }
  return { ok: true, successorWorkItemId, lineageId, recoverySequence, replayed };
}

