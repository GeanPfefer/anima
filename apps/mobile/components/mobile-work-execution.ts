import type { AutonomousExecutionProjection, WorkBudgetWaitProjection } from '@anima/core';

// UX-01 (paridade mobile) — projeta o cartão de execução autônoma em strings de
// exibição. É PURO e derivado exclusivamente da projeção persistida vinda de
// @anima/core; o cliente nunca inventa estado. Espelha os rótulos do cartão web
// (WorkExecutionCard) para paridade. Pausar/cancelar são cooperativos: o cartão
// só PEDE a intenção; o efeito real é aplicado pelo laço num checkpoint seguro.

const STATUS_LABEL: Record<AutonomousExecutionProjection['status'], string> = {
  running: 'Em execução',
  paused: 'Pausada',
  cancelled: 'Cancelada',
  abandoned: 'Abandonada (limite excedido)',
  submitted_for_review: 'Resultado em revisão',
  failed: 'Falhou',
  blocked: 'Bloqueada (orçamento)',
};
const CONTROL_APPLIED_LABEL: Record<string, string> = {
  paused_by_user: 'Pausada por você',
  cancelled_by_user: 'Cancelada por você',
};

// Formatação determinística (sem locale/fuso variável): "2026-07-29 12:00 UTC".
const instant = (iso: string): string => {
  const trimmed = iso.replace('T', ' ').slice(0, 16);
  return iso.endsWith('Z') ? `${trimmed} UTC` : trimmed;
};

export interface MobileWorkExecutionContent {
  readonly statusLabel: string;
  readonly meta: string;
  readonly startedAt: string;
  readonly limits: string | null;
  readonly activity: string | null;
  readonly checkpoint: string;
  readonly budgetBlock: string | null;
  readonly pendingControl: string | null;
  readonly appliedControl: string | null;
  readonly canRequestControl: boolean;
}

// INTEL-04 (coerência V0, paridade mobile). Um item bloqueado por orçamento
// PRÉ-tentativa aguarda a janela móvel liberar — nunca uma decisão humana. Puro;
// espelha o WorkBudgetWaitCard do web. Não oferece override do teto de segurança.
const BUDGET_WAIT_REASON_LABEL: Record<WorkBudgetWaitProjection['reason'], string> = {
  item_attempt_budget_exhausted: 'Limite de tentativas deste item nas últimas 24h',
  user_attempt_budget_exhausted: 'Limite global de tentativas autônomas nas últimas 24h',
  user_runtime_budget_exhausted: 'Limite global de tempo autônomo nas últimas 24h',
  interactive_reserve_protected: 'Reserva interativa da janela de 60 minutos preservada',
};
export interface MobileWorkBudgetWaitContent { readonly title: string; readonly message: string; }
export function presentMobileWorkBudgetWait(wait: WorkBudgetWaitProjection): MobileWorkBudgetWaitContent {
  return {
    title: 'Aguardando a janela do orçamento autônomo',
    message: `${BUDGET_WAIT_REASON_LABEL[wait.reason]}. Este bloqueio é temporal e não exige nenhuma decisão sua: o trabalho volta a ficar elegível automaticamente quando a janela móvel do orçamento liberar. O teto de segurança do modo autônomo permanece inalterado.`,
  };
}

export function presentMobileWorkExecution(execution: AutonomousExecutionProjection): MobileWorkExecutionContent {
  const { limits, latestCheckpoint, pendingControl, appliedControl, budgetBlock } = execution;

  const metaParts = [
    execution.executorId ? `Executor ${execution.executorId}` : null,
    execution.providerRef ? `Provedor ${execution.providerRef}` : null,
    execution.modelRef ? `Modelo ${execution.modelRef}` : null,
    execution.effort ? `Esforço ${execution.effort}` : null,
  ].filter(Boolean) as string[];

  const limitParts = [
    limits.maxAttempts !== null ? `${limits.maxAttempts} tentativa(s)` : null,
    limits.maxDurationMinutes !== null ? `${limits.maxDurationMinutes} min` : null,
  ].filter(Boolean) as string[];

  return {
    statusLabel: STATUS_LABEL[execution.status],
    meta: `${metaParts.length ? `${metaParts.join(' · ')} · ` : ''}tentativa ${execution.attemptId.slice(0, 8)}`,
    startedAt: instant(execution.startedAt),
    limits: limitParts.length ? limitParts.join(' · ') : null,
    activity: execution.status === 'running'
      ? (latestCheckpoint?.nextStep
        ? `Executando: ${latestCheckpoint.nextStep}`
        : 'Preparando a workspace isolada e aguardando o plano do modelo local.')
      : null,
    checkpoint: latestCheckpoint
      ? `Checkpoint #${latestCheckpoint.signalSequence}: ${latestCheckpoint.completedSteps} concluído(s), ${latestCheckpoint.remainingSteps} restante(s). Próximo: ${latestCheckpoint.nextStep || '—'}`
      : 'Última evidência persistida: execução iniciada. O primeiro checkpoint aparecerá após o planejamento local.',
    budgetBlock: budgetBlock
      ? `Orçamento atingido: ${budgetBlock.reason}${budgetBlock.reachedLimit ? ` (limite: ${budgetBlock.reachedLimit})` : ''}.${budgetBlock.recoverable ? ' É um limite temporal: a execução é retomada do checkpoint quando a janela do orçamento liberar, sem decisão sua.' : ''}`
      : null,
    pendingControl: pendingControl
      ? `Pedido de ${pendingControl.action === 'pause' ? 'pausa' : 'cancelamento'} registrado; será aplicado no próximo checkpoint seguro.`
      : null,
    appliedControl: appliedControl
      ? `${CONTROL_APPLIED_LABEL[appliedControl.reason] ?? appliedControl.reason} em ${instant(appliedControl.appliedAt)}.`
      : null,
    canRequestControl: execution.canRequestControl,
  };
}
