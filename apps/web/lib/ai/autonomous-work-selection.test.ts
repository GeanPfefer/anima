import { admitSelectedAutonomousWork, isAutonomousWorkSelectionRequest, renderAutonomousWorkSelection, resolveAutonomousWorkChatIntent } from './autonomous-work-selection';

describe('mandato autônomo no chat Dev', () => {
  test('reconhece o mandato real independentemente do provider', () => {
    expect(isAutonomousWorkSelectionRequest('identifique sozinho o próximo Work Item canônico elegível de self-development')).toBe(true);
    expect(isAutonomousWorkSelectionRequest('Selecione autonomamente o próximo trabalho de desenvolvimento do Anima')).toBe(true);
  });
  test('chat normal e drill-down ambíguo permanecem conservadores', () => {
    expect(isAutonomousWorkSelectionRequest('Me mostre uma dessas falhas')).toBe(false);
    expect(isAutonomousWorkSelectionRequest('Qual é o próximo passo do projeto?')).toBe(false);
  });
  test('distingue consulta de mandato explícito de execução', () => {
    expect(resolveAutonomousWorkChatIntent('Selecione autonomamente o próximo trabalho de desenvolvimento do Anima')).toBe('inspect');
    expect(resolveAutonomousWorkChatIntent('execute um ciclo real de self-development')).toBe('execute');
    expect(resolveAutonomousWorkChatIntent('continue desenvolvendo o ANIMA')).toBe('execute');
    expect(resolveAutonomousWorkChatIntent('qual é o próximo item?')).toBeNull();
  });
  test('admissão delega somente à RPC canônica e preserva stale', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: { eventId: 'event-1', replayed: false }, error: null });
    await expect(admitSelectedAutonomousWork({ rpc } as never, 'item-1', 2, 'request-1')).resolves.toEqual({ outcome: 'admitted', eventId: 'event-1', replayed: false });
    expect(rpc).toHaveBeenCalledWith('request_autonomous_execution', { p_work_item_id: 'item-1', p_expected_proposal_version: 2, p_request_id: 'request-1' });
    rpc.mockResolvedValueOnce({ data: null, error: { code: '55000', message: 'work item is not eligible for autonomous execution' } });
    await expect(admitSelectedAutonomousWork({ rpc } as never, 'item-1', 2, 'request-2')).resolves.toEqual({ outcome: 'stale' });
  });
  test('resposta selecionada é provider-neutral e explica a política', () => {
    const text = renderAutonomousWorkSelection({
      outcome: 'selected', workItemId: 'next',
      rationale: { policy: 'oldest_approval_first', queueSize: 2, selectedPosition: 1, approvalSeq: 10, runnerUpApprovalSeq: 20, skippedOccupiedTargets: 0 },
      evidence: { consideredIds: ['old', 'next'], eliminated: [], selectedId: 'next', policy: 'oldest_approval_first', humanDecisionRequired: false },
    });
    expect(text).toContain('next'); expect(text).toContain('oldest_approval_first');
  });
});
