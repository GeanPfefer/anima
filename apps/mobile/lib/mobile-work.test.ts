jest.mock('@anima/supabase', () => {
  const repo = {
    createProposal: jest.fn(), findResumableWorkItems: jest.fn(), listEvents: jest.fn(),
    getItem: jest.fn(), attachContext: jest.fn(), findItemsBySourceMessageId: jest.fn(), decideIntegration:jest.fn(),
  };
  return { SupabaseWorkOrchestrationRepository: jest.fn(() => repo) };
});
jest.mock('./supabase', () => ({ supabase: { rpc: jest.fn(), auth: { getSession: jest.fn() } } }));
jest.mock('./mobile-host', () => ({ callHostSupervisorTurn: jest.fn() }));

import type { WorkItem, WorkPresentation, WorkState } from '@anima/core';
import { SupabaseWorkOrchestrationRepository } from '@anima/supabase';
import { supabase } from './supabase';
import { callHostSupervisorTurn } from './mobile-host';
import { decideWorkIntegration, requestHostSupervisorTurn, respondWorkDecision, routeWorkMessage } from './mobile-work';

const repo = new (SupabaseWorkOrchestrationRepository as unknown as new () => {
  createProposal: jest.Mock; findResumableWorkItems: jest.Mock; listEvents: jest.Mock;
  getItem: jest.Mock; attachContext: jest.Mock; findItemsBySourceMessageId: jest.Mock; decideIntegration:jest.Mock;
})();
const rpc = supabase.rpc as jest.Mock;
const hostCall = callHostSupervisorTurn as jest.Mock;
const ok = <T>(value: T) => ({ ok: true as const, value });

function item(state: WorkState, overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'work-1', userId: 'user-1', sourceMessageId: 'msg-1', state, impactLevel: 'low', capability: 'programming',
    originalRequest: 'retomar', intent: {}, proposalVersion: 1,
    proposal: { schemaVersion: 1, data: { summary: 'Item', objective: 'Obj', includedScope: [], excludedScope: [], expectedEffects: [], risks: [] } },
    createdAt: new Date(), updatedAt: new Date(), ...overrides,
  } as WorkItem;
}
const withDecision = (state: WorkState): WorkPresentation => ({
  item: item(state), latestResult: null, acceptedResult: null, latestEventType: null, availableActions: [],
  pendingDecision: { requestEventId: 'evt-1', attemptId: 'attempt-1', proposalVersion: 1, reason: 'architectural_decision',
    explanation: 'Continuar?', checkpointReference: 'cp-1',
    options: [{ id: 'continuar', label: 'Continuar', effect: 'resume' }, { id: 'encerrar', label: 'Encerrar', effect: 'cancel' }] },
});

beforeEach(() => { jest.clearAllMocks(); });

describe('routeWorkMessage — intenção work_history', () => {
  test('uma pergunta de histórico reencontra os itens retomáveis via findResumableWorkItems', async () => {
    repo.findResumableWorkItems.mockResolvedValue(ok([item('blocked'), item('review', { id: 'work-2' })]));
    repo.listEvents.mockResolvedValue(ok([]));
    const routing = await routeWorkMessage('quais trabalhos tenho em aberto?', 'msg-1');
    expect(routing.kind).toBe('history');
    if (routing.kind !== 'history') throw new Error('esperado history');
    expect(routing.presentations.map(presentation => presentation.item.id)).toEqual(['work-1', 'work-2']);
    expect(repo.findResumableWorkItems).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalled();
  });

  test('mensagem comum não vira history', async () => {
    const routing = await routeWorkMessage('bom dia, tudo certo por aí', 'msg-1');
    expect(routing.kind).toBe('none');
    expect(repo.findResumableWorkItems).not.toHaveBeenCalled();
  });
});

describe('respondWorkDecision — resposta e gatilho de retomada', () => {
  test('efeito resume + estado approved sinaliza retomada ao host', async () => {
    rpc.mockResolvedValue({ data: { state: 'approved' }, error: null });
    repo.getItem.mockResolvedValue(ok(item('approved'))); repo.listEvents.mockResolvedValue(ok([]));
    const outcome = await respondWorkDecision(withDecision('blocked'), 'continuar');
    expect(rpc).toHaveBeenCalledWith('respond_to_work_decision', expect.objectContaining({ p_option_id: 'continuar', p_input_requested_event_id: 'evt-1', p_expected_proposal_version: 1 }));
    expect(outcome.resumeRequested).toBe(true);
    expect(outcome.presentation.item.state).toBe('approved');
  });

  test('efeito cancel NÃO sinaliza retomada', async () => {
    rpc.mockResolvedValue({ data: { state: 'cancelled' }, error: null });
    repo.getItem.mockResolvedValue(ok(item('cancelled'))); repo.listEvents.mockResolvedValue(ok([]));
    const outcome = await respondWorkDecision(withDecision('blocked'), 'encerrar');
    expect(outcome.resumeRequested).toBe(false);
    expect(hostCall).not.toHaveBeenCalled();
  });
});

describe('requestHostSupervisorTurn — retry só avança o Supervisor', () => {
  test('chama o host e relê o item, SEM reenviar respond_to_work_decision (sem 2º input_provided)', async () => {
    hostCall.mockResolvedValue({ outcome: 'execution_completed' });
    repo.getItem.mockResolvedValue(ok(item('review'))); repo.listEvents.mockResolvedValue(ok([]));
    const presentation = await requestHostSupervisorTurn(withDecision('approved'));
    expect(hostCall).toHaveBeenCalledTimes(1);
    expect(hostCall).toHaveBeenCalledWith('work-1', 1);
    expect(rpc).not.toHaveBeenCalled();
    expect(presentation.item.state).toBe('review');
  });
});
describe('decideWorkIntegration — segunda aprovação persistida',()=>{
  test.each(['authorize','refuse'] as const)('envia %s com IDs exatos e relê a projeção',async decision=>{
    repo.decideIntegration.mockResolvedValue(ok({action:'recorded',decision,eventSeq:9}));
    repo.getItem.mockResolvedValue(ok(item('completed')));repo.listEvents.mockResolvedValue(ok([]));
    const value:WorkPresentation={item:item('completed'),latestResult:null,acceptedResult:null,latestEventType:'result_accepted',availableActions:[],integration:{status:'awaiting_decision',acceptedResultEventId:'result-1',decision:null,availableDecisions:['authorize','refuse']}};
    await decideWorkIntegration(value,decision);
    expect(repo.decideIntegration).toHaveBeenCalledWith({workItemId:'work-1',expectedProposalVersion:1,acceptedResultEventId:'result-1',decision,decisionId:`integration:result-1:${decision}`});
    expect(repo.getItem).toHaveBeenCalledWith('work-1');
  });
});
