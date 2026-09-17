import { resolveCliIdentity } from '@/cli/identity';
import { readPaidComputeBudgetAudit } from '@/lib/work-orchestration/paid-compute-authorization-store';
const ID='8021c1ce-6ad6-4038-b30e-183805f2e7f9', AUTH='b899c45b-2806-4a5e-98ed-000cdb0d01c1';
async function main(){const identity=await resolveCliIdentity();if(!identity.ok)throw new Error(identity.error);const {client}=identity.identity;const events=await client.from('work_events').select('id,event_type,payload,created_at,proposal_version').eq('work_item_id',ID).order('created_at',{ascending:true});if(events.error)throw events.error;const audit=await readPaidComputeBudgetAudit(client,AUTH);console.log(JSON.stringify({events:(events.data??[]).map(e=>({id:e.id,type:e.event_type,proposalVersion:e.proposal_version,createdAt:e.created_at,payload:e.payload})),audit},null,2));}
void main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1});
