import type { WorkEvent, WorkItem, WorkOperationResult } from '@anima/core';
import { runWorkAuthorizeCompute, runWorkShow, type ComputeAuthorityGrantPort, type WorkOrchestrationPort } from './app';
import { parseArgs } from './args';
import { renderHuman } from './render';
import { EXIT } from './exit-codes';

const ok = <T>(value: T): WorkOperationResult<T> => ({ ok: true, value });
const approvedItem = {
  id: 'w1', userId: 'u', sourceMessageId: 'm', state: 'approved', impactLevel: 'low', capability: 'programming',
  originalRequest: 'x', intent: {},
  proposal: { schemaVersion: 1, data: { summary: 's', objective: 'o', includedScope: [], excludedScope: [], expectedEffects: [], risks: [] } },
  proposalVersion: 1, createdAt: new Date(), updatedAt: new Date(),
} satisfies WorkItem;
const waitingEvent = {
  id: 'e1', workItemId: 'w1', type: 'compute_routing_decided', author: 'system', proposalVersion: 1, occurredAt: new Date('2026-09-25T12:00:00Z'),
  payload: { schema_version: 1, data: { decision: {
    status: 'waiting_for_human_authorization', reasonCode: 'paid_authorization_required', reason: 'sem authority',
    alternativesConsidered: [
      { provider: 'ollama', model: 'qwen', admissible: false, reasons: ['history_no_progress'] },
      { provider: 'openai', model: 'gpt-5.6-sol', admissible: false, reasons: ['paid_authority_missing'] },
    ],
  } } },
} satisfies WorkEvent;

const port = (events: readonly WorkEvent[], item: WorkItem = approvedItem): WorkOrchestrationPort => ({
  getItem: async () => ok(item),
  listEvents: async () => ok(events),
  listContexts: async () => ok([]),
  findResumableWorkItems: async () => ok([]),
  reviewResult: async () => { throw new Error('não deve revisar'); },
  resolveApproval: async () => { throw new Error('não deve aprovar'); },
  withdrawApprovedWork: async () => { throw new Error('não deve retirar'); },
});
const grants = (active = 0) => {
  const calls: Parameters<ComputeAuthorityGrantPort['grant']>[0][] = [];
  const grantPort: ComputeAuthorityGrantPort = {
    activeFor: async () => ({ ok: true, count: active }),
    grant: async input => { calls.push(input); return { ok: true, authorizationId: 'auth-1' }; },
  };
  return { calls, grantPort };
};
const limits = { maxCostUsd: 3, maxMinutes: 30, validHours: 2 };
const now = () => new Date('2026-09-25T13:00:00Z');

describe('work authorize-compute (ato humano sobre a espera registrada pelo Router)', () => {
  test('concede exatamente o envelope da decisão com os limites humanos, sem executar', async () => {
    const { calls, grantPort } = grants();
    const result = await runWorkAuthorizeCompute(port([waitingEvent]), grantPort, 'w1', limits, now);
    expect(result.exitCode).toBe(EXIT.OK);
    expect(calls).toEqual([{
      providerId: 'openai', nodeId: 'openai-api', resourceClass: 'provider_api:gpt-5.6-sol', workItemId: 'w1',
      maxDurationMs: 1_800_000, maxCost: { currency: 'USD', amount: 3 },
      validFrom: '2026-09-25T12:59:30.000Z', validUntil: '2026-09-25T15:00:00.000Z',
    }]);
    expect(renderHuman(result.payload)).toContain('openai / openai-api / provider_api:gpt-5.6-sol');
  });

  test('sem espera registrada é recusa por regra e nada é concedido', async () => {
    const { calls, grantPort } = grants();
    const result = await runWorkAuthorizeCompute(port([]), grantPort, 'w1', limits, now);
    expect(result.exitCode).toBe(EXIT.REJECTED);
    expect(calls).toHaveLength(0);
  });

  test('espera já resolvida por início de execução não é reautorizada', async () => {
    const { calls, grantPort } = grants();
    const started = { ...waitingEvent, id: 'e2', type: 'execution_started', payload: {} } satisfies WorkEvent;
    expect((await runWorkAuthorizeCompute(port([waitingEvent, started]), grantPort, 'w1', limits, now)).exitCode).toBe(EXIT.REJECTED);
    expect(calls).toHaveLength(0);
  });

  test('authority ativa compatível já existente não empilha exposição', async () => {
    const { calls, grantPort } = grants(1);
    const result = await runWorkAuthorizeCompute(port([waitingEvent]), grantPort, 'w1', limits, now);
    expect(result.exitCode).toBe(EXIT.REJECTED);
    expect(result.payload).toMatchObject({ code: 'authority_already_active' });
    expect(calls).toHaveLength(0);
  });

  test('duração abaixo do que o Router pede é recusada (a espera continuaria)', async () => {
    const { calls, grantPort } = grants();
    const result = await runWorkAuthorizeCompute(port([waitingEvent]), grantPort, 'w1', { ...limits, maxMinutes: 10 }, now);
    expect(result.exitCode).toBe(EXIT.USAGE);
    expect(calls).toHaveLength(0);
  });

  test('work show projeta a espera e o comando exato para destravar', async () => {
    const result = await runWorkShow(port([waitingEvent]), 'w1');
    expect(result.payload).toMatchObject({ computeRouting: { status: 'waiting_for_human_authorization', requiredAuthority: { resourceClass: 'provider_api:gpt-5.6-sol' } } });
    const out = renderHuman(result.payload);
    expect(out).toContain('Compute: AGUARDANDO AUTORIDADE PAGA · openai / provider_api:gpt-5.6-sol');
    expect(out).toContain('anima work authorize-compute w1 --max-usd <US$> --max-minutes <≥30> --valid-hours <h>');
  });
});

describe('parse de work authorize-compute', () => {
  test('exige os três limites explícitos, dentro das faixas', () => {
    expect(parseArgs(['work', 'authorize-compute', 'w1', '--max-usd', '3', '--max-minutes', '30', '--valid-hours', '2'])).toEqual({
      ok: true, command: { kind: 'work-authorize-compute', id: 'w1', maxCostUsd: 3, maxMinutes: 30, validHours: 2, json: false },
    });
    expect(parseArgs(['work', 'authorize-compute', 'w1', '--max-usd', '3', '--max-minutes', '30']).ok).toBe(false);
    expect(parseArgs(['work', 'authorize-compute', 'w1', '--max-usd', '500', '--max-minutes', '30', '--valid-hours', '2']).ok).toBe(false);
    expect(parseArgs(['work', 'authorize-compute', 'w1', '--max-usd', '-1', '--max-minutes', '30', '--valid-hours', '2']).ok).toBe(false);
  });
  test('limites fora de authorize-compute são uso inválido', () => {
    expect(parseArgs(['work', 'show', 'w1', '--max-usd', '3']).ok).toBe(false);
  });
});
