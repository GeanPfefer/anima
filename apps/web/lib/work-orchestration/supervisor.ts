import {
  evaluateAutonomousEligibility,
  type AutonomousEligibilityGap,
  type WorkExecutorAdapter,
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
  // Posse recusada pelo banco — tipicamente a corrida perdida.
  | 'claim_refused'
  // Posse obtida, início recusado (exclusividade de alvo, versão mudou…).
  | 'attempt_start_refused'
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
  readonly adapter: WorkExecutorAdapter;
  readonly ownerInstanceId: string;
  readonly newId: () => string;
  readonly signal: AbortSignal;
  readonly reader?: SupervisorReader;
}

const base = (reconciliation: readonly ReconciliationFinding[]): SupervisorTurnResult => ({
  outcome: 'no_eligible_work', reconciliation, selection: null, claimId: null, attemptId: null,
  terminalKind: null, claimReleased: false, requiresAnotherTurn: false, refusal: null, gaps: [],
});

const refusalOf = (error: { code?: string; message: string }): { code: string; message: string } =>
  ({ code: error.code ?? 'unknown', message: error.message });

const outcomeForTerminal = (kind: string): SupervisorTurnOutcome =>
  kind === 'result' ? 'execution_completed' : kind === 'cancelled' ? 'execution_cancelled' : 'execution_failed';

/**
 * Executa exatamente uma volta do Supervisor.
 *
 * Nunca aceita, autoriza, integra ou aplica resultado algum: o desfecho máximo
 * desta função é um item em `review` aguardando decisão humana (INT-03).
 */
export async function runSupervisorTurn(dependencies: SupervisorTurnDependencies): Promise<SupervisorTurnResult> {
  const { client, adapter, ownerInstanceId, newId, signal } = dependencies;
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

  const contexts = await service.listContexts(selection.workItemId);
  if (!contexts.ok) {
    return { ...started, outcome: 'selection_not_executable', refusal: { code: 'context_unavailable', message: contexts.error.message } };
  }

  // ---------- (4) Posse exclusiva (AUTO-02) ----------
  //
  // Sem consulta prévia de disponibilidade: prever posse na aplicação é
  // precisamente a janela de corrida que o SUP-05 mediu. A RPC é a fonte de
  // verdade e a recusa dela é o resultado.
  //
  // O lease cobre a duração declarada mais folga: encurtá-lo faria a
  // reconciliação recolher a posse de uma execução legitimamente viva.
  const claimId = newId();
  const leaseSeconds = (eligibility.spec.limits.maxDurationMinutes ?? 30) * 60 + 300;
  const claim = await client.rpc('acquire_work_claim', {
    work_item_id: selection.workItemId,
    expected_proposal_version: selection.approvedProposalVersion,
    claim_id: claimId,
    owner_instance_id: ownerInstanceId,
    lease_seconds: leaseSeconds,
  });
  if (claim.error) return { ...started, outcome: 'claim_refused', refusal: refusalOf(claim.error) };

  // ---------- (5) Início supervisionado ----------
  const attemptId = newId();
  const attempt = await client.rpc('start_claimed_work_attempt', {
    claim_id: claimId, attempt_id: attemptId, executor_id: adapter.id,
  });
  if (attempt.error) {
    // Nenhuma tentativa começou; a posse é devolvida com a razão que o próprio
    // contrato exige para esse caso, e o alvo volta a ficar livre.
    const released = await client.rpc('release_work_claim', { claim_id: claimId, reason: 'released_without_attempt' });
    return {
      ...started, outcome: 'attempt_start_refused', claimId, claimReleased: !released.error,
      refusal: refusalOf(attempt.error),
    };
  }
  const running = { ...started, claimId, attemptId };

  // ---------- (6) Execução real, com persistência de checkpoint em stream ----------
  const request = buildExecutorRequest({
    item: item.value, spec: eligibility.spec, attemptId,
    contextReferences: contexts.value.at(-1)?.references ?? [],
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
      return persisted.error ? { ok: false, message: persisted.error.message } : { ok: true };
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
