import {
  classifyCloudProvisionFailure,
  planNextCloudSessionAction,
  type CloudProvisionFailureClassV1,
  type CloudSessionEnvelopeV1,
  type CloudSessionHaltSignalV1,
  type CloudSessionStopReasonV1,
  type RequirementMoneyV1,
} from '@anima/core';

// ============================================================
// RESILIENT CLOUD SESSION V1 — ORQUESTRADOR de reprovisionamento (composição, sem efeito próprio).
//
// Dirige o loop resiliente DENTRO do envelope de uma sessão cloud, delegando cada efeito a uma
// PORTA injetável — este módulo não cria Pod, não gasta e não persiste POR SI: só compõe.
//
//   selecionar candidato (matcher − placements excluídos)
//     → planner puro decide provisionar × parar (governança: custo/tempo/candidatos/provider)
//       → attemptProvision (UMA máquina; reserva+provisiona; em falha LIQUIDA e faz teardown ANTES
//          de retornar)
//         → sucesso: DEVOLVE o Pod saudável ao caller (coder/gates/Verifier/review) — NÃO reprovisiona
//         → falha:   classifica; exclui o placement se recuperável; relê committed (settlement já
//                    liberou o excesso) e tenta o próximo candidato
//
// INVARIANTE DE 1 POD: o loop é SEQUENCIAL e `attemptProvision` só retorna DEPOIS do teardown do Pod
// que falhou — nunca há dois Pods simultâneos. A troca de máquina/placement DENTRO de cloud
// self-hosted é autônoma; a escolha CLOUD × LOCAL × API de terceiros continua HUMANA (fora daqui).
// ============================================================

/** Seleção do próximo candidato elegível (matcher sobre inventário − placements excluídos). */
export type CloudSessionCandidateSelectionResult =
  | { readonly ok: true; readonly placementId: string; readonly estimatedCost: RequirementMoneyV1 | null }
  | { readonly ok: false; readonly blocker: string; readonly detail: string };

/** Resultado de UMA tentativa de provisão de máquina. Em falha, a porta já LIQUIDOU e fez teardown
 * do recurso ANTES de retornar (contrato) — o orquestrador nunca segura um Pod vivo entre voltas. */
export type CloudSessionProvisionResult<TRuntime> =
  | { readonly ok: true; readonly runtime: TRuntime; readonly providerRef: string | null; readonly leaseExpiresAt?: string; finish(attemptId: string | null): Promise<void> }
  | { readonly ok: false; readonly reason: string; readonly providerRef: string | null; readonly settledCost?: RequirementMoneyV1 | null };

export interface ResilientCloudSessionPorts<TRuntime> {
  /** Próximo candidato elegível, respeitando os placements já excluídos nesta sessão. */
  selectNextCandidate(excluded: ReadonlySet<string>): Promise<CloudSessionCandidateSelectionResult>;
  /** Reserva + provisiona UM candidato; em falha, liquida e faz teardown ANTES de retornar. */
  attemptProvision(
    candidate: { readonly placementId: string; readonly estimatedCost: RequirementMoneyV1 | null },
    signal: AbortSignal,
  ): Promise<CloudSessionProvisionResult<TRuntime>>;
  /** Custo committed corrente da autoridade (do ledger; reflete settlements). `null` = sem teto. */
  readCommittedCost(): Promise<RequirementMoneyV1 | null>;
  now(): number;
}

/** Uma linha do traço da sessão — reconstrói o arco (candidato→providerRef→desfecho→settlement). */
export interface CloudSessionAttemptTraceV1 {
  readonly attempt: number;
  readonly placementId: string;
  readonly providerRef: string | null;
  readonly outcome: 'healthy' | 'failed';
  readonly failureReason: string | null;
  readonly failureClass: CloudProvisionFailureClassV1 | null;
  readonly settledCost: RequirementMoneyV1 | null;
}

export type ResilientCloudSessionOutcome<TRuntime> =
  | {
      readonly ok: true;
      readonly cloudSessionId: string;
      readonly placementId: string;
      readonly providerRef: string | null;
      readonly runtime: TRuntime;
      /** Prazo absoluto (ISO) da lease do Pod saudável, quando o provisionador o expôs. */
      readonly leaseExpiresAt?: string;
      finish(attemptId: string | null): Promise<void>;
      readonly attempts: number;
      readonly trace: readonly CloudSessionAttemptTraceV1[];
    }
  | {
      readonly ok: false;
      readonly cloudSessionId: string;
      readonly stopReason: CloudSessionStopReasonV1;
      readonly detail: string;
      readonly attempts: number;
      readonly trace: readonly CloudSessionAttemptTraceV1[];
    };

/**
 * Executa uma sessão cloud resiliente até obter um Pod SAUDÁVEL (devolvido ao caller) ou parar com
 * razão exata. Determinística dado o comportamento das portas. Nunca cria dois Pods; nunca pede nova
 * autorização humana por Pod intermediário — tudo dentro do envelope já autorizado.
 */
export async function runResilientCloudSession<TRuntime>(input: {
  readonly envelope: CloudSessionEnvelopeV1;
  readonly ports: ResilientCloudSessionPorts<TRuntime>;
  readonly signal: AbortSignal;
}): Promise<ResilientCloudSessionOutcome<TRuntime>> {
  const { envelope, ports, signal } = input;
  const trace: CloudSessionAttemptTraceV1[] = [];
  const excluded = new Set<string>();
  // Falhas recuperáveis por placement — só excluímos a SKU quando o orçamento de tentativas dela
  // (`maxAttemptsPerPlacement`) se esgota. A identidade mais fina pré-create é o gpuTypeId (SKU);
  // ver `CloudSessionEnvelopeV1.maxAttemptsPerPlacement`.
  const placementFailures = new Map<string, number>();
  let attempts = 0;
  let halt: CloudSessionHaltSignalV1 = 'none';
  let terminalReason: string | null = null;
  const startedAt = ports.now();

  for (;;) {
    if (signal.aborted) {
      return { ok: false, cloudSessionId: envelope.cloudSessionId, stopReason: 'terminal_failure', detail: 'session aborted', attempts, trace };
    }
    // Relê o committed ANTES de cada decisão: um settlement da volta anterior já liberou excesso,
    // reabrindo budget para a próxima máquina.
    const committedCost = await ports.readCommittedCost();
    const selection = await ports.selectNextCandidate(excluded);
    const nextCandidate = selection.ok
      ? { placementId: selection.placementId, estimatedCost: selection.estimatedCost }
      : null;

    const decision = planNextCloudSessionAction({
      envelope,
      progress: { elapsedMs: ports.now() - startedAt, committedCost, attemptsMade: attempts, halt, terminalReason },
      nextCandidate,
    });

    if (decision.action === 'stop') {
      // Quando o motivo é "sem candidato" e a SELEÇÃO trouxe um blocker preciso, preserva-o no
      // detalhe (ex.: no_compatible_cloud_resource | provider_inventory_unavailable).
      const detail = decision.reason === 'no_more_candidates' && !selection.ok
        ? `${decision.detail}; selection:${selection.blocker}:${selection.detail}`
        : decision.detail;
      return { ok: false, cloudSessionId: envelope.cloudSessionId, stopReason: decision.reason, detail, attempts, trace };
    }

    attempts += 1;
    const result = await ports.attemptProvision({ placementId: decision.placementId, estimatedCost: decision.estimatedCost }, signal);
    if (result.ok) {
      // Pod saudável: REUTILIZA — devolve ao caller para coder/gates/Verifier/review. Não reprovisiona.
      trace.push({ attempt: attempts, placementId: decision.placementId, providerRef: result.providerRef, outcome: 'healthy', failureReason: null, failureClass: null, settledCost: null });
      return {
        ok: true, cloudSessionId: envelope.cloudSessionId, placementId: decision.placementId,
        providerRef: result.providerRef, runtime: result.runtime,
        ...(result.leaseExpiresAt !== undefined ? { leaseExpiresAt: result.leaseExpiresAt } : {}),
        finish: result.finish, attempts, trace,
      };
    }

    const assessment = classifyCloudProvisionFailure(result.reason);
    trace.push({
      attempt: attempts, placementId: decision.placementId, providerRef: result.providerRef,
      outcome: 'failed', failureReason: result.reason, failureClass: assessment.failureClass,
      settledCost: result.settledCost ?? null,
    });
    if (assessment.excludePlacement) {
      const failures = (placementFailures.get(decision.placementId) ?? 0) + 1;
      placementFailures.set(decision.placementId, failures);
      // Exclui a SKU só quando seu orçamento de tentativas se esgota (default 1). Assim uma máquina
      // ruim não queima toda a SKU se o operador permitir re-tentativas (outra máquina física).
      if (failures >= envelope.maxAttemptsPerPlacement) excluded.add(decision.placementId);
    }
    halt = assessment.disposition === 'halt_provider_unavailable' ? 'provider_unavailable'
      : assessment.disposition === 'halt_terminal' ? 'terminal' : 'none';
    terminalReason = halt !== 'none' ? result.reason : null;
    // Loop: o próximo `readCommittedCost` refletirá o settlement que `attemptProvision` já fez.
  }
}
