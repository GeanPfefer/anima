process.env.ANIMA_COMPUTE_ROUTER_V1_ENABLED='1';
process.env.ANIMA_ON_DEMAND_NODE_ENABLED='false';
process.env.ANIMA_CODER_VRAM_GB='16';
process.env.ANIMA_CODER_MODEL_ALLOWLIST=JSON.stringify([{model:'qwen3-coder:latest',requiresGb:20}]);
import { resolveCliIdentity } from '@/cli/identity';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import { ensurePlannedProjectClassification } from '@/lib/work-orchestration/planned-project-classification';
import { runProjectBacklogHostTurn } from '@/lib/work-orchestration/backlog-host-turn-run';
const ID='8021c1ce-6ad6-4038-b30e-183805f2e7f9', VERSION=3;
const log=(v:unknown)=>console.log(JSON.stringify(v,null,2));
async function main(){
 const identity=await resolveCliIdentity(); if(!identity.ok) throw new Error(identity.error); const {client,userId}=identity.identity;
 const service=createWorkOrchestrationService(client);
 const approved=await service.resolveApproval({workItemId:ID,expectedProposalVersion:VERSION,decision:{type:'approve'}}); if(!approved.ok) throw new Error(`${approved.error.code}: ${approved.error.message}`);
 log({step:'approved',userId,workItemId:ID,version:VERSION});
 const classified=await ensurePlannedProjectClassification(client,ID,VERSION); if(!classified.ok) throw new Error(`${classified.code}: ${classified.message}`); log({step:'classified',replayed:(classified as {replayed?:boolean}).replayed??false});
 const controller=new AbortController(); for(const sig of ['SIGINT','SIGTERM'] as const) process.on(sig,()=>controller.abort());
 const result=await runProjectBacklogHostTurn({client,ownerInstanceId:`selfdev-ponto2-${ID}`,maxTurnsPerCycle:1,maxCycles:1,signal:controller.signal,requestedWorkItemId:ID});
 log({step:'host-turn:result',continuation:result.continuation,stopReason:result.stopReason,cyclesExecuted:result.cyclesExecuted,itemsTouched:result.itemsTouched,notExecutableReason:result.notExecutableReason??null,cycles:result.cycles.map(c=>({turnsExecuted:c.turnsExecuted,stopReason:c.stopReason,lastOutcome:c.lastOutcome,notExecutableReason:c.notExecutableReason??null,turns:c.turns.map(t=>({workItemId:t.workItemId,outcome:t.outcome,refusal:t.refusal??null}))}))});
}
void main().catch(e=>{console.error(e instanceof Error?e.stack??e.message:String(e));process.exitCode=1});
