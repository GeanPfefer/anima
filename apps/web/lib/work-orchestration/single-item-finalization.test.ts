/** @jest-environment node */
import { finalizeSingleItemTurn, persistPostTurnHostObservations, type PostTurnObservationInput } from './post-turn-observation';
import { persistHostObservedGateEvidence } from './gate-evidence';
import { persistHostObservedCoderEvidence } from './coder-evidence';
import { observeAndPersistHostGitEvidence } from './host-evidence';
import { verifyAndReleaseCandidate } from './mandated-verification';
import { createWorkOrchestrationService } from './server';

jest.mock('./gate-evidence', () => ({ persistHostObservedGateEvidence: jest.fn() }));
jest.mock('./coder-evidence', () => ({ persistHostObservedCoderEvidence: jest.fn() }));
jest.mock('./host-evidence', () => ({ observeAndPersistHostGitEvidence: jest.fn() }));
jest.mock('./server', () => ({ createWorkOrchestrationService: jest.fn() }));
jest.mock('./mandated-verification', () => ({ ...jest.requireActual('./mandated-verification'), verifyAndReleaseCandidate: jest.fn() }));
const order: string[] = [];
function input(kind: 'result' | 'error' | 'cancelled' = 'result'): PostTurnObservationInput {
  return { client: { rpc: jest.fn(async (name, args) => {
      expect(name).toBe('release_work_claim'); expect(args).toEqual({ claim_id: 'claim-own', reason: 'attempt_finished' });
      order.push('release'); return {error:null,data:{id:'claim-own',work_item_id:'own',attempt_id:'attempt-own',approved_proposal_version:1,release_reason:'attempt_finished',released_at:'2026-10-10T12:00:00Z'}};
    }) },
    result: { outcome: kind === 'result' ? 'execution_interrupted' : kind === 'error' ? 'execution_failed' : 'execution_cancelled',
      selection: {workItemId:'own',approvedProposalVersion:1}, attemptId:'attempt-own', claimId:'claim-own', terminalKind:kind, claimReleased:false, requiresAnotherTurn:false },
    contract: {executor:'worktree',coderBackend:'codex-cli',baseSha:'1'.repeat(40)},
    gateObservations: [{label:'test',exitCode:0}], coderObservations:[{backendId:'codex-cli:default',seconds:1}],
    systemWriter: { gateEvidence: {}, coderEvidence: {}, hostEvidence: {}, verifierOpinion: {} }, finalizationTimeoutMs:20,
  } as unknown as PostTurnObservationInput;
}
beforeEach(() => {
  order.length=0; jest.resetAllMocks();
  (persistHostObservedGateEvidence as jest.Mock).mockImplementation(async()=>{order.push('gate');return {ok:true};});
  (persistHostObservedCoderEvidence as jest.Mock).mockImplementation(async()=>{order.push('coder');return {ok:true};});
  (observeAndPersistHostGitEvidence as jest.Mock).mockImplementation(async()=>{order.push('git');return {ok:true};});
  (createWorkOrchestrationService as jest.Mock).mockReturnValue({getItem:jest.fn(),listEvents:jest.fn()});
  (verifyAndReleaseCandidate as jest.Mock).mockImplementation(async()=>{order.push('verifier');return {status:'released',verdict:'verified'};});
});
test('sucesso só depois das três evidências, Verifier persistido e liberação própria', async()=>{
  const i=input(); const result=await finalizeSingleItemTurn(i);
  expect(order).toEqual(['gate','coder','git','verifier','release']);
  expect(result).toMatchObject({outcome:'execution_completed',claimReleased:true,requiresAnotherTurn:false});
  expect(verifyAndReleaseCandidate).toHaveBeenCalledWith('own',expect.objectContaining({requireVerified:true}));
});
test.each([persistHostObservedGateEvidence,persistHostObservedCoderEvidence,observeAndPersistHostGitEvidence])('evidência recusada não declara sucesso, mas libera execução encerrada',async port=>{
  (port as jest.Mock).mockResolvedValue({ok:false});
  const r=await finalizeSingleItemTurn(input());
  expect(r).toMatchObject({outcome:'execution_interrupted',claimReleased:true,requiresAnotherTurn:false});
  expect(verifyAndReleaseCandidate).not.toHaveBeenCalled(); expect(order.at(-1)).toBe('release');
});
test.each(['rejected','inconclusive'] as const)('parecer %s não é sucesso',async verdict=>{
  (verifyAndReleaseCandidate as jest.Mock).mockResolvedValue({status:'released',verdict});
  expect(await finalizeSingleItemTurn(input())).toMatchObject({outcome:'execution_interrupted',claimReleased:true});
});
test('timeout de evidência libera apenas claim própria e nunca agenda outra volta',async()=>{
  (persistHostObservedGateEvidence as jest.Mock).mockImplementation(()=>new Promise(()=>undefined));
  expect(await finalizeSingleItemTurn(input())).toMatchObject({claimReleased:true,refusal:{code:'single_item_verification_timeout'},requiresAnotherTurn:false});
});
test.each(['error','cancelled'] as const)('terminal %s confirmado preserva falha e libera claim',async kind=>{
  const r=await finalizeSingleItemTurn(input(kind)); expect(r.claimReleased).toBe(true);
  expect(r.outcome).toBe(kind==='error'?'execution_failed':'execution_cancelled');
  expect(verifyAndReleaseCandidate).not.toHaveBeenCalled();
});
test('backend observado divergente impede verificação e sucesso',async()=>{
  const i=input(); const r=await finalizeSingleItemTurn({...i,coderObservations:[{backendId:'openai:other',durationMs:1000,outcome:'succeeded'}]});
  expect(r.refusal?.code).toBe('single_item_executor_mismatch'); expect(order).toEqual(['release']);
});
test('recusa de autorização na liberação é explícita, sem claim falsamente liberada',async()=>{
  const i=input(); (i.client.rpc as jest.Mock).mockResolvedValue({error:{message:'42501'}});
  expect(await finalizeSingleItemTurn(i)).toMatchObject({outcome:'execution_interrupted',claimReleased:false,refusal:{code:'single_item_claim_release_failed'}});
});
test('timeout da liberação fica indeterminado; não repete RPC nem inicia outra volta',async()=>{
  const i=input(); (i.client.rpc as jest.Mock).mockImplementation(()=>new Promise(()=>undefined));
  expect(await finalizeSingleItemTurn(i)).toMatchObject({outcome:'execution_interrupted',claimReleased:false,requiresAnotherTurn:false,refusal:{code:'single_item_claim_release_failed'}});
  expect(i.client.rpc).toHaveBeenCalledTimes(1);
});
test('sem terminal durável não inventa encerramento nem abandona exclusividade',async()=>{
  const i=input(); const turn={...i.result,terminalKind:null};
  expect(await finalizeSingleItemTurn({...i,result:turn})).toBe(turn); expect(order).toEqual([]);
});
test('fluxo global advisory conserva fail-open; Single-Item recusa evidências ausentes',async()=>{
  const i=input();
  expect(await persistPostTurnHostObservations({...i,singleItem:true,gateObservations:[]})).toMatchObject({status:'held'});
  (persistHostObservedGateEvidence as jest.Mock).mockRejectedValue(Error('writer failed'));
  await persistPostTurnHostObservations(i);
  expect(verifyAndReleaseCandidate).toHaveBeenCalledWith('own',expect.not.objectContaining({requireVerified:true}));
});

test.each([null,{id:'foreign'},{id:'claim-own',work_item_id:'other'}])('resposta de liberação incompleta ou estrangeira é recusada',async data=>{
  const i=input();(i.client.rpc as jest.Mock).mockResolvedValue({error:null,data});
  expect(await finalizeSingleItemTurn(i)).toMatchObject({claimReleased:false,outcome:'execution_interrupted',refusal:{code:'single_item_claim_release_failed'}});
});
