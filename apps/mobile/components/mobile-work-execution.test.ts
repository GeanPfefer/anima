import type { AutonomousExecutionProjection } from '@anima/core';
import { presentMobileWorkExecution } from './mobile-work-execution';

const base: AutonomousExecutionProjection = {
  attemptId: '12345678-90ab-cdef-1234-567890abcdef', status: 'running', startedAt: '2026-07-29T12:00:00Z',
  executorId: 'worktree-v1', providerRef: 'ollama', modelRef: 'qwen3-coder', effort: 'standard',
  limits: { maxAttempts: 3, maxDurationMinutes: 45 },
  latestCheckpoint: { signalSequence: 2, completedSteps: 1, remainingSteps: 3, nextStep: 'editar calculator.py' },
  pendingControl: null, appliedControl: null, budgetBlock: null, canRequestControl: true,
};
const execution = (over: Partial<AutonomousExecutionProjection> = {}): AutonomousExecutionProjection => ({ ...base, ...over });

describe('apresentação da execução autônoma no cartão mobile', () => {
  test('em execução projeta status, meta, início, limites, atividade e checkpoint', () => {
    const content = presentMobileWorkExecution(execution());
    expect(content).toMatchObject({
      statusLabel: 'Em execução',
      meta: 'Executor worktree-v1 · Provedor ollama · Modelo qwen3-coder · Esforço standard · tentativa 12345678',
      startedAt: '2026-07-29 12:00 UTC',
      limits: '3 tentativa(s) · 45 min',
      activity: 'Executando: editar calculator.py',
      checkpoint: 'Checkpoint #2: 1 concluído(s), 3 restante(s). Próximo: editar calculator.py',
      canRequestControl: true,
    });
  });

  test('em execução sem checkpoint declara preparação e ausência de evidência', () => {
    const content = presentMobileWorkExecution(execution({ latestCheckpoint: null }));
    expect(content.activity).toContain('Preparando a workspace isolada');
    expect(content.checkpoint).toContain('O primeiro checkpoint aparecerá');
  });

  test('campos opcionais ausentes não são inventados', () => {
    const content = presentMobileWorkExecution(execution({ executorId: null, providerRef: null, modelRef: null, effort: null, limits: { maxAttempts: null, maxDurationMinutes: null } }));
    expect(content.meta).toBe('tentativa 12345678');
    expect(content.limits).toBeNull();
  });

  test('pausada aplicada não mostra atividade e traduz a razão', () => {
    const content = presentMobileWorkExecution(execution({ status: 'paused', canRequestControl: false, appliedControl: { action: 'pause', reason: 'paused_by_user', appliedAt: '2026-07-29T12:05:00Z' } }));
    expect(content).toMatchObject({ statusLabel: 'Pausada', activity: null, appliedControl: 'Pausada por você em 2026-07-29 12:05 UTC.', canRequestControl: false });
  });

  test('pedido pendente de controle é declarado como cooperativo', () => {
    const content = presentMobileWorkExecution(execution({ pendingControl: { action: 'cancel', requestedAt: '2026-07-29T12:03:00Z' } }));
    expect(content.pendingControl).toBe('Pedido de cancelamento registrado; será aplicado no próximo checkpoint seguro.');
  });

  test('bloqueio por orçamento é projetado com razão e limite', () => {
    const content = presentMobileWorkExecution(execution({ status: 'blocked', canRequestControl: false, budgetBlock: { reason: 'autonomous_time_budget_exhausted', reachedLimit: 'autonomous_window' } }));
    expect(content).toMatchObject({ statusLabel: 'Bloqueada (orçamento)', budgetBlock: 'Orçamento atingido: autonomous_time_budget_exhausted (limite: autonomous_window).' });
  });
});
