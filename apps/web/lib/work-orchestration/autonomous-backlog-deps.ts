import type { AutonomousQueueEntry, ObservedCoderInput, ObservedGateInput } from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readExecutionContract, resolveExecutorRoute, type ExecutionContract } from './executor-selection';
import { persistPostTurnHostObservations } from './post-turn-observation';
import { readAutonomousBacklogCandidates } from './autonomous-backlog-read';
import { runSupervisorTurn, type SupervisorTurnResult } from './supervisor';
import { readMachinePressure, readResourceAdmission } from './resource-governor';
import { decideCoderPlacement, localRuntimeFor, readExplicitCoderNodeV0, remoteRuntimeFor } from './coder-placement';
import { leaseDeadlineSignal, onDemandBurstForced, prepareResidentOnDemandCoderNode, readResidentOnDemandNodeConfig } from './resident-on-demand-node';
import { readLivePaidNodeCount } from './paid-compute-lease-reconciler-deps';
import { createOpenAIPaidCallAuthorizer } from './openai-paid-compute';

// ============================================================
// Dependências do driver de backlog para o PROJETO real (worktree/qwen3-coder),
// compartilhadas entre a rota de UMA volta (`backlog-cycle`) e a rota de
// CONTINUAÇÃO por host (`backlog-host-turn`). Uma única implementação da volta
// real (resolução de executor por contrato + `runSupervisorTurn` + observação
// host-side) — sem drift entre as rotas.
// ============================================================

export interface ProjectBacklogCycleDeps {
  readonly readBacklog: () => ReturnType<typeof readAutonomousBacklogCandidates>;
  readonly hostPermitsAutonomousWork: () => boolean;
  readonly runTurn: (entry: AutonomousQueueEntry, signal: AbortSignal) => Promise<SupervisorTurnResult>;
}

type RetryCheckpointEvent = { readonly event_type: string; readonly payload: unknown };
const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Num retry governado, prefere o checkpoint Git mais recente desta unidade ao
 * checkpoint inicial do successor. A base autorizada nunca muda. Sem correlação
 * completa, mantém o contrato persistido (fail-safe). */
export function resumeLatestRetryCheckpoint(contract: ExecutionContract, events: readonly RetryCheckpointEvent[]): ExecutionContract {
  const latestApproval = events.find(event => event.event_type === 'work_approved');
  const approvalData = record(record(latestApproval?.payload)?.data);
  if (approvalData?.decision !== 'retry') return contract;
  const sourceAttemptId = typeof approvalData.source_attempt_id === 'string' ? approvalData.source_attempt_id : '';
  const evidenceEvent = events.find(event => {
    if (event.event_type !== 'host_observed_evidence_recorded') return false;
    const data = record(record(event.payload)?.data);
    return data?.attempt_id === sourceAttemptId;
  });
  const evidence = record(record(record(evidenceEvent?.payload)?.data)?.evidence);
  const commit = typeof evidence?.observedCommitSha === 'string' ? evidence.observedCommitSha : '';
  const base = typeof evidence?.baseSha === 'string' ? evidence.baseSha : '';
  if (!/^[a-f0-9]{40}$/i.test(commit) || base !== contract.baseSha) return contract;
  return { ...contract, resumeCheckpointCommitSha: commit };
}

/**
 * Monta as dependências de execução real de uma volta do backlog para um cliente
 * autenticado. A SELEÇÃO/EXCLUSÃO continuam server-side; a volta usa o executor de
 * worktree resolvido do contrato persistido do item e a observação host-side pós-volta.
 */
export function buildProjectBacklogCycleDeps(
  client: SupabaseClient<Database>,
  ownerInstanceId: string,
): ProjectBacklogCycleDeps {
  let admittedPressure: ReturnType<typeof readMachinePressure> = 'unknown';
  // Base de um resultado sintético do Supervisor para quando o contrato do item não
  // resolve um executor: o driver classifica `selection_not_executable` como parada
  // anti-spin (`turn_not_executable`), sem tentar executar às cegas.
  const notExecutable = (entry: AutonomousQueueEntry, code: string, message: string): SupervisorTurnResult => ({
    outcome: 'selection_not_executable', reconciliation: [],
    selection: {
      workItemId: entry.workItemId, approvedProposalVersion: entry.approvedProposalVersion,
      approvalSeq: entry.approvalSeq, targetReference: entry.targetReference,
      selectionPolicy: 'backlog_driver', queueSize: 0, runnerUpApprovalSeq: null, skippedOccupiedTargets: 0,
    },
    claimId: null, attemptId: null, terminalKind: null, routingDecision: null, routingAdjustment: null,
    claimReleased: false, requiresAnotherTurn: false, refusal: { code, message }, gaps: [],
  });

  return {
    readBacklog: () => readAutonomousBacklogCandidates(client),
    // Snapshot NOVO por consulta, antes de cada volta. Somente `permit` inicia;
    // defer e indisponibilidade da autoridade falham fechados.
    hostPermitsAutonomousWork: () => {
      const admission = readResourceAdmission();
      admittedPressure = admission.pressure;
      if (admission.verdict === 'permit') return true;
      const model = process.env.ANIMA_WORKTREE_CODER_MODEL ?? 'qwen3-coder:latest';
      if (readResidentOnDemandNodeConfig(model)) return true;
      const node = readExplicitCoderNodeV0(model);
      return decideCoderPlacement({
        pressure: admittedPressure,
        model,
        nodes: node ? [node] : [],
        // O gate financeiro canônico ainda não existe: paid permanece inelegível.
        paidComputeAuthorized: false,
      }).placement === 'remote';
    },
    runTurn: async (entry, signal) => {
      // Contrato persistido do item escolhido → executor de worktree (project:anima).
      const item = await client.from('work_items').select('intent').eq('id', entry.workItemId).maybeSingle();
      if (item.error || !item.data) {
        return notExecutable(entry, 'work_item_unavailable', 'O item selecionado não pôde ser lido para execução.');
      }
      let contract = readExecutionContract(item.data.intent);
      const history = await client.from('work_events').select('event_type,payload')
        .eq('work_item_id', entry.workItemId).order('seq', { ascending: false }).limit(40);
      if (!history.error) contract = resumeLatestRetryCheckpoint(contract, history.data ?? []);
      const model = contract.model ?? process.env.ANIMA_WORKTREE_CODER_MODEL ?? 'qwen3-coder:latest';
      const node = readExplicitCoderNodeV0(model);
      let placement = decideCoderPlacement({
        pressure: admittedPressure,
        model,
        nodes: node ? [node] : [],
        paidComputeAuthorized: false,
      });
      let onDemandSession: Awaited<ReturnType<typeof prepareResidentOnDemandCoderNode>> | null = null;
      let ollamaRuntimeOverride;
      // On-demand engata sob defer (pressão moderada/alta) OU quando o lever de prova/ops
      // força a pré-condição; `unknown` permanece fail-closed (sensor indisponível).
      if ((placement.placement === 'defer' || onDemandBurstForced()) && admittedPressure !== 'unknown') {
        const onDemand = readResidentOnDemandNodeConfig(model);
        if (onDemand) {
          onDemandSession = await prepareResidentOnDemandCoderNode({
            client, config: onDemand, workItemId: entry.workItemId,
            proposalVersion: entry.approvedProposalVersion, leaseId: crypto.randomUUID(), signal,
            readLivePaidNodeCount: () => readLivePaidNodeCount(client),
          });
          if (!onDemandSession.ok) {
            const code = onDemandSession.reason === 'waiting_authorization' ? 'paid_compute_authorization_required'
              : onDemandSession.reason === 'concurrency_limit' ? 'paid_compute_concurrency_limit'
              : onDemandSession.reason === 'paid_node_count_unavailable' ? 'paid_compute_observability_unavailable'
              : 'coder_node_unavailable';
            return notExecutable(entry, code, `Node on-demand indisponível: ${onDemandSession.detail}.`);
          }
          ollamaRuntimeOverride = onDemandSession.runtime;
          placement = { placement: 'remote', reason: 'local_pressure_requires_burst', node: {
            id: onDemand.nodeId, endpoint: onDemandSession.runtime.url, locality: 'remote', enabled: true, healthy: true,
            capabilities: ['coder_inference'], models: [model], resourceClass: onDemand.resourceClass, billingMode: onDemand.billingMode,
          } };
        }
      }
      if (placement.placement === 'defer') return notExecutable(entry, 'coder_placement_deferred', `Placement do coder adiou a execução: ${placement.reason}.`);
      ollamaRuntimeOverride ??= placement.placement === 'remote' ? remoteRuntimeFor(placement.node, model) : localRuntimeFor(model);
      const gateObservations: ObservedGateInput[] = [];
      const coderObservations: ObservedCoderInput[] = [];
      const selection = resolveExecutorRoute(contract, {
        ...(contract.coderBackend === null || contract.coderBackend === 'ollama' ? { ollamaRuntimeOverride } : {}),
        gateObserver: outcome => gateObservations.push(outcome),
        coderObserver: outcome => coderObservations.push(outcome),
        ...(contract.coderBackend === 'openai' ? { authorizeOpenAIPaidCall: createOpenAIPaidCallAuthorizer(client) } : {}),
      });
      if (!selection.ok) return notExecutable(entry, selection.error.code, selection.error.message);

      let turn: SupervisorTurnResult | null = null;
      // Watchdog best-effort: numa lease paga, a volta é abortada no DEADLINE da lease para parar
      // o gasto mais cedo (o teardown/reconciler durável segue como rede de segurança). O
      // `finish` usa o sinal BASE (não este) para garantir teardown mesmo após o abort.
      const turnDeadline = onDemandSession?.ok ? leaseDeadlineSignal(signal, onDemandSession.leaseExpiresAt) : null;
      try {
        turn = await runSupervisorTurn({
          client, routes: [selection.route], ownerInstanceId,
          newId: () => crypto.randomUUID(), signal: turnDeadline?.signal ?? signal,
          requestedWork: { workItemId: entry.workItemId, expectedProposalVersion: entry.approvedProposalVersion },
        });
      } finally {
        turnDeadline?.dispose();
        if (onDemandSession?.ok) await onDemandSession.finish(turn?.attemptId ?? null);
      }
      if (turn === null) return notExecutable(entry, 'resident_turn_failed', 'A volta do Resident Host não devolveu resultado.');

      // Observação host-side pós-volta (evidência de gate/coder/git + parecer do
      // Verifier) — a MESMA da rota supervisor-turn. Fail-open: nunca altera o desfecho.
      await persistPostTurnHostObservations({ client, result: turn, contract, gateObservations, coderObservations });
      return turn;
    },
  };
}
