import { COMPUTE_ROUTER_REQUESTED_DURATION_MS, projectComputeRoutingWait, type ComputeRoutingWaitEventV1 } from './compute-routing-wait';

const at = (minute: number) => new Date(Date.UTC(2026, 8, 25, 12, minute));
const decided = (status: string, minute: number, version = 1): ComputeRoutingWaitEventV1 => ({
  type: 'compute_routing_decided', proposalVersion: version, occurredAt: at(minute),
  payload: { data: { decision: {
    status, reasonCode: status === 'selected' ? 'preferred_candidate' : 'paid_authorization_required', reason: 'r',
    alternativesConsidered: [
      { provider: 'ollama', model: 'qwen', admissible: false, reasons: ['history_no_progress'] },
      { provider: 'openai', model: 'gpt-5.6-sol', admissible: false, reasons: ['paid_authority_missing'] },
    ],
  } } },
});
const started = (minute: number, version = 1): ComputeRoutingWaitEventV1 => ({ type: 'execution_started', proposalVersion: version, occurredAt: at(minute), payload: {} });
const project = (events: readonly ComputeRoutingWaitEventV1[], state: 'approved' | 'review' = 'approved', proposalVersion = 1) =>
  projectComputeRoutingWait({ workItemId: 'w1', state, proposalVersion, events });

describe('projectComputeRoutingWait', () => {
  test('espera por authority expõe o envelope exato derivado da decisão', () => {
    expect(project([decided('waiting_for_human_authorization', 1)])).toEqual({
      status: 'waiting_for_human_authorization', reasonCode: 'paid_authorization_required', reason: 'r',
      approvedProposalVersion: 1, decidedAt: at(1).toISOString(),
      requiredAuthority: {
        providerId: 'openai', nodeId: 'openai-api', resourceClass: 'provider_api:gpt-5.6-sol', model: 'gpt-5.6-sol',
        workItemId: 'w1', minDurationMs: COMPUTE_ROUTER_REQUESTED_DURATION_MS,
      },
    });
  });
  test('início de execução posterior resolve a espera', () => {
    expect(project([decided('waiting_for_human_authorization', 1), started(2)])).toBeNull();
  });
  test('decisão selecionada posterior resolve a espera', () => {
    expect(project([decided('waiting_for_human_authorization', 1), decided('selected', 2)])).toBeNull();
  });
  test('decisão de outra versão aprovada não conta', () => {
    expect(project([decided('waiting_for_human_authorization', 1, 1)], 'approved', 2)).toBeNull();
  });
  test('só unidades approved podem estar esperando o router', () => {
    expect(project([decided('waiting_for_human_authorization', 1)], 'review')).toBeNull();
  });
  test('bloqueio é projetado sem envelope de authority', () => {
    expect(project([decided('blocked', 1)])).toMatchObject({ status: 'blocked', reasonCode: 'paid_authorization_required' });
    expect(project([decided('blocked', 1)])).not.toHaveProperty('requiredAuthority');
  });
  test('espera sem candidato OpenAI identificável não é destravável: bloqueio', () => {
    const event: ComputeRoutingWaitEventV1 = { type: 'compute_routing_decided', proposalVersion: 1, occurredAt: at(1),
      payload: { data: { decision: { status: 'waiting_for_human_authorization', reasonCode: 'x', reason: 'y', alternativesConsidered: [] } } } };
    expect(project([event])).toMatchObject({ status: 'blocked' });
  });
});
