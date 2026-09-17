import { resolveCliIdentity } from '@/cli/identity';
import { correctReviewedWorkItem } from '@/lib/work-orchestration/review-correction-orchestration';
const ITEM='4eb79eb4-f6c4-40a5-b791-2e9d671a33c5';
async function main():Promise<void>{const identity=await resolveCliIdentity();if(!identity.ok)throw new Error(identity.error);const result=await correctReviewedWorkItem(identity.identity.client,ITEM);if(!result.ok)throw new Error(`${result.reason}: ${result.message??''} ${(result.refusals??[]).join(',')}`);const item=await identity.identity.client.from('work_items').select('state,proposal_version,impact_level,capability,intent,proposal').eq('id',result.successorWorkItemId).single();console.log(JSON.stringify({result,item:item.data},null,2));}
void main().catch(error=>{console.error(error instanceof Error?error.stack??error.message:String(error));process.exitCode=1;});
