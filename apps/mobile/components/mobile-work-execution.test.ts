import type { AutonomousExecutionProjection, WorkBudgetWaitProjection } from '@anima/core';
import { presentMobileWorkBudgetWait, presentMobileWorkExecution } from './mobile-work-execution';

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

  test('bloqueio por orçamento recuperável declara a retomada temporal do checkpoint', () => {
    const content = presentMobileWorkExecution(execution({ status: 'blocked', canRequestControl: false, budgetBlock: { reason: 'interactive_reserve_protected', reachedLimit: 'resources', recoverable: true } }));
    expect(content.statusLabel).toBe('Bloqueada (orçamento)');
    expect(content.budgetBlock).toContain('Orçamento atingido: interactive_reserve_protected (limite: resources).');
    expect(content.budgetBlock).toContain('retomada do checkpoint quando a janela do orçamento liberar');
  });
  test('bloqueio não recuperável não promete retomada automática', () => {
    const content = presentMobileWorkExecution(execution({ status: 'blocked', canRequestControl: false, budgetBlock: { reason: 'human_input_required', reachedLimit: null, recoverable: false } }));
    expect(content.budgetBlock).toBe('Orçamento atingido: human_input_required.');
  });
});

describe('espera por janela de orçamento no cartão mobile (INTEL-04 coerência)', () => {
  const wait = (reason: WorkBudgetWaitProjection['reason']): WorkBudgetWaitProjection => ({ reason, reachedLimit: 'attempts' });
  test('declara a espera como temporal, sem afirmar decisão humana', () => {
    const content = presentMobileWorkBudgetWait(wait('user_attempt_budget_exhausted'));
    expect(content.title).toBe('Aguardando a janela do orçamento autônomo');
    expect(content.message).toContain('não exige nenhuma decisão sua');
    expect(content.message).toContain('teto de segurança do modo autônomo permanece inalterado');
  });
  test('cada motivo de orçamento tem rótulo tipado próprio', () => {
    expect(presentMobileWorkBudgetWait(wait('interactive_reserve_protected')).message).toContain('Reserva interativa');
    expect(presentMobileWorkBudgetWait(wait('user_runtime_budget_exhausted')).message).toContain('tempo autônomo');
  });
});
