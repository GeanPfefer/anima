import { WorkOrchestrationService, buildProposalRevision, interpretWorkRequest, isWorkContinuation, isWorkHistoryQuery, presentWorkItem, resolveWorkFocus, type ApprovalDecision, type ResultReviewDecision, type WorkItem, type WorkPresentation, type WorkResultValidation } from '@anima/core';
import { SupabaseWorkOrchestrationRepository } from '@anima/supabase';
import { supabase } from './supabase';
import { shouldRequestHostResume } from './mobile-history';
import { callHostSupervisorTurn } from './mobile-host';
const service=()=>new WorkOrchestrationService(new SupabaseWorkOrchestrationRepository(supabase));
const required=<T>(result:{ok:true;value:T}|{ok:false;error:{message:string}}):T=>{if(!result.ok)throw new Error(result.error.message);return result.value};
async function presentation(item:WorkItem):Promise<WorkPresentation>{const events=required(await service().listEvents(item.id));return presentWorkItem(item,events)}
export type MobileWorkRouting={kind:'none'}|{kind:'proposal';presentation:WorkPresentation}|{kind:'history';presentations:readonly WorkPresentation[]}|{kind:'continued';workItemId:string}|{kind:'focus_confirmation_required';sourceMessageId:string;candidates:readonly{id:string;summary:string}[]}|{kind:'error';message:string};

export async function routeWorkMessage(message:string,sourceMessageId:string):Promise<MobileWorkRouting>{
  const interpretation=interpretWorkRequest(message,sourceMessageId);
  if(interpretation.kind==='work_candidate'){const created=required(await service().createProposal(interpretation.command));await setWorkFocus(created.id);return{kind:'proposal',presentation:await presentation(created)}}
  // UX-04 — reencontrar o próprio trabalho aberto pela conversa. Avaliada ANTES da
  // continuação: um pedido genérico de listar/retomar mostra tudo em aberto (isolado
  // por RLS) em vez de focar um referente específico. Reconstrói a MESMA projeção.
  if(interpretation.kind==='conversation'&&isWorkHistoryQuery(message)){
    const items=required(await service().findResumableWorkItems());
    const presentations=await Promise.all(items.map(item=>presentation(item)));
    return{kind:'history',presentations};
  }
  if(interpretation.kind!=='conversation'||!isWorkContinuation(message))return{kind:'none'};
  const{data:focus}=await supabase.from('work_focus').select('work_item_id').maybeSingle();
  const{data:candidates,error}=await supabase.from('work_items').select('id,original_request,proposal,proposal_version').in('state',['proposed','approved','in_progress','blocked','review','changes_requested']).order('updated_at',{ascending:false}).limit(5);if(error)throw error;
  const resolution=resolveWorkFocus((candidates??[]).map(item=>item.id),focus?.work_item_id??undefined);
  if(resolution.kind==='focused'){const selected=candidates!.find(item=>item.id===resolution.itemId)!;await setWorkFocus(selected.id);required(await service().attachContext({workItemId:selected.id,expectedProposalVersion:selected.proposal_version,references:[{kind:'message',id:sourceMessageId}]}));return{kind:'continued',workItemId:selected.id}}
  if(resolution.kind==='confirmation_required')return{kind:'focus_confirmation_required',sourceMessageId,candidates:candidates!.filter(item=>resolution.itemIds.includes(item.id)).map(item=>({id:item.id,summary:(item.proposal as {data?:{summary?:string}}).data?.summary??item.original_request}))};
  return{kind:'none'};
}
export async function loadWorkItems(sourceMessageIds:readonly string[]):Promise<Record<string,WorkPresentation>>{const entries=await Promise.all(sourceMessageIds.map(async sourceMessageId=>{const result=required(await service().findItemsBySourceMessageId(sourceMessageId));const item=result.at(-1);return item?[sourceMessageId,await presentation(item)]as const:null}));return Object.fromEntries(entries.filter((entry):entry is readonly[string,WorkPresentation]=>entry!==null))}
// Reconciliação após falha de mutação: relê o estado real para que o retry
// parta da versão atual em vez de repetir uma versão obsoleta.
export async function reloadWork(workItemId:string):Promise<WorkPresentation>{return presentation(required(await service().getItem(workItemId)))}
export async function getWorkFocus():Promise<string|null>{const{data,error}=await supabase.from('work_focus').select('work_item_id').maybeSingle();if(error)throw error;return data?.work_item_id??null}
export async function setWorkFocus(workItemId:string):Promise<void>{const{error}=await supabase.rpc('set_work_focus',{work_item_id:workItemId});if(error)throw error}
// Resposta do usuário à pergunta de ambiguidade: fixa o foco escolhido e
// vincula a mensagem original ao item, preservando a proveniência da decisão.
export async function confirmWorkFocus(workItemId:string,sourceMessageId:string):Promise<void>{
  await setWorkFocus(workItemId);
  const item=required(await service().getItem(workItemId));
  required(await service().attachContext({workItemId,expectedProposalVersion:item.proposalVersion,references:[{kind:'message',id:sourceMessageId}]}));
}
export async function decideWork(value:WorkPresentation,decision:ApprovalDecision):Promise<WorkPresentation>{return presentation(required(await service().resolveApproval({workItemId:value.item.id,expectedProposalVersion:value.item.proposalVersion,decision})))}
export async function requestProposalCorrection(value:WorkPresentation,requestedChanges:string):Promise<WorkPresentation>{const revision=buildProposalRevision(value.item,requestedChanges);return presentation(required(await service().requestProposalRevision({workItemId:value.item.id,expectedProposalVersion:value.item.proposalVersion,...revision})))}
export async function startWork(value:WorkPresentation):Promise<WorkPresentation>{return presentation(required(await service().startWork({workItemId:value.item.id,expectedProposalVersion:value.item.proposalVersion})))}
export async function submitWorkResult(value:WorkPresentation,summary:string,references:readonly string[],validations:readonly WorkResultValidation[]=[],limitations:readonly string[]=[]):Promise<WorkPresentation>{return presentation(required(await service().submitResult({workItemId:value.item.id,expectedProposalVersion:value.item.proposalVersion,result:{summary,resultReferences:references,validations,limitations}})))}
export async function reviewWorkResult(value:WorkPresentation,decision:ResultReviewDecision):Promise<WorkPresentation>{if(!value.latestResult)throw new Error('Resultado indisponível para revisão.');return presentation(required(await service().reviewResult({workItemId:value.item.id,expectedProposalVersion:value.item.proposalVersion,reviewedResultEventId:value.latestResult.eventId,decision})))}
// Resposta à decisão (idempotente no banco: repetir a mesma opção NÃO cria um 2º
// input_provided). Devolve a projeção real relida e se a retomada executora deve
// ser pedida ao host — nunca inventa estado otimista.
export async function respondWorkDecision(value:WorkPresentation,optionId:string):Promise<{presentation:WorkPresentation;resumeRequested:boolean}>{
  if(!value.pendingDecision)throw new Error('Decisão pendente indisponível.');
  const effect=value.pendingDecision.options.find(option=>option.id===optionId)?.effect;
  const{data,error}=await supabase.rpc('respond_to_work_decision',{
    p_work_item_id:value.item.id,
    p_expected_proposal_version:value.pendingDecision.proposalVersion,
    p_input_requested_event_id:value.pendingDecision.requestEventId,
    p_option_id:optionId,
  });
  if(error)throw error;
  const state=(data as {state?:string}|null)?.state??'';
  return{presentation:await reloadWork(value.item.id),resumeRequested:shouldRequestHostResume(effect,state)};
}

// Pede ao HOST exatamente uma volta do Supervisor (retomada canônica pelo
// checkpoint). Não executa nada no dispositivo; relê a projeção persistida
// depois. Falha do host é tipada e NÃO desfaz a decisão já registrada.
export async function requestHostSupervisorTurn(value:WorkPresentation):Promise<WorkPresentation>{
  await callHostSupervisorTurn(value.item.id,value.item.proposalVersion);
  return reloadWork(value.item.id);
}
