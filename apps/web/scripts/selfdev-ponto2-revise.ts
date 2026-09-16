process.env.ANIMA_AI_PROVIDER = 'openai';
process.env.ANIMA_WORKTREE_CODER_BACKEND = 'openai';
import type { CreateWorkProposalCommand } from '@anima/core';
import { resolveCliIdentity } from '@/cli/identity';
import { OpenAIProjectWorkPlanner, planExecutableProjectWork } from '@/lib/ai/project-work-planner';
import { createOpenAIPlannerAdmission } from '@/lib/work-orchestration/openai-paid-compute';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import { readExecutionContract } from '@/lib/work-orchestration/executor-selection';
const WORK_ITEM_ID='8021c1ce-6ad6-4038-b30e-183805f2e7f9';
const EXPECTED_VERSION=2;
const MODEL=process.env.OPENAI_MODEL ?? 'gpt-5.6-terra';
const MESSAGE=[
  'Planeje diretamente com os seams e arquivos fornecidos abaixo; não gaste o limite de tools redescobrindo o repositório.',
  'REVISE o Ponto 2 porque a proposta v2 ficou insuficiente: alterar apenas compute-economics.ts NÃO implementa actual-cost settlement.',
  'A proposta terminal deve obrigatoriamente incluir o seam web que, após uma attempt OpenAI terminal e após persistir/obter a usage provider-reported, calcula o custo com ProviderPricingV1 explícito/versionado e chama settlePaidComputeBudgetReservation usando a reservationId admitida. O caminho deve persistir evidence/auditoria reproduzível e manter reserva aberta em qualquer falta ou inconsistência.',
  'Autorize no escopo os arquivos mínimos necessários entre: packages/core/src/compute-economics.ts e seu teste; apps/web/lib/work-orchestration/openai-paid-compute.ts e teste; um novo módulo focal openai-actual-cost-settlement.ts e seu teste; post-turn-observation.ts e teste ou o ponto terminal equivalente comprovado no código. Inclua autonomous-backlog-deps.ts somente se for de fato o seam terminal mínimo. Não toque autonomous-backlog-deps-router.test.ts.',
  'Exija testes de wiring que provem: reservationId correlacionada ao attempt; usage real agregada; pricing provider/model/currency/sourceRef/effectiveFrom; amount <= reserved; chamada de settlement uma vez; replay idempotente; pricing/usage ausente ou inválido e over-reservation não chamam RPC e mantêm reserva aberta; Ollama e RunPod permanecem intactos.',
  'Não inclua migration se a evidence existente bastar. Não faça settlement histórico de c0edc775. Não inclua Verifier v2 nem Ponto 1. Use expected_effects e covers exatamente alinhados e gates focais reais para core e web.',
  'Escopo máximo permitido: packages/core/src/compute-economics.ts; packages/core/src/compute-economics.test.ts; apps/web/lib/work-orchestration/openai-paid-compute.ts; apps/web/lib/work-orchestration/openai-paid-compute.test.ts; apps/web/lib/work-orchestration/gpt-coder.ts; apps/web/lib/work-orchestration/gpt-coder.test.ts; apps/web/lib/work-orchestration/worktree-executor.ts; apps/web/lib/work-orchestration/worktree-executor.test.ts; apps/web/lib/work-orchestration/post-turn-observation.ts; apps/web/lib/work-orchestration/post-turn-observation.test.ts; e, se preferir separar a lógica, openai-actual-cost-settlement.ts + teste. Selecione somente o subconjunto mínimo que feche o wiring.',
].join(' ');
const log=(v:unknown)=>console.log(JSON.stringify(v,null,2));
async function main(){
 const identity=await resolveCliIdentity(); if(!identity.ok) throw new Error(identity.error);
 const {client,userId}=identity.identity; const service=createWorkOrchestrationService(client);
 const source=await client.from('ai_conversations').insert({user_id:userId,role:'user',content:MESSAGE}).select('id').single(); if(source.error||!source.data) throw new Error(source.error?.message??'source missing');
 const base:CreateWorkProposalCommand={sourceMessageId:source.data.id,impactLevel:'low',capability:'programming',intent:{},proposal:{schemaVersion:1,data:{summary:'Revisar Ponto 2 para incluir wiring real.',objective:'Implementar actual-cost settlement fim a fim.',includedScope:['(planner deve definir)'],excludedScope:['Verifier v2','Ponto 1','origin/main'],expectedEffects:['Settlement OpenAI real será ligado ao lifecycle.'],risks:['Settlement incorreto deve falhar fechado.']}}};
 const planned=await planExecutableProjectWork(MESSAGE,base,new OpenAIProjectWorkPlanner({admission:createOpenAIPlannerAdmission(client,WORK_ITEM_ID),userId,model:MODEL})); if(!planned.ok) throw new Error(planned.message);
 const revised=await service.reviseProposal({workItemId:WORK_ITEM_ID,expectedProposalVersion:EXPECTED_VERSION,intent:planned.command.intent,proposal:planned.command.proposal}); if(!revised.ok) throw new Error(`${revised.error.code}: ${revised.error.message}`);
 const criteria=((planned.command.intent as {execution_spec?:{validation_criteria?:{label:string;command?:string;proof?:string;covers?:string[]}[]}}).execution_spec?.validation_criteria)??[]; const effects=planned.command.proposal.data.expectedEffects??[]; const set=new Set(effects); const unknown=criteria.flatMap(c=>(c.covers??[]).filter(x=>!set.has(x))); const uncovered=effects.filter(e=>!criteria.some(c=>(c.covers??[]).includes(e))); const spec=readExecutionContract(planned.command.intent);
 log({workItemId:WORK_ITEM_ID,terminalVersion:revised.value.proposalVersion,coderBackend:spec.coderBackend,includedScope:planned.command.proposal.data.includedScope,excludedScope:planned.command.proposal.data.excludedScope,expectedEffects:effects,validationCriteria:criteria,ALIGNMENT:{unknown,uncovered,aligned:!unknown.length&&!uncovered.length}});
}
void main().catch(e=>{console.error(e instanceof Error?e.stack??e.message:String(e));process.exitCode=1});
