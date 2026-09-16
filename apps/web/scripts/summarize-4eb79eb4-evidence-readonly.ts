import { resolveCliIdentity } from '@/cli/identity';
const ITEM='4eb79eb4-f6c4-40a5-b791-2e9d671a33c5';
async function main():Promise<void>{const identity=await resolveCliIdentity();if(!identity.ok)throw new Error(identity.error);const{client}=identity.identity;
 const result=await client.from('work_events').select('seq,event_type,payload').eq('work_item_id',ITEM).in('event_type',['checkpoint_recorded','result_submitted','host_observed_gate_evidence_recorded','host_observed_coder_evidence_recorded','verifier_opinion_recorded']).order('seq',{ascending:true});if(result.error)throw new Error(result.error.message);
 console.log(JSON.stringify(result.data,null,2));}
void main().catch(error=>{console.error(error instanceof Error?error.stack??error.message:String(error));process.exitCode=1;});
