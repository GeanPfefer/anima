import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

export type WorkRetryReadiness = {
  readonly status: 'RETRY_READY' | 'BLOCKED'; readonly reason: string | null;
  readonly attemptsUsed: number; readonly maxAttempts: number; readonly remainingAttempts: number;
  readonly sourceAttemptId: string | null; readonly failureEventId: string | null; readonly proposalVersion: number;
};

const blocked = (): WorkRetryReadiness => ({ status:'BLOCKED',reason:'read_failed',attemptsUsed:0,maxAttempts:0,remainingAttempts:0,sourceAttemptId:null,failureEventId:null,proposalVersion:0 });
export async function readWorkRetryReadiness(client:SupabaseClient<Database>,workItemId:string):Promise<WorkRetryReadiness>{
  const result=await client.rpc('current_work_retry_readiness',{p_work_item_id:workItemId});
  if(result.error||!result.data||typeof result.data!=='object'||Array.isArray(result.data))return blocked();
  return result.data as unknown as WorkRetryReadiness;
}
