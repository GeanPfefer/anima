import type { WorkItem } from '@anima/core';
import { evaluateWorkProposalReadiness } from './work-proposal-readiness';

const SHA='a'.repeat(40);
const id1='11111111-1111-4111-8111-111111111111';
const id2='22222222-2222-4222-8222-222222222222';
const item=(id:string,dependencies:string[]=[],overrides:Partial<WorkItem>={}):WorkItem=>({
  id,userId:'u',sourceMessageId:'m',state:'proposed',impactLevel:'structural',capability:'programming',originalRequest:'x',proposalVersion:2,
  intent:{execution_spec:{schema_version:1,target:{kind:'project',reference:'anima'},executor:'worktree',coder_backend:'ollama',model:'qwen3-coder:latest',base_sha:SHA,permissions:['workspace_read','workspace_write_isolated'],validation_criteria:[{label:'core',command:'npm test --workspace=packages/core -- work-routing.test.ts'}],limits:{max_attempts:2,max_duration_minutes:30},depends_on_work_item_ids:dependencies}},
  proposal:{schemaVersion:1,data:{summary:'s',objective:'o',includedScope:['packages/core/src/work-orchestration/work-routing.ts'],excludedScope:['apps/web/lib/resident-host/'],expectedEffects:['e'],risks:['r']}},
  createdAt:new Date(0),updatedAt:new Date(0),...overrides,
});

describe('readiness técnica de WorkProposal',()=>{
  test('item bounded sem dependência fica pronto para decisão e execução após approval',()=>expect(evaluateWorkProposalReadiness({item:item(id1),knownItems:[item(id1)]})).toEqual({approval:{status:'READY'},execution:{status:'READY'}}));
  test('dependência proposta não impede approval, mas bloqueia execution',()=>expect(evaluateWorkProposalReadiness({item:item(id2,[id1]),knownItems:[item(id1),item(id2,[id1])]})).toEqual({approval:{status:'READY'},execution:{status:'BLOCKED_BY_DEPENDENCY',workItemIds:[id1]}}));
  test('dependência completed libera execution readiness',()=>expect(evaluateWorkProposalReadiness({item:item(id2,[id1]),knownItems:[item(id1,[],{state:'completed'}),item(id2,[id1])]}).execution).toEqual({status:'READY'}));
  test('spec ausente e path inventado falham fechado',()=>expect(evaluateWorkProposalReadiness({item:item(id1,[],{intent:{},proposal:{schemaVersion:1,data:{...item(id1).proposal.data,includedScope:['inventado/sem-pai.ts']}}}),knownItems:[]} ).approval).toMatchObject({status:'NOT_READY'}));
});

