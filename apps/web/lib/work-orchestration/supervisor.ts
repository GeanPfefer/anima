import {
  evaluateAutonomousEligibility,
  planWorkResumption,
  planWorkRoutingAdjustment,
  requiredEffortFor,
  selectWorkRoute,
  validateWorkIntelligenceClassification,
  type AbandonedCheckpointV1,
  type AutonomousEligibilityGap,
  type WorkIntelligenceClassificationV1,
  type WorkExecutorAdapter,
  type WorkExecutorRequest,
  type WorkRoutingCandidateV1,
  type WorkRoutingAdjustmentContextV1,
  type WorkRoutingAdjustmentV1,
  type WorkRoutingDecisionV1,
} from '@anima/core';
import type { Database, Json } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildExecutorRequest, recordExecutionTerminal, runExecutorStreamed, type CheckpointSink } from './execution';
import { createWorkOrchestrationService } from './server';

// ============================================================
// Laço operacional mínimo do Supervisor V0 (Fase E).
//
// Uma volta por invocação. Sem daemon, sem polling, sem scheduler: quem decide
// invocar de novo é quem chama, e `requiresAnotherTurn` diz se vale a pena.
//
// A aplicação NÃO julga elegibilidade, ordem, ocupação de alvo nem posse. Essas
// regras vivem em `autonomous_work_queue`, `next_autonomous_work`,
// `acquire_work_claim` e `private.begin_work_attempt`, todas ratificadas. Aqui
// só existe composição e tradução de recusa tipada. Reimplementar qualquer uma
// delas na aplicação reintroduziria exatamente a assimetria que o SUP-05 fechou.
// ============================================================

export type SupervisorTurnOutcome =
  // Fila vazia ou todo alvo ocupado: nada a fazer, e nenhum efeito produzido.
  | 'no_eligible_work'
  // A cabeça da fila existe mas não pôde virar entrada de executor.
  | 'selection_not_executable'
  | 'routing_unavailable'
  | 'routing_refused'
  | 'budget_interrupted'
  // Pausa/cancelamento cooperativo do usuário aplicado num checkpoint (UX-01).
  | 'control_applied'
  // Posse recusada pelo banco — tipicamente a corrida perdida.
  | 'claim_refused'
  // Posse obtida, início recusado (exclusividade de alvo, versão mudou…).
  | 'attempt_start_refused'
  | 'resumption_requires_human'
  | 'execution_completed'
  | 'execution_failed'
  | 'execution_cancelled'
  // Tentativa aberta sem terminal confiável. Caso do SUP-04, não desta volta.
  | 'execution_interrupted'
  | 'terminal_refused';

export interface ReconciliationFinding {
  readonly workItemId: string;
  readonly attemptId: string | null;
  readonly claimId: string | null;
  readonly finding: string;
  readonly action: string;
  readonly itemState: string;
}

export interface SupervisorSelection {
  readonly workItemId: string;
  readonly approvedProposalVersion: number;
  readonly approvalSeq: number;
  readonly targetReference: string;
  readonly selectionPolicy: string;
  readonly queueSize: number;
  readonly runnerUpApprovalSeq: number | null;
  readonly skippedOccupiedTargets: number;
}

export interface SupervisorTurnResult {
  readonly outcome: SupervisorTurnOutcome;
  /** Sempre presente: a reconciliação roda antes de qualquer seleção. */
  readonly reconciliation: readonly ReconciliationFinding[];
  readonly selection: SupervisorSelection | null;
  readonly claimId: string | null;
  readonly attemptId: string | null;
  readonly terminalKind: 'result' | 'error' | 'cancelled' | null;
  readonly routingDecision: WorkRoutingDecisionV1 | null;
  readonly routingAdjustment: WorkRoutingAdjustmentV1 | null;
  readonly claimReleased: boolean;
  /** Efeito persistido que esta volta não conseguiu fechar sozinha. */
  readonly requiresAnotherTurn: boolean;
  readonly refusal: { readonly code: string; readonly message: string } | null;
  readonly gaps: readonly AutonomousEligibilityGap[];
}

/** Leitura do item e dos contextos. Só isso: o laço não escreve por aqui. */
export type SupervisorReader = Pick<ReturnType<typeof createWorkOrchestrationService>, 'getItem' | 'listContexts'>;

export interface SupervisorTurnDependencies {
  readonly client: SupabaseClient<Database>;
  readonly routes: readonly {
    readonly candidate: WorkRoutingCandidateV1;
    readonly adapter: WorkExecutorAdapter;
  }[];
  readonly ownerInstanceId: string;
  readonly newId: () => string;
  readonly signal: AbortSignal;
  readonly reader?: SupervisorReader;
}

const base = (reconciliation: readonly ReconciliationFinding[]): SupervisorTurnResult => ({
  outcome: 'no_eligible_work', reconciliation, selection: null, claimId: null, attemptId: null,
  terminalKind: null, routingDecision: null, routingAdjustment: null,
  claimReleased: false, requiresAnotherTurn: false, refusal: null, gaps: [],
});

const refusalOf = (error: { code?: string; message: string }): { code: string; message: string } =>
  ({ code: error.code ?? 'unknown', message: error.message });

const outcomeForTerminal = (kind: string): SupervisorTurnOutcome =>
  kind === 'result' ? 'execution_completed' : kind === 'cancelled' ? 'execution_cancelled' : 'execution_failed';

const object = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;

const routingAdjustmentContext = (value: unknown): WorkRoutingAdjustmentContextV1 | null => {
  const root = object(value);
  if (root?.schemaVersion !== 1 || !Array.isArray(root.attempts)) return null;
  const attempts: WorkRoutingAdjustmentContextV1['attempts'][number][] = [];
  for (const raw of root.attempts) {
    const attempt = object(raw);
    if (!attempt || typeof attempt.attemptId !== 'string'
      || !['result_submitted', 'execution_failed', 'work_cancelled', 'attempt_abandoned'].includes(String(attempt.outcome))
      || !['light', 'standard', 'strong'].includes(String(attempt.selectedEffort))
      || !['none', 'escalated', 'reduced'].includes(String(attempt.adjustment))) return null;
    attempts.push(attempt as unknown as WorkRoutingAdjustmentContextV1['attempts'][number]);
  }
  const rawCheckpoint = root.latestCheckpoint;
  if (rawCheckpoint === null) return { schemaVersion: 1, attempts, latestCheckpoint: null };
  const checkpoint = object(rawCheckpoint);
  if (!checkpoint || typeof checkpoint.attemptId !== 'string' || typeof checkpoint.nextStep !== 'string'
    || !Array.isArray(checkpoint.remainingSteps) || !checkpoint.remainingSteps.every(step => typeof step === 'string')
    || !Array.isArray(checkpoint.failures) || !checkpoint.failures.every(failure => typeof failure === 'string')) return null;
  return {
    schemaVersion: 1, attempts,
    latestCheckpoint: checkpoint as unknown as NonNullable<WorkRoutingAdjustmentContextV1['latestCheckpoint']>,
  };
};

/**
 * Executa exatamente uma volta do Supervisor.
 *
 * Nunca aceita, autoriza, integra ou aplica resultado algum: o desfecho máximo
 * desta função é um item em `review` aguardando decisão humana (INT-03).
 */
export async function runSupervisorTurn(dependencies: SupervisorTurnDependencies): Promise<SupervisorTurnResult> {
  const { client, routes, ownerInstanceId, newId, signal } = dependencies;
  const service = dependencies.reader ?? createWorkOrchestrationService(client);

  // ---------- (1) Reconciliação, sempre antes da seleção ----------
  //
  // Religar sem reconciliar selecionaria sobre um estado que a interrupção
  // deixou mentindo. A rotina é do SUP-04 e não é reimplementada aqui: a
  // aplicação apenas a invoca e relata o que ela produziu.
  const reconciled = await client.rpc('reconcile_supervised_work');
  if (reconciled.error) {
    return { ...base([]), outcome: 'selection_not_executable', refusal: refusalOf(reconciled.error), requiresAnotherTurn: true };
  }
  const reconciliation: readonly ReconciliationFinding[] = (reconciled.data ?? []).map(row => ({
    workItemId: row.work_item_id, attemptId: row.attempt_id, claimId: row.claim_id,
    finding: row.finding, action: row.action, itemState: row.item_state,
  }));

  // ---------- (2) Seleção pela fronteira canônica do SUP-02 ----------
  const selected = await client.rpc('next_autonomous_work');
  if (selected.error) {
    return { ...base(reconciliation), outcome: 'selection_not_executable', refusal: refusalOf(selected.error), requiresAnotherTurn: true };
  }
  const head = (selected.data ?? [])[0];
  if (!head) return base(reconciliation);

  const selection: SupervisorSelection = {
    workItemId: head.work_item_id, approvedProposalVersion: head.approved_proposal_version,
    approvalSeq: head.approval_seq, targetReference: head.target_reference,
    selectionPolicy: head.selection_policy, queueSize: head.queue_size,
    runnerUpApprovalSeq: head.runner_up_approval_seq, skippedOccupiedTargets: head.skipped_occupied_targets,
  };
  const started = { ...base(reconciliation), selection, requiresAnotherTurn: true };

  // ---------- (3) Item completo e leitura do contrato aprovado ----------
  const item = await service.getItem(selection.workItemId);
  if (!item.ok) {
    return { ...started, outcome: 'selection_not_executable', refusal: { code: 'work_item_unavailable', message: item.error.message } };
  }

  // O predicado do core é o parser canônico do `execution_spec`; a fila usa o
  // espelho SQL da mesma régua. Divergência entre os dois é defeito, não
  // permissão para executar às cegas — daí a saída fail-closed sem posse.
  const eligibility = evaluateAutonomousEligibility(item.value);
  if (!eligibility.eligible) {
    return {
      ...started, outcome: 'selection_not_executable', gaps: eligibility.gaps,
      refusal: { code: 'eligibility_divergence', message: 'A fila ofereceu um item que o predicado do domínio recusa.' },
    };
  }

  const budgetRead = await client.rpc('autonomous_work_budget_status', {
    p_work_item_id: selection.workItemId,
  });
  if (budgetRead.error) {
    return { ...started, outcome: 'selection_not_executable', refusal: refusalOf(budgetRead.error) };
  }
  const budget = object(budgetRead.data);
  if (!budget || typeof budget.admitted !== 'boolean') {
    return {
      ...started,
      outcome: 'selection_not_executable',
      refusal: { code: 'work_budget_invalid', message: 'O orçamento autônomo não pôde ser reconstruído.' },
    };
  }
  if (!budget.admitted) {
    const blocked = await client.rpc('block_work_on_budget', {
      p_work_item_id: selection.workItemId,
    });
    if (blocked.error) {
      return { ...started, outcome: 'selection_not_executable', refusal: refusalOf(blocked.error) };
    }
    return {
      ...started,
      outcome: 'budget_interrupted',
      requiresAnotherTurn: false,
      refusal: {
        code: typeof budget.reason === 'string' ? budget.reason : 'work_budget_exhausted',
        message: 'A execução autônoma aguarda o usuário porque o orçamento disponível foi atingido.',
      },
    };
  }

  const contexts = await service.listContexts(selection.workItemId);
  if (!contexts.ok) {
    return { ...started, outcome: 'selection_not_executable', refusal: { code: 'context_unavailable', message: contexts.error.message } };
  }

  const sourceRead = await client.rpc('abandoned_work_resumption_source', { p_work_item_id: selection.workItemId });
  if (sourceRead.error) return { ...started, outcome: 'selection_not_executable', refusal: refusalOf(sourceRead.error) };
  const persistedSource = object(sourceRead.data);
  const isResumption = persistedSource?.kind === 'abandoned_checkpoint';

  const claimId = newId();
  const leaseSeconds = (eligibility.spec.limits.maxDurationMinutes ?? 30) * 60 + 300;
  const attemptId = newId();
  const classificationRead = await client.rpc('current_work_intelligence_classification', {
    p_work_item_id: selection.workItemId,
  });
  if (classificationRead.error) {
    return { ...started, outcome: 'routing_refused', refusal: refusalOf(classificationRead.error) };
  }
  const classificationData = object(classificationRead.data);
  const classification = classificationData?.classification;
  if (validateWorkIntelligenceClassification(classification) !== null) {
    return {
      ...started, outcome: 'routing_unavailable',
      refusal: { code: 'routing_classification_invalid', message: 'A classificação corrente não pôde ser reconstruída.' },
    };
  }
  const adjustmentContextRead = await client.rpc('work_routing_adjustment_context', {
    p_work_item_id: selection.workItemId,
  });
  if (adjustmentContextRead.error) {
    return { ...started, outcome: 'routing_refused', refusal: refusalOf(adjustmentContextRead.error) };
  }
  const adjustmentContext = routingAdjustmentContext(adjustmentContextRead.data);
  if (!adjustmentContext) {
    return {
      ...started, outcome: 'routing_unavailable',
      refusal: { code: 'routing_history_invalid', message: 'O histórico de roteamento não pôde ser reconstruído.' },
    };
  }
  const adjustment = planWorkRoutingAdjustment({
    baselineEffort: requiredEffortFor(classification as unknown as WorkIntelligenceClassificationV1),
    context: adjustmentContext,
  });
  const routing = selectWorkRoute({
    capability: item.value.capability,
    classification: classification as unknown as WorkIntelligenceClassificationV1,
    minimumEffort: adjustment.effectiveEffort,
    candidates: routes.map(route => route.candidate),
  });
  if (routing.outcome !== 'selected') {
    return {
      ...started, outcome: 'routing_unavailable',
      refusal: { code: routing.reason, message: routing.explanation },
    };
  }
  const configuredRoute = routes.find(route =>
    route.candidate.routeId === routing.decision.selected.routeId
    && route.adapter.id === routing.decision.selected.executorId);
  if (!configuredRoute) {
    return {
      ...started, outcome: 'routing_unavailable',
      refusal: { code: 'routing_adapter_missing', message: 'A rota selecionada não possui adaptador correspondente.' },
    };
  }
  const adapter = configuredRoute.adapter;
  const adjustmentRecorded = await client.rpc('record_work_routing_adjustment', {
    p_work_item_id: selection.workItemId,
    p_expected_proposal_version: selection.approvedProposalVersion,
    p_attempt_id: attemptId,
    p_adjustment: adjustment as unknown as Json,
  });
  if (adjustmentRecorded.error) {
    return { ...started, outcome: 'routing_refused', refusal: refusalOf(adjustmentRecorded.error) };
  }
  const routingRecorded = await client.rpc('record_work_routing_decision', {
    p_work_item_id: selection.workItemId,
    p_expected_proposal_version: selection.approvedProposalVersion,
    p_attempt_id: attemptId,
    p_decision: routing.decision as unknown as Json,
  });
  if (routingRecorded.error) {
    return { ...started, outcome: 'routing_refused', refusal: refusalOf(routingRecorded.error) };
  }
  const routed = { ...started, routingDecision: routing.decision, routingAdjustment: adjustment };
  let carriedContext: WorkExecutorRequest['carriedContext'];
  let attempt;
  if (isResumption && persistedSource) {
    const rawCheckpoint = object(persistedSource.checkpoint);
    const data = object(rawCheckpoint?.data);
    const sourceAttemptId = String(persistedSource.source_attempt_id ?? '');
    const sourceClaimId = typeof persistedSource.source_claim_id === 'string' ? persistedSource.source_claim_id : null;
    const abandonmentEventSeq = Number(persistedSource.abandonment_event_seq);
    const abandonmentReason = String(persistedSource.abandonment_reason ?? '');
    const abandonedAt = String(persistedSource.abandoned_at ?? '');
    const checkpoint = data ? {
      schemaVersion: 1, workItemId: selection.workItemId, sourceAttemptId, sourceClaimId,
      approvedProposalVersion: Number(persistedSource.approved_proposal_version),
      checkpointEventSeq: Number(rawCheckpoint?.checkpoint_event_seq),
      checkpointSignalSequence: Number(rawCheckpoint?.checkpoint_signal_sequence),
      abandonmentEventSeq, abandonmentReason, abandonedAt,
      handoffReference: data.handoffReference, completedSteps: data.completedSteps,
      remainingSteps: data.remainingSteps, nextStep: data.nextStep, decisions: data.decisions,
      risks: data.risks, touchedResources: data.touchedResources, validations: data.validations,
      failures: data.failures, evidenceReferences: data.evidenceReferences,
    } as AbandonedCheckpointV1 : null;
    const decision = planWorkResumption({
      item: item.value,
      source: {
        kind: 'abandoned_checkpoint', checkpoint, sourceAttemptId, sourceClaimId,
        approvedProposalVersion: Number(persistedSource.approved_proposal_version),
        abandonmentEventSeq, abandonmentReason, abandonedAt,
      },
      openClaim: null,
      previousAttemptIds: Array.isArray(persistedSource.previous_attempt_ids)
        ? persistedSource.previous_attempt_ids.filter((id): id is string => typeof id === 'string') : [],
      nextAttemptId: attemptId, nextClaimId: claimId, now: new Date(),
    });
    if (decision.outcome !== 'resume') {
      return {
        ...routed, outcome: decision.outcome === 'requires_human' ? 'resumption_requires_human' : 'attempt_start_refused',
        refusal: { code: decision.reason, message: decision.explanation },
      };
    }
    carriedContext = { isNewAttempt: true, continueFromCheckpoint: true, ...decision.plan.carriedContext };
    attempt = await client.rpc('begin_resumed_work_attempt', {
      work_item_id: selection.workItemId, expected_proposal_version: selection.approvedProposalVersion,
      source_attempt_id: decision.plan.resumeFromAttemptId,
      checkpoint_event_seq: decision.plan.resumeFromCheckpointEventSeq!,
      abandonment_event_seq: abandonmentEventSeq, claim_id: claimId, attempt_id: attemptId,
      owner_instance_id: ownerInstanceId, lease_seconds: leaseSeconds, executor_id: adapter.id,
    });
  } else {
    const claim = await client.rpc('acquire_work_claim', {
      work_item_id: selection.workItemId, expected_proposal_version: selection.approvedProposalVersion,
      claim_id: claimId, owner_instance_id: ownerInstanceId, lease_seconds: leaseSeconds,
    });
    if (claim.error) return { ...routed, outcome: 'claim_refused', refusal: refusalOf(claim.error) };
    attempt = await client.rpc('start_claimed_work_attempt', {
      claim_id: claimId, attempt_id: attemptId, executor_id: adapter.id,
    });
  }
  if (attempt.error) {
    // Nenhuma tentativa começou; a posse é devolvida com a razão que o próprio
    // contrato exige para esse caso, e o alvo volta a ficar livre.
    const released = await client.rpc('release_work_claim', { claim_id: claimId, reason: 'released_without_attempt' });
    return {
      ...routed, outcome: 'attempt_start_refused', claimId, claimReleased: !released.error,
      refusal: refusalOf(attempt.error),
    };
  }
  const running = { ...routed, claimId, attemptId };

  // ---------- (6) Execução real, com persistência de checkpoint em stream ----------
  const request = buildExecutorRequest({
    item: item.value, spec: eligibility.spec, attemptId,
    contextReferences: contexts.value.at(-1)?.references ?? [],
    carriedContext,
  });
  // Porta de persistência: cada checkpoint é gravado IMEDIATAMENTE, antes do
  // próximo sinal. Replay idempotente (`record_work_checkpoint`) não devolve
  // erro, então o consumo segue normalmente; falha de persistência interrompe
  // fechado, sem processar terminal.
  const checkpointSink: CheckpointSink = {
    persistCheckpoint: async (checkpoint) => {
      const persisted = await client.rpc('record_work_checkpoint', {
        work_item_id: selection.workItemId,
        expected_proposal_version: selection.approvedProposalVersion,
        attempt_id: attemptId,
        signal: checkpoint as unknown as Json,
      });
      if (persisted.error) return { ok: false, message: persisted.error.message };
      // UX-01: com um checkpoint seguro persistido, aplica cooperativamente um
      // pedido de pausa/cancelamento pendente. A decisão explícita do usuário é
      // primária, por isso vem ANTES do gate de orçamento. Aplicada, a RPC já
      // liberou a posse e o terminal do executor NÃO será consumido — nada é
      // morto no meio de uma edição.
      const controlled = await client.rpc('apply_work_control_at_checkpoint', {
        p_work_item_id: selection.workItemId,
        p_expected_proposal_version: selection.approvedProposalVersion,
        p_attempt_id: attemptId,
      });
      if (controlled.error) return { ok: false, message: controlled.error.message };
      const control = object(controlled.data);
      if (control?.applied === true) {
        return {
          ok: false,
          cause: 'control',
          reason: typeof control.action === 'string' ? control.action : 'control_applied',
          message: 'A execução autônoma foi pausada ou cancelada pelo usuário no checkpoint seguro.',
          claimReleased: control.claimReleased === true,
        };
      }
      const checked = await client.rpc('interrupt_work_on_budget', {
        p_work_item_id: selection.workItemId,
        p_expected_proposal_version: selection.approvedProposalVersion,
        p_attempt_id: attemptId,
      });
      if (checked.error) return { ok: false, message: checked.error.message };
      const decision = object(checked.data);
      if (decision?.interrupted === true) {
        return {
          ok: false,
          cause: 'budget',
          reason: typeof decision.reason === 'string' ? decision.reason : 'work_budget_exhausted',
          message: 'A execução autônoma foi interrompida após salvar o checkpoint para preservar o orçamento.',
          claimReleased: decision.claimReleased === true,
        };
      }
      return { ok: true };
    },
  };
  let run;
  try {
    run = await runExecutorStreamed(adapter, request, signal, checkpointSink);
  } catch (cause) {
    // Tentativa aberta sem desfecho observado; os checkpoints já confirmados
    // permanecem persistidos. A posse NÃO é liberada e nenhum terminal é
    // inventado: é a órfã que o SUP-04 reconcilia por limite persistido.
    return {
      ...running, outcome: 'execution_interrupted',
      refusal: { code: 'executor_threw', message: cause instanceof Error ? cause.message : 'Falha não tipada do executor.' },
    };
  }
  if (!run.ok) {
    // `checkpoint`: a persistência falhou no meio do stream; `transcript`: fora
    // do contrato do INT-01. Nos dois, a tentativa fica aberta para o SUP-04,
    // com a posse retida e sem terminal — os checkpoints confirmados permanecem.
    if (run.cause === 'budget') {
      return {
        ...running,
        outcome: 'budget_interrupted',
        claimReleased: run.claimReleased === true,
        requiresAnotherTurn: false,
        refusal: { code: run.reason ?? 'work_budget_exhausted', message: run.defect },
      };
    }
    if (run.cause === 'control') {
      // Pausa/cancelamento aplicado no checkpoint: a posse já foi liberada pela
      // RPC e o item já está em `blocked`/`cancelled`. Nenhum terminal é gravado.
      return {
        ...running,
        outcome: 'control_applied',
        claimReleased: run.claimReleased === true,
        requiresAnotherTurn: false,
        refusal: { code: run.reason ?? 'control_applied', message: run.defect },
      };
    }
    const code = run.cause === 'checkpoint' ? 'checkpoint_persist_failed' : 'executor_contract_violation';
    return { ...running, outcome: 'execution_interrupted', refusal: { code, message: run.defect } };
  }

  // ---------- (7) Terminal pela fronteira ratificada ----------
  const terminalKind = (run.terminal as { kind: 'result' | 'error' | 'cancelled' }).kind;
  const terminal = await recordExecutionTerminal(client, {
    workItemId: selection.workItemId, expectedProposalVersion: selection.approvedProposalVersion,
    attemptId, terminal: run.terminal,
  });
  if (terminal.error) {
    // O executor produziu, o banco recusou registrar. A posse permanece: soltá-la
    // afirmaria um encerramento que não existe no log.
    return { ...running, outcome: 'terminal_refused', refusal: refusalOf(terminal.error) };
  }

  // ---------- (8) Liberação auditável ----------
  const released = await client.rpc('release_work_claim', { claim_id: claimId, reason: 'attempt_finished' });
  return {
    ...running, outcome: outcomeForTerminal(terminalKind), terminalKind,
    claimReleased: !released.error,
    // Liberação falha não desfaz o terminal; a posse vencida é recolhida pela
    // reconciliação da próxima volta, com a razão `attempt_finished`.
    refusal: released.error ? refusalOf(released.error) : null,
    requiresAnotherTurn: true,
  };
}
