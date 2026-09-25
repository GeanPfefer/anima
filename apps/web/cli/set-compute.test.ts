import type { WorkEvent, WorkItem, WorkOperationResult } from '@anima/core';
import { runWorkSetCompute, runWorkShow, type RecordComputePreferencePort, type WorkOrchestrationPort } from './app';
import { parseArgs } from './args';
import { renderHuman } from './render';
import { EXIT } from './exit-codes';

const ok = <T>(value: T): WorkOperationResult<T> => ({ ok: true, value });
const item = (overrides: Partial<WorkItem> = {}): WorkItem => ({
  id: 'w1', userId: 'u', sourceMessageId: 'm', state: 'approved', impactLevel: 'low', capability: 'programming',
  originalRequest: 'x',
  intent: { execution_spec: { coder_backend: 'ollama', coder_backend_source: 'runtime_default' } },
  proposal: { schemaVersion: 1, data: { summary: 's', objective: 'o', includedScope: [], excludedScope: [], expectedEffects: [], risks: [] } },
  proposalVersion: 2, createdAt: new Date(), updatedAt: new Date(),
  ...overrides,
} as WorkItem);
const port = (events: readonly WorkEvent[], it: WorkItem = item()): WorkOrchestrationPort => ({
  getItem: async () => ok(it),
  listEvents: async () => ok(events),
  listContexts: async () => ok([]),
  findResumableWorkItems: async () => ok([]),
  reviewResult: async () => { throw new Error('não deve revisar'); },
  resolveApproval: async () => { throw new Error('não deve aprovar'); },
  withdrawApprovedWork: async () => { throw new Error('não deve retirar'); },
});
const SOL = { schemaVersion: 1, strategy: 'provider_api', provider: 'openai', model: 'gpt-5.6-sol' } as const;
const preferenceEvent = (preference: unknown, at = '2026-09-25T12:00:00Z'): WorkEvent => ({
  id: `p-${at}`, workItemId: 'w1', type: 'compute_preference_recorded', author: 'user', proposalVersion: 2, occurredAt: new Date(at),
  payload: { schema_version: 1, data: { preference } },
} as WorkEvent);
const waitingEvent = {
  id: 'e1', workItemId: 'w1', type: 'compute_routing_decided', author: 'system', proposalVersion: 2, occurredAt: new Date('2026-09-25T12:01:00Z'),
  payload: { schema_version: 1, data: { decision: {
    status: 'waiting_for_human_authorization', reasonCode: 'paid_authorization_required', reason: 'A preferência aprovada é OpenAI e não existe autoridade paga válida e compatível.',
    alternativesConsidered: [
      { provider: 'ollama', model: 'qwen', admissible: true, reasons: [] },
      { provider: 'openai', model: 'gpt-5.6-sol', admissible: false, reasons: ['paid_authority_missing'] },
    ],
  } } },
} as WorkEvent;

const recorder = (result: Awaited<ReturnType<RecordComputePreferencePort>> = { ok: true, replayed: false }) => {
  const calls: Parameters<RecordComputePreferencePort>[0][] = [];
  const record: RecordComputePreferencePort = async input => { calls.push(input); return result; };
  return { calls, record };
};

describe('parseArgs · work set-compute', () => {
  test('provider_api/openai/<modelo> vira preferência tipada', () => {
    expect(parseArgs(['work', 'set-compute', 'w1', '--strategy', 'provider_api', '--provider', 'openai', '--model', 'gpt-5.6-sol']))
      .toEqual({ ok: true, command: { kind: 'work-set-compute', id: 'w1', preference: SOL, json: false } });
  });
  test('router_default não aceita provider/modelo', () => {
    expect(parseArgs(['work', 'set-compute', 'w1', '--strategy', 'router_default']))
      .toEqual({ ok: true, command: { kind: 'work-set-compute', id: 'w1', preference: { schemaVersion: 1, strategy: 'router_default' }, json: false } });
    expect(parseArgs(['work', 'set-compute', 'w1', '--strategy', 'router_default', '--model', 'x']).ok).toBe(false);
  });
  test('recusa provider fora do contrato, modelo ausente e dinheiro misturado à preferência', () => {
    expect(parseArgs(['work', 'set-compute', 'w1', '--strategy', 'provider_api', '--provider', 'ollama', '--model', 'qwen']).ok).toBe(false);
    expect(parseArgs(['work', 'set-compute', 'w1', '--strategy', 'provider_api', '--provider', 'openai']).ok).toBe(false);
    expect(parseArgs(['work', 'set-compute', 'w1', '--strategy', 'provider_api', '--provider', 'openai', '--model', 'gpt-5.6-sol', '--max-usd', '3']).ok).toBe(false);
  });
  test('flags de preferência fora de set-compute são uso inválido', () => {
    expect(parseArgs(['work', 'show', 'w1', '--model', 'gpt-5.6-sol']).ok).toBe(false);
  });
});

describe('work set-compute (ato humano, sem gasto)', () => {
  test('registra a preferência na versão vigente e deixa claro que não autoriza gasto', async () => {
    const { calls, record } = recorder();
    const result = await runWorkSetCompute(port([]), record, 'w1', SOL);
    expect(result.exitCode).toBe(EXIT.OK);
    expect(calls).toEqual([{ workItemId: 'w1', expectedProposalVersion: 2, preference: SOL }]);
    expect(result.payload).toMatchObject({ kind: 'work-set-compute', replayed: false, preference: SOL });
    expect(renderHuman(result.payload)).toContain('Não autoriza gasto');
  });
  test('replay da mesma preferência é idempotente', async () => {
    const { record } = recorder({ ok: true, replayed: true });
    const result = await runWorkSetCompute(port([]), record, 'w1', SOL);
    expect(result.payload).toMatchObject({ replayed: true });
  });
  test('item já em execução/terminal é recusa por regra e nada é registrado', async () => {
    const { calls, record } = recorder();
    const result = await runWorkSetCompute(port([], item({ state: 'in_progress' })), record, 'w1', SOL);
    expect(result.exitCode).toBe(EXIT.REJECTED);
    expect(calls).toHaveLength(0);
  });
  test('recusa do RPC (versão mudou) é recusa por regra', async () => {
    const { record } = recorder({ ok: false, code: '55000', message: 'work item state or version changed' });
    expect((await runWorkSetCompute(port([]), record, 'w1', SOL)).exitCode).toBe(EXIT.REJECTED);
  });
});

describe('G · work show projeta preferência e espera', () => {
  test('preferência explícita + espera por authority aparecem juntas, com o comando que destrava', async () => {
    const result = await runWorkShow(port([preferenceEvent(SOL), waitingEvent]), 'w1');
    expect(result.payload).toMatchObject({
      computePreference: { status: 'explicit', strategy: 'provider_api', provider: 'openai', model: 'gpt-5.6-sol', recordedAt: '2026-09-25T12:00:00.000Z' },
      computeRouting: { status: 'waiting_for_human_authorization', requiredAuthority: { providerId: 'openai', resourceClass: 'provider_api:gpt-5.6-sol' } },
    });
    const text = renderHuman(result.payload);
    expect(text).toContain('Compute (preferência da unidade): provider_api · openai/gpt-5.6-sol');
    expect(text).toContain('Compute: AGUARDANDO AUTORIDADE PAGA · openai / provider_api:gpt-5.6-sol');
    expect(text).toContain('anima work authorize-compute w1');
  });
  test('preferência explícita ainda não avaliada pelo Router é dita explicitamente', async () => {
    const text = renderHuman((await runWorkShow(port([preferenceEvent(SOL)]), 'w1')).payload);
    expect(text).toContain('sem espera registrada no Router');
  });
  test('sem preferência (backend do runtime) ⇒ Router padrão local-first', async () => {
    const result = await runWorkShow(port([]), 'w1');
    expect(result.payload).toMatchObject({ computePreference: { status: 'router_default', cleared: false } });
    expect(renderHuman(result.payload)).toContain('nenhuma · Router padrão (local-first)');
  });
  test('F · item legado com coder_backend openai (sem marca) aparece como legado', async () => {
    const legacy = item({ intent: { execution_spec: { coder_backend: 'openai' } } });
    expect((await runWorkShow(port([], legacy), 'w1')).payload).toMatchObject({ computePreference: { status: 'legacy_contract', provider: 'openai' } });
  });
  test('router_default registrado por último limpa a preferência anterior', async () => {
    const result = await runWorkShow(port([preferenceEvent(SOL), preferenceEvent({ schemaVersion: 1, strategy: 'router_default' }, '2026-09-25T12:05:00Z')]), 'w1');
    expect(result.payload).toMatchObject({ computePreference: { status: 'router_default', cleared: true } });
  });
});
