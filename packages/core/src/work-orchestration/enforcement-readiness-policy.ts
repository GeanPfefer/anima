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
import type { ChangeAuthorizationEvidenceV1, ChangeAuthorizationStatus } from './change-authorization-evidence';

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
// A Change Authorization Evidence host-observada (quando disponível) alimenta esta
// camada: `eligible` exige verificação COMPLETA (`status = verified`) SEM mudança não
// autorizada. Autorização ausente/parcial/não verificável degrada conservadoramente
// (`change_scope_unverified`) — um gate `FAIL→PASS` discriminating continua ótima
// evidência TÉCNICA, mas não está pronto para enforcement autônomo sem a autorização
// verificada. O hard enforcement do executor (contract_violation) segue sendo a
// autoridade operacional; esta camada só a torna AUDITÁVEL, jamais a substitui.
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
  | 'change_scope_unverified'
  | 'discriminating_gate_candidate';

/**
 * Projeção da verificação do Change Authorization Scope para a força da evidência.
 * `unavailable` = sem evidência de autorização; `partially_verifiable` = parte do
 * escopo é prosa/não verificável; `verified` = superfície toda verificável e
 * comparada host-side aos arquivos alterados. Só `verified` sem mudança não
 * autorizada sustenta `eligible`.
 */
export interface ChangeAuthorizationVerificationV0 {
  readonly status: ChangeAuthorizationStatus;
  readonly authorizedChangedFiles: readonly string[];
  readonly unauthorizedChangedFiles: readonly string[];
}

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
   * OPCIONAL: Change Authorization Evidence host-observada da attempt (já classificada
   * pela semântica canônica). Ausente ⇒ `changeAuthorization = unavailable` e degrada.
   * NUNCA derive autorização do gate `targetPaths`: são escopos diferentes.
   */
  readonly changeAuthorization?: ChangeAuthorizationEvidenceV1;
}

const projectChangeAuthorization = (
  evidence: ChangeAuthorizationEvidenceV1 | undefined,
): ChangeAuthorizationVerificationV0 =>
  evidence
    ? {
        status: evidence.status,
        authorizedChangedFiles: evidence.authorizedChangedFiles,
        unauthorizedChangedFiles: evidence.unauthorizedChangedFiles,
      }
    : { status: 'unavailable', authorizedChangedFiles: [], unauthorizedChangedFiles: [] };

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
  const changeAuthorization = projectChangeAuthorization(input.changeAuthorization);
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

  // gate_assertion + discriminating = candidato TÉCNICO. A candidatura a enforcement
  // autônomo exige autorização de mudança VERIFICADA e limpa (regra conservadora):
  //  - qualquer mudança fora do escopo AUTORIZADO observada ⇒ revisão (nunca deny/
  //    fraude automática); mudança fora do gate target, por si só, é NEUTRA;
  //  - autorização ausente/parcial/não verificável ⇒ revisão (change_scope_unverified),
  //    mesmo com diferencial forte — o hard enforcement do executor segue sendo a
  //    autoridade operacional, aqui só se afere prontidão;
  //  - só `verified` sem mudança não autorizada sustenta `eligible`.
  if (changeAuthorization.unauthorizedChangedFiles.length > 0) {
    return result('requires_review', 'unauthorized_change_detected');
  }
  if (changeAuthorization.status !== 'verified') {
    return result('requires_review', 'change_scope_unverified');
  }
  return result('eligible', 'discriminating_gate_candidate');
}
