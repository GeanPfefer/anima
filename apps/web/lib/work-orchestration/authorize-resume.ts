import { readHumanBudgetBlockedResumeAuthorization, readHumanResumeAuthorization, type HumanResumeAuthorization } from '@anima/core';
import type { Database, Json } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readWorkRetryReadiness } from './retry-readiness';

export type AuthorizeResumeResult =
  | { readonly ok: true; readonly authorizationId: string; readonly successorWorkItemId: string; readonly lineageId: string;
      readonly additionalAttempts: number; readonly aggregateCeiling: number; readonly previousConsumed: number; readonly replayed: boolean }
  | { readonly ok: true; readonly authorizationId: string; readonly workItemId: string; readonly additionalAttempts: 1;
      readonly budgetReason: string; readonly consumed: boolean; readonly replayed: boolean; readonly mode: 'budget_blocked_attempt' }
  | { readonly ok: false; readonly code: string; readonly message: string; readonly rejected: boolean };

export async function authorizeResume(client: SupabaseClient<Database>, id: string, input?: unknown): Promise<AuthorizeResumeResult> {
  const fail = (code: string, rejected = true): AuthorizeResumeResult => ({ ok: false, code, message: code, rejected });
  if (input === undefined) {
    const budgetStored = await client.from('work_budget_resume_authorizations').select('authority').eq('work_item_id',id).maybeSingle();
    if (budgetStored.error) return fail(budgetStored.error.message, false);
    if (budgetStored.data) input = budgetStored.data.authority;
    else {
      const stored = await client.from('work_resume_authorizations').select('authority').eq('predecessor_id',id).maybeSingle();
      if (stored.error) return fail(stored.error.message, false);
      input = stored.data?.authority;
    }
  }
  const budgetAuthority = readHumanBudgetBlockedResumeAuthorization(input);
  if (budgetAuthority) {
    const item = await client.from('work_items').select('proposal_version').eq('id',id).maybeSingle();
    if (item.error) return fail(item.error.message,false);
    if (!item.data) return fail('work_item_not_found');
    const {data,error} = await client.rpc('authorize_work_resume', {
      p_work_item_id:id,p_expected_proposal_version:item.data.proposal_version,p_authorization:budgetAuthority as unknown as Json,
    });
    if (error) return fail(error.message,['22023','55000','42501','23505','P0002'].includes(error.code));
    if (!data || typeof data!=='object' || Array.isArray(data)) return fail('response_invalid',false);
    const value=data as Record<string,unknown>;
    if (typeof value.authorizationId!=='string'||typeof value.workItemId!=='string'||value.additionalAttempts!==1
      ||typeof value.budgetReason!=='string'||typeof value.consumed!=='boolean'||typeof value.replayed!=='boolean'||value.mode!=='budget_blocked_attempt') return fail('response_invalid',false);
    return {ok:true,...value} as unknown as Extract<AuthorizeResumeResult,{mode:'budget_blocked_attempt'}>;
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
