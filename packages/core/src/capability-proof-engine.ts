import {
  maturityRank,
  type CapabilityMaturity,
  type CapabilityProofRef,
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
  | 'autonomous_operation'
  /**
   * Proof Evaluation V0 (2026-09-28): um PROCEDIMENTO assistido (humano/dev fora do
   * runtime do Anima — backup/restore manual, script de prova controlada)
   * comprovadamente funcionou. Prova o procedimento, NUNCA a capacidade do
   * sistema: é preservado como evidência, mas não participa da maturidade.
   * Ex.: restore PASS por ato humano ≠ "o Anima garante a própria durabilidade".
   */
  | 'assisted_procedure';

/** Classes que participam da escada de maturidade. */
export type CapabilityMaturityEvidenceClass = Exclude<
  CapabilityEvidenceClass,
  'assisted_procedure'
>;

/**
 * Desfecho da observação.
 *
 * `inconclusive` NÃO é ausência de evidência: preserva fatos que demonstram
 * PARTE do caminho sem demonstrar a capacidade (ex.: gates executados e
 * observados pelo host, mas falhos — prova execução, não conclusão correta).
 * É guardado e exibido; nunca promove nem regride.
 */
export type CapabilityEvidenceOutcome =
  | 'positive'
  | 'negative'
  | 'inconclusive';

/**
 * DE ONDE a observação veio (proveniência da fonte, não o que ela demonstra):
 *
 * - `canonical_event_log`: derivada automaticamente de `work_events` (estado
 *   canônico append-only; o Anima operou sobre trabalho real);
 * - `recorded_proof`: prova controlada/registro estruturado com proveniência
 *   (registro append-only + commit), escrito à mão. É evidência, não juízo: a
 *   maturidade continua saindo da régua. Prova controlada NUNCA conta como
 *   ocasião de reprodução — `operational` exige uso real, não repetição de prova.
 *
 * Ausente = `canonical_event_log` (compatibilidade com o V1/V1.1).
 */
export type CapabilityEvidenceSource =
  | 'canonical_event_log'
  | 'recorded_proof';

/**
 * Frescor modelado, NÃO aplicado no V0:
 * - `durable`: o fato não envelhece (código exercitado, execução observada);
 * - `perishable`: depende de algo que pode desaparecer/mudar (ferramenta
 *   externa instalada, preço de provider, runtime disponível). Política de
 *   recência fica para versão futura; hoje só é exposto para leitura humana.
 */
export type CapabilityEvidenceFreshness = 'durable' | 'perishable';

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

  /**
   * Identidade da OCASIÃO independente que produziu esta observação — tipicamente
   * o attempt. É o sinal explícito de REPRODUÇÃO: duas execuções verificadas da
   * mesma capacidade só contam como reprodução quando vêm de ocasiões distintas.
   *
   * Deliberadamente separado de `proofRefs`: reprodução conta OCASIÕES, nunca a
   * quantidade de ponteiros de prova. Ausência de `occasionId` NUNCA dispara
   * promoção por reprodução (fail-closed conservador) — a observação ainda
   * sustenta a força da sua própria classe, mas não é contada como ocasião
   * independente.
   */
  readonly occasionId?: string;

  /** Proveniência da fonte. Ausente = `canonical_event_log`. */
  readonly source?: CapabilityEvidenceSource;

  /**
   * Ambiente em que o fato foi observado (ex.: `windows-local-dev`). Só para
   * leitura humana — nunca decide maturidade.
   */
  readonly environment?: string;

  /**
   * O que a observação cobre — e o que NÃO cobre (ex.: "funcionalidade, não
   * isolamento de segurança"). Só para leitura humana.
   */
  readonly scope?: string;

  /** Frescor (modelado; sem política de expiração no V0). */
  readonly freshness?: CapabilityEvidenceFreshness;
}

export function evidenceSourceOf(
  evidence: CapabilityEvidenceObservation,
): CapabilityEvidenceSource {
  return evidence.source ?? 'canonical_event_log';
}

export type CapabilityProofBasis =
  | 'definition'
  | CapabilityMaturityEvidenceClass
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

  /**
   * V0.1: ocasiões independentes (canônicas) de execução verificada positiva
   * na janela válida, quando atingem `REPRODUCTION_THRESHOLD`. Presente = a
   * REPRODUÇÃO FOI OBSERVADA — mesmo que ela não satisfaça `operational` para
   * esta capacidade (reprodução ≠ satisfação operacional).
   */
  readonly reproducedOccasions?: number;

  /**
   * V0.1: maturidade que a evidência alcançaria antes de uma limitação
   * (critério operacional da regra não satisfeito ou teto de derivação).
   * Ausente = nada foi limitado.
   */
  readonly limitedFrom?: CapabilityMaturity;
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

  /**
   * V0.1: a reprodução observada (≥ `REPRODUCTION_THRESHOLD` ocasiões
   * canônicas independentes) SATISFAZ `operational` para esta capacidade?
   * Ausente = `true` (compatibilidade V1). Critério operacional é específico
   * da capacidade: quem decide é a regra, nunca o engine.
   */
  readonly reproductionSatisfiesOperational?: boolean;

  /**
   * V0.1: teto programático — a maturidade derivada nunca o ultrapassa.
   * `degraded` nunca é limitada (regressão sempre vence).
   */
  readonly maturityCeiling?: CapabilityMaturity;
}

const EVIDENCE_RANK: Record<CapabilityEvidenceClass, number> = {
  // Nunca chega à janela forte (isStrongEvidence o exclui); rank só por totalidade.
  assisted_procedure: -1,
  implementation: 0,
  verified_execution: 1,
  reproduced_operation: 2,
  autonomous_operation: 3,
};

/**
 * Reprodução V1: NÃO é estatística — é o mínimo semântico de "reproduziu". Duas
 * ocasiões independentes de execução verificada bastam para sair de "provado uma
 * vez" (`proven`) e sustentar operação reproduzível (`operational`). Um único
 * sucesso, por mais rico que seja em provas, nunca é reprodução.
 */
export const REPRODUCTION_THRESHOLD = 2 as const;

const EVIDENCE_MATURITY: Record<
  Exclude<CapabilityMaturityEvidenceClass, 'implementation'>,
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
  return (
    evidence.evidenceClass !== 'implementation' &&
    evidence.evidenceClass !== 'assisted_procedure'
  );
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
function assessUncappedCapabilityMaturity(
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
    CapabilityMaturityEvidenceClass,
    'implementation'
  >;

  let maturity: CapabilityMaturity = EVIDENCE_MATURITY[bestClass];
  let basis: CapabilityProofBasis = bestClass;
  let reproducedOccasions: number | undefined;
  let limitedFrom: CapabilityMaturity | undefined;

  /**
   * REPRODUÇÃO.
   *
   * Uma execução verificada única PROVA (`proven`), mas não demonstra OPERAÇÃO
   * reproduzível. Execução verificada positiva em >= REPRODUCTION_THRESHOLD
   * ocasiões INDEPENDENTES (occasionId distinto) dentro da janela válida (já
   * pós-recuperação, se houve regressão) promove a `operational`
   * (`reproduced_operation`).
   *
   * - só REFORÇA a partir de `verified_execution`; nunca rebaixa uma classe já
   *   mais forte (`reproduced_operation`/`autonomous_operation`);
   * - conta OCASIÕES distintas, então duas observações da MESMA ocasião não
   *   inflam reprodução;
   * - ausência de `occasionId` não é contada — reprodução falha fechado.
   */
  if (bestClass === 'verified_execution') {
    const occasions = new Set<string>();

    for (const evidence of positiveWindow) {
      // Prova controlada registrada não é uso real: nunca conta como ocasião
      // de reprodução (Proof Evaluation V0, 2026-09-28).
      if (
        evidence.evidenceClass === 'verified_execution' &&
        evidence.occasionId !== undefined &&
        evidenceSourceOf(evidence) === 'canonical_event_log'
      ) {
        occasions.add(evidence.occasionId);
      }
    }

    if (occasions.size >= REPRODUCTION_THRESHOLD) {
      reproducedOccasions = occasions.size;

      // V0.1: reprodução observada ≠ satisfação operacional. A regra decide.
      if (input.reproductionSatisfiesOperational ?? true) {
        maturity = 'operational';
        basis = 'reproduced_operation';
      } else {
        limitedFrom = 'operational';
      }
    }
  }

  return {
    maturity,
    basis,
    decisiveEvidenceId: best.id,
    supportingEvidenceIds: positiveWindow.map(
      (evidence) => evidence.id,
    ),
    contradictingEvidenceIds,
    ...(reproducedOccasions !== undefined ? { reproducedOccasions } : {}),
    ...(limitedFrom !== undefined ? { limitedFrom } : {}),
  };
}

const CEILING_BASIS: Partial<Record<CapabilityMaturity, CapabilityProofBasis>> = {
  implemented: 'implementation',
  proven: 'verified_execution',
  operational: 'reproduced_operation',
};

/**
 * Deriva maturidade e aplica o teto da regra (V0.1). A maturidade derivada
 * nunca ultrapassa `maturityCeiling`; `limitedFrom` preserva o que a
 * evidência alcançaria. Regressão (`degraded`) nunca é limitada.
 */
export function assessCapabilityMaturity(
  input: AssessCapabilityMaturityInput,
): CapabilityProofAssessment {
  const assessment = assessUncappedCapabilityMaturity(input);
  const ceiling = input.maturityCeiling;

  if (
    ceiling === undefined ||
    assessment.maturity === 'degraded' ||
    maturityRank(assessment.maturity) <= maturityRank(ceiling)
  ) {
    return assessment;
  }

  return {
    ...assessment,
    maturity: ceiling,
    basis: CEILING_BASIS[ceiling] ?? 'definition',
    limitedFrom: assessment.limitedFrom ?? assessment.maturity,
  };
}

export function deriveCapabilityMaturity(
  input: AssessCapabilityMaturityInput,
): CapabilityMaturity {
  return assessCapabilityMaturity(input).maturity;
}