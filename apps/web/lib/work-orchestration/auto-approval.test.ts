import { autoApproveAutonomousWork } from './auto-approval';

const validItem = {
  state: 'proposed', impact_level: 'low', capability: 'programming', proposal_version: 1,
  intent: {
    canonical_provenance: { kind: 'canonical_backlog', sourceId: 'FIX-01', document: 'docs/x.md', heading: 'FIX-01', canonicalObjective: 'x', planningGeneration: 1, materializationReason: 'selected_ready' },
    execution_spec: { schema_version: 1, target: { kind: 'project', reference: 'anima' }, executor: 'worktree', coder_backend: 'ollama', model: 'qwen3-coder:latest', base_sha: 'abc', permissions: ['workspace_read', 'workspace_write_isolated'], validation_criteria: [{ label: 'gate', command: 'npm test' }], limits: { max_attempts: 1, max_duration_minutes: 10 } },
  },
  proposal: { schema_version: 1, data: { included_scope: ['docs/safe.md'] } },
};

const client = (item: typeof validItem = validItem, rpcResult: unknown = { action: 'approved', event_seq: 7 }) => {
  const rpc = jest.fn(async (name: string) => name === 'current_work_intelligence_classification'
    ? { data: { classification: null }, error: null }
    : name === 'record_work_intelligence_classification'
      ? { data: { revision: 1 }, error: null }
      : { data: rpcResult, error: null });
  const single = jest.fn(async () => ({ data: item, error: null }));
  const eq = jest.fn(() => ({ single }));
  const select = jest.fn(() => ({ eq }));
  return { value: { from: jest.fn(() => ({ select })), rpc }, rpc };
};

describe('autoApproveAutonomousWork', () => {
  test('slice canônico local válido persiste aprovação system via RPC com envelope auditável', async () => {
    const c = client();
    const result = await autoApproveAutonomousWork({ client: c.value as never, workItemId: 'wi-1', readGovernorVerdict: () => 'permit' });
    expect(result).toEqual({ action: 'approved', eventSeq: 7, sourceId: 'FIX-01' });
    expect(c.rpc).toHaveBeenCalledWith('record_work_intelligence_classification', expect.objectContaining({
      p_work_item_id: 'wi-1',
      p_classification: expect.objectContaining({
        risk: 'low',
        provenance: expect.objectContaining({ classifierId: 'autonomous-authorization-v1' }),
      }),
    }));
    expect(c.rpc).toHaveBeenCalledWith('auto_approve_autonomous_work', expect.objectContaining({
      work_item_id: 'wi-1', expected_proposal_version: 1,
      envelope: expect.objectContaining({ authority: 'autonomous_policy', envelope_version: 1, source_id: 'FIX-01', execution_class: 'canonical_local_isolated_worktree' }),
    }));
  });

  test.each([
    ['backend externo', { intent: { ...validItem.intent, execution_spec: { ...validItem.intent.execution_spec, coder_backend: 'openai' } } }, 'coder_backend_not_local_authorized'],
    ['executor não-worktree', { intent: { ...validItem.intent, execution_spec: { ...validItem.intent.execution_spec, executor: 'commanded' } } }, 'executor_not_worktree'],
    ['efeito externo', { impact_level: 'external' }, 'impact_not_low'],
    ['sem validação', { intent: { ...validItem.intent, execution_spec: { ...validItem.intent.execution_spec, validation_criteria: [] } } }, 'validation_criteria_missing'],
    ['mutação de segurança', { proposal: { schema_version: 1, data: { included_scope: ['supabase/migrations/x.sql'] } } }, 'security_sensitive_scope'],
  ])('%s → humano e não chama RPC', async (_name, patch, reason) => {
    const c = client({ ...validItem, ...patch } as typeof validItem);
    await expect(autoApproveAutonomousWork({ client: c.value as never, workItemId: 'wi-1', readGovernorVerdict: () => 'permit' }))
      .resolves.toEqual({ action: 'human_required', reason });
    expect(c.rpc).not.toHaveBeenCalled();
  });

  test('erro da policy/Governor → humano', async () => {
    const c = client();
    const result = await autoApproveAutonomousWork({ client: c.value as never, workItemId: 'wi-1', readGovernorVerdict: () => { throw new Error('sensor'); } });
    expect(result).toEqual({ action: 'human_required', reason: 'policy_error:sensor' });
    expect(c.rpc).not.toHaveBeenCalled();
  });

  test('já aprovado → no-op', async () => {
    const c = client({ ...validItem, state: 'approved' });
    await expect(autoApproveAutonomousWork({ client: c.value as never, workItemId: 'wi-1', readGovernorVerdict: () => 'permit' }))
      .resolves.toEqual({ action: 'already_approved' });
    expect(c.rpc).not.toHaveBeenCalled();
  });

  test('replay da RPC é idempotente', async () => {
    const c = client(validItem, { action: 'replayed', event_seq: 7 });
    await expect(autoApproveAutonomousWork({ client: c.value as never, workItemId: 'wi-1', readGovernorVerdict: () => 'permit' }))
      .resolves.toEqual({ action: 'replayed', eventSeq: 7, sourceId: 'FIX-01' });
  });

  test('classificação existente não é duplicada', async () => {
    const c = client();
    c.rpc.mockImplementation(async (name: string) => name === 'current_work_intelligence_classification'
      ? { data: { classification: { schemaVersion: 1 } }, error: null }
      : { data: { action: 'approved', event_seq: 7 }, error: null });
    await autoApproveAutonomousWork({ client: c.value as never, workItemId: 'wi-1', readGovernorVerdict: () => 'permit' });
    expect(c.rpc).not.toHaveBeenCalledWith('record_work_intelligence_classification', expect.anything());
  });
});
