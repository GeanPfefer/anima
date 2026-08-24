import { isProjectBacklogMaterializationConfirmation, presentProjectBacklogProposal, validateProjectBacklogProposalDraft, type ProjectBacklogProposalDraft } from '@anima/core';
import type { Database, Json } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

type Client = SupabaseClient<Database>;
type Result = { readonly text: string; readonly sourceMessageId?: string; readonly kind: 'proposal'|'revised'|'materialized'|'already_materialized' };
const requestPattern = /(?:agora que decidimos|transformar essa decisao|colocar essa decisao em pratica|que trabalhos)/i;
const revisionPattern = /^(?:tira|remove|divide|inclui|nao quero|não quero|isso nao e prioridade|isso não é prioridade)\b/i;
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};

export const buildLocalFirstBacklogDraft = (revision?: string): ProjectBacklogProposalDraft => ({
  objective: 'Aplicar a preferência local-first e permitir uso remoto somente quando a capacidade local for inadequada.',
  rationale: revision ? `Decomposição revisada sob a restrição humana: ${revision}` : 'Separar observação de capacidade, decisão de roteamento e prova controlada reduz acoplamento e mantém cada recorte validável.',
  exclusions: ['Auto-provisioning de cloud', 'Criação automática de Pod ou recurso pago', 'Auto-approval e execução automática'],
  uncertainties: ['Limiares finais de capacidade e custo precisam ser calibrados com evidência operacional.'],
  slices: [
    { sliceKey:'compute-node-inventory',summary:'Representar nós e capacidade disponíveis',objective:'Criar um contrato provider-neutral para capacidade local/remota observada, sem provisionar recursos.',impactLevel:'structural',capability:'programming',dependencies:[],intent:{kind:'project_work'},proposal:{schemaVersion:1,data:{summary:'Representar nós e capacidade disponíveis',objective:'Modelar capacidade observada de compute sem provisioning.',includedScope:['packages/core/src/work-orchestration/resource-observation.ts'],excludedScope:['apps/web/lib/resident-host/'],expectedEffects:['Inventário tipado e testável de capacidade'],risks:['Modelar cedo demais atributos específicos de provider']}}},
    { sliceKey:'local-first-routing-policy',summary:'Definir política local-first por capacidade',objective:'Decidir local versus remoto por capacidade, custo e restrições, sem iniciar infraestrutura.',impactLevel:'structural',capability:'programming',dependencies:['compute-node-inventory'],intent:{kind:'project_work'},proposal:{schemaVersion:1,data:{summary:'Definir política local-first por capacidade',objective:'Produzir decisão pura e fail-closed de roteamento.',includedScope:['packages/core/src/work-orchestration/work-routing.ts'],excludedScope:['apps/web/lib/resident-host/'],expectedEffects:['Política determinística local-first'],risks:['Thresholds sem evidência suficiente']}}},
    { sliceKey:'controlled-routing-proof',summary:'Provar o roteamento sem auto-provisioning',objective:'Validar seleção local/remota com fixtures controladas e zero criação de infraestrutura.',impactLevel:'significant',capability:'programming',dependencies:['local-first-routing-policy'],intent:{kind:'project_work'},proposal:{schemaVersion:1,data:{summary:'Provar o roteamento sem auto-provisioning',objective:'Cobrir decisões e fronteiras com testes determinísticos.',includedScope:['packages/core/src/work-orchestration/work-routing.test.ts'],excludedScope:['supabase/migrations/'],expectedEffects:['Prova local de roteamento sem efeito externo'],risks:['Fixture não representar pressão real']}}},
  ],
});

const toStoredSlices = (draft: ProjectBacklogProposalDraft): Json => draft.slices.map(s => ({
  slice_key:s.sliceKey,summary:s.summary,impact_level:s.impactLevel,capability:s.capability,dependencies:[...s.dependencies],intent:s.intent,
  proposal:{schema_version:1,data:{summary:s.proposal.data.summary,objective:s.proposal.data.objective,included_scope:[...s.proposal.data.includedScope],excluded_scope:[...s.proposal.data.excludedScope],expected_effects:[...s.proposal.data.expectedEffects],risks:[...s.proposal.data.risks]}},
})) as Json;

async function persist(client: Client,userId:string,message:string): Promise<string> {
  const r=await client.from('ai_conversations').insert({user_id:userId,role:'user',content:message}).select('id').single();
  if(!r.data) throw new Error('backlog_source_message_failed'); return r.data.id;
}

export async function processProjectBacklogGovernanceRequest(input:{client:Client;userId:string;message:string}):Promise<Result|null>{
  const pending=await input.client.from('project_backlog_proposal_state').select('*').eq('status','awaiting_confirmation').order('created_at',{ascending:false}).limit(2);
  if(pending.error) throw new Error('backlog_pending_read_failed');
  if((pending.data?.length??0)>1) return null;
  const current=pending.data?.[0];
  if(current){
    if(!current.id || !current.version || !current.source_decision_id || !current.source_decision_version) throw new Error('backlog_pending_invalid');
    if(revisionPattern.test(input.message.trim())){
      const source=await persist(input.client,input.userId,input.message); const key=`backlog-change:${source}`;
      const changed=await input.client.rpc('request_project_backlog_proposal_changes',{proposal_id:current.id,expected_version:current.version,source_message_id:source,idempotency_key:key,requested_changes:input.message});
      if(changed.error) throw new Error('backlog_revision_failed');
      const draft=buildLocalFirstBacklogDraft(input.message); const created=await input.client.rpc('create_project_backlog_proposal',{source_decision_id:current.source_decision_id,source_decision_version:current.source_decision_version,objective:draft.objective,slices:toStoredSlices(draft),rationale:draft.rationale,exclusions:[...draft.exclusions],uncertainties:[...draft.uncertainties],provenance:{source:'system_derivation',revision_source_message_id:source},idempotency_key:`backlog-proposal:${source}`,supersedes_id:current.id});
      if(created.error) throw new Error('backlog_revision_create_failed'); const v=object(created.data);
      return {kind:'revised',sourceMessageId:source,text:`Revisei a proposta (versão ${v.version}).\n\n${presentProjectBacklogProposal(draft)}`};
    }
    if(!isProjectBacklogMaterializationConfirmation(input.message)) return null;
    const source=await persist(input.client,input.userId,input.message);
    const materialized=await input.client.rpc('materialize_project_backlog_proposal',{proposal_id:current.id,expected_version:current.version,confirmation_message_id:source,idempotency_key:`backlog-materialize:${current.id}:v${current.version}`,provenance:{source:'human_confirmation',actor:'user'}});
    if(materialized.error) throw new Error('backlog_materialization_failed'); const ids=object(materialized.data).work_item_ids as unknown[]|undefined;
    return {kind:'materialized',sourceMessageId:source,text:`Registrei ${ids?.length??0} trabalhos como propostas no backlog. Nenhum foi aprovado ou iniciado.`};
  }
  if(isProjectBacklogMaterializationConfirmation(input.message)){
    const latest=await input.client.from('project_backlog_proposal_state').select('id').eq('status','materialized').order('created_at',{ascending:false}).limit(1).maybeSingle();
    if(latest.data?.id){const links=await input.client.from('project_backlog_materialized_items').select('work_item_id').eq('proposal_id',latest.data.id);return {kind:'already_materialized',text:`Esses ${links.data?.length??0} trabalhos já foram registrados. Nenhum item adicional foi criado.`};}
  }
  if(!requestPattern.test(input.message.normalize('NFD').replace(/[\u0300-\u036f]/g,''))) return null;
  const decisions=await input.client.from('project_decision_proposal_state').select('*').eq('status','ratified').order('created_at',{ascending:false}).limit(2);
  if(decisions.error || decisions.data?.length!==1) return null;
  const decision=decisions.data[0]!; if(!decision.id || !decision.version) throw new Error('ratified_decision_invalid');
  const existing=await input.client.from('project_backlog_proposals').select('id').eq('source_decision_id',decision.id).limit(1);
  if(existing.data?.length) return null;
  const draft=buildLocalFirstBacklogDraft(); const issue=validateProjectBacklogProposalDraft(draft); if(issue) throw new Error(`backlog_draft_invalid:${issue}`);
  const source=await persist(input.client,input.userId,input.message);
  const created=await input.client.rpc('create_project_backlog_proposal',{source_decision_id:decision.id,source_decision_version:decision.version,objective:draft.objective,slices:toStoredSlices(draft),rationale:draft.rationale,exclusions:[...draft.exclusions],uncertainties:[...draft.uncertainties],provenance:{source:'system_derivation',source_message_id:source,authority:'advisory'},idempotency_key:`backlog-proposal:${source}`,supersedes_id:undefined});
  if(created.error) throw new Error('backlog_proposal_create_failed'); const value=object(created.data);
  return {kind:'proposal',sourceMessageId:source,text:`Proposta de backlog — versão ${value.version}\n\n${presentProjectBacklogProposal(draft)}\n\nExclusões: ${draft.exclusions.join('; ')}\nIncertezas: ${draft.uncertainties.join('; ')}`};
}
