import { resolveCliIdentity } from '@/cli/identity';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import { runWorkReview } from '@/cli/app';
const ITEM='4eb79eb4-f6c4-40a5-b791-2e9d671a33c5';
const REASON=[
'REQUEST_CHANGES (decisão humana): output 5fad667 semanticamente rejeitado; B1/B2/B3 não satisfeitos.',
'Rework autorizado somente em:',
'- apps/web/lib/work-orchestration/post-turn-observation.ts',
'- apps/web/lib/work-orchestration/post-turn-observation.test.ts',
'- apps/web/lib/work-orchestration/autonomous-backlog-deps.ts',
'- apps/web/lib/work-orchestration/autonomous-backlog-deps-router.test.ts',
'B1: remova actualCostUsd e a RPC fictícia settle_openai_actual_cost. Use reservation pelo lease provider-api:<attemptId>, usage terminal provider-reported, provider/model/cohort, ProviderPricingV1, settleOpenAIActualCostReservation, OpenAISettlementAuditV1 e adapte para settlePaidComputeBudgetReservation(client,{reservationId,settled:audit.actualCost,costSource}). Pricing null mantém cost_unknown sem settlement.',
'B2: altere materialmente autonomous-backlog-deps.ts para propagar os fatos reais do caller buildProjectBacklogCycleDeps(...).runTurn até adapter→primitive→store.',
'B3: testes fortes sem any e sem hook vazio: pricing conhecido/null, usage ausente, pricing inválido, over-reservation, replay, provider/model/moeda incompatíveis, correlação attempt↔reservation, caller vivo até store, Ollama/RunPod intocados.',
'Contrato anti-hallucination: proibido nova RPC/tabela/migration/protocolo, actualCostUsd do caller, nomes substitutos ou any. Se API real faltar, pare com evidência; não invente.',
'Referência técnica read-only autorizada: diff ccb7dcc..0bea4c8 (af313c3 como HEAD validado). É especificação concreta, não output; proibido cherry-pick/merge/promoção/cópia automática.',
].join('\n');
async function main():Promise<void>{const identity=await resolveCliIdentity();if(!identity.ok)throw new Error(identity.error);const service=createWorkOrchestrationService(identity.identity.client);const result=await runWorkReview(service,ITEM,{type:'request_changes',requestedChanges:REASON});console.log(JSON.stringify(result,null,2));}
void main().catch(error=>{console.error(error instanceof Error?error.stack??error.message:String(error));process.exitCode=1;});
