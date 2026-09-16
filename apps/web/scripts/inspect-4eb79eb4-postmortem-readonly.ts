import { resolveCliIdentity } from '@/cli/identity';
import { readPaidComputeBudgetAudit } from '@/lib/work-orchestration/paid-compute-authorization-store';
const ITEM='4eb79eb4-f6c4-40a5-b791-2e9d671a33c5'; const AUTH='7bd202af-c649-4efe-b70a-43e7a27d8ae0';
async function main():Promise<void>{
 const identity=await resolveCliIdentity();if(!identity.ok)throw new Error(identity.error);const{client}=identity.identity;
 const [item,events,claims,budgetEvents]=await Promise.all([
  client.from('work_items').select('state,proposal_version,updated_at,intent,proposal').eq('id',ITEM).single(),
  client.from('work_events').select('seq,event_type,proposal_version,created_at,payload').eq('work_item_id',ITEM).order('seq',{ascending:true}),
  client.from('work_claims').select('*').eq('work_item_id',ITEM),
  client.from('paid_compute_budget_events').select('*').eq('authorization_id',AUTH).order('created_at',{ascending:true}),
 ]);
 if(item.error||events.error||claims.error||budgetEvents.error)throw new Error(item.error?.message??events.error?.message??claims.error?.message??budgetEvents.error?.message);
 console.log(JSON.stringify({item:item.data,claims:claims.data,ledger:await readPaidComputeBudgetAudit(client,AUTH),budgetEvents:budgetEvents.data,events:events.data},null,2));
}
void main().catch(error=>{console.error(error instanceof Error?error.stack??error.message:String(error));process.exitCode=1;});
