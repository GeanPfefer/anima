import type { ProposalVersion, WorkItemId } from './types';
import { validateWorkCheckpoint, type WorkCheckpointV1 } from './work-executor-contract';
import type { WorkClaimId } from './work-claim';

// Etapa 2A — espelho puro da persistência de checkpoint mid-flight (evento
// append-only `checkpoint_recorded`).
//
// A garantia real é do banco: lock do item (`FOR UPDATE`), índice único parcial
// `(attempt_id, signal_sequence)` e RLS. Aqui fica a lógica determinística que
// `record_work_checkpoint`/`latest_work_checkpoint` implementam, para que o
// contrato seja verificável sem banco e as duas implementações possam ser
// provadas concordantes.
//
// O que este módulo NUNCA faz: derivar `status`/`stopReason` terminais, decidir
// elegibilidade, iniciar tentativa, autorizar retomada ou chamar
// `planWorkResumption`. Projetar a continuação é entregar dados, nunca permissão.

/** Um evento `checkpoint_recorded` reduzido ao que a reconstrução precisa. */
export interface PersistedCheckpoint {
  readonly workItemId: WorkItemId;
  readonly attemptId: string;
  readonly approvedProposalVersion: ProposalVersion;
  /** Derivado no servidor; nulo na execução comandada (INT-04), sem claim. */
  readonly claimId: WorkClaimId | null;
  /** Sequência 1-indexada da transcrição INT-01 (não só dos checkpoints). */
  readonly signalSequence: number;
  readonly checkpoint: WorkCheckpointV1;
}

export type CheckpointDeliveryOutcome =
  // Sequência maior que a última persistida (ou primeiro checkpoint): novo evento.
  | { readonly action: 'recorded' }
  // Mesma sequência, conteúdo idêntico: idempotente, sem novo evento.
  | { readonly action: 'replayed' }
  // Sequência menor que a última: regressão recusada.
  | { readonly action: 'regression'; readonly explanation: string }
  // Mesma sequência, conteúdo diferente: conflito fail-closed.
  | { readonly action: 'conflict'; readonly explanation: string }
  // Payload malformado ou correlação divergente.
  | { readonly action: 'invalid'; readonly explanation: string };

const sameList = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((entry, index) => entry === right[index]);

/**
 * Igualdade de conteúdo determinística entre dois checkpoints: mesmas listas na
 * mesma ordem, mesmos campos, mesma versão de schema, mesmas referências. Sem
 * timestamps e sem correção de divergência — é ela que separa replay de conflito.
 */
export function sameWorkCheckpoint(a: WorkCheckpointV1, b: WorkCheckpointV1): boolean {
  return a.schemaVersion === b.schemaVersion
    && a.handoffReference === b.handoffReference
    && a.nextStep === b.nextStep
    && sameList(a.completedSteps, b.completedSteps)
    && sameList(a.remainingSteps, b.remainingSteps)
    && sameList(a.decisions, b.decisions)
    && sameList(a.risks, b.risks)
    && sameList(a.touchedResources, b.touchedResources)
    && sameList(a.failures, b.failures)
    && sameList(a.evidenceReferences, b.evidenceReferences)
    && a.validations.length === b.validations.length
    && a.validations.every((entry, index) =>
      entry.label === b.validations[index]?.label && entry.outcome === b.validations[index]?.outcome);
}

/**
 * Decide o que uma entrega de checkpoint significa contra o último checkpoint já
 * persistido da MESMA tentativa. Fail-closed: payload inválido ou correlação
 * divergente não registram nada.
 *
 * Aceita sequência crescente **não consecutiva** de propósito: a RPC não conhece
 * os `progress` não persistidos, então só exige monotonicidade, nunca
 * contiguidade.
 */
export function reconcileCheckpointDelivery(
  latest: PersistedCheckpoint | null,
  incoming: PersistedCheckpoint,
): CheckpointDeliveryOutcome {
  const invalid = validateWorkCheckpoint(incoming.checkpoint);
  if (invalid) return { action: 'invalid', explanation: invalid };
  if (!Number.isInteger(incoming.signalSequence) || incoming.signalSequence < 1) {
    return { action: 'invalid', explanation: 'A sequência do checkpoint precisa ser um inteiro 1-indexado.' };
  }

  if (latest === null) return { action: 'recorded' };

  if (latest.workItemId !== incoming.workItemId
    || latest.attemptId !== incoming.attemptId
    || latest.approvedProposalVersion !== incoming.approvedProposalVersion) {
    return { action: 'invalid', explanation: 'O checkpoint recebido pertence a outra correlação.' };
  }

  if (incoming.signalSequence < latest.signalSequence) {
    return { action: 'regression', explanation: `A sequência ${incoming.signalSequence} regride abaixo da última persistida ${latest.signalSequence}.` };
  }
  if (incoming.signalSequence === latest.signalSequence) {
    return sameWorkCheckpoint(latest.checkpoint, incoming.checkpoint)
      ? { action: 'replayed' }
      : { action: 'conflict', explanation: 'Mesma sequência com conteúdo diferente não pode sobrescrever o checkpoint já registrado.' };
  }
  return { action: 'recorded' };
}

export type LatestCheckpoint =
  | { readonly found: true; readonly checkpoint: PersistedCheckpoint }
  | { readonly found: false };

/**
 * Seleciona o checkpoint de maior `signalSequence`, preservando o histórico
 * (não muta a entrada). Ausência é tipada: `{ found: false }`, nunca uma
 * continuidade inventada.
 */
export function selectLatestCheckpoint(checkpoints: readonly PersistedCheckpoint[]): LatestCheckpoint {
  let best: PersistedCheckpoint | null = null;
  for (const candidate of checkpoints) {
    if (best === null || candidate.signalSequence > best.signalSequence) best = candidate;
  }
  return best === null ? { found: false } : { found: true, checkpoint: best };
}

/** Dados de continuação para uso FUTURO (AUTO-05), sem status terminal. */
export interface CheckpointContinuation {
  readonly workItemId: WorkItemId;
  readonly attemptId: string;
  readonly approvedProposalVersion: ProposalVersion;
  readonly handoffReference: string;
  readonly remainingSteps: readonly string[];
  readonly nextStep: string;
  readonly risks: readonly string[];
  readonly touchedResources: readonly string[];
  readonly previousFailures: readonly string[];
}

/**
 * Projeta a continuação retomável de um checkpoint. É deliberadamente incapaz de
 * autorizar: não deriva `status`/`stopReason`, não decide elegibilidade e não
 * inicia nada. Quem retoma (AUTO-05) continua sendo a autoridade pura, alimentada
 * — no futuro — por esta projeção.
 */
export function projectCheckpointContinuation(entry: PersistedCheckpoint): CheckpointContinuation {
  return {
    workItemId: entry.workItemId,
    attemptId: entry.attemptId,
    approvedProposalVersion: entry.approvedProposalVersion,
    handoffReference: entry.checkpoint.handoffReference,
    remainingSteps: entry.checkpoint.remainingSteps,
    nextStep: entry.checkpoint.nextStep,
    risks: entry.checkpoint.risks,
    touchedResources: entry.checkpoint.touchedResources,
    previousFailures: entry.checkpoint.failures,
  };
}
