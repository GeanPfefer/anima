/** @jest-environment node */
import { calculateCohortMetrics, type AutonomousQueueEntry, type EconomicAttemptV1, type ProposalVersion, type WorkItemId } from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

// A pressão da máquina é a única impureza da via: forçá-la torna a prova determinística.
jest.mock('./resource-governor', () => ({
  readResourceAdmission: jest.fn(() => ({ verdict: 'permit', pressure: 'low' as const })),
  readMachinePressure: jest.fn(() => 'low' as const),
}));

// O Supervisor é mockado para capturar a DECISÃO de compute que o wiring lhe entrega
// (e provar que decisões selecionadas NÃO são persistidas no wiring — só na tentativa).
jest.mock('./supervisor', () => ({
  runSupervisorTurn: jest.fn(async () => ({ outcome: 'turn_recorded', attemptId: 'attempt-x' })),
}));
jest.mock('./post-turn-observation', () => ({ persistPostTurnHostObservations: jest.fn(async () => undefined) }));
jest.mock('./economic-history', () => ({
  readEconomicHistory: jest.fn(async () => null),
  economicTaskClass: jest.fn(() => 'unknown'),
}));

// Prova de "cloud inalterado sob Router ON→Ollama": o provisioner on-demand é o mesmo seam.
jest.mock('./local-process-node-provisioner', () => ({
  LocalProcessNodeProvisioner: jest.fn().mockImplementation(() => ({
    provision: jest.fn(async () => ({ ok: false, reason: 'mock — falha real de provisão' })),
    inspect: jest.fn(async () => ({ nodeId: 'x', reachable: false, healthy: false })),
    stop: jest.fn(async () => ({ ok: true })),
    disposeAll: jest.fn(async () => undefined),
  })),
}));

import { buildProjectBacklogCycleDeps } from './autonomous-backlog-deps';
import { runSupervisorTurn } from './supervisor';
import { LocalProcessNodeProvisioner } from './local-process-node-provisioner';
import { readResourceAdmission, readMachinePressure } from './resource-governor';
import { readEconomicHistory } from './economic-history';

const runTurnMock = runSupervisorTurn as unknown as jest.Mock;
const ProvisionerMock = LocalProcessNodeProvisioner as unknown as jest.Mock;
const admissionMock = readResourceAdmission as unknown as jest.Mock;
const pressureMock = readMachinePressure as unknown as jest.Mock;
const economicHistoryMock = readEconomicHistory as unknown as jest.Mock;

const entry: AutonomousQueueEntry = {
  workItemId: '00000000-0000-0000-0000-0000000000b1' as WorkItemId,
  approvedProposalVersion: 1 as ProposalVersion,
  approvalSeq: 1,
  approvedAt: new Date(),
  capability: 'programming',
  targetReference: 'anima',
  queuePosition: 0,
  targetOccupied: false,
};

type HistoryEvent = { readonly event_type: string; readonly payload: unknown };
interface ClientConfig {
  readonly historyEvents?: readonly HistoryEvent[];
  readonly authRows?: readonly unknown[];
}
interface ClientSpy { rpcCalls: { fn: string; args: Record<string, unknown> }[]; authQueried: number }

const workItemIntent = {
  execution_spec: {
    executor: 'worktree',
    target: { kind: 'project', reference: 'anima' },
    base_sha: 'a'.repeat(40),
    model: 'qwen3-coder:latest',
    validation_criteria: [{ label: 'testes', command: 'npm test' }],
  },
};

// Autorização paga válida (fixture) — NENHUMA credencial de provider, só o envelope humano.
const validAuthRow = (now = new Date()) => ({
  id: '00000000-0000-0000-0000-0000000000f1',
  user_id: '00000000-0000-0000-0000-0000000000f2',
  provider_id: 'openai',
  node_id: null,
  resource_class: null,
  work_item_id: null,
  max_duration_ms: 3_600_000,
  max_cost_currency: 'USD',
  max_cost_amount: 1,
  valid_from: new Date(now.getTime() - 60_000).toISOString(),
  valid_until: new Date(now.getTime() + 3_600_000).toISOString(),
  revoked_at: null,
  created_at: now.toISOString(),
});

function makeClient(cfg: ClientConfig, spy: ClientSpy): SupabaseClient<Database> {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    spy.rpcCalls.push({ fn, args });
    return { data: { action: 'recorded' }, error: null };
  };
  const from = (table: string): unknown => {
    if (table === 'work_items') {
      const chain: Record<string, unknown> = {
        select: () => chain, eq: () => chain,
        maybeSingle: async () => ({ data: { intent: workItemIntent }, error: null }),
      };
      return chain;
    }
    if (table === 'work_events') {
      const chain: Record<string, unknown> = {
        select: () => chain, eq: () => chain, order: () => chain,
        limit: async () => ({ data: cfg.historyEvents ?? [], error: null }),
      };
      return chain;
    }
    if (table === 'paid_compute_authorizations') {
      spy.authQueried += 1;
      const chain: Record<string, unknown> = {
        select: () => chain, eq: () => chain, is: () => chain, lte: () => chain, gt: () => chain,
        order: () => chain, limit: async () => ({ data: cfg.authRows ?? [], error: null }),
      };
      return chain;
    }
    throw new Error(`tabela inesperada: ${table}`);
  };
  return { from, rpc } as unknown as SupabaseClient<Database>;
}

const capabilityBreakingHistory: readonly HistoryEvent[] = [
  { event_type: 'execution_failed', payload: { data: { reason: 'ollama_read_round_limit' } } },
];

const completeMetrics = (provider: 'ollama' | 'openai', cost: number) => calculateCohortMetrics([1, 2].map((): EconomicAttemptV1 => ({
  cohort: { provider, model: provider === 'openai' ? 'gpt-5.6-terra' : 'qwen3-coder:latest', capability: 'programming', taskClass: 'unknown', placement: provider === 'openai' ? 'api' : 'local' },
  terminalResult: 'completed', reachedReview: true, verified: true, durationMs: 100, timeToReviewMs: 100,
  cost: { status: 'known', value: { currency: 'USD', amount: cost / 2 } },
})));

const ROUTER_ENV = [
  'ANIMA_COMPUTE_ROUTER_V1_ENABLED', 'OPENAI_API_KEY', 'ANIMA_CODER_MODEL', 'OPENAI_MODEL',
  'ANIMA_WORKTREE_CODER_MODEL', 'ANIMA_CODER_VRAM_GB', 'ANIMA_CODER_MODEL_ALLOWLIST',
  'ANIMA_ON_DEMAND_NODE_ENABLED', 'ANIMA_ON_DEMAND_NODE_PROVISIONER', 'ANIMA_ON_DEMAND_NODE_ID',
  'ANIMA_ON_DEMAND_NODE_BILLING_MODE', 'ANIMA_ON_DEMAND_FORCE_BURST',
] as const;

describe('buildProjectBacklogCycleDeps — Compute Router V1 atrás do feature gate', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ROUTER_ENV) { saved[k] = process.env[k]; delete process.env[k]; }
    runTurnMock.mockClear();
    ProvisionerMock.mockClear();
    admissionMock.mockReturnValue({ verdict: 'permit', pressure: 'low' });
    pressureMock.mockReturnValue('low');
    economicHistoryMock.mockReset();
    economicHistoryMock.mockResolvedValue(null);
  });
  afterEach(() => {
    for (const k of ROUTER_ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });

  // A — Router OFF é semanticamente INVISÍVEL: nenhuma decisão, nenhum lookup de
  // authority, nenhum evento `compute_routing_decided`; o Supervisor roda SEM decisão.
  test('A · Router OFF preserva o legado: zero authority lookup, zero routing event, sem decisão ao Supervisor', async () => {
    const spy: ClientSpy = { rpcCalls: [], authQueried: 0 };
    process.env.OPENAI_API_KEY = 'sk-should-be-ignored-when-off';
    const deps = buildProjectBacklogCycleDeps(makeClient({}, spy), 'router-test');
    expect(deps.hostPermitsAutonomousWork()).toBe(true);

    const turn = await deps.runTurn(entry, new AbortController().signal);
    expect(turn.outcome).toBe('turn_recorded');
    expect(spy.authQueried).toBe(0);
    expect(economicHistoryMock).not.toHaveBeenCalled();
    expect(spy.rpcCalls.filter(c => c.fn === 'record_compute_routing_decision')).toHaveLength(0);
    expect(runTurnMock).toHaveBeenCalledTimes(1);
    expect(runTurnMock.mock.calls[0][0].computeRoutingDecision).toBeUndefined();
  });

  // B — Router ON + local admissível ⇒ Ollama. Decisão selecionada NÃO é persistida no
  // wiring (a tentativa persiste), e o Supervisor recebe a decisão local.
  test('B · Router ON + local cabe ⇒ Ollama local (selected, sem persistência no wiring)', async () => {
    const spy: ClientSpy = { rpcCalls: [], authQueried: 0 };
    process.env.ANIMA_COMPUTE_ROUTER_V1_ENABLED = '1';
    // Sem OPENAI_API_KEY: OpenAI não é candidata ⇒ nenhum authority lookup.
    const deps = buildProjectBacklogCycleDeps(makeClient({}, spy), 'router-test');
    expect(deps.hostPermitsAutonomousWork()).toBe(true);

    const turn = await deps.runTurn(entry, new AbortController().signal);
    expect(turn.outcome).toBe('turn_recorded');
    expect(spy.authQueried).toBe(0);
    expect(economicHistoryMock).toHaveBeenCalledTimes(1);
    expect(spy.rpcCalls.filter(c => c.fn === 'record_compute_routing_decision')).toHaveLength(0);
    const decision = runTurnMock.mock.calls[0][0].computeRoutingDecision;
    expect(decision).toMatchObject({ status: 'selected', selectedProvider: 'ollama', reasonCode: 'local_sufficient', placement: 'local' });
  });

  test('Router ON entrega coortes econômicas completas ao Router', async () => {
    const spy: ClientSpy = { rpcCalls: [], authQueried: 0 };
    process.env.ANIMA_COMPUTE_ROUTER_V1_ENABLED = '1';
    process.env.OPENAI_API_KEY = 'sk-test-fixture';
    economicHistoryMock.mockResolvedValue({ signal: {
      local: completeMetrics('ollama', 4), openai: completeMetrics('openai', 2),
    } });
    const deps = buildProjectBacklogCycleDeps(makeClient({ authRows: [validAuthRow()] }, spy), 'router-test');
    expect(deps.hostPermitsAutonomousWork()).toBe(true);
    await deps.runTurn(entry, new AbortController().signal);
    expect(runTurnMock.mock.calls[0][0].computeRoutingDecision).toMatchObject({
      selectedProvider: 'openai', reasonCode: 'economics_favors_openai', economicsBasis: {
        used: true, localSampleSize: 2, openaiSampleSize: 2, localDataQuality: 'complete', openaiDataQuality: 'complete',
      },
    });
  });

  // C — Router ON + local incapaz + autoridade paga válida ⇒ OpenAI. Prova determinística
  // por FIXTURE de autorização (nenhuma chamada paga real).
  test('C · Router ON + local incapaz + authority válida ⇒ OpenAI (provider_api)', async () => {
    const spy: ClientSpy = { rpcCalls: [], authQueried: 0 };
    process.env.ANIMA_COMPUTE_ROUTER_V1_ENABLED = '1';
    process.env.OPENAI_API_KEY = 'sk-test-fixture';
    process.env.ANIMA_CODER_MODEL = 'gpt-5.6-terra';
    const deps = buildProjectBacklogCycleDeps(
      makeClient({ historyEvents: capabilityBreakingHistory, authRows: [validAuthRow()] }, spy), 'router-test');
    expect(deps.hostPermitsAutonomousWork()).toBe(true);

    const turn = await deps.runTurn(entry, new AbortController().signal);
    expect(turn.outcome).toBe('turn_recorded');
    expect(spy.authQueried).toBeGreaterThanOrEqual(1);
    const decision = runTurnMock.mock.calls[0][0].computeRoutingDecision;
    expect(decision).toMatchObject({
      status: 'selected', selectedProvider: 'openai', placement: 'provider_api',
      reasonCode: 'local_model_incapable', authorizationId: '00000000-0000-0000-0000-0000000000f1',
    });
  });

  // D — Router ON + local incapaz + SEM autoridade ⇒ waiting. Persiste a decisão como
  // evidência (sem tentativa) e a volta para: o Supervisor NUNCA roda, nada é gasto.
  test('D · Router ON + local incapaz + sem authority ⇒ waiting_for_human_authorization (não inicia tentativa)', async () => {
    const spy: ClientSpy = { rpcCalls: [], authQueried: 0 };
    process.env.ANIMA_COMPUTE_ROUTER_V1_ENABLED = '1';
    process.env.OPENAI_API_KEY = 'sk-test-fixture';
    const deps = buildProjectBacklogCycleDeps(
      makeClient({ historyEvents: capabilityBreakingHistory, authRows: [] }, spy), 'router-test');
    expect(deps.hostPermitsAutonomousWork()).toBe(true);

    const turn = await deps.runTurn(entry, new AbortController().signal);
    expect(turn.outcome).toBe('selection_not_executable');
    expect(turn.refusal?.code).toBe('paid_authorization_required');
    const recorded = spy.rpcCalls.filter(c => c.fn === 'record_compute_routing_decision');
    expect(recorded).toHaveLength(1);
    const args = recorded[0]!.args;
    expect(args.p_attempt_id).toBeNull();
    expect((args.p_decision as { status: string }).status).toBe('waiting_for_human_authorization');
    expect(runTurnMock).not.toHaveBeenCalled();
  });

  // E — "cloud inalterado": sob Router ON com Ollama selecionado, o ciclo de vida
  // on-demand (burst) permanece FORA do Router e continua reachable/intacto — o lever
  // engata o provisioner exatamente como no caminho legado.
  test('E · Router ON→Ollama não captura o cloud: o burst on-demand ainda engata (provisioner instanciado)', async () => {
    const spy: ClientSpy = { rpcCalls: [], authQueried: 0 };
    process.env.ANIMA_COMPUTE_ROUTER_V1_ENABLED = '1';
    process.env.ANIMA_ON_DEMAND_NODE_ENABLED = 'true';
    process.env.ANIMA_ON_DEMAND_NODE_PROVISIONER = 'local-process';
    process.env.ANIMA_ON_DEMAND_NODE_ID = 'owned-burst-router';
    process.env.ANIMA_ON_DEMAND_NODE_BILLING_MODE = 'owned';
    process.env.ANIMA_ON_DEMAND_FORCE_BURST = 'true';
    const deps = buildProjectBacklogCycleDeps(makeClient({}, spy), 'router-test');
    expect(deps.hostPermitsAutonomousWork()).toBe(true);

    const turn = await deps.runTurn(entry, new AbortController().signal);
    // Provisão falha no mock ⇒ coder_node_unavailable, MAS o provisioner FOI instanciado:
    // prova que Router→Ollama percorre o mesmo entry-point de cloud/on-demand do legado.
    expect(turn.refusal?.code).toBe('coder_node_unavailable');
    expect(ProvisionerMock).toHaveBeenCalledTimes(1);
    expect(runTurnMock).not.toHaveBeenCalled();
  });
});
