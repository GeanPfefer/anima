import type {
  Capability,
  CapabilityMaturity,
} from './capability-map';
import { ANIMA_CAPABILITY_REGISTRY_V0 } from './capability-registry';
import {
  assessCapabilityMaturity,
  type CapabilityDefinitionMaturity,
  type CapabilityEvidenceObservation,
  type CapabilityProofAssessment,
} from './capability-proof-engine';
import { deriveCanonicalWorkCapabilityEvidenceFromEvents } from './capability-proof-work-evidence';
import type { WorkEvent } from './work-orchestration/types';

/**
 * O registry atual ainda contém maturidades historicamente auditadas.
 *
 * Para o Proof Engine, porém, `proven`/`operational`/`autonomous` não podem ser
 * usados como premissa da própria conclusão. Eles colapsam para o fato mais
 * fraco que podemos afirmar sem evidência dinâmica: a implementação existe.
 *
 * `degraded` também implica que a implementação existe; regressão é uma
 * conclusão sobre evidência temporal, não uma propriedade da definição.
 */
export function capabilityDefinitionMaturity(
  maturity: CapabilityMaturity,
): CapabilityDefinitionMaturity {
  if (maturity === 'projected') return 'projected';
  if (maturity === 'specified') return 'specified';

  return 'implemented';
}

export type CapabilityAssessmentIssueCode =
  | 'duplicate_capability_definition'
  | 'evidence_for_unknown_capability';

export interface CapabilityAssessmentIssue {
  readonly code: CapabilityAssessmentIssueCode;
  readonly capabilityId: string;
  readonly explanation: string;
}

export interface CapabilityHistoryAssessment {
  readonly capabilityId: string;

  /**
   * Valor atualmente declarado pelo registry.
   *
   * É mantido para auditoria/migração, mas NÃO alimenta diretamente a
   * conclusão forte do Proof Engine.
   */
  readonly declaredMaturity: CapabilityMaturity;

  /**
   * Baseline epistemológico fornecido ao Proof Engine.
   */
  readonly definitionMaturity: CapabilityDefinitionMaturity;

  /**
   * Conclusão rederivada somente da definição + evidência dinâmica fornecida.
   */
  readonly derivedMaturity: CapabilityMaturity;

  readonly assessment: CapabilityProofAssessment;
  readonly evidence: readonly CapabilityEvidenceObservation[];
}

export interface CapabilityAssessmentProjection {
  readonly assessments: readonly CapabilityHistoryAssessment[];
  readonly issues: readonly CapabilityAssessmentIssue[];
}

function compareEvidence(
  left: CapabilityEvidenceObservation,
  right: CapabilityEvidenceObservation,
): number {
  const leftTime = Date.parse(left.observedAt);
  const rightTime = Date.parse(right.observedAt);

  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  return left.id.localeCompare(right.id);
}

/**
 * Primitive pura de agregação.
 *
 * Importante:
 *
 * - NÃO interpreta texto livre;
 * - NÃO confia em `proofRefs` como classificação de força;
 * - NÃO usa maturity forte do registry como prova;
 * - NÃO produz assessment para capability sem evidência dinâmica;
 * - evidencia para capability desconhecida falha fechado como issue explícita.
 */
export function assessCapabilitiesFromEvidence(
  capabilities: readonly Capability[],
  evidence: readonly CapabilityEvidenceObservation[],
): CapabilityAssessmentProjection {
  const issues: CapabilityAssessmentIssue[] = [];
  const definitions = new Map<string, Capability>();

  for (const capability of capabilities) {
    if (definitions.has(capability.id)) {
      issues.push({
        code: 'duplicate_capability_definition',
        capabilityId: capability.id,
        explanation:
          `A capability ${capability.id} aparece mais de uma vez nas definições.`,
      });

      continue;
    }

    definitions.set(capability.id, capability);
  }

  const evidenceByCapability = new Map<
    string,
    CapabilityEvidenceObservation[]
  >();

  for (const observation of evidence) {
    if (!definitions.has(observation.capabilityId)) {
      issues.push({
        code: 'evidence_for_unknown_capability',
        capabilityId: observation.capabilityId,
        explanation:
          `Há evidência para ${observation.capabilityId}, mas a capability não existe no registry fornecido.`,
      });

      continue;
    }

    const current =
      evidenceByCapability.get(observation.capabilityId) ?? [];

    current.push(observation);
    evidenceByCapability.set(
      observation.capabilityId,
      current,
    );
  }

  const assessments: CapabilityHistoryAssessment[] = [];
  const emitted = new Set<string>();

  /**
   * Preserva a ordem do registry para que a projeção continue compatível com
   * a ordem conceitual do Evolution Map.
   */
  for (const capability of capabilities) {
    if (emitted.has(capability.id)) continue;
    emitted.add(capability.id);

    const capabilityEvidence =
      evidenceByCapability.get(capability.id);

    /**
     * V0 é uma MIGRAÇÃO incremental:
     *
     * capability sem resolver/evidência dinâmica ainda não é reavaliada.
     * Isso impede que ausência de telemetria seja confundida com ausência de
     * capacidade.
     */
    if (
      capabilityEvidence === undefined ||
      capabilityEvidence.length === 0
    ) {
      continue;
    }

    const definitionMaturity =
      capabilityDefinitionMaturity(capability.maturity);

    const assessment = assessCapabilityMaturity({
      capabilityId: capability.id,
      definitionMaturity,
      evidence: capabilityEvidence,
    });

    /**
     * assessCapabilityMaturity valida timestamps. Depois que a validação
     * ocorreu, ordenamos a evidência para a projeção externa ser determinística.
     */
    const orderedEvidence = [
      ...capabilityEvidence,
    ].sort(compareEvidence);

    assessments.push({
      capabilityId: capability.id,
      declaredMaturity: capability.maturity,
      definitionMaturity,
      derivedMaturity: assessment.maturity,
      assessment,
      evidence: orderedEvidence,
    });
  }

  return {
    assessments,
    issues,
  };
}

/**
 * Primeira ponte end-to-end:
 *
 * WorkEvent[]
 *   -> atribuição factual
 *   -> CapabilityEvidenceObservation[]
 *   -> agregação por capability
 *   -> maturidade derivada
 *
 * O registry é parâmetro para manter esta função testável e permitir futuras
 * versões/registries sem duplicar a primitive.
 */
export function deriveCapabilityAssessmentsFromWorkHistory(
  events: readonly WorkEvent[],
  capabilities: readonly Capability[] =
    ANIMA_CAPABILITY_REGISTRY_V0,
): CapabilityAssessmentProjection {
  const evidence =
    deriveCanonicalWorkCapabilityEvidenceFromEvents(events);

  return assessCapabilitiesFromEvidence(
    capabilities,
    evidence,
  );
}