import { resolveCliIdentity } from '@/cli/identity';
import { readPaidComputeBudgetAudit } from '@/lib/work-orchestration/paid-compute-authorization-store';
const AUTHORITY='3b87224f-071f-486d-88b8-a9dfe0259747';
async function main():Promise<void>{
  const identity=await resolveCliIdentity(); if(!identity.ok) throw new Error(identity.error);
  const before=await readPaidComputeBudgetAudit(identity.identity.client,AUTHORITY);
  if(!before.ok||!before.budget||!before.budget.ceiling||before.budget.ceiling.currency!=='USD'||before.budget.ceiling.amount!==1.5) throw new Error('ledger invariant unavailable');
  const {data,error}=await identity.identity.client.rpc('raise_paid_compute_hourly_limit_to_usd_1' as never,{authorization_id:AUTHORITY} as never);
  if(error) throw error;
  const after=await readPaidComputeBudgetAudit(identity.identity.client,AUTHORITY);
  if(!after.ok||!after.budget||!after.budget.ceiling||after.budget.committed!==before.budget.committed||after.budget.ceiling.amount!==1.5) throw new Error('ledger changed during amendment');
  console.log(JSON.stringify({result:data,authorityId:AUTHORITY,maxHourlyPrice:{currency:'USD',amount:1},ledger:{ceiling:after.budget.ceiling,committed:after.budget.committed,remaining:after.budget.remaining}},null,2));
}
void main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
