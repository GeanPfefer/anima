import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

type ItemRow=Pick<Database['public']['Tables']['work_items']['Row'],'state'|'proposal_version'|'impact_level'|'capability'|'intent'>;

type PreparationResult=
  |{readonly ok:true;readonly replayed:boolean}
  |{readonly ok:false;readonly code:string;readonly message:string;readonly postgresCode?:string};

const failure=(code:string,message:string,postgresCode?:string):PreparationResult=>({ok:false,code,message,...(postgresCode?{postgresCode}:{})});

export async function ensurePlannedProjectClassification(client:SupabaseClient<Database>,workItemId:string,expectedProposalVersion:number,now=()=>new Date()):Promise<PreparationResult>{
  const read=await client.from('work_items').select('state,proposal_version,impact_level,capability,intent').eq('id',workItemId).maybeSingle();
  if(read.error||!read.data)return failure('work_item_not_found',read.error?.message??'O trabalho não foi encontrado para esta conta.',read.error?.code);
  const item=read.data as ItemRow;
  const intent=item.intent as {planner?:unknown;execution_spec?:{target?:{kind?:unknown;reference?:unknown};permissions?:unknown;validation_criteria?:unknown;limits?:{max_attempts?:unknown;max_duration_minutes?:unknown}}};
  const spec=intent.execution_spec;
  const supportedImpact=item.impact_level==='low'||item.impact_level==='structural';
  const planned=item.state==='approved'&&item.proposal_version===expectedProposalVersion&&supportedImpact&&item.capability==='programming'
    &&(intent.planner==='openai_project_tools_v1'||intent.planner==='local_ollama_project_tools_v1')
    &&spec?.target?.kind==='project'&&spec.target.reference==='anima'
    &&Array.isArray(spec.permissions)&&spec.permissions.length===2&&spec.permissions[0]==='workspace_read'&&spec.permissions[1]==='workspace_write_isolated'
    &&Array.isArray(spec.validation_criteria)&&spec.validation_criteria.length>0&&spec.limits?.max_attempts===3&&spec.limits.max_duration_minutes===30;
  if(!planned)return failure('classification_policy_not_applicable',`A preparação não se aplica ao envelope persistido (${item.state}, v${item.proposal_version}, impacto ${item.impact_level}).`);
  const current=await client.rpc('current_work_intelligence_classification',{p_work_item_id:workItemId});
  if(current.error)return failure('classification_read_failed',current.error.message,current.error.code);
  if((current.data as {classification?:unknown}|null)?.classification)return {ok:true as const,replayed:true};
  const structural=item.impact_level==='structural';
  const write=await client.rpc('record_work_intelligence_classification',{p_work_item_id:workItemId,p_expected_proposal_version:expectedProposalVersion,p_expected_classification_revision:0,p_classification:{schemaVersion:1,complexity:'bounded',risk:structural?'moderate':'low',reversibility:structural?'conditionally_reversible':'reversible',planClarity:'clear',urgency:'normal',provenance:{kind:'system_assessed',classifiedAt:now().toISOString(),classifierId:String(intent.planner)+'-bridge',policyVersion:'human-approved-project-planner-v1'}}});
  if(!write.error)return {ok:true as const,replayed:false};
  // Se outra chamada venceu a corrida ou a resposta da escrita foi ambígua, a
  // fonte de verdade decide: um fato corrente válido transforma o retry em replay.
  const reconciled=await client.rpc('current_work_intelligence_classification',{p_work_item_id:workItemId});
  if(!reconciled.error&&(reconciled.data as {classification?:unknown}|null)?.classification)return {ok:true as const,replayed:true};
  return failure('classification_persist_failed',write.error.message,write.error.code);
}
