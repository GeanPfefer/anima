import type { WorkClaimKind } from './eligibility';
import {
  DIFFERENTIAL_EVIDENCE_POLICY_VERSION,
  evaluateDifferentialEvidencePolicy,
  type DifferentialEvidenceDecisionKind,
  type DifferentialEvidenceReasonCode,
  type DifferentialEvidenceRelevantFactsV0,
} from './differential-evidence-policy';
import {
  classifyDifferentialGate,
  type DifferentialGateStatus,
  type ObservedGateOutcomeV1,
} from './host-observed-gate-evidence';
import { normalizeScopePath } from './workspace-access-policy';

// ============================================================
// Enforcement Readiness V0 — SHADOW ONLY (última camada antes de Enforcement V1).
//
// Três fronteiras SEPARADAS, jamais colapsadas:
//   Evidence            != Policy               (fatos != interpretação)
//   Policy Decision      != Enforcement Readiness (a policy `allow` NÃO é o mesmo que
//                                                  "a evidência bastaria para enforcement
//                                                  autônomo")
//   Enforcement Readiness != Enforcement        (readiness NÃO executa nada)
//
// E DOIS escopos DISTINTOS, jamais confundidos:
//   • GATE EVIDENCE SCOPE          = `targetPaths` do gate (a superfície de PROVA).
//     Mudar o próprio target contamina a evidência (→ `confounded`). Mudar arquivos
//     FORA do gate target é NEUTRO por si só (implementação legítima).
//   • CHANGE AUTHORIZATION SCOPE   = `includedScope` do Work Item (o que o coder está
//     AUTORIZADO a modificar). Só mudança fora da superfície AUTORIZADA é candidata a
//     violação de escopo — e isso NÃO se deriva do gate target.
//
// A evidência host-observada de gate NÃO carrega o Change Authorization Scope hoje;
// por isso o shadow default registra `changeAuthorization = unavailable` e degrada
// conservadoramente. O executor já bloqueia HARD escrita fora do `includedScope`
// (contract_violation, ANTES dos gates) — mas essa prova não está na superfície de
// evidência que esta camada lê. Verificá-la aqui é a PRÓXIMA fatia.
//
// `eligible` significa APENAS "a evidência seria CANDIDATA a enforcement autônomo
// segundo esta versão" — NÃO que qualquer ação operacional seja executada agora.
// ============================================================

/** Readiness canônica. Mudanças semânticas exigem nova versão. */
export const ENFORCEMENT_READINESS_POLICY_VERSION = 'enforcement-readiness-v0' as const;

export type EnforcementReadinessDisposition =
  | 'eligible'
  | 'requires_review'
  | 'blocked'
  | 'insufficient_evidence';

export type EnforcementReadinessReasonCode =
  | 'unsupported_claim_kind'
  | 'regression_observed'
  | 'criterion_unsatisfied'
  | 'gate_failed'
  | 'differential_inconclusive'
  | 'differential_confounded'
  | 'non_discriminating_gate'
  | 'substantive_requires_composite_proof'
  | 'unauthorized_change_detected'
  | 'discriminating_gate_candidate';

/**
 * Verificação do Change Authorization Scope. `unavailable` = a superfície autorizada
 * não está disponível nesta superfície de evidência (o gate não carrega o
 * `includedScope`); qualquer caminho que precisaria dessa prova degrada. `verified` =
 * a superfície autorizada foi comparada host-side contra os arquivos alterados
 * observados, separando autorizados de não autorizados.
 */
export type ChangeAuthorizationVerificationV0 =
  | { readonly status: 'unavailable' }
  | {
      readonly status: 'verified';
      readonly authorizedChangedFiles: readonly string[];
      readonly unauthorizedChangedFiles: readonly string[];
    };

export interface EnforcementReadinessEvidenceStrengthV0 {
  /** Classificação diferencial REUTILIZADA (nunca uma taxonomia paralela). */
  readonly differentialStatus: DifferentialGateStatus;
  readonly policyDecision: DifferentialEvidenceDecisionKind;
  readonly quadrant: DifferentialEvidenceRelevantFactsV0['quadrant'];
  readonly finalOutcome: 'passed' | 'failed';
  readonly changeAuthorization: ChangeAuthorizationVerificationV0;
}

export interface EnforcementReadinessDecisionV0 {
  readonly policyVersion: typeof ENFORCEMENT_READINESS_POLICY_VERSION;
  readonly claimKind: string;
  readonly disposition: EnforcementReadinessDisposition;
  readonly reasonCode: EnforcementReadinessReasonCode;
  readonly evidenceStrength: EnforcementReadinessEvidenceStrengthV0;
  /** Referência à decisão da Policy V0 que originou esta readiness (auditoria). */
  readonly policyReference: {
    readonly policyVersion: typeof DIFFERENTIAL_EVIDENCE_POLICY_VERSION;
    readonly decision: DifferentialEvidenceDecisionKind;
    readonly reasonCode: DifferentialEvidenceReasonCode;
  };
  readonly evidenceReference: { readonly label: string; readonly command: string };
}

export interface EvaluateEnforcementReadinessInput {
  readonly claimKind?: WorkClaimKind | string;
  readonly gate: ObservedGateOutcomeV1;
  /**
   * OPCIONAL: superfície AUTORIZADA de edição (Change Authorization Scope,
   * ex.: `includedScope` do Work Item) + arquivos alterados observados pelo host.
   * Ausente ⇒ `changeAuthorization = unavailable`. NUNCA derive autorização do gate
   * `targetPaths`: são escopos diferentes.
   */
  readonly changeAuthorization?: {
    readonly authorizedScope: readonly string[];
    readonly observedChangedFiles: readonly string[];
  };
}

const resolveChangeAuthorization = (
  input: EvaluateEnforcementReadinessInput['changeAuthorization'],
): ChangeAuthorizationVerificationV0 => {
  if (!input) return { status: 'unavailable' };
  const authorized = new Set(input.authorizedScope.map(normalizeScopePath).filter(Boolean));
  const observed = [...new Set(input.observedChangedFiles.map(normalizeScopePath).filter(Boolean))];
  return {
    status: 'verified',
    authorizedChangedFiles: observed.filter(path => authorized.has(path)),
    unauthorizedChangedFiles: observed.filter(path => !authorized.has(path)),
  };
};

/**
 * Avalia, SOMENTE EM SHADOW MODE, se a evidência disponível seria CANDIDATA a uma
 * futura decisão operacional autônoma. Pura e determinística: a mesma evidência +
 * mesmo `claim_kind` + mesma versão sempre produzem a mesma readiness. Sem I/O, LLM,
 * relógio, rede ou estado global. NÃO executa, bloqueia, promove, aprova nem altera
 * qualquer state machine — só interpreta e explica.
 */
export function evaluateEnforcementReadiness(
  input: EvaluateEnforcementReadinessInput,
): EnforcementReadinessDecisionV0 {
  const { gate } = input;
  const policy = evaluateDifferentialEvidencePolicy({ claimKind: input.claimKind, gate });
  const differentialStatus = classifyDifferentialGate(gate);
  const changeAuthorization = resolveChangeAuthorization(input.changeAuthorization);
  const claimKind = input.claimKind ?? 'unknown';

  const evidenceStrength: EnforcementReadinessEvidenceStrengthV0 = {
    differentialStatus,
    policyDecision: policy.decision,
    quadrant: policy.relevantFacts.quadrant,
    finalOutcome: gate.outcome,
    changeAuthorization,
  };

  const result = (
    disposition: EnforcementReadinessDisposition,
    reasonCode: EnforcementReadinessReasonCode,
  ): EnforcementReadinessDecisionV0 => ({
    policyVersion: ENFORCEMENT_READINESS_POLICY_VERSION,
    claimKind,
    disposition,
    reasonCode,
    evidenceStrength,
    policyReference: { policyVersion: policy.policyVersion, decision: policy.decision, reasonCode: policy.reasonCode },
    evidenceReference: { label: gate.label, command: gate.command },
  });

  // Classe de afirmação desconhecida/não suportada degrada conservadoramente.
  if (claimKind !== 'gate_assertion' && claimKind !== 'substantive') {
    return result('insufficient_evidence', 'unsupported_claim_kind');
  }

  // Gate final VERMELHO nunca é elegível. O quadrante é preservado para auditoria:
  // regressão (era verde) × critério ainda não satisfeito (segue vermelho) × sem
  // baseline (só se sabe que o resultado falhou).
  if (gate.outcome === 'failed') {
    if (evidenceStrength.quadrant === 'pass_fail') return result('blocked', 'regression_observed');
    if (evidenceStrength.quadrant === 'fail_fail') return result('blocked', 'criterion_unsatisfied');
    return result('blocked', 'gate_failed');
  }

  // Sem baseline / scope unverified / mismatch ⇒ diferencial inconclusivo: nunca
  // elegível para decisão autônoma forte (mantém insuficiência honesta).
  if (differentialStatus === 'inconclusive') {
    return result('insufficient_evidence', 'differential_inconclusive');
  }

  // Target novo ou alterado (a própria superfície de PROVA mudou): revisão humana.
  // Não é fraude por si só, mas a evidência diferencial não basta para promoção.
  if (differentialStatus === 'confounded') {
    return result('requires_review', 'differential_confounded');
  }

  // PASS→PASS: o gate está verde, mas a mudança NÃO demonstra tê-lo tornado verde
  // (sem efeito causal). Prova ausência de regressão/satisfação corrente, jamais
  // efeito causal — logo NÃO elegível para promoção autônoma por efeito causal.
  // Distingue "policy diz allow" de "evidência suficiente para enforcement autônomo".
  if (differentialStatus === 'non_discriminating') {
    return result('requires_review', 'non_discriminating_gate');
  }

  // differentialStatus === 'discriminating' (FAIL→PASS limpo: scope verified, target
  // pré-existente e NÃO alterado). Um gate verde jamais prova sozinho uma afirmação
  // substantiva ampla: exige prova composta ⇒ permanece humano/conservador.
  if (claimKind === 'substantive') {
    return result('requires_review', 'substantive_requires_composite_proof');
  }

  // gate_assertion + discriminating = CANDIDATO a enforcement autônomo futuro. Se o
  // Change Authorization Scope está DISPONÍVEL e há mudança fora dele, é candidata a
  // violação de escopo AUTORIZADO (≠ gate target) ⇒ revisão, nunca deny/fraude
  // automática. Mudança fora do gate target, por si só, é NEUTRA e não rebaixa.
  if (changeAuthorization.status === 'verified' && changeAuthorization.unauthorizedChangedFiles.length > 0) {
    return result('requires_review', 'unauthorized_change_detected');
  }
  return result('eligible', 'discriminating_gate_candidate');
}
