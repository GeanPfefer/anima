import { readReplanDiagnosis, replanDiagnosisJson, deriveReplanStrategy, type ReplanStrategy } from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readWorkRetryReadiness } from './retry-readiness';

export type ReplanResult =
  | { readonly ok: true; readonly successorWorkItemId: string; readonly lineageId: string;
      readonly replanId: string; readonly replayed: boolean; readonly allocatedAttempts: number;
      readonly strategy: readonly ReplanStrategy[] }
  | { readonly ok: false; readonly code: string; readonly message: string; readonly rejected: boolean };
const failed = (code: string, rejected = true): ReplanResult => ({ ok:false, code, message:code, rejected });

/** Auth/RLS client; a RPC deriva o successor e revalida os fatos sob lock. Sem aprovação. */
export async function replanFailedWorkItem(
  client: SupabaseClient<Database>, workItemId: string, suppliedDiagnosis?: unknown,
): Promise<ReplanResult> {
  let input = suppliedDiagnosis;
  if (input === undefined) {
    const stored = await client.from('work_replans').select('diagnosis').eq('predecessor_id',workItemId).maybeSingle();
    if (stored.error) return failed(stored.error.message,false);
    input = stored.data?.diagnosis;
  }
  const diagnosis = readReplanDiagnosis(input);
  if (!diagnosis) return failed('diagnosis_required_or_invalid');
  const readiness = await readWorkRetryReadiness(client, workItemId);
  if (readiness.reason === 'read_failed') return failed('read_failed',false);
  if (!readiness.failureEventId) return failed('failure_missing');
  const result = await client.rpc('replan_failed_work', {
    p_work_item_id:workItemId, p_expected_proposal_version:readiness.proposalVersion,
    p_failure_event_id:readiness.failureEventId, p_diagnosis:replanDiagnosisJson(diagnosis),
  });
  if (result.error) return failed(result.error.message,['55000','22023','42501','23505'].includes(result.error.code));
  const data = result.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return failed('response_invalid',false);
  if (typeof data.successorWorkItemId !== 'string' || typeof data.lineageId !== 'string'
    || typeof data.replanId !== 'string' || typeof data.replayed !== 'boolean'
    || typeof data.allocatedAttempts !== 'number') return failed('response_invalid',false);
  return {ok:true, successorWorkItemId:data.successorWorkItemId,lineageId:data.lineageId,
    replanId:data.replanId,replayed:data.replayed,allocatedAttempts:data.allocatedAttempts,
    strategy:deriveReplanStrategy(diagnosis)};
}
