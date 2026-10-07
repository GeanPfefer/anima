/** @jest-environment node */
import type { BacklogHostTurnResult } from './autonomous-backlog-host-turn';
import { planAutonomousBacklogTurn, type AutonomousQueueCandidate, type WorkIntelligenceClassificationV1 } from '@anima/core';
import { readPostApprovalClassificationConfig } from './post-approval-classification';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@anima/types';

// Amarração por workItemId (ADR-003, Governed Retry V0): quando a invocação veio de um
// ato explícito (sinal/retry governado), esta volta é limitada ao item pedido. Provamos
// que o ciclo real recebe SÓ o item solicitado e que um pedido inelegível/inexistente
// esvazia o backlog em vez de cair em "qualquer item elegível" (sem fallback global).

jest.mock('./autonomous-backlog-deps', () => ({ buildProjectBacklogCycleDeps: jest.fn() }));
jest.mock('./autonomous-backlog-driver', () => ({ runAutonomousBacklogCycle: jest.fn() }));
jest.mock('./autonomous-backlog-host-turn', () => ({ runAutonomousBacklogHostTurn: jest.fn() }));
jest.mock('@anima/core', () => {
  const actual = jest.requireActual<typeof import('@anima/core')>('@anima/core');
  return { ...actual, planAutonomousBacklogTurn: jest.fn(actual.planAutonomousBacklogTurn) };
});

import { runProjectBacklogHostTurn } from './backlog-host-turn-run';
import { buildProjectBacklogCycleDeps } from './autonomous-backlog-deps';
import { runAutonomousBacklogCycle } from './autonomous-backlog-driver';
import { runAutonomousBacklogHostTurn } from './autonomous-backlog-host-turn';

const RESULT = { cyclesExecuted: 0, turnsExecuted: 0, itemsTouched: 0, stopReason: 'max_cycles_reached', continuation: 'stop', moreWorkAvailable: false, lastOutcome: null, cycles: [] } as unknown as BacklogHostTurnResult;
type RawEntry = string | { readonly id: string; readonly state?: string };
const candidate = (entry: RawEntry) => (typeof entry === 'string' ? { item: { id: entry } } : { item: { id: entry.id, state: entry.state } });

// O host-turn é mockado: apenas dispara UM ciclo e devolve o resultado. O ciclo captura o
// que `readBacklog` (possivelmente filtrado pela amarração) realmente entrega ao driver.
function wire(rawBacklog: readonly RawEntry[]): () => Promise<string[]> {
  let seen: string[] = [];
  (buildProjectBacklogCycleDeps as jest.Mock).mockReturnValue({
    readBacklog: async () => rawBacklog.map(candidate),
    hostPermitsAutonomousWork: () => true,
    runTurn: jest.fn(),
  });
  (runAutonomousBacklogCycle as jest.Mock).mockImplementation(async (deps: { readBacklog: () => Promise<ReadonlyArray<{ item: { id: string } }>> }) => {
    seen = (await deps.readBacklog()).map(entry => entry.item.id);
    return { turnsExecuted: 0, itemsTouched: 0, stopReason: 'max_turns_reached', turns: [] };
  });
  (runAutonomousBacklogHostTurn as jest.Mock).mockImplementation(async (deps: { runCycle: (signal: AbortSignal) => Promise<unknown> }) => {
    await deps.runCycle(new AbortController().signal);
    return RESULT;
  });
  return async () => seen;
}

const run = (requestedWorkItemId?: string) => runProjectBacklogHostTurn({
  client: {} as SupabaseClient<Database>, ownerInstanceId: 'owner', maxTurnsPerCycle: 1, maxCycles: 1,
  signal: new AbortController().signal, ...(requestedWorkItemId ? { requestedWorkItemId } : {}),
});

describe('runProjectBacklogHostTurn — classificação pós-aprovação', () => {
  const since = new Date('2026-10-01T00:00:00Z');
  const date = new Date('2026-10-05T00:00:00Z');
  const cls: WorkIntelligenceClassificationV1 = { schemaVersion: 1, complexity: 'bounded', risk: 'low', reversibility: 'reversible', planClarity: 'clear', urgency: 'normal', provenance: { kind: 'system_assessed', classifiedAt: date.toISOString(), classifierId: 'canonical_backlog_v1-bridge', policyVersion: 'human-approved-project-planner-v1' } };
  const unclassified: AutonomousQueueCandidate = {
    item: { id: 'T3', userId: 'u', sourceMessageId: 'm', originalRequest: 'Classify', state: 'approved', capability: 'programming', impactLevel: 'low', proposalVersion: 1, createdAt: since, updatedAt: date,
      proposal: { schemaVersion: 1, data: { summary: 's', objective: 'o', includedScope: ['x'], excludedScope: ['deploy'], expectedEffects: ['ok'], risks: [] } },
      intent: { canonical_provenance: { kind: 'canonical_backlog', sourceId: 'SDC-22', document: 'plan', heading: 'SDC', canonicalObjective: 'Classify', planningGeneration: 1 },
        execution_spec: { schema_version: 1, target: { kind: 'project', reference: 'anima' }, permissions: [], validation_criteria: [{ label: 'tests' }], limits: { max_attempts: 1 } } } },
    approval: { seq: 1, approvedAt: date, proposalVersion: 1 }, openClaim: null, currentClassification: null,
  };
  const base = () => ({ client: {} as SupabaseClient<Database>, ownerInstanceId: 'owner', maxTurnsPerCycle: 1, maxCycles: 1, signal: new AbortController().signal });
  const realDriver = jest.requireActual<typeof import('./autonomous-backlog-driver')>('./autonomous-backlog-driver');
  const realCore = jest.requireActual<typeof import('@anima/core')>('@anima/core');
  let snapshot: readonly AutonomousQueueCandidate[];
  let order: string[];
  let read: jest.Mock;
  let supervisor: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    snapshot = [unclassified]; order = [];
    read = jest.fn(async () => { order.push('read'); return snapshot; });
    supervisor = jest.fn(async () => {
      order.push('supervisor');
      return { outcome: 'no_eligible_work', reconciliation: [], selection: null, execution: null, refusal: null, wait: null };
    });
    (planAutonomousBacklogTurn as jest.Mock).mockImplementation((input: Parameters<typeof planAutonomousBacklogTurn>[0]) => {
      order.push('plan'); return realCore.planAutonomousBacklogTurn(input);
    });
    (buildProjectBacklogCycleDeps as jest.Mock).mockReturnValue({ readBacklog: read, hostPermitsAutonomousWork: () => true, runTurn: supervisor });
    (runAutonomousBacklogCycle as jest.Mock).mockImplementation(realDriver.runAutonomousBacklogCycle);
    (runAutonomousBacklogHostTurn as jest.Mock).mockImplementation(async (deps: { runCycle: (signal: AbortSignal) => Promise<unknown> }) => {
      await deps.runCycle(new AbortController().signal); return RESULT;
    });
  });
  afterEach(() => (planAutonomousBacklogTurn as jest.Mock).mockImplementation(realCore.planAutonomousBacklogTurn));

  test.each<Readonly<Record<string, string | undefined>>>([{}, { ANIMA_POST_APPROVAL_CLASSIFICATION: '1' }, { ANIMA_POST_APPROVAL_CLASSIFICATION: '1', ANIMA_POST_APPROVAL_CLASSIFICATION_SINCE: 'today' }])('config inativa %j preserva o plano e resultado', async env => {
    const ensure = jest.fn();
    const expected = realCore.planAutonomousBacklogTurn({ candidates: snapshot, now: date, hostPermitsAutonomousWork: true });
    expect(await runProjectBacklogHostTurn({ ...base(), postApprovalClassificationConfig: readPostApprovalClassificationConfig(env), postApprovalClassificationEnsure: ensure })).toBe(RESULT);
    expect(ensure).not.toHaveBeenCalled(); expect(read).toHaveBeenCalledTimes(1); expect(supervisor).not.toHaveBeenCalled();
    expect((planAutonomousBacklogTurn as jest.Mock).mock.results[0]?.value).toEqual(expected);
  });
  test('requestedWorkItemId nunca classifica e preserva filtro', async () => {
    snapshot = [unclassified, { ...unclassified, item: { ...unclassified.item, id: 'other' } }];
    const ensure = jest.fn();
    await runProjectBacklogHostTurn({ ...base(), requestedWorkItemId: 'T3', postApprovalClassificationConfig: { since }, postApprovalClassificationEnsure: ensure });
    expect(ensure).not.toHaveBeenCalled();
    expect((planAutonomousBacklogTurn as jest.Mock).mock.calls[0]![0].candidates).toEqual([unclassified]);
  });
  test.each([false, true])('classifica/replay=%s antes de plano e Supervisor, com releitura única', async replayed => {
    const ensure = jest.fn(async () => { order.push('ensure'); snapshot = [{ ...unclassified, currentClassification: cls }]; return { ok: true as const, replayed }; });
    expect(await runProjectBacklogHostTurn({ ...base(), postApprovalClassificationConfig: { since }, postApprovalClassificationEnsure: ensure })).toBe(RESULT);
    expect(ensure).toHaveBeenCalledWith('T3', 1);
    expect(read).toHaveBeenCalledTimes(2);
    expect(order).toEqual(['read', 'ensure', 'read', 'plan', 'supervisor']);
  });
  test('peek é read-only mesmo com item novo não classificado', async () => {
    (runAutonomousBacklogHostTurn as jest.Mock).mockImplementation(async (deps: { peekMoreWork: () => Promise<boolean> }) => {
      expect(await deps.peekMoreWork()).toBe(false); return RESULT;
    });
    const ensure = jest.fn();
    await runProjectBacklogHostTurn({ ...base(), postApprovalClassificationConfig: { since }, postApprovalClassificationEnsure: ensure });
    expect(ensure).not.toHaveBeenCalled(); expect(read).toHaveBeenCalledTimes(1); expect(supervisor).not.toHaveBeenCalled();
  });
  test.each(['rejected', 'threw'])('falha %s não chega ao Supervisor/routing/claim/attempt nem repete na mesma volta', async mode => {
    (runAutonomousBacklogHostTurn as jest.Mock).mockImplementation(async (deps: { runCycle: (signal: AbortSignal) => Promise<unknown> }) => {
      await deps.runCycle(new AbortController().signal); await deps.runCycle(new AbortController().signal); return RESULT;
    });
    const ensure = jest.fn(async () => { if (mode === 'threw') throw new Error('provider detail'); return { ok: false as const, code: 'failed', message: 'provider detail' }; });
    expect(await runProjectBacklogHostTurn({ ...base(), postApprovalClassificationConfig: { since }, postApprovalClassificationEnsure: ensure })).toBe(RESULT);
    expect(ensure).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledTimes(2);
    expect(supervisor).not.toHaveBeenCalled(); expect(snapshot).toEqual([unclassified]);
    expect(order).toEqual(['read', 'plan', 'read', 'plan']);
  });
});

describe('runProjectBacklogHostTurn — amarração por workItemId', () => {
  beforeEach(() => jest.clearAllMocks());

  test('sinal para A com A e B elegíveis entrega SÓ A ao ciclo', async () => {
    const readSeen = wire(['A', 'B']);
    await run('A');
    expect(await readSeen()).toEqual(['A']);
  });

  test('item pedido inelegível/inexistente esvazia o backlog — sem fallback para outro', async () => {
    const readSeen = wire(['A', 'B']);
    await run('C');
    expect(await readSeen()).toEqual([]);
  });

  test('sinal para B preserva a dependência `completed` A (senão B sairia da fila por dependência)', async () => {
    // B (pedido) depende de A (completed). A amarração mantém B E A (inerte), descarta X.
    const readSeen = wire([{ id: 'B', state: 'approved' }, { id: 'A', state: 'completed' }, { id: 'X', state: 'approved' }]);
    await run('B');
    expect((await readSeen()).sort()).toEqual(['A', 'B']);
  });

  test('sem ato explícito mantém o backlog autônomo íntegro (comportamento idle)', async () => {
    const readSeen = wire(['A', 'B']);
    await run();
    expect(await readSeen()).toEqual(['A', 'B']);
  });
});

describe('runProjectBacklogHostTurn — modo do laço do coder', () => {
  beforeEach(() => jest.clearAllMocks());
  const base = { client: {} as SupabaseClient<Database>, ownerInstanceId: 'owner', maxTurnsPerCycle: 1, maxCycles: 1, signal: new AbortController().signal };

  test('sem declaração não repassa modo (deps resolvem AUTONOMOUS)', async () => {
    wire(['A']);
    await run('A');
    expect((buildProjectBacklogCycleDeps as jest.Mock).mock.calls[0]).toHaveLength(2);
  });

  test('SUPERVISED explícito para UM item é repassado às deps', async () => {
    wire(['A']);
    await runProjectBacklogHostTurn({ ...base, requestedWorkItemId: 'A', coderRuntimeMode: 'supervised' });
    expect((buildProjectBacklogCycleDeps as jest.Mock).mock.calls[0]![2]).toEqual({ coderRuntimeMode: 'supervised' });
  });

  test('SUPERVISED sem item pedido é recusado (nunca vale para a fila autônoma)', async () => {
    wire(['A', 'B']);
    await expect(runProjectBacklogHostTurn({ ...base, coderRuntimeMode: 'supervised' })).rejects.toThrow('requestedWorkItemId');
    expect(buildProjectBacklogCycleDeps).not.toHaveBeenCalled();
  });
});
