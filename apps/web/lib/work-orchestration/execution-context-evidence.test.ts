/** @jest-environment node */
import {
  executionContextClaimFromEnvironment,
  executionContextSinkFor,
  persistHostObservedExecutionContext,
  readRunnerIdentityViaRls,
  resolveExecutionContextClaim,
  type ExecutionContextClaim,
  type ExecutionContextSink,
} from './execution-context-evidence';
import { createTrustedSystemWriter } from './trusted-system-writer';

const USER = '22222222-2222-4222-8222-222222222222';
const correlation = { workItemId: 'w-1', attemptId: 'a-1', approvedProposalVersion: 1 };
const claim = (over: Partial<ExecutionContextClaim> = {}): ExecutionContextClaim => ({
  executionMode: 'unattended', actorKind: 'automated_runner',
  runner: { kind: 'single_item_cli', authenticatedUserId: USER, instanceId: 'inst-1' }, ...over,
});
const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;

describe('executionContextClaimFromEnvironment', () => {
  test('sem ANIMA_EXECUTION_MODE (ou inválido) não declara nada', () => {
    expect(executionContextClaimFromEnvironment(USER, env({}))).toBeNull();
    expect(executionContextClaimFromEnvironment(USER, env({ ANIMA_EXECUTION_MODE: 'autonomous' }))).toBeNull();
    expect(executionContextClaimFromEnvironment(USER, env({ ANIMA_EXECUTION_MODE: '' }))).toBeNull();
  });
  test('ator padrão é o coerente com o modo; runner usa a identidade fornecida, não o ambiente', () => {
    expect(executionContextClaimFromEnvironment(USER, env({ ANIMA_EXECUTION_MODE: 'unattended' })))
      .toEqual({ executionMode: 'unattended', actorKind: 'automated_runner', runner: { kind: 'single_item_cli', authenticatedUserId: USER, instanceId: 'unspecified' } });
    expect(executionContextClaimFromEnvironment(USER, env({ ANIMA_EXECUTION_MODE: 'manual' }))?.actorKind).toBe('human_operator');
    const forged = executionContextClaimFromEnvironment(USER, env({ ANIMA_EXECUTION_MODE: 'unattended', ANIMA_EXECUTION_RUNNER_USER_ID: 'attacker', ANIMA_RUNNER_USER_ID: 'attacker' }));
    expect(forged?.runner.authenticatedUserId).toBe(USER);
  });
  test('ator ou runner inválidos no ambiente ⇒ sem declaração (fail-closed)', () => {
    expect(executionContextClaimFromEnvironment(USER, env({ ANIMA_EXECUTION_MODE: 'unattended', ANIMA_EXECUTION_ACTOR: 'root' }))).toBeNull();
    expect(executionContextClaimFromEnvironment(USER, env({ ANIMA_EXECUTION_MODE: 'unattended', ANIMA_EXECUTION_RUNNER_KIND: 'god' }))).toBeNull();
  });
});

describe('persistHostObservedExecutionContext', () => {
  const sink = (): ExecutionContextSink & { record: jest.Mock } => ({ record: jest.fn(async () => ({ ok: true as const, action: 'recorded' as const })) });
  test('sem declaração: skipped, sink não é chamado (ausência de contexto nunca vira fato)', async () => {
    const s = sink();
    await expect(persistHostObservedExecutionContext(correlation, null, s)).resolves.toMatchObject({ ok: false, stage: 'skipped' });
    expect(s.record).not.toHaveBeenCalled();
  });
  test('declaração válida é persistida com correlação e observedAt do host', async () => {
    const s = sink();
    const out = await persistHostObservedExecutionContext(correlation, claim(), s, () => new Date('2026-10-16T10:00:00Z'));
    expect(out).toMatchObject({ ok: true, action: 'recorded' });
    expect(s.record).toHaveBeenCalledWith(expect.objectContaining({ attemptId: 'a-1', workItemId: 'w-1', approvedProposalVersion: 1, executionMode: 'unattended', observedAt: '2026-10-16T10:00:00.000Z' }));
  });
  test('declarações inválidas/forjadas são barradas antes do sink', async () => {
    const s = sink();
    for (const bad of [
      claim({ actorKind: 'human_operator' }),
      claim({ executionMode: 'autonomous' as never }),
      claim({ runner: { kind: 'single_item_cli', authenticatedUserId: 'service_role', instanceId: 'x' } }),
      claim({ runner: { kind: 'single_item_cli', authenticatedUserId: USER, instanceId: 'C:\\x' } }),
    ]) await expect(persistHostObservedExecutionContext(correlation, bad, s)).resolves.toMatchObject({ ok: false, stage: 'build' });
    await expect(persistHostObservedExecutionContext({ ...correlation, approvedProposalVersion: 0 }, claim(), s)).resolves.toMatchObject({ ok: false, stage: 'build' });
    expect(s.record).not.toHaveBeenCalled();
  });
  test('recusa do banco (ex.: unattended sem sustentação no ledger) é persist não-fatal; exceção também', async () => {
    const refuse: ExecutionContextSink = { record: async () => ({ ok: false, message: 'unattended not supported: supervision lease exists' }) };
    await expect(persistHostObservedExecutionContext(correlation, claim(), refuse)).resolves.toMatchObject({ ok: false, stage: 'persist', reason: expect.stringContaining('lease') });
    const boom: ExecutionContextSink = { record: async () => { throw new Error('rede'); } };
    await expect(persistHostObservedExecutionContext(correlation, claim(), boom)).resolves.toMatchObject({ ok: false, stage: 'persist', reason: 'rede' });
  });
  test('replay é reportado como replayed', async () => {
    const s: ExecutionContextSink = { record: async () => ({ ok: true, action: 'replayed' }) };
    await expect(persistHostObservedExecutionContext(correlation, claim(), s)).resolves.toMatchObject({ ok: true, action: 'replayed' });
  });
});

describe('executionContextSinkFor (RPC)', () => {
  test('chama a RPC com correlação da própria evidência e propaga replay/erro', async () => {
    const rpc = jest.fn()
      .mockResolvedValueOnce({ data: { action: 'recorded' }, error: null })
      .mockResolvedValueOnce({ data: { action: 'replayed' }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'runner identity does not match item owner' } });
    const sink = executionContextSinkFor({ rpc } as never);
    const evidence = { schemaVersion: 1, workItemId: 'w-1', attemptId: 'a-1', approvedProposalVersion: 3, executionMode: 'supervised', actorKind: 'automated_runner', runner: { kind: 'resident_host', authenticatedUserId: USER, instanceId: 'i' }, observedAt: '2026-10-16T00:00:00Z' } as const;
    await expect(sink.record(evidence)).resolves.toEqual({ ok: true, action: 'recorded' });
    expect(rpc).toHaveBeenCalledWith('record_host_observed_execution_context', { work_item_id: 'w-1', expected_proposal_version: 3, attempt_id: 'a-1', evidence });
    await expect(sink.record(evidence)).resolves.toEqual({ ok: true, action: 'replayed' });
    await expect(sink.record(evidence)).resolves.toEqual({ ok: false, message: 'runner identity does not match item owner' });
  });
});

describe('identidade do runner via RLS', () => {
  const clientReturning = (result: unknown) => ({ from: () => ({ select: () => ({ eq: () => ({ single: async () => result }) }) }) }) as never;
  test('lê o dono visível pela sessão do runner; falha/ausência ⇒ null', async () => {
    await expect(readRunnerIdentityViaRls(clientReturning({ data: { user_id: USER }, error: null }), 'w')).resolves.toBe(USER);
    await expect(readRunnerIdentityViaRls(clientReturning({ data: null, error: { message: 'x' } }), 'w')).resolves.toBeNull();
    await expect(readRunnerIdentityViaRls({ from: () => { throw new Error('x'); } } as never, 'w')).resolves.toBeNull();
  });
  test('resolveExecutionContextClaim: sem modo não consulta; com modo usa a identidade lida, nunca o ambiente', async () => {
    const spy = { from: jest.fn() } as never;
    await expect(resolveExecutionContextClaim(spy, 'w', env({}))).resolves.toBeNull();
    expect((spy as unknown as { from: jest.Mock }).from).not.toHaveBeenCalled();
    const claimed = await resolveExecutionContextClaim(clientReturning({ data: { user_id: USER }, error: null }), 'w', env({ ANIMA_EXECUTION_MODE: 'unattended', ANIMA_EXECUTION_RUNNER_INSTANCE: 'sched-1' }));
    expect(claimed?.runner).toEqual({ kind: 'single_item_cli', authenticatedUserId: USER, instanceId: 'sched-1' });
    await expect(resolveExecutionContextClaim(clientReturning({ data: null, error: { message: 'x' } }), 'w', env({ ANIMA_EXECUTION_MODE: 'unattended' }))).resolves.toBeNull();
  });
});

describe('Trusted System Writer — sink de contexto', () => {
  test('usa o cliente do WRITER e a RPC dedicada; sem identidade do writer falha fechado', async () => {
    const rpc = jest.fn(async () => ({ data: { action: 'recorded' }, error: null }));
    const writer = createTrustedSystemWriter(async () => ({ accessToken: 'tok' }), (() => ({ rpc })) as never);
    const evidence = { schemaVersion: 1, workItemId: 'w', attemptId: 'a', approvedProposalVersion: 1, executionMode: 'manual', actorKind: 'human_operator', runner: { kind: 'interactive_ui', authenticatedUserId: USER, instanceId: 'ui' }, observedAt: '2026-10-16T00:00:00Z' } as const;
    await expect(writer.executionContext.record(evidence)).resolves.toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledWith('record_host_observed_execution_context', expect.any(Object));
    const down = createTrustedSystemWriter(async () => null);
    await expect(down.executionContext.record(evidence)).resolves.toEqual({ ok: false, message: 'trusted_system_writer_unavailable' });
  });
});
