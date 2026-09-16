import type {
  CapabilityMaturity,
  CapabilityProofRef,
} from './capability-map';

/**
 * A definição só pode afirmar até `implemented`.
 *
 * Estados fortes (`proven`, `operational`, `autonomous`) pertencem ao domínio
 * da evidência e devem ser derivados pelo proof engine.
 */
export type CapabilityDefinitionMaturity = Extract<
  CapabilityMaturity,
  'projected' | 'specified' | 'implemented'
>;

/**
 * O que uma observação realmente demonstra.
 *
 * Não é o tipo físico da fonte (`commit`, `attempt`, `event` etc.).
 * `CapabilityProofRef` responde "onde está a prova?".
 * Esta classe responde "o que essa prova demonstra?".
 */
export type CapabilityEvidenceClass =
  | 'implementation'
  | 'verified_execution'
  | 'reproduced_operation'
  | 'autonomous_operation';

export type CapabilityEvidenceOutcome =
  | 'positive'
  | 'negative'
  | 'inconclusive';

export interface CapabilityEvidenceObservation {
  /** Identidade estável da observação. */
  readonly id: string;

  readonly capabilityId: string;

  readonly evidenceClass: CapabilityEvidenceClass;

  readonly outcome: CapabilityEvidenceOutcome;

  /** Instante ISO-8601 em que o fato foi observado. */
  readonly observedAt: string;

  /**
   * Fontes reais que sustentam esta observação.
   *
   * Uma execução verificada, por exemplo, pode correlacionar attempt + verifier
   * + event em vez de fingir que um único ponteiro conta toda a história.
   */
  readonly proofRefs: readonly CapabilityProofRef[];

  readonly note?: string;
}

export type CapabilityProofBasis =
  | 'definition'
  | CapabilityEvidenceClass
  | 'regression';

export interface CapabilityProofAssessment {
  readonly maturity: CapabilityMaturity;

  /**
   * Classe decisiva para a maturidade atual.
   * `regression` significa que evidência posterior contradisse capacidade
   * previamente comprovada.
   */
  readonly basis: CapabilityProofBasis;

  readonly decisiveEvidenceId: string | null;

  /**
   * Evidências positivas ainda válidas no ciclo atual.
   *
   * Uma regressão invalida provas fortes anteriores para promoção automática.
   */
  readonly supportingEvidenceIds: readonly string[];

  /** Evidências negativas fortes observadas no histórico recebido. */
  readonly contradictingEvidenceIds: readonly string[];
}

export interface AssessCapabilityMaturityInput {
  readonly capabilityId: string;

  /**
   * Estado da definição/código sem fazer alegação epistemológica forte.
   *
   * O registry atual ainda mistura definição e prova; a migração para este
   * contrato será feita separadamente.
   */
  readonly definitionMaturity: CapabilityDefinitionMaturity;

  readonly evidence: readonly CapabilityEvidenceObservation[];
}

const EVIDENCE_RANK: Record<CapabilityEvidenceClass, number> = {
  implementation: 0,
  verified_execution: 1,
  reproduced_operation: 2,
  autonomous_operation: 3,
};

const EVIDENCE_MATURITY: Record<
  Exclude<CapabilityEvidenceClass, 'implementation'>,
  CapabilityMaturity
> = {
  verified_execution: 'proven',
  reproduced_operation: 'operational',
  autonomous_operation: 'autonomous',
};

function timestampOf(evidence: CapabilityEvidenceObservation): number {
  const timestamp = Date.parse(evidence.observedAt);

  if (!Number.isFinite(timestamp)) {
    throw new Error(
      `invalid_capability_evidence_timestamp:${evidence.id}`,
    );
  }

  return timestamp;
}

function compareEvidence(
  left: CapabilityEvidenceObservation,
  right: CapabilityEvidenceObservation,
): number {
  const time = timestampOf(left) - timestampOf(right);

  if (time !== 0) return time;

  return left.id.localeCompare(right.id);
}

function isStrongEvidence(
  evidence: CapabilityEvidenceObservation,
): evidence is CapabilityEvidenceObservation & {
  evidenceClass:
    | 'verified_execution'
    | 'reproduced_operation'
    | 'autonomous_operation';
} {
  return evidence.evidenceClass !== 'implementation';
}

/**
 * Deriva maturidade exclusivamente de definição + observações resolvidas.
 *
 * Importante:
 * - NÃO conta `proofRefs`;
 * - NÃO presume que commit/doc/test sozinho prova funcionamento;
 * - NÃO recebe `proven`/`operational`/`autonomous` como input autoritativo;
 * - regressão posterior invalida provas fortes anteriores até nova prova.
 */
export function assessCapabilityMaturity(
  input: AssessCapabilityMaturityInput,
): CapabilityProofAssessment {
  const relevant = input.evidence
    .filter((evidence) => evidence.capabilityId === input.capabilityId);

  // Validação explícita: uma observação relevante não pode entrar com tempo
  // impossível, pois recência é parte da semântica de regressão/recuperação.
  for (const evidence of relevant) {
    timestampOf(evidence);
  }

  const implementationEvidence = relevant
    .filter(
      (evidence) =>
        evidence.evidenceClass === 'implementation' &&
        evidence.outcome === 'positive',
    )
    .sort(compareEvidence);

  const definitionMaturity: CapabilityDefinitionMaturity =
    implementationEvidence.length > 0
      ? 'implemented'
      : input.definitionMaturity;

  const strong = relevant
    .filter(
      (evidence) =>
        isStrongEvidence(evidence) &&
        evidence.outcome !== 'inconclusive',
    )
    .sort(compareEvidence);

  const contradictingEvidenceIds = strong
    .filter((evidence) => evidence.outcome === 'negative')
    .map((evidence) => evidence.id);

  const lastNegativeIndex = strong
    .map((evidence) => evidence.outcome)
    .lastIndexOf('negative');

  let positiveWindow = strong.filter(
    (evidence) => evidence.outcome === 'positive',
  );

  if (lastNegativeIndex >= 0) {
    const beforeLastNegative = strong.slice(0, lastNegativeIndex);

    const hadPreviouslyProvenCapability = beforeLastNegative.some(
      (evidence) => evidence.outcome === 'positive',
    );

    if (hadPreviouslyProvenCapability) {
      const afterLastNegative = strong
        .slice(lastNegativeIndex + 1)
        .filter((evidence) => evidence.outcome === 'positive');

      // Havia prova forte e a observação forte mais recente a contradisse.
      // Implementação pode continuar existindo, mas a capacidade precisa ser
      // re-provada antes de voltar à escada forte.
      if (afterLastNegative.length === 0) {
        const lastNegative = strong[lastNegativeIndex]!;

        return {
          maturity: 'degraded',
          basis: 'regression',
          decisiveEvidenceId: lastNegative.id,
          supportingEvidenceIds: beforeLastNegative
            .filter((evidence) => evidence.outcome === 'positive')
            .map((evidence) => evidence.id),
          contradictingEvidenceIds,
        };
      }

      // Recuperação: provas anteriores à regressão não promovem o estado atual.
      positiveWindow = afterLastNegative;
    }
  }

  if (positiveWindow.length === 0) {
    const decisiveImplementation =
      implementationEvidence[implementationEvidence.length - 1];

    return {
      maturity: definitionMaturity,
      basis:
        decisiveImplementation === undefined
          ? 'definition'
          : 'implementation',
      decisiveEvidenceId: decisiveImplementation?.id ?? null,
      supportingEvidenceIds: implementationEvidence.map(
        (evidence) => evidence.id,
      ),
      contradictingEvidenceIds,
    };
  }

  let best = positiveWindow[0]!;

  for (const candidate of positiveWindow.slice(1)) {
    const candidateRank = EVIDENCE_RANK[candidate.evidenceClass];
    const bestRank = EVIDENCE_RANK[best.evidenceClass];

    if (
      candidateRank > bestRank ||
      (
        candidateRank === bestRank &&
        compareEvidence(candidate, best) > 0
      )
    ) {
      best = candidate;
    }
  }

  // `positiveWindow` contém somente evidência forte aqui.
  const bestClass = best.evidenceClass as Exclude<
    CapabilityEvidenceClass,
    'implementation'
  >;

  return {
    maturity: EVIDENCE_MATURITY[bestClass],
    basis: bestClass,
    decisiveEvidenceId: best.id,
    supportingEvidenceIds: positiveWindow.map(
      (evidence) => evidence.id,
    ),
    contradictingEvidenceIds,
  };
}

export function deriveCapabilityMaturity(
  input: AssessCapabilityMaturityInput,
): CapabilityMaturity {
  return assessCapabilityMaturity(input).maturity;
}