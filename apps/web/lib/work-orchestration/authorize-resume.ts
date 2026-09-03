import { readHumanResumeAuthorization, type HumanResumeAuthorization } from '@anima/core';
import type { Database, Json } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readWorkRetryReadiness } from './retry-readiness';

export type AuthorizeResumeResult =
  | { readonly ok: true; readonly authorizationId: string; readonly successorWorkItemId: string; readonly lineageId: string;
      readonly additionalAttempts: number; readonly aggregateCeiling: number; readonly previousConsumed: number; readonly replayed: boolean }
  | { readonly ok: false; readonly code: string; readonly message: string; readonly rejected: boolean };

export async function authorizeResume(client: SupabaseClient<Database>, id: string, input?: unknown): Promise<AuthorizeResumeResult> {
  const fail = (code: string, rejected = true): AuthorizeResumeResult => ({ ok: false, code, message: code, rejected });
  if (input === undefined) {
    const stored = await client.from('work_resume_authorizations').select('authority').eq('predecessor_id',id).maybeSingle();
    if (stored.error) return fail(stored.error.message, false);
    input = stored.data?.authority;
  }
  const authority: HumanResumeAuthorization | null = readHumanResumeAuthorization(input);
  if (!authority) return fail('authorization_required_or_invalid');
  const ready = await readWorkRetryReadiness(client, id);
  if (ready.reason === 'read_failed') return fail('read_failed',false);
  if (!ready.failureEventId) return fail('failure_missing');
  const {data,error} = await client.rpc('authorize_work_resume', {
    p_work_item_id:id, p_expected_proposal_version:ready.proposalVersion, p_failure_event_id:ready.failureEventId,
    p_authorization:authority as unknown as Json,
  });
  if (error) return fail(error.message,['22023','55000','42501','23505'].includes(error.code));
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.authorizationId !== 'string'
    || typeof data.successorWorkItemId !== 'string' || typeof data.lineageId !== 'string'
    || typeof data.additionalAttempts !== 'number' || typeof data.aggregateCeiling !== 'number'
    || typeof data.previousConsumed !== 'number' || typeof data.replayed !== 'boolean') return fail('response_invalid',false);
  return {ok:true,authorizationId:data.authorizationId,successorWorkItemId:data.successorWorkItemId,lineageId:data.lineageId,
    additionalAttempts:data.additionalAttempts,aggregateCeiling:data.aggregateCeiling,previousConsumed:data.previousConsumed,replayed:data.replayed};
}
