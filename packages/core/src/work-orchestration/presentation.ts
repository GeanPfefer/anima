import type { Json } from '@anima/types';
import type { WorkEvent, WorkItem, WorkResultValidation, WorkResultValidationOutcome } from './types';

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
}
export type WorkAction = 'approve'|'reject'|'defer'|'revise_proposal'|'start'|'submit_result'|'accept_result'|'request_result_changes';
export interface WorkProvenanceProjection { readonly status:'complete'|'incomplete'; readonly issues:readonly string[]; }
export interface WorkPresentation { readonly item: WorkItem; readonly latestResult: WorkResultProjection|null; readonly acceptedResult: WorkResultProjection|null; readonly latestEventType:WorkEvent['type']|null; readonly availableActions:readonly WorkAction[]; readonly provenance?:WorkProvenanceProjection; }

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
  for(let index=events.length-1;index>=0;index--){const event=events[index]!;if(event.type!=='result_submitted'||event.proposalVersion===null)continue;const envelope=object(event.payload),data=object(envelope?.data);if(typeof data?.summary!=='string'||!Array.isArray(data.result_references)||!data.result_references.every(value=>typeof value==='string'))continue;return{eventId:event.id,proposalVersion:event.proposalVersion,author:event.author,summary:data.summary,references:data.result_references,validations:projectValidations(data.validations),limitations:projectLimitations(data.limitations)};}
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
export const presentWorkItem=(item:WorkItem,events:readonly WorkEvent[]):WorkPresentation=>{const latestResult=projectLatestWorkResult(events);return{item,latestResult,acceptedResult:projectAcceptedWorkResult(events),latestEventType:events.at(-1)?.type??null,availableActions:availableWorkActions(item,latestResult)}};

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
  return{...base,acceptedResult,availableActions:issues.length?[]:base.availableActions,provenance:{status:issues.length?'incomplete':'complete',issues}};
}
export function buildProposalRevision(item:WorkItem,requestedChanges:string):Pick<import('./commands').RequestProposalRevisionCommand,'intent'|'proposal'|'requestedChanges'>{
  const feedback=requestedChanges.trim();
  const objective=`${item.proposal.data.objective}\n\nAjuste solicitado: ${feedback}`;
  const includedScope=item.proposal.data.includedScope.includes(feedback)?item.proposal.data.includedScope:[...item.proposal.data.includedScope,feedback];
  return{requestedChanges:feedback,intent:{...item.intent,revision_feedback:feedback},proposal:{...item.proposal,data:{...item.proposal.data,objective,includedScope}}};
}
