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
export interface WorkPresentation { readonly item: WorkItem; readonly latestResult: WorkResultProjection|null; readonly latestEventType:WorkEvent['type']|null; readonly availableActions:readonly WorkAction[]; }

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
export const presentWorkItem=(item:WorkItem,events:readonly WorkEvent[]):WorkPresentation=>{const latestResult=projectLatestWorkResult(events);return{item,latestResult,latestEventType:events.at(-1)?.type??null,availableActions:availableWorkActions(item,latestResult)}};
export function buildProposalRevision(item:WorkItem,requestedChanges:string):Pick<import('./commands').RequestProposalRevisionCommand,'intent'|'proposal'|'requestedChanges'>{
  const feedback=requestedChanges.trim();
  const objective=`${item.proposal.data.objective}\n\nAjuste solicitado: ${feedback}`;
  const includedScope=item.proposal.data.includedScope.includes(feedback)?item.proposal.data.includedScope:[...item.proposal.data.includedScope,feedback];
  return{requestedChanges:feedback,intent:{...item.intent,revision_feedback:feedback},proposal:{...item.proposal,data:{...item.proposal.data,objective,includedScope}}};
}
