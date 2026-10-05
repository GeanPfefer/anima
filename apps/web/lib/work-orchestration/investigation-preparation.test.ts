/** @jest-environment node */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkOrchestrationService, type CreateWorkProposalCommand, type WorkItem } from '@anima/core';
import { buildInvestigationProposal, prepareInvestigation, investigationCommitExists, isInvestigationPreparationEnvelope, readInvestigationProvenanceFromIntent, type InvestigationPreparationDeps } from './investigation-preparation';
const input = {question:'Onde está o contrato?',baseSha:'a'.repeat(40)};
const date = '2026-10-05T12:00:00.000Z';
function fixture(refs: readonly string[] = []) {
  const createProposal = jest.fn(async (command: CreateWorkProposalCommand) => ({ok:true as const,value:{id:'work',state:'proposed',...command} as WorkItem}));
  const deps: InvestigationPreparationDeps = {service:{createProposal},commitExists:jest.fn(async()=>true),readReferences:jest.fn(async()=>refs),persistSourceMessage:jest.fn(async()=>'source'),now:()=>new Date(date)};
  return {deps,createProposal};
}
test('builder puro emite V0 exato e advisory diretamente, sem planner ou canonical provenance',()=>{
 const command=buildInvestigationProposal(input,'INV-04',date);
 expect(command.capability).toBe('research'); expect(command.impactLevel).toBe('low');
 expect(command.intent).not.toHaveProperty('planner'); expect(command.intent).not.toHaveProperty('canonical_provenance');
 expect(command.intent.execution_spec).toEqual({schema_version:1,effect_class:'read_only',executor:'investigation-v1',coder_backend:'codex-cli',model:'default',base_sha:input.baseSha,target:{kind:'project',reference:'anima'},permissions:['workspace_read'],verifier_requirement:'advisory',limits:{max_attempts:1,max_duration_minutes:30},validation_criteria:[{label:'Responder à pergunta com evidências referenciadas no snapshot autorizado e lacunas explícitas.'}]});
 expect(isInvestigationPreparationEnvelope(command.intent)).toBe(true);
});
test.each([{question:''},{question:'   '},{question:'x'.repeat(4001)},{baseSha:'bad'},{baseSha:'a'.repeat(40)+'\n'},{capability:'unknown'},{capability:''}])('recusa entrada antes de toda persistência %j',async patch=>{
 const {deps,createProposal}=fixture(); expect((await prepareInvestigation({...input,...patch},deps)).ok).toBe(false);
 expect(deps.persistSourceMessage).not.toHaveBeenCalled(); expect(createProposal).not.toHaveBeenCalled();
});
test('leitor de provenance aceita contrato completo e recusa dados incompletos/malformados',()=>{
 const intent=buildInvestigationProposal(input,'INV-01',date).intent;
 expect(readInvestigationProvenanceFromIntent(intent)).toMatchObject({reference:'INV-01',baseSha:input.baseSha});
 for(const patch of [{kind:'planner'},{origin:'other'},{baseSha:'bad'},{baseSha:'a'.repeat(40)+'\n'},{preparedAt:'today'},{preparedAt:'2026-02-30T12:00:00.000Z'},{reference:'INV-1'},{reference:'INV-01\n'},{reference:'INV-00'},{extra:true}]) {
   expect(readInvestigationProvenanceFromIntent({investigation_provenance:{...intent.investigation_provenance as object,...patch}})).toBeNull();
 }
 const p=intent.investigation_provenance as Record<string,unknown>;
 for(const field of Object.keys(p)) { const partial={...p}; delete partial[field]; expect(readInvestigationProvenanceFromIntent({investigation_provenance:partial})).toBeNull(); }
 expect(readInvestigationProvenanceFromIntent(null)).toBeNull();
});
test('aloca próxima referência livre incluindo INV canônico, insere uma origem e cria só proposed',async()=>{
 const {deps,createProposal}=fixture(['INV-01','INV-02','INV-03','SDC-14']);
 const result=await prepareInvestigation(input,deps);
 expect(result).toMatchObject({ok:true,state:'proposed',reference:'INV-04',capability:'research'});
 expect(deps.readReferences).toHaveBeenCalledTimes(2); expect(deps.persistSourceMessage).toHaveBeenCalledTimes(1); expect(createProposal).toHaveBeenCalledTimes(1);
 expect(createProposal.mock.calls[0]![0]).toMatchObject({sourceMessageId:'source',intent:{investigation_provenance:{reference:'INV-04'}}});
 expect(Object.keys(deps.service)).toEqual(['createProposal']);
});
test('colisão surgida na releitura falha antes da mensagem',async()=>{
 const {deps,createProposal}=fixture(); jest.mocked(deps.readReferences).mockResolvedValueOnce([]).mockResolvedValueOnce(['INV-01']);
 expect(await prepareInvestigation(input,deps)).toMatchObject({ok:false,code:'investigation_reference_collision'});
 expect(deps.persistSourceMessage).not.toHaveBeenCalled(); expect(createProposal).not.toHaveBeenCalled();
});
test('SHA inexistente falha antes de ler referências ou escrever',async()=>{
 const {deps,createProposal}=fixture(); jest.mocked(deps.commitExists).mockResolvedValue(false);
 expect(await prepareInvestigation(input,deps)).toMatchObject({code:'base_sha_not_found'});
 expect(deps.readReferences).not.toHaveBeenCalled(); expect(deps.persistSourceMessage).not.toHaveBeenCalled(); expect(createProposal).not.toHaveBeenCalled();
});
test('RPC recusada ou lançada reporta janela de origem órfã',async()=>{
 for (const throws of [false,true]) {
  const {deps}=fixture(); deps.service.createProposal=jest.fn(async()=>{if(throws)throw new Error('RPC failed');return {ok:false as const,error:{code:'invalid_input' as const,message:'RPC refused',retryable:false}};});
  expect(await prepareInvestigation(input,deps)).toMatchObject({ok:false,code:'proposal_persist_failed',orphanSourceMessageId:'source',message:expect.stringContaining('órfã possível')});
 }
});
test('git real distingue commit existente, objeto não commit e SHA inexistente',async()=>{
 const repo=mkdtempSync(join(tmpdir(),'anima-investigation-'));
 try {
  const git=(...args:string[])=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim();
  git('init'); git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','--allow-empty','-m','fixture');
  const sha=git('rev-parse','HEAD'), tree=git('rev-parse','HEAD^{tree}');
  expect(await investigationCommitExists(sha,repo)).toBe(true); expect(await investigationCommitExists(tree,repo)).toBe(false);
  const {deps,createProposal}=fixture(); const gitDeps={...deps,commitExists:(sha:string)=>investigationCommitExists(sha,repo)};
  expect(await prepareInvestigation({...input,baseSha:'f'.repeat(40)},gitDeps)).toMatchObject({code:'base_sha_not_found'});
  expect(deps.persistSourceMessage).not.toHaveBeenCalled(); expect(createProposal).not.toHaveBeenCalled();
 } finally {rmSync(repo,{recursive:true,force:true});}
});

test('serviço real com repositório falso persiste somente proposta, sem approve/start/classify',async()=>{
 const {deps}=fixture(); const calls:string[]=[];
 const repository=new Proxy({}, {get:(_target,key)=>async(command:CreateWorkProposalCommand)=>{
   calls.push(String(key)); if(key!=='createProposal') throw new Error(`Operação inesperada: ${String(key)}`);
   return {ok:true as const,value:{...command,id:'real-service-fake-repo',userId:'u',originalRequest:input.question,state:'proposed',proposalVersion:1,createdAt:new Date(date),updatedAt:new Date(date)} as WorkItem};
 }}) as import('@anima/core').WorkOrchestrationRepository;
 const result=await prepareInvestigation(input,{...deps,service:new WorkOrchestrationService(repository)});
 expect(result).toMatchObject({ok:true,state:'proposed',workItemId:'real-service-fake-repo'});expect(calls).toEqual(['createProposal']);
});
test('falhas de leitura/origem e esgotamento não criam proposta',async()=>{
 const {deps,createProposal}=fixture();
 expect(await prepareInvestigation(input,{...deps,readReferences:async()=>{throw new Error('read failed');}})).toMatchObject({ok:false});
 expect(await prepareInvestigation(input,{...deps,readReferences:async()=>Array.from({length:99},(_,i)=>`INV-${String(i+1).padStart(2,'0')}`)})).toMatchObject({code:'investigation_references_exhausted'});
 expect(deps.persistSourceMessage).not.toHaveBeenCalled();
 expect(await prepareInvestigation(input,{...deps,persistSourceMessage:async()=>null})).toMatchObject({code:'source_message_persist_failed'});
 expect(createProposal).not.toHaveBeenCalled();
});
test('builder e profile recusam provenance/envelope incoerentes sem persistência',()=>{
 expect(()=>buildInvestigationProposal(input,'INV-1',date)).toThrow('investigation_envelope_invalid');
 const command=buildInvestigationProposal(input,'INV-01',date), spec=command.intent.execution_spec as Record<string,unknown>;
 for(const patch of [{schema_version:2},{permissions:['workspace_write_isolated']},{executor:'worktree'},{model:'custom'},{coder_backend:'ollama'},{verifier_requirement:'required_fail_closed'}]) {
  expect(isInvestigationPreparationEnvelope({...command.intent,execution_spec:{...spec,...patch}})).toBe(false);
 }
});
