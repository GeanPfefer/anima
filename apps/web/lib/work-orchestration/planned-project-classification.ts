import { readCanonicalProvenanceFromIntent } from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

type ItemRow=Pick<Database['public']['Tables']['work_items']['Row'],'state'|'proposal_version'|'impact_level'|'capability'|'intent'>;
type SupportedPlanner='openai_project_tools_v1'|'local_ollama_project_tools_v1';
type ClassificationSource=SupportedPlanner|'canonical_backlog_v1';

type PreparationResult=
  |{readonly ok:true;readonly replayed:boolean}
  |{readonly ok:false;readonly code:string;readonly message:string;readonly postgresCode?:string};

const failure=(code:string,message:string,postgresCode?:string):PreparationResult=>({ok:false,code,message,...(postgresCode?{postgresCode}:{})});
const supportedPlanner=(value:unknown):value is SupportedPlanner=>value==='openai_project_tools_v1'||value==='local_ollama_project_tools_v1';

/**
 * Recovery successors deliberately copy only `execution_spec`: planner metadata
 * is provenance, not execution authority. For those already-governed units, the
 * classifier may recover the planner only through the persisted one-to-one
 * lineage and the original item. A bare intent with `resume_from_checkpoint`
 * but no lineage remains ineligible (fail-closed).
 */
async function sourceForClassification(
  client:SupabaseClient<Database>,workItemId:string,intent:{planner?:unknown;execution_spec?:unknown},
):Promise<ClassificationSource|null>{
  if(supportedPlanner(intent.planner))return intent.planner;
  // Uma revisão humana pode substituir a metadata do planner sem alterar a origem
  // canônica estável do trabalho. A proveniência canônica é validada pelo contrato
  // puro e, combinada com TODAS as guardas do envelope abaixo, continua sendo uma
  // origem governada para preparar somente a classificação post-approval.
  if(readCanonicalProvenanceFromIntent(intent)!==null)return 'canonical_backlog_v1';
  const rawSpec=intent.execution_spec;
  if(typeof rawSpec!=='object'||rawSpec===null||Array.isArray(rawSpec)
    ||typeof (rawSpec as Record<string,unknown>).resume_from_checkpoint!=='object')return null;
  const lineage=await client.from('work_recovery_lineage').select('original_work_item_id').eq('successor_work_item_id',workItemId).maybeSingle();
  if(lineage.error||!lineage.data)return null;
  const original=await client.from('work_items').select('intent').eq('id',lineage.data.original_work_item_id).maybeSingle();
  if(original.error||!original.data)return null;
  const originalIntent=original.data.intent as {planner?:unknown};
  return supportedPlanner(originalIntent.planner)?originalIntent.planner:null;
}

export async function ensurePlannedProjectClassification(client:SupabaseClient<Database>,workItemId:string,expectedProposalVersion:number,now=()=>new Date()):Promise<PreparationResult>{
  const read=await client.from('work_items').select('state,proposal_version,impact_level,capability,intent').eq('id',workItemId).maybeSingle();
  if(read.error||!read.data)return failure('work_item_not_found',read.error?.message??'O trabalho não foi encontrado para esta conta.',read.error?.code);
  const item=read.data as ItemRow;
  const intent=item.intent as {planner?:unknown;execution_spec?:{target?:{kind?:unknown;reference?:unknown};permissions?:unknown;validation_criteria?:unknown;limits?:{max_attempts?:unknown;max_duration_minutes?:unknown}}};
  const spec=intent.execution_spec;
  const classificationSource=await sourceForClassification(client,workItemId,intent);
  const supportedImpact=item.impact_level==='low'||item.impact_level==='structural';
  const planned=item.state==='approved'&&item.proposal_version===expectedProposalVersion&&supportedImpact&&item.capability==='programming'
    &&classificationSource!==null
    &&spec?.target?.kind==='project'&&spec.target.reference==='anima'
    &&Array.isArray(spec.permissions)&&spec.permissions.length===2&&spec.permissions[0]==='workspace_read'&&spec.permissions[1]==='workspace_write_isolated'
    &&Array.isArray(spec.validation_criteria)&&spec.validation_criteria.length>0&&spec.limits?.max_attempts===3&&spec.limits.max_duration_minutes===30;
  if(!planned)return failure('classification_policy_not_applicable',`A preparação não se aplica ao envelope persistido (${item.state}, v${item.proposal_version}, impacto ${item.impact_level}).`);
  const current=await client.rpc('current_work_intelligence_classification',{p_work_item_id:workItemId});
  if(current.error)return failure('classification_read_failed',current.error.message,current.error.code);
  if((current.data as {classification?:unknown}|null)?.classification)return {ok:true as const,replayed:true};
  const structural=item.impact_level==='structural';
  const write=await client.rpc('record_work_intelligence_classification',{p_work_item_id:workItemId,p_expected_proposal_version:expectedProposalVersion,p_expected_classification_revision:0,p_classification:{schemaVersion:1,complexity:'bounded',risk:structural?'moderate':'low',reversibility:structural?'conditionally_reversible':'reversible',planClarity:'clear',urgency:'normal',provenance:{kind:'system_assessed',classifiedAt:now().toISOString(),classifierId:classificationSource+'-bridge',policyVersion:'human-approved-project-planner-v1'}}});
  if(!write.error)return {ok:true as const,replayed:false};
  // Se outra chamada venceu a corrida ou a resposta da escrita foi ambígua, a
  // fonte de verdade decide: um fato corrente válido transforma o retry em replay.
  const reconciled=await client.rpc('current_work_intelligence_classification',{p_work_item_id:workItemId});
  if(!reconciled.error&&(reconciled.data as {classification?:unknown}|null)?.classification)return {ok:true as const,replayed:true};
  return failure('classification_persist_failed',write.error.message,write.error.code);
}
