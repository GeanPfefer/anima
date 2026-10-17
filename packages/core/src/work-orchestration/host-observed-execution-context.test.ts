/** @jest-environment node */
import {
  buildHostObservedExecutionContext,
  executionModeAllowsActor,
  readPersistedExecutionContext,
  sameExecutionContext,
  type BuildHostObservedExecutionContextInput,
  type WorkEvent,
} from './index';

const USER = '11111111-1111-4111-8111-111111111111';
const input = (over: Partial<BuildHostObservedExecutionContextInput> = {}): BuildHostObservedExecutionContextInput => ({
  workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 1,
  executionMode: 'unattended', actorKind: 'automated_runner',
  runner: { kind: 'single_item_cli', authenticatedUserId: USER, instanceId: 'resident-1' },
  observedAt: '2026-10-16T12:00:00.000Z', ...over,
});

describe('buildHostObservedExecutionContext', () => {
  test('constrói o fato declarado com schemaVersion 1', () => {
    expect(buildHostObservedExecutionContext(input())).toMatchObject({ ok: true, value: { schemaVersion: 1, executionMode: 'unattended', actorKind: 'automated_runner' } });
  });
  test.each([
    [{ executionMode: 'autonomous' as never }, 'invalid_mode'],
    [{ executionMode: undefined as never }, 'invalid_mode'],
    [{ actorKind: 'root' as never }, 'invalid_actor_kind'],
    [{ workItemId: ' ' }, 'invalid_correlation'],
    [{ attemptId: '' }, 'invalid_correlation'],
    [{ approvedProposalVersion: 0 }, 'invalid_correlation'],
    [{ approvedProposalVersion: 1.5 }, 'invalid_correlation'],
    [{ observedAt: 'ontem' }, 'invalid_timestamp'],
  ] as const)('recusa %j', (over, defect) => {
    expect(buildHostObservedExecutionContext(input(over as Partial<BuildHostObservedExecutionContextInput>))).toMatchObject({ ok: false, defect });
  });
  test('unattended exige runner automático; manual exige humano', () => {
    expect(buildHostObservedExecutionContext(input({ actorKind: 'human_operator' }))).toMatchObject({ ok: false, defect: 'mode_actor_incompatible' });
    expect(buildHostObservedExecutionContext(input({ executionMode: 'manual', actorKind: 'automated_runner' }))).toMatchObject({ ok: false, defect: 'mode_actor_incompatible' });
    expect(buildHostObservedExecutionContext(input({ executionMode: 'manual', actorKind: 'human_operator' })).ok).toBe(true);
    expect(executionModeAllowsActor('supervised', 'automated_runner') && executionModeAllowsActor('supervised', 'human_operator')).toBe(true);
  });
  test('recusa runner forjado: usuário não UUID, instância com caminho/URL/segredo, kind desconhecido, campo extra', () => {
    const base = { kind: 'single_item_cli' as const, authenticatedUserId: USER, instanceId: 'resident-1' };
    for (const runner of [
      { ...base, authenticatedUserId: 'admin' },
      { ...base, authenticatedUserId: 'service_role' },
      { ...base, instanceId: 'C:\\Users\\x' },
      { ...base, instanceId: 'http://evil' },
      { ...base, instanceId: 'password=abc' },
      { ...base, instanceId: '' },
      { ...base, kind: 'root' as never },
      { ...base, extra: 'x' } as never,
    ]) expect(buildHostObservedExecutionContext(input({ runner }))).toMatchObject({ ok: false, defect: 'invalid_runner' });
    expect(buildHostObservedExecutionContext(input({ runner: undefined as never }))).toMatchObject({ ok: false, defect: 'invalid_runner' });
  });
  test('não propaga campos desconhecidos do chamador', () => {
    const built = buildHostObservedExecutionContext({ ...input(), role: 'anima_system_writer' } as never);
    expect(built.ok && Object.keys(built.value).sort()).toEqual(['actorKind', 'approvedProposalVersion', 'attemptId', 'executionMode', 'observedAt', 'runner', 'schemaVersion', 'workItemId']);
  });
});

describe('sameExecutionContext', () => {
  test('ignora observedAt e distingue qualquer outro campo', () => {
    const a = buildHostObservedExecutionContext(input());
    const b = buildHostObservedExecutionContext(input({ observedAt: '2027-01-01T00:00:00Z' }));
    const c = buildHostObservedExecutionContext(input({ executionMode: 'supervised' }));
    if (!a.ok || !b.ok || !c.ok) throw new Error('fixture');
    expect(sameExecutionContext(a.value, b.value)).toBe(true);
    expect(sameExecutionContext(a.value, c.value)).toBe(false);
  });
});

const persisted = (over: { data?: Record<string, unknown>; author?: WorkEvent['author']; type?: string; proposalVersion?: number | null } = {}): WorkEvent => {
  const built = buildHostObservedExecutionContext(input());
  if (!built.ok) throw new Error('fixture');
  return {
    id: 'e1', workItemId: 'work-1', type: (over.type ?? 'host_observed_execution_context_recorded') as WorkEvent['type'],
    author: over.author ?? 'system', proposalVersion: over.proposalVersion === undefined ? 1 : over.proposalVersion, seq: 10,
    occurredAt: new Date('2026-10-16T12:00:01Z'),
    payload: { schema_version: 1, data: {
      work_item_id: 'work-1', attempt_id: 'attempt-1', approved_proposal_version: 1, origin: 'host', recorded_by: 'trusted_system_writer',
      execution_mode: 'unattended', actor_kind: 'automated_runner', evidence: built.value,
      authority: { approval_author: 'user', approval_authority: 'human', approved_seq: 5, classified_seq: 6, leases_observed: 0, human_acts_after_mandate: 0 },
      ...over.data,
    } } as unknown as WorkEvent['payload'],
  };
};

describe('readPersistedExecutionContext', () => {
  test('lê o fato íntegro', () => {
    expect(readPersistedExecutionContext(persisted())).toMatchObject({ eventSeq: 10, attemptId: 'attempt-1', executionMode: 'unattended', authority: { approvedSeq: 5, approvalAuthor: 'user' } });
  });
  test('recusa autor diferente de system, tipo errado e eventos históricos sem os campos', () => {
    for (const author of ['user', 'anima', 'executor'] as const) expect(readPersistedExecutionContext(persisted({ author }))).toBeNull();
    expect(readPersistedExecutionContext(persisted({ type: 'host_observed_gate_evidence_recorded' }))).toBeNull();
    expect(readPersistedExecutionContext({ ...persisted(), payload: { data: { execution_mode: 'unattended' } } })).toBeNull();
    expect(readPersistedExecutionContext({ ...persisted(), payload: {} })).toBeNull();
  });
  test('recusa proveniência incompleta ou adulterada', () => {
    for (const data of [
      { origin: 'executor' }, { recorded_by: 'resident' }, { recorded_by: undefined },
      { execution_mode: 'autonomous' }, { actor_kind: 'root' },
      { execution_mode: 'supervised' },                       // diverge da evidência assinada
      { actor_kind: 'human_operator' },                       // diverge e é incoerente com unattended
      { attempt_id: 'attempt-2' }, { approved_proposal_version: 2 },
      { authority: undefined }, { authority: { approval_author: 'user' } },
      { authority: { approval_author: 'root', approval_authority: 'human', approved_seq: 1, classified_seq: 2, leases_observed: 0, human_acts_after_mandate: 0 } },
      { authority: { approval_author: 'user', approval_authority: 'human', approved_seq: -1, classified_seq: 2, leases_observed: 0, human_acts_after_mandate: 0 } },
    ]) expect(readPersistedExecutionContext(persisted({ data }))).toBeNull();
  });
  test('recusa versão do evento divergente da versão do fato', () => {
    expect(readPersistedExecutionContext(persisted({ proposalVersion: 2 }))).toBeNull();
  });
});
