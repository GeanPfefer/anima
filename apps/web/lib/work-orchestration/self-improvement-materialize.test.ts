import type { Json } from '@anima/types';
import type {
  CreateWorkProposalCommand,
  SelfDeficiencyCoverage,
  SelfImprovementMaterializerDeps,
  WorkEvent,
} from '@anima/core';
import {
  mapSelfImprovementResult,
  materializeSelfImprovementWhenIdle,
  runMaterializersInOrder,
  type SelfImprovementIdleDeps,
} from './self-improvement-materialize';
import type { MaterializationAttempt } from '../resident-host/resident-host';

// Provado por DOUBLES (sem banco/LLM). O detector e o materializer puros do core já têm
// suas próprias regressões; aqui cobrimos SÓ a fiação idle: fail-closed do histórico,
// curto-circuito sem deficiência, mapeamento do desfecho para `MaterializationAttempt`
// (structural ⇒ human_required) e a composição em ordem.

const failEvent = (id: string, workItemId: string, reason: string, time: string): WorkEvent => ({
  id,
  workItemId,
  type: 'execution_failed',
  author: 'system',
  proposalVersion: 2,
  payload: { schema_version: 1, data: { attempt_id: `att-${id}`, reason, retryable: false } } as unknown as Json,
  occurredAt: new Date(time),
});

// Duas falhas com a MESMA causa reconhecida em work_items DISTINTOS ⇒ um
// `repeated_failure` (threshold V0 = 2). Espelha a fixture do core.
const twoFailures: readonly WorkEvent[] = [
  failEvent('e1', 'w1', 'gate_failed', '2026-09-10T10:00:00Z'),
  failEvent('e2', 'w2', 'gate_failed', '2026-09-11T10:00:00Z'),
];

const recordingDeps = (overrides?: Partial<SelfImprovementMaterializerDeps>): {
  readonly deps: SelfImprovementMaterializerDeps;
  readonly created: CreateWorkProposalCommand[];
  readonly sourceMessages: string[];
} => {
  const created: CreateWorkProposalCommand[] = [];
  const sourceMessages: string[] = [];
  const deps: SelfImprovementMaterializerDeps = {
    readDeficiencyCoverage: async (): Promise<readonly SelfDeficiencyCoverage[]> => [],
    persistSourceMessage: async (content) => {
      sourceMessages.push(content);
      return 'msg-1';
    },
    createProposal: async (command) => {
      created.push(command);
      return { ok: true, workItemId: 'wi-new' };
    },
    ...overrides,
  };
  return { deps, created, sourceMessages };
};

describe('mapSelfImprovementResult', () => {
  it('mapeia sucesso para human_required (structural nunca auto-aprova)', () => {
    const attempt = mapSelfImprovementResult({
      ok: true,
      workItemId: 'wi-new',
      deficiencyId: 'repeated_failure|gate_failed',
      // proposal não é lido pelo mapeamento
      proposal: {} as never,
    });
    expect(attempt).toEqual<MaterializationAttempt>({
      materialized: true,
      detail: 'self_deficiency:repeated_failure|gate_failed',
      workItemId: 'wi-new',
      authorization: 'human_required',
      authorizationDetail: 'structural_self_improvement_requires_human_approval',
    });
  });

  it('mapeia falha para materialized:false com a razão', () => {
    expect(mapSelfImprovementResult({ ok: false, reason: 'no_candidate' })).toEqual({
      materialized: false,
      detail: 'self_improvement:no_candidate',
    });
  });
});

describe('materializeSelfImprovementWhenIdle', () => {
  it('fail-closed quando o histórico não carrega', async () => {
    const { deps } = recordingDeps();
    const attempt = await materializeSelfImprovementWhenIdle({
      loadEvents: async () => ({ ok: false, reason: 'event_history_invalid' }),
      materializerDeps: deps,
    });
    expect(attempt).toEqual({ materialized: false, detail: 'self_improvement:history_event_history_invalid' });
  });

  it('fail-closed quando loadEvents lança', async () => {
    const { deps } = recordingDeps();
    const attempt = await materializeSelfImprovementWhenIdle({
      loadEvents: async () => {
        throw new Error('boom');
      },
      materializerDeps: deps,
    });
    expect(attempt.materialized).toBe(false);
    expect(attempt.detail).toBe('self_improvement:history_threw:boom');
  });

  it('curto-circuita sem deficiência: NÃO toca os portos de efeito', async () => {
    const { deps, created, sourceMessages } = recordingDeps();
    const attempt = await materializeSelfImprovementWhenIdle({
      loadEvents: async () => ({ ok: true, events: [] }),
      materializerDeps: deps,
    });
    expect(attempt).toEqual({ materialized: false, detail: 'self_improvement:no_deficiency' });
    expect(created).toHaveLength(0);
    expect(sourceMessages).toHaveLength(0);
  });

  it('materializa UMA proposta structural em proposed e reporta human_required', async () => {
    const { deps, created, sourceMessages } = recordingDeps();
    const attempt = await materializeSelfImprovementWhenIdle({
      loadEvents: async () => ({ ok: true, events: twoFailures }),
      materializerDeps: deps,
    });
    expect(attempt.materialized).toBe(true);
    expect(attempt.workItemId).toBe('wi-new');
    expect(attempt.authorization).toBe('human_required');
    expect(attempt.detail).toBe('self_deficiency:repeated_failure|gate_failed');
    // Exatamente UM work_item; desfecho `proposed` (impacto structural, sem execution_spec).
    expect(created).toHaveLength(1);
    expect(created[0]!.impactLevel).toBe('structural');
    expect(created[0]!.intent).not.toHaveProperty('execution_spec');
    expect(sourceMessages).toHaveLength(1);
  });

  it('não duplica: uma deficiência já coberta por work ativo não re-materializa', async () => {
    const { deps, created } = recordingDeps({
      readDeficiencyCoverage: async () => [
        { deficiencyId: 'repeated_failure|gate_failed', workItemId: 'w-existing', state: 'proposed', updatedAt: '2026-09-12T10:00:00Z' },
      ],
    });
    const attempt = await materializeSelfImprovementWhenIdle({
      loadEvents: async () => ({ ok: true, events: twoFailures }),
      materializerDeps: deps,
    });
    expect(attempt.materialized).toBe(false);
    expect(created).toHaveLength(0);
  });
});

describe('runMaterializersInOrder', () => {
  const ok = (id: string): MaterializationAttempt => ({ materialized: true, detail: id });
  const no = (id: string): MaterializationAttempt => ({ materialized: false, detail: id });

  it('lista vazia ⇒ nenhum materializer configurado', async () => {
    expect(await runMaterializersInOrder([])).toEqual({ materialized: false, detail: 'no_materializer_configured' });
  });

  it('o primeiro que materializa vence e curto-circuita os seguintes', async () => {
    const calls: string[] = [];
    const attempt = await runMaterializersInOrder([
      async () => { calls.push('a'); return ok('a'); },
      async () => { calls.push('b'); return ok('b'); },
    ]);
    expect(attempt).toEqual(ok('a'));
    expect(calls).toEqual(['a']);
  });

  it('cai para o próximo quando o anterior não materializa; retorna o último desfecho', async () => {
    const calls: string[] = [];
    const attempt = await runMaterializersInOrder([
      async () => { calls.push('a'); return no('a-empty'); },
      async () => { calls.push('b'); return no('b-empty'); },
    ]);
    expect(attempt).toEqual(no('b-empty'));
    expect(calls).toEqual(['a', 'b']);
  });
});
