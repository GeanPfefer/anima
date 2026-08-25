import type { Json } from '@anima/types';
import type { WorkEvent, WorkItem, WorkResultValidation, WorkResultValidationOutcome } from './types';
import { HUMAN_INTERRUPTION_REASONS, type AutonomousLimitKind, type HumanInterruptionReason } from './human-interruption';
import type { WorkBudgetReason } from './work-budget';
import { projectIntegrationBoundary, type WorkIntegrationDecision } from './integration-decision';
import {parseBranchPublicationReceipt,parseReviewRequestReceipt} from './protected-integration';
import { projectWorktreeHandoff } from './worktree-handoff';
import { projectHostObservedEvidence, type HostObservedGitEvidenceV1 } from './host-observed-evidence';
import { projectHostObservedGateEvidence, type HostObservedGateEvidenceV1 } from './host-observed-gate-evidence';
import { verifyPersistedWorkResult, type WorkVerificationReport } from './work-verification';
import { projectVerifierOpinionHistory, type VerifierOpinionV1 } from './verifier-opinion';
import { deriveCoderWorkloadCostObservationsFromEvents, deriveWorkloadCostObservationsFromEvents } from './resource-observation';
import { buildCostDistribution, type CostDistribution } from './resource-classification';
import { projectWorkloadCostProfiles, type WorkloadCostProfile } from './resource-history';

// null distingue "não informado" de lista vazia: a UI deve declarar a ausência
// explicitamente, nunca preencher o vazio com o texto livre do autor.
export interface WorkResultProjection {
  readonly eventId: string;
  readonly proposalVersion: number;
  readonly author: WorkEvent['author'];
  readonly summary: string;
  readonly references: readonly string[];
  readonly validations: readonly WorkResultValidation[] | null;
  readonly limitations: readonly string[] | null;
  // Referência de handoff do resultado (UX-03). Persistida pelo terminal do
  // executor (autônomo/comandado) como data.handoff_reference; null quando o
  // resultado não a informa. A UI declara a ausência, nunca a inventa.
  readonly handoffReference: string | null;
}
export type WorkAction = 'approve'|'reject'|'defer'|'revise_proposal'|'start'|'submit_result'|'accept_result'|'request_result_changes';
export interface WorkProvenanceProjection { readonly status:'complete'|'incomplete'; readonly issues:readonly string[]; }

// UX-01 — projeção do cartão de execução autônoma. É PURA e derivada apenas do
// item e dos eventos persistidos: o cliente nunca inventa estado. Ausente
// (null) quando não há tentativa autônoma (execution_started com claim_id).
export type ExecutionControlAction = 'pause'|'cancel';
export type AutonomousExecutionStatus = 'running'|'paused'|'cancelled'|'abandoned'|'submitted_for_review'|'failed'|'blocked';
export interface ExecutionCheckpointProjection { readonly signalSequence:number; readonly completedSteps:number; readonly remainingSteps:number; readonly nextStep:string; }
export interface ExecutionControlRequestProjection { readonly action:ExecutionControlAction; readonly requestedAt:string; }
export interface ExecutionControlAppliedProjection { readonly action:ExecutionControlAction; readonly reason:string; readonly appliedAt:string; }
// `recoverable`: o bloqueio é um limite TEMPORAL de janela móvel (INTEL-04) que
// se recupera esperando — a tentativa é RETOMADA do checkpoint quando a janela
// libera, sem decisão humana. Distingue-o de bloqueios não-orçamentários (ex.:
// decisão humana), que exigem outra ação.
export interface ExecutionBudgetBlockProjection { readonly reason:string; readonly reachedLimit:string|null; readonly recoverable:boolean; }
export interface AutonomousExecutionProjection {
  readonly attemptId:string;
  readonly status:AutonomousExecutionStatus;
  readonly startedAt:string;
  readonly executorId:string|null;
  readonly providerRef:string|null;
  readonly modelRef:string|null;
  readonly effort:string|null;
  readonly limits:{readonly maxAttempts:number|null; readonly maxDurationMinutes:number|null};
  readonly latestCheckpoint:ExecutionCheckpointProjection|null;
  readonly pendingControl:ExecutionControlRequestProjection|null;
  readonly appliedControl:ExecutionControlAppliedProjection|null;
  readonly budgetBlock:ExecutionBudgetBlockProjection|null;
  // Derivado, não inventado: só cabe pedir controle quando a tentativa corre e
  // não há pedido pendente. O cartão nunca decide isso por conta própria.
  readonly canRequestControl:boolean;
}
export interface WorkDecisionOptionProjection { readonly id:string; readonly label:string; readonly effect:'resume'|'cancel'; }
export interface WorkDecisionProjection {
  readonly requestEventId:string;
  readonly attemptId:string;
  readonly proposalVersion:number;
  readonly reason:HumanInterruptionReason;
  readonly explanation:string;
  readonly options:readonly WorkDecisionOptionProjection[];
  readonly checkpointReference:string;
}
// INTEL-04 (coerência V0). Um item bloqueado por orçamento PRÉ-tentativa não é
// uma decisão humana: é um estado TEMPORAL que volta a ser elegível quando a
// janela móvel do orçamento libera. Esta projeção o declara honestamente para a
// UI (nunca um cartão de decisão, que `projectPendingWorkDecision` corretamente
// ignora). Read-only; não decide nem oferece override do teto.
export interface WorkBudgetWaitProjection {
  readonly reason: WorkBudgetReason;
  readonly reachedLimit: AutonomousLimitKind;
}
export interface WorkIntegrationProjection {
  readonly status:'awaiting_decision'|'authorized'|'branch_published'|'review_request_created'|'refused';
  readonly acceptedResultEventId:string;
  readonly decision:WorkIntegrationDecision|null;
  readonly availableDecisions:readonly WorkIntegrationDecision[];
  readonly publication?:{readonly repositoryId:string;readonly remoteName:string;readonly remoteBranch:string;readonly commitSha:string}|null;
  // Estado posterior do protocolo: review request (PR) criado e persistido.
  // Só é preenchido quando o fato review_request_created existe e casa a
  // autorização; nunca afirma merge ou integração.
  readonly reviewRequest?:{readonly repositoryId:string;readonly remoteName:string;readonly reviewReference:string;readonly reviewId:string;readonly sourceBranch:string;readonly sourceCommitSha:string;readonly baseBranch:string}|null;
}
export interface WorkPresentation { readonly item: WorkItem; readonly latestResult: WorkResultProjection|null; readonly acceptedResult: WorkResultProjection|null; readonly latestEventType:WorkEvent['type']|null; readonly availableActions:readonly WorkAction[]; /** Oferta read-only; a RPC autoritativa ainda valida claims e concorrência. */ readonly manualReleaseAvailable:boolean; /** Fase humana projetada dos fatos (presentWorkItem sempre a preenche; opcional para não quebrar projeções/fixtures antigas). */ readonly progress?:WorkProgressPhaseProjection; readonly provenance?:WorkProvenanceProjection; readonly execution?:AutonomousExecutionProjection|null; readonly pendingDecision?:WorkDecisionProjection|null; readonly pendingBudgetWait?:WorkBudgetWaitProjection|null; readonly integration?:WorkIntegrationProjection|null; readonly verification?:WorkVerificationReport|null;
  // Histórico append-only dos pareceres do Verifier persistidos (auditoria). Só
  // presente quando há ao menos um; read-only, nunca altera ações nem decide.
  readonly opinionHistory?:readonly VerifierOpinionV1[];
  // Fatos BRUTOS que o host observou de forma independente (git e gate), ao lado do
  // parecer que os interpreta. Auditoria read-only; só presente quando há alguma
  // evidência observada. Nunca altera ações nem substitui a atestação por si só.
  readonly observedEvidence?:{ readonly git:HostObservedGitEvidenceV1|null; readonly gates:HostObservedGateEvidenceV1|null };
  // Resource Governor V0 (leitura): custo derivado dos workloads observados deste item —
  // gates (durationMs por gate) E coder (duração wall-clock de backend.edit()) → perfis por
  // workload + classe relativa à distribuição do próprio item. Gate e coder ficam em perfis
  // SEPARADOS (chave por workloadKind). Auditoria read-only (EVIDÊNCIA + HISTÓRICO +
  // CLASSIFICAÇÃO); NÃO traz advisory, que depende do snapshot vivo da máquina e vive no seam
  // host-side. Só presente quando há ao menos um workload observado. Nunca altera ações nem decide.
  readonly resourceCost?:WorkResourceCostProjection; }

export interface WorkResourceCostProjection { readonly distribution:CostDistribution; readonly profiles:readonly WorkloadCostProfile[]; }
/** Projeta o custo de recursos deste item a partir dos workloads observados pelo host (gates
 * + coder). Puro e read-only; `null` quando o item ainda não tem nenhum workload observado. */
export function projectWorkResourceCost(events:readonly WorkEvent[]):WorkResourceCostProjection|null{
  const observations=[...deriveWorkloadCostObservationsFromEvents(events),...deriveCoderWorkloadCostObservationsFromEvents(events)];
  if(observations.length===0)return null;
  const distribution=buildCostDistribution(observations);
  return{distribution,profiles:projectWorkloadCostProfiles(observations,distribution)};
}

const object=(value:Json|undefined):Record<string,Json|undefined>|null=>value!==null&&value!==undefined&&!Array.isArray(value)&&typeof value==='object'?value:null;
const validationOutcomes:ReadonlySet<string>=new Set(['passed','failed','declared']);
const projectValidations=(value:Json|undefined):readonly WorkResultValidation[]|null=>{
  if(!Array.isArray(value))return null;
  const parsed:WorkResultValidation[]=[];
  for(const entry of value){const record=object(entry);if(typeof record?.label!=='string'||!record.label.trim()||typeof record.outcome!=='string'||!validationOutcomes.has(record.outcome))return null;parsed.push({label:record.label,outcome:record.outcome as WorkResultValidationOutcome});}
  return parsed;
};
const projectLimitations=(value:Json|undefined):readonly string[]|null=>Array.isArray(value)&&value.every((entry):entry is string=>typeof entry==='string'&&entry.trim().length>0)?value:null;
export function projectLatestWorkResult(events:readonly WorkEvent[]):WorkResultProjection|null{
  for(let index=events.length-1;index>=0;index--){const event=events[index]!;if(event.type!=='result_submitted'||event.proposalVersion===null)continue;const envelope=object(event.payload),data=object(envelope?.data);if(typeof data?.summary!=='string'||!Array.isArray(data.result_references)||!data.result_references.every(value=>typeof value==='string'))continue;return{eventId:event.id,proposalVersion:event.proposalVersion,author:event.author,summary:data.summary,references:data.result_references,validations:projectValidations(data.validations),limitations:projectLimitations(data.limitations),handoffReference:typeof data.handoff_reference==='string'&&data.handoff_reference.trim().length>0?data.handoff_reference:null};}
  return null;
}
// O resultado aceito é reconstruído a partir do result_accepted mais recente
// e do evento exato que ele referencia (accepted_result_event_id). Qualquer
// elo ausente ou malformado resulta em null: a UI declara a lacuna, nunca a
// preenche com texto próprio.
export function projectAcceptedWorkResult(events:readonly WorkEvent[]):WorkResultProjection|null{
  for(let index=events.length-1;index>=0;index--){
    const event=events[index]!;
    if(event.type!=='result_accepted')continue;
    const data=object(object(event.payload)?.data);
    const acceptedId=data?.accepted_result_event_id;
    if(typeof acceptedId!=='string'||!acceptedId)return null;
    const accepted=events.find(candidate=>candidate.id===acceptedId&&candidate.type==='result_submitted');
    if(!accepted)return null;
    return projectLatestWorkResult([accepted]);
  }
  return null;
}
// Compartilhado entre web e mobile: transforma o texto do formulário em
// validações tipadas. "ok:" atesta sucesso, "falha:"/"falhou:" atesta falha;
// qualquer outra linha permanece como declaração não verificada.
export function parseWorkResultValidations(text:string):readonly WorkResultValidation[]{
  return text.split('\n').map(line=>line.trim()).filter(Boolean).map(line=>{
    const passed=/^ok\s*:/i.exec(line);if(passed)return{label:line.slice(passed[0].length).trim(),outcome:'passed' as const};
    const failed=/^falh(?:a|ou)\s*:/i.exec(line);if(failed)return{label:line.slice(failed[0].length).trim(),outcome:'failed' as const};
    return{label:line,outcome:'declared' as const};
  }).filter(validation=>validation.label.length>0);
}
export const describeValidationOutcome=(outcome:WorkResultValidationOutcome):string=>outcome==='passed'?'passou':outcome==='failed'?'falhou':'declarada sem verificação';
export function availableWorkActions(item:WorkItem,latestResult:WorkResultProjection|null):readonly WorkAction[]{
  if(item.state==='proposed')return['approve','reject','defer','revise_proposal'];
  if(item.state==='approved'||item.state==='changes_requested'||item.state==='blocked')return['start'];
  if(item.state==='in_progress')return['submit_result'];
  if(item.state==='review'&&latestResult?.proposalVersion===item.proposalVersion)return['accept_result','request_result_changes'];
  return[];
}
// Reconstrói o cartão de execução autônoma a partir dos eventos persistidos.
// Cada campo tem origem num evento; nada é derivado do relógio ou de suposição.
const asString=(value:Json|undefined):string|null=>typeof value==='string'&&value.trim().length>0?value:null;
const asNumber=(value:Json|undefined):number|null=>typeof value==='number'&&Number.isFinite(value)?value:null;
const arrayLength=(value:Json|undefined):number=>Array.isArray(value)?value.length:0;
const eventData=(event:WorkEvent):Record<string,Json|undefined>|null=>object(object(event.payload)?.data);
const eventAttempt=(event:WorkEvent):string|null=>asString(eventData(event)?.attempt_id);
const interruptionReasons:ReadonlySet<string>=new Set(HUMAN_INTERRUPTION_REASONS);
export function projectPendingWorkDecision(item:WorkItem,events:readonly WorkEvent[]):WorkDecisionProjection|null{
  for(let index=events.length-1;index>=0;index--){
    const request=events[index]!;
    if(request.type!=='input_requested'||request.proposalVersion!==item.proposalVersion)continue;
    const data=eventData(request),inputRequest=object(data?.input_request),sourceState=object(inputRequest?.source_state);
    const reason=asString(inputRequest?.reason)??asString(data?.reason),attemptId=asString(data?.attempt_id);
    const explanation=asString(inputRequest?.explanation)??asString(data?.explanation);
    const checkpointReference=asString(sourceState?.checkpoint_reference)??asString(data?.checkpoint_reference);
    if(reason===null||!interruptionReasons.has(reason)||attemptId===null||explanation===null||checkpointReference===null)continue;
    if(inputRequest&&inputRequest.schema_version!==1)continue;
    if(events.some(event=>event.type==='input_provided'&&asString(eventData(event)?.input_requested_event_id)===request.id))return null;
    if(!Array.isArray(data?.options))continue;
    const options:WorkDecisionOptionProjection[]=[];
    for(const value of data.options){const option=object(value),id=asString(option?.id),label=asString(option?.label),effect=asString(option?.effect);if(id===null||label===null||(effect!=='resume'&&effect!=='cancel')){options.length=0;break;}options.push({id,label,effect});}
    if(options.length<2||new Set(options.map(option=>option.id)).size!==options.length)continue;
    return{requestEventId:request.id,attemptId,proposalVersion:item.proposalVersion,reason:reason as HumanInterruptionReason,explanation,options,checkpointReference};
  }
  return null;
}
const budgetReasons:ReadonlySet<string>=new Set<WorkBudgetReason>(['item_attempt_budget_exhausted','user_attempt_budget_exhausted','user_runtime_budget_exhausted','interactive_reserve_protected']);
const limitKinds:ReadonlySet<string>=new Set<AutonomousLimitKind>(['attempts','duration','resources']);
// Item bloqueado aguardando a janela do orçamento: o ÚLTIMO `work_blocked` da
// versão vigente é um bloqueio de orçamento PRÉ-tentativa (razão tipada, sem
// `attempt_id`). Interrupções em tentativa (com `attempt_id`) e bloqueios de
// decisão humana não caem aqui — a UI daqueles vem de outra projeção.
export function projectPendingBudgetWait(item:WorkItem,events:readonly WorkEvent[]):WorkBudgetWaitProjection|null{
  if(item.state!=='blocked')return null;
  for(let index=events.length-1;index>=0;index--){
    const event=events[index]!;
    if(event.type!=='work_blocked'||event.proposalVersion!==item.proposalVersion)continue;
    const data=eventData(event);
    if(asString(data?.attempt_id)!==null)return null;
    const reason=asString(data?.reason);
    if(reason===null||!budgetReasons.has(reason))return null;
    const reachedLimit=asString(data?.reached_limit);
    return{reason:reason as WorkBudgetReason,reachedLimit:reachedLimit!==null&&limitKinds.has(reachedLimit)?reachedLimit as AutonomousLimitKind:'attempts'};
  }
  return null;
}
export function projectWorkIntegration(item:WorkItem,events:readonly WorkEvent[]):WorkIntegrationProjection|null{
  if(item.state!=='completed')return null;
  const boundary=projectIntegrationBoundary(events);
  if(!boundary||boundary.correlation.workItemId!==item.id||boundary.correlation.approvedProposalVersion!==item.proposalVersion)return null;
  const acceptance=boundary.acceptance;
  if(!acceptance)return null;
  if(boundary.status==='result_accepted')return{status:'awaiting_decision',acceptedResultEventId:acceptance.acceptedResultEventId,decision:null,availableDecisions:['authorize','refuse'],publication:null};
  if(boundary.status==='integration_authorized'){
    const decision=boundary.integrationDecision!;
    let publication:{repositoryId:string;remoteName:string;remoteBranch:string;commitSha:string}|null=null;
    for(let index=events.length-1;index>=0;index--){const event=events[index]!;if(event.type!=='branch_published'||event.author!=='system'||event.proposalVersion!==item.proposalVersion)continue;const data=eventData(event),receipt=parseBranchPublicationReceipt(data?.receipt);if(receipt&&data?.authorization_decision_id===decision.decisionId&&data?.accepted_result_event_id===acceptance.acceptedResultEventId&&data?.attempt_id===boundary.correlation.attemptId&&receipt.idempotencyKey===`integration-publication:${decision.decisionId}:${receipt.commitSha}:branch`){publication={repositoryId:receipt.repositoryId,remoteName:receipt.remoteName,remoteBranch:receipt.remoteBranch,commitSha:receipt.commitSha};break;}}
    if(publication){
      // Estado posterior: review request criado e persistido. Só promove quando o
      // fato review_request_created casa autor=system, versão, autorização,
      // resultado aceito, tentativa e a idempotencyKey de review derivada do
      // commit. Divergência é ignorada e a projeção permanece em branch_published.
      for(let index=events.length-1;index>=0;index--){const event=events[index]!;if(event.type!=='review_request_created'||event.author!=='system'||event.proposalVersion!==item.proposalVersion)continue;const data=eventData(event),receipt=parseReviewRequestReceipt(data?.receipt);if(receipt&&data?.authorization_decision_id===decision.decisionId&&data?.accepted_result_event_id===acceptance.acceptedResultEventId&&data?.attempt_id===boundary.correlation.attemptId&&receipt.idempotencyKey===`integration-publication:${decision.decisionId}:${receipt.sourceCommitSha}:review`)return{status:'review_request_created',acceptedResultEventId:acceptance.acceptedResultEventId,decision:'authorize',availableDecisions:[],publication,reviewRequest:{repositoryId:receipt.repositoryId,remoteName:receipt.remoteName,reviewReference:receipt.reviewReference,reviewId:receipt.reviewId,sourceBranch:receipt.sourceBranch,sourceCommitSha:receipt.sourceCommitSha,baseBranch:receipt.baseBranch}};}
      return{status:'branch_published',acceptedResultEventId:acceptance.acceptedResultEventId,decision:'authorize',availableDecisions:[],publication,reviewRequest:null};
    }
    return{status:'authorized',acceptedResultEventId:acceptance.acceptedResultEventId,decision:'authorize',availableDecisions:[],publication:null};
  }
  if(boundary.status==='integration_refused')return{status:'refused',acceptedResultEventId:acceptance.acceptedResultEventId,decision:'refuse',availableDecisions:[],publication:null};
  return null;
}
export function projectAutonomousExecution(item:WorkItem,events:readonly WorkEvent[]):AutonomousExecutionProjection|null{
  // Tentativa autônoma corrente = último execution_started com claim_id. A
  // execução comandada (INT-04) não tem claim e não é pausável/cancelável aqui.
  let started:WorkEvent|undefined;
  for(let index=events.length-1;index>=0;index--){const event=events[index]!;if(event.type!=='execution_started')continue;if(asString(eventData(event)?.claim_id)===null)continue;started=event;break;}
  if(!started)return null;
  const attemptId=asString(eventData(started)?.attempt_id);
  if(attemptId===null)return null;
  const forAttempt=events.filter(event=>eventAttempt(event)===attemptId);

  // Executor/provedor/modelo/esforço: do work_routing_decided da tentativa; ao
  // menos o executor vem do próprio execution_started quando não há decisão.
  let executorId=asString(eventData(started)?.executor_id),providerRef:string|null=null,modelRef:string|null=null,effort:string|null=null;
  const routing=forAttempt.find(event=>event.type==='work_routing_decided');
  if(routing){const selected=object(object(eventData(routing)?.decision)?.selected);if(selected){executorId=asString(selected.executorId)??executorId;providerRef=asString(selected.providerRef);modelRef=asString(selected.modelRef);effort=asString(selected.effort);}}

  // Checkpoint persistido mais recente (maior signal_sequence).
  let latestCheckpoint:ExecutionCheckpointProjection|null=null;
  for(const event of forAttempt){if(event.type!=='checkpoint_recorded')continue;const data=eventData(event);const sequence=asNumber(data?.signal_sequence);if(sequence===null)continue;if(latestCheckpoint&&sequence<=latestCheckpoint.signalSequence)continue;const checkpoint=object(data?.checkpoint);latestCheckpoint={signalSequence:sequence,completedSteps:arrayLength(checkpoint?.completedSteps),remainingSteps:arrayLength(checkpoint?.remainingSteps),nextStep:asString(checkpoint?.nextStep)??''};}

  // Resultado aplicado da pausa/cancelamento: work_paused, ou work_cancelled que
  // referencia um pedido de controle (distinto do cancelamento do executor).
  let appliedControl:ExecutionControlAppliedProjection|null=null,appliedIndex=-1;
  for(let index=0;index<events.length;index++){const event=events[index]!;if(eventAttempt(event)!==attemptId)continue;const data=eventData(event);if(event.type==='work_paused'){appliedControl={action:'pause',reason:asString(data?.reason)??'paused_by_user',appliedAt:asString(data?.applied_at)??event.occurredAt.toISOString()};appliedIndex=index;}else if(event.type==='work_cancelled'&&data?.control_request_event_seq!==undefined&&data.control_request_event_seq!==null){appliedControl={action:'cancel',reason:asString(data?.reason)??'cancelled_by_user',appliedAt:asString(data?.applied_at)??event.occurredAt.toISOString()};appliedIndex=index;}}

  // Pedido pendente = último work_control_requested sem aplicação posterior.
  let lastRequest:{index:number;action:ExecutionControlAction;requestedAt:string}|null=null;
  for(let index=0;index<events.length;index++){const event=events[index]!;if(event.type!=='work_control_requested'||eventAttempt(event)!==attemptId)continue;const action=asString(eventData(event)?.action);if(action==='pause'||action==='cancel')lastRequest={index,action,requestedAt:asString(eventData(event)?.requested_at)??event.occurredAt.toISOString()};}
  const pendingControl:ExecutionControlRequestProjection|null=lastRequest&&lastRequest.index>appliedIndex?{action:lastRequest.action,requestedAt:lastRequest.requestedAt}:null;

  // Orçamento relevante: um work_blocked da tentativa registra a razão tipada.
  let budgetBlock:ExecutionBudgetBlockProjection|null=null;
  for(const event of forAttempt){if(event.type!=='work_blocked')continue;const data=eventData(event);const reason=asString(data?.reason)??'work_blocked';budgetBlock={reason,reachedLimit:asString(data?.reached_limit),recoverable:budgetReasons.has(reason)};}

  const has=(type:WorkEvent['type']):boolean=>forAttempt.some(event=>event.type===type);
  let status:AutonomousExecutionStatus='running';
  if(appliedControl?.action==='cancel')status='cancelled';
  else if(appliedControl?.action==='pause')status='paused';
  else if(has('result_submitted'))status='submitted_for_review';
  else if(has('execution_failed'))status='failed';
  else if(has('attempt_abandoned'))status='abandoned';
  else if(has('work_cancelled'))status='cancelled';
  else if(has('work_blocked'))status='blocked';

  const specLimits=object(object((item.intent as Record<string,Json|undefined>).execution_spec)?.limits);
  return{
    attemptId,status,startedAt:started.occurredAt.toISOString(),executorId,providerRef,modelRef,effort,
    limits:{maxAttempts:asNumber(specLimits?.max_attempts),maxDurationMinutes:asNumber(specLimits?.max_duration_minutes)},
    latestCheckpoint,pendingControl,appliedControl,budgetBlock,
    canRequestControl:status==='running'&&pendingControl===null,
  };
}
// Fase HUMANA do trabalho autônomo, derivada SOMENTE de fatos já projetados
// (estado do item, execução + checkpoint, integração) — nunca da narrativa do LLM.
// É projeção pura e read-only: não persiste estado novo nem inventa fases sem
// fato que as sustente. Analisar e implementar não têm fronteira de evento (o
// coder edita numa chamada opaca), então ambos caem em `implementing`.
export type WorkProgressPhase =
  |'proposal'|'approved'|'implementing'|'testing'|'paused'
  |'reviewing'|'ready_to_integrate'|'integrating'
  |'done'|'blocked'|'failed'|'rejected'|'cancelled';
export interface WorkProgressPhaseProjection{readonly phase:WorkProgressPhase;readonly label:string;readonly active:boolean;readonly terminal:boolean;}
const PROGRESS_LABEL:Record<WorkProgressPhase,string>={proposal:'Proposta',approved:'Aprovado',implementing:'Implementando',testing:'Testando',paused:'Pausado',reviewing:'Revisando',ready_to_integrate:'Pronto para integrar',integrating:'Integrando',done:'Concluído',blocked:'Bloqueado',failed:'Falhou',rejected:'Rejeitado',cancelled:'Cancelado'};
const PROGRESS_ACTIVE=new Set<WorkProgressPhase>(['implementing','testing']);
const PROGRESS_TERMINAL=new Set<WorkProgressPhase>(['done','failed','rejected','cancelled']);
const progressPhase=(phase:WorkProgressPhase):WorkProgressPhaseProjection=>({phase,label:PROGRESS_LABEL[phase],active:PROGRESS_ACTIVE.has(phase),terminal:PROGRESS_TERMINAL.has(phase)});
// `awaiting_decision` = resultado aceito, integração pendente do humano → Pronto
// para integrar. `refused` = humano recusou a integração; o trabalho está aceito
// (concluído sem integrar) → Concluído. Demais (authorized/branch_published/
// review_request_created) = integração em andamento → Integrando.
const integrationProgressPhase=(integration:WorkIntegrationProjection):WorkProgressPhaseProjection=>integration.status==='awaiting_decision'?progressPhase('ready_to_integrate'):integration.status==='refused'?progressPhase('done'):progressPhase('integrating');
/**
 * Deriva a fase humana a partir dos fatos projetados. Ordem: estados terminais do
 * item (autoridade do domínio) → execução autônoma em andamento (running:
 * `testing` quando existe o checkpoint de pós-edição do worktree, senão
 * `implementing`) → integração (pós-resultado) → espera humana/pré-execução.
 */
export function deriveWorkProgressPhase(input:{readonly item:WorkItem;readonly execution:AutonomousExecutionProjection|null;readonly integration:WorkIntegrationProjection|null;}):WorkProgressPhaseProjection{
  const{item,execution,integration}=input;
  // Estados terminais NEGATIVOS do item vêm primeiro (autoridade do domínio).
  if(item.state==='rejected')return progressPhase('rejected');
  if(item.state==='cancelled')return progressPhase('cancelled');
  if(item.state==='failed')return progressPhase('failed');
  // Execução autônoma ATIVA tem precedência (running/paused).
  if(execution){
    if(execution.status==='running')return progressPhase(execution.latestCheckpoint!==null?'testing':'implementing');
    if(execution.status==='paused')return progressPhase('paused');
    if(execution.status==='failed')return progressPhase('failed');
    if(execution.status==='blocked')return progressPhase('blocked');
    if(execution.status==='cancelled'||execution.status==='abandoned')return progressPhase('cancelled');
  }
  // Integração (pós-aceite) ANTES de `completed`: um item aceito (completed) ainda
  // pode ter uma decisão de integração pendente — é justamente o `ready_to_integrate`.
  if(integration)return integrationProgressPhase(integration);
  // Resultado submetido, ainda não aceito → revisão.
  if(execution?.status==='submitted_for_review')return progressPhase('reviewing');
  // Concluído sem fronteira de integração → done.
  if(item.state==='completed')return progressPhase('done');
  if(item.state==='blocked')return progressPhase('blocked');
  if(item.state==='review'||item.state==='changes_requested')return progressPhase('reviewing');
  if(item.state==='in_progress')return progressPhase('implementing');
  if(item.state==='approved')return progressPhase('approved');
  return progressPhase('proposal');
}
export function projectManualReleaseAvailable(item:WorkItem,events:readonly WorkEvent[]):boolean{
  if(item.state!=='in_progress')return false;
  let manualStartIndex=-1;
  for(let index=events.length-1;index>=0;index--){const event=events[index];if(event?.type==='work_started'&&event.author==='user'&&event.proposalVersion===item.proposalVersion){manualStartIndex=index;break;}}
  if(manualStartIndex<0)return false;
  const disqualifying=new Set<WorkEvent['type']>(['execution_started','result_submitted','execution_failed','work_cancelled','attempt_abandoned']);
  return !events.slice(manualStartIndex+1).some(event=>disqualifying.has(event.type));
}

export const presentWorkItem=(item:WorkItem,events:readonly WorkEvent[]):WorkPresentation=>{const latestResult=projectLatestWorkResult(events);const opinionHistory=projectVerifierOpinionHistory(events);const observedGit=projectHostObservedEvidence(events);const observedGates=projectHostObservedGateEvidence(events);const execution=projectAutonomousExecution(item,events);const integration=projectWorkIntegration(item,events);return{item,latestResult,acceptedResult:projectAcceptedWorkResult(events),latestEventType:events.at(-1)?.type??null,availableActions:availableWorkActions(item,latestResult),manualReleaseAvailable:projectManualReleaseAvailable(item,events),execution,pendingDecision:projectPendingWorkDecision(item,events),pendingBudgetWait:projectPendingBudgetWait(item,events),integration,progress:deriveWorkProgressPhase({item,execution,integration}),
  // Parecer advisory do Verifier — só quando há evidência git durável a conferir.
  // É projeção pura e read-only; nunca altera ações nem substitui a revisão humana.
  verification:projectWorktreeHandoff(events)?verifyPersistedWorkResult(item,events):null,
  // Histórico persistido dos pareceres (auditoria), quando existe.
  ...(opinionHistory.length>0?{opinionHistory}:{}),
  // Fatos brutos observados pelo host (git e gate), quando existe algum.
  ...(observedGit!==null||observedGates!==null?{observedEvidence:{git:observedGit,gates:observedGates}}:{}),
  // Custo de recursos derivado dos gates observados (Resource Governor V0), quando há.
  ...((()=>{const resourceCost=projectWorkResourceCost(events);return resourceCost!==null?{resourceCost}:{};})())};};

// Reconstrói a projeção somente quando os elos persistidos mínimos existem.
// O estado atual nunca basta para inventar o histórico que deveria explicá-lo.
export function reconstructWorkPresentation(item:WorkItem,events:readonly WorkEvent[],contextReferences:readonly {readonly kind:string;readonly id:string}[]):WorkPresentation{
  const issues:string[]=[];
  if(events.some(event=>event.workItemId!==item.id))issues.push('event_work_item_mismatch');
  const proposed=events.filter(event=>event.type==='work_proposed');
  if(proposed.length!==1||proposed[0]?.proposalVersion!==1)issues.push('missing_original_proposal');
  if(!contextReferences.some(reference=>reference.kind==='message'&&reference.id===item.sourceMessageId))issues.push('missing_source_message_reference');
  for(let version=2;version<=item.proposalVersion;version++)if(!events.some(event=>event.type==='proposal_revised'&&event.proposalVersion===version))issues.push(`missing_proposal_revision_v${version}`);
  if(item.state!=='proposed'&&!['rejected','cancelled'].includes(item.state)&&!events.some(event=>event.type==='work_approved'&&event.proposalVersion===item.proposalVersion))issues.push('missing_versioned_decision');
  const acceptedResult=projectAcceptedWorkResult(events);
  let acceptedEvent:WorkEvent|undefined;
  for(let index=events.length-1;index>=0;index--){if(events[index]?.type==='result_accepted'){acceptedEvent=events[index];break;}}
  if(item.state==='completed'&&(!acceptedResult||acceptedResult.proposalVersion!==item.proposalVersion||acceptedEvent?.proposalVersion!==item.proposalVersion))issues.push('missing_accepted_result');
  const latestResult=projectLatestWorkResult(events);
  if(item.state==='review'&&(!latestResult||latestResult.proposalVersion!==item.proposalVersion))issues.push('missing_current_result');
  const executionResults=events.filter(event=>event.type==='result_submitted').map(event=>object(object(event.payload)?.data)?.execution_id).filter((value):value is string=>typeof value==='string');
  for(const executionId of executionResults)if(!events.some(event=>event.type==='execution_started'&&object(object(event.payload)?.data)?.execution_id===executionId))issues.push(`missing_execution_${executionId}`);
  const base=presentWorkItem(item,events);
  return{...base,acceptedResult,availableActions:issues.length?[]:base.availableActions,integration:base.integration?{...base.integration,availableDecisions:issues.length?[]:base.integration.availableDecisions}:base.integration,provenance:{status:issues.length?'incomplete':'complete',issues}};
}
export function buildProposalRevision(item:WorkItem,requestedChanges:string):Pick<import('./commands').RequestProposalRevisionCommand,'intent'|'proposal'|'requestedChanges'>{
  const feedback=requestedChanges.trim();
  const objective=`${item.proposal.data.objective}\n\nAjuste solicitado: ${feedback}`;
  const includedScope=item.proposal.data.includedScope.includes(feedback)?item.proposal.data.includedScope:[...item.proposal.data.includedScope,feedback];
  return{requestedChanges:feedback,intent:{...item.intent,revision_feedback:feedback},proposal:{...item.proposal,data:{...item.proposal.data,objective,includedScope}}};
}
