import {
  HUMAN_INTERRUPTION_REASONS,
  evaluateHumanInterruption,
  type HumanInterruptionReason,
  type HumanInterruptionRequest,
} from '.';

const makeRequest = (reason: HumanInterruptionReason, overrides: Partial<HumanInterruptionRequest> = {}): HumanInterruptionRequest => ({
  reason,
  state: { workState: 'in_progress', proposalVersion: 3, attemptNumber: 2, checkpointReference: 'checkpoint:abc' },
  explanation: `Interrupção necessária: ${reason}`,
  ...(reason === 'persistent_inability_after_limits' ? { reachedLimit: 'attempts' } : {}),
  ...overrides,
});

describe('política de interrupção humana', () => {
  test.each(HUMAN_INTERRUPTION_REASONS)('%s é uma razão fechada e gera input_requested tipado', reason => {
    const result = evaluateHumanInterruption(makeRequest(reason));
    expect(result).toMatchObject({
      kind: 'interrupt',
      payload: {
        schema_version: 1,
        reason,
        source_state: { work_state: 'in_progress', proposal_version: 3, attempt_number: 2, checkpoint_reference: 'checkpoint:abc' },
      },
    });
  });

  test('a política contém exatamente as oito razões do Marco 003 e não oferece outro', () => {
    expect(HUMAN_INTERRUPTION_REASONS).toEqual([
      'scope_change', 'architectural_decision', 'destructive_action', 'sensitive_credential_required',
      'requirements_conflict', 'permission_missing', 'final_integration_approval', 'persistent_inability_after_limits',
    ]);
    expect(HUMAN_INTERRUPTION_REASONS).not.toContain('other');
  });

  test('razão fora da lista é defeito em runtime', () => {
    expect(evaluateHumanInterruption({ ...makeRequest('scope_change'), reason: 'other' })).toMatchObject({ kind: 'defect', code: 'reason_not_allowed' });
  });

  test('estado e versão exatos são obrigatórios', () => {
    expect(evaluateHumanInterruption({ ...makeRequest('permission_missing'), state: { workState: 'in_progress', proposalVersion: 0 } })).toMatchObject({ kind: 'defect', code: 'source_state_invalid' });
    expect(evaluateHumanInterruption({ ...makeRequest('permission_missing'), state: { workState: 'invented', proposalVersion: 1 } })).toMatchObject({ kind: 'defect', code: 'source_state_invalid' });
  });

  test('explicação concreta é obrigatória', () => {
    expect(evaluateHumanInterruption(makeRequest('requirements_conflict', { explanation: '  ' }))).toMatchObject({ kind: 'defect', code: 'explanation_missing' });
  });

  test('incapacidade persistente antes de atingir limite é defeito, nunca interrupção nem loop', () => {
    expect(evaluateHumanInterruption(makeRequest('persistent_inability_after_limits', { reachedLimit: undefined }))).toMatchObject({ kind: 'defect', code: 'limit_not_reached' });
  });

  test.each(['attempts', 'duration', 'resources'] as const)('incapacidade persistente após limite de %s interrompe', reachedLimit => {
    expect(evaluateHumanInterruption(makeRequest('persistent_inability_after_limits', { reachedLimit }))).toMatchObject({ kind: 'interrupt', payload: { reached_limit: reachedLimit } });
  });

  test('razões comuns não inventam limite no payload', () => {
    const result = evaluateHumanInterruption(makeRequest('destructive_action', { reachedLimit: 'duration' }));
    expect(result).toMatchObject({ kind: 'interrupt' });
    if (result.kind === 'interrupt') expect(result.payload).not.toHaveProperty('reached_limit');
  });
});
