import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

type ItemRow=Pick<Database['public']['Tables']['work_items']['Row'],'state'|'proposal_version'|'impact_level'|'capability'|'intent'>;

export async function ensurePlannedProjectClassification(client:SupabaseClient<Database>,workItemId:string,expectedProposalVersion:number,now=()=>new Date()){
  const read=await client.from('work_items').select('state,proposal_version,impact_level,capability,intent').eq('id',workItemId).maybeSingle();
  if(read.error||!read.data)return {ok:false as const,code:'work_item_not_found'};
  const item=read.data as ItemRow;
  const intent=item.intent as {planner?:unknown;execution_spec?:{target?:{kind?:unknown;reference?:unknown};permissions?:unknown;validation_criteria?:unknown;limits?:{max_attempts?:unknown;max_duration_minutes?:unknown}}};
  const spec=intent.execution_spec;
  const planned=item.state==='approved'&&item.proposal_version===expectedProposalVersion&&item.impact_level==='low'&&item.capability==='programming'
    &&(intent.planner==='openai_project_tools_v1'||intent.planner==='local_ollama_project_tools_v1')
    &&spec?.target?.kind==='project'&&spec.target.reference==='anima'
    &&Array.isArray(spec.permissions)&&spec.permissions.length===2&&spec.permissions[0]==='workspace_read'&&spec.permissions[1]==='workspace_write_isolated'
    &&Array.isArray(spec.validation_criteria)&&spec.validation_criteria.length>0&&spec.limits?.max_attempts===3&&spec.limits.max_duration_minutes===30;
  if(!planned)return {ok:false as const,code:'classification_policy_not_applicable'};
  const current=await client.rpc('current_work_intelligence_classification',{p_work_item_id:workItemId});
  if(current.error)return {ok:false as const,code:'classification_read_failed'};
  if((current.data as {classification?:unknown}|null)?.classification)return {ok:true as const,replayed:true};
  const write=await client.rpc('record_work_intelligence_classification',{p_work_item_id:workItemId,p_expected_proposal_version:expectedProposalVersion,p_expected_classification_revision:0,p_classification:{schemaVersion:1,complexity:'bounded',risk:'low',reversibility:'reversible',planClarity:'clear',urgency:'normal',provenance:{kind:'system_assessed',classifiedAt:now().toISOString(),classifierId:String(intent.planner)+'-bridge',policyVersion:'project-planner-v1'}}});
  return write.error?{ok:false as const,code:'classification_persist_failed'}:{ok:true as const,replayed:false};
}
