/** @jest-environment node */
import type { AutonomousQueueEntry, ProposalVersion, WorkItemId } from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

// A pressão da máquina é a única impureza da via: forçá-la torna a prova determinística.
// `defer/high` reproduz "local sem headroom" sem depender do estado real da Goma no CI.
jest.mock('./resource-governor', () => ({
  readResourceAdmission: jest.fn(() => ({ verdict: 'defer', pressure: 'high' as const })),
  readMachinePressure: jest.fn(() => 'high' as const),
}));

// A prova financeira negativa exige que NENHUM node suba. Mockar o provisioner permite
// afirmar diretamente que ele nunca é instanciado quando a autorização paga falta — o
// contrato exato da Missão: "provisioner NÃO deve ser instanciado/chamado".
jest.mock('./local-process-node-provisioner', () => ({
  LocalProcessNodeProvisioner: jest.fn().mockImplementation(() => ({
    provision: jest.fn(async () => ({ ok: false, reason: 'mock — não deveria ser chamado' })),
    inspect: jest.fn(async () => ({ nodeId: 'x', reachable: false, healthy: false })),
    stop: jest.fn(async () => ({ ok: true })),
    disposeAll: jest.fn(async () => undefined),
  })),
}));

import { buildProjectBacklogCycleDeps } from './autonomous-backlog-deps';
import { LocalProcessNodeProvisioner } from './local-process-node-provisioner';

const ProvisionerMock = LocalProcessNodeProvisioner as unknown as jest.Mock;

const ON_DEMAND_ENV = [
  'ANIMA_ON_DEMAND_NODE_ENABLED', 'ANIMA_ON_DEMAND_NODE_PROVISIONER',
  'ANIMA_ON_DEMAND_NODE_ID', 'ANIMA_ON_DEMAND_NODE_BILLING_MODE',
] as const;

const entry: AutonomousQueueEntry = {
  workItemId: '00000000-0000-0000-0000-0000000000a1' as WorkItemId,
  approvedProposalVersion: 1 as ProposalVersion,
  approvalSeq: 1,
  approvedAt: new Date(),
  capability: 'programming',
  targetReference: 'anima',
  queuePosition: 0,
  targetOccupied: false,
};

const workItemIntent = {
  execution_spec: {
    target: { kind: 'project', reference: 'anima' },
    model: 'qwen3-coder:latest',
    validation_criteria: [{ label: 'testes', command: 'npm test' }],
  },
};

// Cliente Supabase falso, roteado por tabela. NÃO fabrica autorização paga:
// `paid_compute_authorizations` devolve zero linhas (a via financeira deve fechar).
// `rpc` aceita a evidência de lifecycle no vazio (a persistência real é provada por pgTAP);
// aqui só destrava a via para exercitar o mapeamento de falha do wiring.
function makeClient(spy: { paidAuthQueried: number }): SupabaseClient<Database> {
  const rpc = async () => ({ data: { action: 'recorded' }, error: null });
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
        limit: async () => ({ data: [], error: null }),
      };
      return chain;
    }
    if (table === 'paid_compute_authorizations') {
      spy.paidAuthQueried += 1;
      const chain: Record<string, unknown> = {
        select: () => chain, eq: () => chain, is: () => chain, lte: () => chain, gt: () => chain,
        order: () => chain, limit: async () => ({ data: [], error: null }),
      };
      return chain;
    }
    throw new Error(`tabela inesperada: ${table}`);
  };
  return { from, rpc } as unknown as SupabaseClient<Database>;
}

describe('buildProjectBacklogCycleDeps — via financeira pelo MESMO wiring do Resident Host', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => { for (const k of ON_DEMAND_ENV) saved[k] = process.env[k]; ProvisionerMock.mockClear(); });
  afterEach(() => {
    for (const k of ON_DEMAND_ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });

  test('paid sem autorização válida: recusa paid_compute_authorization_required, provisioner nunca sobe', async () => {
    process.env.ANIMA_ON_DEMAND_NODE_ENABLED = 'true';
    process.env.ANIMA_ON_DEMAND_NODE_PROVISIONER = 'local-process';
    process.env.ANIMA_ON_DEMAND_NODE_ID = 'paid-burst-1';
    process.env.ANIMA_ON_DEMAND_NODE_BILLING_MODE = 'paid';
    const spy = { paidAuthQueried: 0 };

    const deps = buildProjectBacklogCycleDeps(makeClient(spy), 'supervisor-test');
    // O host ADMITE a volta porque há node on-demand configurado sob pressão local.
    expect(deps.hostPermitsAutonomousWork()).toBe(true);

    // A volta atravessa: placement → defer (nenhum node elegível) → decisão de
    // provisionamento consulta a autorização persistida → paga sem autorização →
    // fecha ANTES de instanciar/chamar o NodeProvisioner. Zero processo externo.
    const turn = await deps.runTurn(entry, new AbortController().signal);
    expect(turn.outcome).toBe('selection_not_executable');
    expect(turn.refusal?.code).toBe('paid_compute_authorization_required');
    expect(spy.paidAuthQueried).toBe(1);
    expect(ProvisionerMock).not.toHaveBeenCalled();
  });

  test('on-demand desligado: pressão local sem node vira coder_placement_deferred (fail-closed, sem burst)', async () => {
    // Sem ANIMA_ON_DEMAND_NODE_ENABLED, nenhum burst on-demand existe: a volta adia
    // por placement, também sem subir processo.
    for (const k of ON_DEMAND_ENV) delete process.env[k];
    const spy = { paidAuthQueried: 0 };

    const deps = buildProjectBacklogCycleDeps(makeClient(spy), 'supervisor-test');
    // Sem on-demand e sob defer, o host NÃO admite trabalho (fail-closed).
    expect(deps.hostPermitsAutonomousWork()).toBe(false);

    const turn = await deps.runTurn(entry, new AbortController().signal);
    expect(turn.outcome).toBe('selection_not_executable');
    expect(turn.refusal?.code).toBe('coder_placement_deferred');
    expect(spy.paidAuthQueried).toBe(0);
    expect(ProvisionerMock).not.toHaveBeenCalled();
  });

  test('owned com falha de provisão: recusa coder_node_unavailable sem fabricar sucesso nem rodar o turno', async () => {
    // Node OWNED (sem gate financeiro) sob pressão: o provisioner é instanciado e a
    // provisão falha ao vivo (mock devolve ok:false). A volta deve mapear para
    // coder_node_unavailable — nenhum runtime remoto fabricado, nenhum turno de
    // supervisor iniciado, e a evidência terminal (provision_failed) é coerente.
    process.env.ANIMA_ON_DEMAND_NODE_ENABLED = 'true';
    process.env.ANIMA_ON_DEMAND_NODE_PROVISIONER = 'local-process';
    process.env.ANIMA_ON_DEMAND_NODE_ID = 'owned-burst-1';
    process.env.ANIMA_ON_DEMAND_NODE_BILLING_MODE = 'owned';
    const spy = { paidAuthQueried: 0 };

    const deps = buildProjectBacklogCycleDeps(makeClient(spy), 'supervisor-test');
    expect(deps.hostPermitsAutonomousWork()).toBe(true);

    const turn = await deps.runTurn(entry, new AbortController().signal);
    expect(turn.outcome).toBe('selection_not_executable');
    expect(turn.refusal?.code).toBe('coder_node_unavailable');
    // Owned não consulta autorização paga; o provisioner FOI instanciado (a falha é real).
    expect(spy.paidAuthQueried).toBe(0);
    expect(ProvisionerMock).toHaveBeenCalledTimes(1);
  });
});
