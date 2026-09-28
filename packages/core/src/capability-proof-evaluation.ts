// Capability Proof Evaluation V0 (2026-09-28) — AVALIAÇÃO declarado × derivado.
//
// Responde, por capacidade: "qual evidência real sustenta a maturidade
// declarada?". Não é uma régua nova — a maturidade continua saindo de
// `assessCapabilityMaturity` (capability-proof-engine.ts). Este módulo:
//
// 1. explicita QUAIS capacidades têm regra de derivação (`CAPABILITY_PROOF_RULES_V0`)
//    — sem regra ⇒ `not_evaluated` (a maturidade declarada segue manual);
// 2. junta evidência canônica (work_events) + registrada (provas controladas);
// 3. compara declarado × derivado (`aligned`/`underclaimed`/`overclaimed`) SEM
//    mutar o registry — divergência é reportada, nunca corrigida em silêncio;
// 4. descreve fontes (manual/derived/hybrid) e o que falta para o próximo degrau
//    segundo critérios CONCRETOS por capacidade.
//
// Conceitos separados (ver docs/arquitetura/capability-proof-engine.md):
// Capability ≠ Tool ≠ primitiva de implementação ≠ Proof ≠ disponibilidade de
// runtime ≠ Maturity claim.

import {
  maturityRank,
  nextMaturity,
  type Capability,
  type CapabilityMaturity,
} from './capability-map';
import { ANIMA_CAPABILITY_REGISTRY_V0 } from './capability-registry';
import {
  evidenceSourceOf,
  type CapabilityEvidenceObservation,
  type CapabilityEvidenceSource,
} from './capability-proof-engine';
import {
  assessCapabilitiesFromEvidence,
  capabilityDefinitionMaturity,
  type CapabilityHistoryAssessment,
} from './capability-proof-assessment';
import { explainCapabilityAssessment } from './capability-assessment-explanation';
import { RECORDED_CAPABILITY_EVIDENCE_V0 } from './capability-proof-recorded';
import { deriveCanonicalWorkCapabilityEvidenceFromEvents } from './capability-proof-work-evidence';
import type { WorkEvent } from './work-orchestration/types';

// ─── Regras ───────────────────────────────────────────────────────────────────

export type CapabilityCriterionMaturity = Extract<
  CapabilityMaturity,
  'specified' | 'implemented' | 'proven' | 'operational' | 'autonomous'
>;

export interface CapabilityProofRule {
  readonly capabilityId: string;

  /** Fontes das quais a regra deriva evidência. */
  readonly sources: readonly CapabilityEvidenceSource[];

  /** O que conta como evidência — a regra legível. */
  readonly evidence: string;

  /**
   * Critério CONCRETO por degrau: o que precisa ser observado para a
   * capacidade alcançá-lo. É o texto dos gaps.
   */
  readonly criteria: Readonly<Partial<Record<CapabilityCriterionMaturity, string>>>;

  /**
   * Maior degrau que a derivação ATUAL consegue concluir com estas fontes.
   * Degraus acima continuam possíveis, mas exigem um sinal que ainda não existe
   * (ex.: `autonomous_operation` não é produzido por nenhum adapter).
   */
  readonly derivationCeiling: CapabilityMaturity;

  /**
   * V0.1 — REPRODUÇÃO ≠ SATISFAÇÃO OPERACIONAL. Duas ocasiões canônicas
   * independentes positivas bastam para `operational` NESTA capacidade?
   *
   * - `true` só para capacidades ESTREITAS em que repetir a execução observada
   *   é o próprio uso operacional (executar gates; editar arquivo observado);
   * - `false`: a reprodução é preservada e exibida, mas a maturidade para em
   *   `proven` até existir um critério operacional próprio (taxa de sucesso,
   *   falhas contabilizadas, calibração contra revisão humana…).
   *
   * Critério operacional é específico da capacidade; o engine não decide.
   */
  readonly reproductionSatisfiesOperational: boolean;

  /**
   * Degrau terminal saudável. `autonomous` NÃO é destino universal (revisão
   * humana 2026-09-27 §6): fundações podem terminar em `operational`.
   * Ausente = decisão conceitual ainda pendente (não se inventa).
   */
  readonly terminalMaturity?: CapabilityMaturity;
}

const CANONICAL: readonly CapabilityEvidenceSource[] = ['canonical_event_log'];
const RECORDED: readonly CapabilityEvidenceSource[] = ['recorded_proof'];

const AUTONOMOUS_NOT_DERIVABLE =
  'Operação verificada sob authority autônoma sem humano no ciclo — sinal `autonomous_operation` ainda não existe (fora do V0).';

/**
 * Regras V0: pilotos canônicos já conectados (V1/V1.1) + seis capacidades novas
 * com evidência suficientemente estruturada. As demais ficam `not_evaluated`.
 */
export const CAPABILITY_PROOF_RULES_V0: readonly CapabilityProofRule[] = [
  {
    capabilityId: 'agency.edit-file',
    sources: CANONICAL,
    evidence: 'coder observado pelo host + handoff + Git correlacionados na mesma attempt (mesmo commit e arquivos).',
    criteria: {
      proven: '1 attempt com edição do coder correlacionada a Git + handoff.',
      operational: '≥2 attempts independentes com edição correlacionada.',
      autonomous: AUTONOMOUS_NOT_DERIVABLE,
    },
    derivationCeiling: 'operational',
    // Capacidade ESTREITA: editar arquivo com edição observada pelo host e
    // correlacionada a Git + handoff (mesmo commit/arquivos). Repetir isso em
    // attempts independentes É o uso operacional; não afirma que a mudança é
    // correta (isso é produce-change).
    reproductionSatisfiesOperational: true,
  },
  {
    capabilityId: 'agency.run-tests',
    sources: CANONICAL,
    evidence: 'gates host-observed com todos os terminais `passed`; gate falho é preservado como inconclusivo (executou, não concluiu).',
    criteria: {
      proven: '1 attempt com todos os gates terminais verdes observados pelo host.',
      operational: '≥2 attempts independentes com gates verdes observados pelo host.',
      autonomous: AUTONOMOUS_NOT_DERIVABLE,
    },
    derivationCeiling: 'operational',
    // Capacidade ESTREITA: executar gates/testes governados. Controle positivo
    // da revisão independente (2026-09-28).
    reproductionSatisfiesOperational: true,
  },
  {
    capabilityId: 'agency.produce-change',
    sources: CANONICAL,
    evidence: 'cadeia forte: resultado + Git + gates + Verifier independente correlacionados.',
    criteria: {
      proven: '1 attempt com cadeia forte verificada.',
      operational: "Critério operacional próprio ainda pendente — produção sustentada contabilizando attempts falhas (hoje não geram evidência negativa) e resultados rejeitados na revisão humana. Reprodução de sucessos, sozinha, não basta.",
      autonomous: AUTONOMOUS_NOT_DERIVABLE,
    },
    derivationCeiling: 'proven',
    reproductionSatisfiesOperational: false,
  },
  {
    capabilityId: 'agency.verify-change',
    sources: CANONICAL,
    evidence: 'a mesma cadeia forte: a mudança foi conferida contra gates e Verifier independente.',
    criteria: {
      proven: '1 attempt com cadeia forte verificada.',
      operational: "Critério operacional próprio ainda pendente — verificação calibrada contra o desfecho humano (changes_requested ainda não calibra verify-change) e attempts falhas contabilizadas. Reprodução de sucessos, sozinha, não basta.",
      autonomous: AUTONOMOUS_NOT_DERIVABLE,
    },
    derivationCeiling: 'proven',
    reproductionSatisfiesOperational: false,
  },
  {
    capabilityId: 'governance.verifier',
    sources: CANONICAL,
    evidence: 'parecer conclusivo (verified ou rejected) sobre observação independente (Git + gates) da attempt.',
    criteria: {
      proven: '1 parecer conclusivo com cobertura independente.',
      operational: "Critério operacional próprio ainda pendente — acerto do parecer calibrado contra a revisão humana (falso-positivo como seq4→seq5 não é sinal persistido; changes_requested não calibra o verifier). Reprodução de sucessos, sozinha, não basta.",
      autonomous: AUTONOMOUS_NOT_DERIVABLE,
    },
    derivationCeiling: 'proven',
    reproductionSatisfiesOperational: false,
  },
  {
    capabilityId: 'agency.supervised-self-development',
    sources: CANONICAL,
    evidence: 'cadeia forte verificada + decisão humana de revisão (aceite = positiva; changes_requested = negativa).',
    criteria: {
      proven: '1 resultado verificado e aceito pela revisão humana.',
      operational: "Critério operacional próprio ainda pendente — aceite humano sustentado com as rejeições (changes_requested) contabilizadas, não só aceites repetidos. Reprodução de sucessos, sozinha, não basta.",
    },
    derivationCeiling: 'proven',
    reproductionSatisfiesOperational: false,
    // Supervisionado é, por definição, com humano no ciclo: o degrau seguinte é
    // outra capacidade (continuous self-development), não "supervised autônomo".
    terminalMaturity: 'operational',
  },
  {
    capabilityId: 'compute.external-provider',
    sources: CANONICAL,
    evidence: 'coder de provider externo (prefixo estruturado do backend) com uso reportado pelo provider numa attempt governada.',
    criteria: {
      proven: '1 attempt governada em que o provider externo respondeu (uso reportado).',
      operational: "Critério operacional próprio ainda pendente — disponibilidade/uso rotineiro com as falhas inconclusivas do provider contabilizadas e custo real liquidado; respostas repetidas sob authorities pagas efêmeras não são uso rotineiro. Reprodução de sucessos, sozinha, não basta.",
      autonomous: AUTONOMOUS_NOT_DERIVABLE,
    },
    derivationCeiling: 'proven',
    reproductionSatisfiesOperational: false,
  },
  {
    capabilityId: 'research.web.search',
    sources: RECORDED,
    evidence: 'prova viva controlada registrada (consulta real, degradação normalizada).',
    criteria: {
      proven: '1 prova viva observada com resultado normalizado.',
      operational: 'Um consumidor real do Anima usando a busca em ≥2 ocasiões (uso, não prova controlada), com fallback para degradação sob carga.',
      autonomous: AUTONOMOUS_NOT_DERIVABLE,
    },
    derivationCeiling: 'proven',
    reproductionSatisfiesOperational: false,
  },
  {
    capabilityId: 'research.web.open',
    sources: RECORDED,
    evidence: 'prova viva controlada registrada (abertura, encerramento e limpeza observados).',
    criteria: {
      proven: '1 prova viva observada com sessão efêmera encerrada e limpa.',
      operational: 'Consumidor real do Anima em ≥2 ocasiões E runtime com boundary (contêiner Linux + egress controlado) — o Windows prova funcionalidade, não isolamento.',
      autonomous: AUTONOMOUS_NOT_DERIVABLE,
    },
    derivationCeiling: 'proven',
    reproductionSatisfiesOperational: false,
  },
  {
    capabilityId: 'research.web.extract',
    sources: RECORDED,
    evidence: 'prova viva controlada registrada (conteúdo extraído como não confiável, com contentHash).',
    criteria: {
      proven: '1 prova viva observada com extração e hash de proveniência.',
      operational: 'Conteúdo extraído alimentando um consumidor real (findings persistidos/citados) em ≥2 ocasiões.',
      autonomous: AUTONOMOUS_NOT_DERIVABLE,
    },
    derivationCeiling: 'proven',
    reproductionSatisfiesOperational: false,
  },
  {
    capabilityId: 'memory.durability',
    sources: RECORDED,
    evidence: 'dimensões (histórico, restore, config, toolchain) provadas como procedimento assistido ou primitiva de apoio — nenhuma realiza a capacidade.',
    criteria: {
      specified:
        'Contrato Durable State: classes de estado que precisam sobreviver, destinos autorizados, detecção de estado só-local, o que nunca é enviado, quando avisar/propor publicação e como provar recuperabilidade (revisão humana 2026-09-27 §1).',
      implemented: 'Código do Anima que detecta progresso só-local e propõe cópia recuperável fora da máquina, sob política/authority (contrato Durable State primeiro).',
      proven: 'O Anima detectou progresso só-local real e produziu cópia recuperável verificada (restore provado a partir dela).',
      operational: 'Detecção e cópia ocorrendo em uso real em ≥2 ocasiões, com restore verificável.',
    },
    derivationCeiling: 'proven',
    reproductionSatisfiesOperational: false,
  },
  {
    capabilityId: 'compute.paid-settlement',
    sources: RECORDED,
    evidence: 'implementação coberta por testes + catálogo de preço versionado; nenhuma liquidação real observada.',
    criteria: {
      implemented: 'Código de settlement exercitado por testes.',
      proven: 'Prova viva paga (authority humana) liquidando custo real no ledger a partir do uso reportado pelo provider.',
      operational: 'Liquidações reais em ≥2 attempts pagas independentes, sem reserva `cost_unknown` nova.',
    },
    derivationCeiling: 'implemented',
    reproductionSatisfiesOperational: false,
    terminalMaturity: 'operational',
  },
];

// ─── Avaliação ────────────────────────────────────────────────────────────────

export type CapabilityProofStatus =
  | 'aligned' //               declarado = derivado
  | 'underclaimed' //          evidência sustenta MAIS que o declarado
  | 'overclaimed' //           declarado acima do que a evidência sustenta
  | 'insufficient_evidence' // há regra, mas nada contribui para a maturidade
  | 'not_evaluated'; //        sem regra (ou fonte indisponível): declarado segue manual

export type CapabilityMaturitySource = 'manual' | 'derived' | 'hybrid';

export interface CapabilityEvidenceSummary {
  /** Observações que participam da maturidade (positivas/negativas fortes, implementação positiva). */
  readonly contributing: number;
  /** Fatos parciais preservados (executou, não concluiu; primitiva de apoio). */
  readonly inconclusive: number;
  /** Procedimentos assistidos (humano/dev) — provam o procedimento, não a capacidade. */
  readonly assistedProcedures: number;
  /** Evidência forte negativa. */
  readonly contradicting: number;
}

export interface CapabilityProofEvaluation {
  readonly capabilityId: string;
  readonly declaredMaturity: CapabilityMaturity;
  /** `null` quando nada derivou maturidade (insuficiente/não avaliado). */
  readonly derivedMaturity: CapabilityMaturity | null;
  readonly status: CapabilityProofStatus;
  readonly maturitySource: CapabilityMaturitySource;
  readonly rule: CapabilityProofRule | null;
  /** Conclusão do engine (quando houve evidência). */
  readonly assessment: CapabilityHistoryAssessment | null;
  /** Toda evidência recebida para a capacidade, em ordem determinística. */
  readonly evidence: readonly CapabilityEvidenceObservation[];
  readonly summary: CapabilityEvidenceSummary;
  /**
   * V0.1 — reprodução OBSERVADA (≥2 ocasiões canônicas independentes) e se ela
   * satisfaz `operational` para esta capacidade. `null` = sem reprodução.
   * Reprodução ≠ satisfação operacional: a reprodução é preservada mesmo
   * quando a maturidade para em `proven`.
   */
  readonly reproduction: CapabilityReproductionView | null;
  /** O que falta, em critérios concretos da regra. */
  readonly gaps: readonly string[];
  /** Frase única em PT explicando a conclusão. */
  readonly explanation: string;
}

export interface CapabilityReproductionView {
  /** Ocasiões canônicas independentes positivas na janela válida. */
  readonly occasions: number;
  /** A regra aceita a reprodução como critério operacional? */
  readonly satisfiesOperational: boolean;
}

export interface EvaluateCapabilityProofsInput {
  readonly capabilities?: readonly Capability[];
  readonly evidence: readonly CapabilityEvidenceObservation[];
  readonly rules?: readonly CapabilityProofRule[];
  /** Fontes que não puderam ser lidas (ex.: event log indisponível). */
  readonly unavailableSources?: readonly CapabilityEvidenceSource[];
}

const MATURITY_PT: Record<CapabilityMaturity, string> = {
  projected: 'projetada',
  specified: 'especificada',
  implemented: 'implementada',
  proven: 'comprovada',
  operational: 'operacional',
  autonomous: 'autônoma',
  degraded: 'regredida',
};

function compareEvidence(
  left: CapabilityEvidenceObservation,
  right: CapabilityEvidenceObservation,
): number {
  const time = Date.parse(left.observedAt) - Date.parse(right.observedAt);
  if (time !== 0) return time;
  return left.id.localeCompare(right.id);
}

function isContributing(observation: CapabilityEvidenceObservation): boolean {
  if (observation.evidenceClass === 'assisted_procedure') return false;
  if (observation.outcome === 'inconclusive') return false;
  // Implementação negativa não existe como sinal de regressão no engine.
  if (observation.evidenceClass === 'implementation') return observation.outcome === 'positive';
  return true;
}

function summarize(
  evidence: readonly CapabilityEvidenceObservation[],
): CapabilityEvidenceSummary {
  let contributing = 0;
  let inconclusive = 0;
  let assistedProcedures = 0;
  let contradicting = 0;

  for (const observation of evidence) {
    if (observation.evidenceClass === 'assisted_procedure') {
      assistedProcedures += 1;
      continue;
    }
    if (observation.outcome === 'inconclusive') {
      inconclusive += 1;
      continue;
    }
    if (isContributing(observation)) contributing += 1;
    if (
      observation.outcome === 'negative' &&
      observation.evidenceClass !== 'implementation'
    ) {
      contradicting += 1;
    }
  }

  return { contributing, inconclusive, assistedProcedures, contradicting };
}

function compareDeclared(
  declared: CapabilityMaturity,
  derived: CapabilityMaturity,
): Extract<CapabilityProofStatus, 'aligned' | 'underclaimed' | 'overclaimed'> {
  if (declared === derived) return 'aligned';
  const delta = maturityRank(derived) - maturityRank(declared);
  if (delta > 0) return 'underclaimed';
  if (delta < 0) return 'overclaimed';
  // Mesmo rank, rótulos distintos (ex.: implementada × regredida): a regressão
  // derivada não está reconhecida no declarado.
  return derived === 'degraded' ? 'overclaimed' : 'aligned';
}

function nextGap(
  rule: CapabilityProofRule,
  from: CapabilityMaturity,
): string | null {
  if (
    rule.terminalMaturity !== undefined &&
    from !== 'degraded' &&
    maturityRank(from) >= maturityRank(rule.terminalMaturity)
  ) {
    return null;
  }

  const next = nextMaturity(from);
  if (next === null) return null;

  const criterion =
    rule.criteria[next as CapabilityCriterionMaturity] ??
    `Critério para ${MATURITY_PT[next]} ainda não definido.`;

  if (maturityRank(next) > maturityRank(rule.derivationCeiling)) {
    return `Para ${MATURITY_PT[next]} (fora do alcance da derivação atual): ${criterion}`;
  }

  return `Para ${MATURITY_PT[next]}: ${criterion}`;
}

function sourcesLabel(sources: ReadonlySet<CapabilityEvidenceSource>): string {
  const labels: string[] = [];
  if (sources.has('canonical_event_log')) labels.push('event log canônico');
  if (sources.has('recorded_proof')) labels.push('prova registrada');
  return labels.join(' + ');
}

function evaluateOne(
  capability: Capability,
  rule: CapabilityProofRule | null,
  evidence: readonly CapabilityEvidenceObservation[],
  assessment: CapabilityHistoryAssessment | null,
  unavailable: ReadonlySet<CapabilityEvidenceSource>,
): CapabilityProofEvaluation {
  const declared = capability.maturity;
  const ordered = [...evidence].sort(compareEvidence);
  const summary = summarize(ordered);

  if (rule === null) {
    return {
      capabilityId: capability.id,
      declaredMaturity: declared,
      derivedMaturity: null,
      status: 'not_evaluated',
      maturitySource: 'manual',
      rule: null,
      assessment: null,
      evidence: ordered,
      summary,
      reproduction: null,
      gaps: [],
      explanation:
        'Sem regra de derivação: a maturidade declarada é manual (proofRefs do registry, não avaliados pelo motor).',
    };
  }

  const missingSources = rule.sources.filter((source) => unavailable.has(source));

  if (summary.contributing === 0 && missingSources.length > 0) {
    return {
      capabilityId: capability.id,
      declaredMaturity: declared,
      derivedMaturity: null,
      status: 'not_evaluated',
      maturitySource: 'manual',
      rule,
      assessment: null,
      evidence: ordered,
      summary,
      reproduction: null,
      gaps: [`Fonte indisponível: ${sourcesLabel(new Set(missingSources))}.`],
      explanation:
        'Há regra, mas a fonte de evidência não pôde ser lida agora — ausência de telemetria não rebaixa o declarado.',
    };
  }

  const derivedFromEvidence =
    assessment !== null && assessment.assessment.basis !== 'definition';

  if (!derivedFromEvidence) {
    const baseline = capabilityDefinitionMaturity(declared);
    const gaps: string[] = [];
    const gap = nextGap(rule, baseline);
    if (gap) gaps.push(gap);

    const preserved: string[] = [];
    if (summary.assistedProcedures > 0) {
      preserved.push(`${summary.assistedProcedures} procedimento(s) assistido(s)`);
    }
    if (summary.inconclusive > 0) {
      preserved.push(`${summary.inconclusive} fato(s) parcial(is)`);
    }
    if (summary.contradicting > 0) {
      preserved.push(`${summary.contradicting} evidência(s) negativa(s)`);
    }

    return {
      capabilityId: capability.id,
      declaredMaturity: declared,
      derivedMaturity: null,
      status: 'insufficient_evidence',
      maturitySource: 'manual',
      rule,
      assessment,
      evidence: ordered,
      summary,
      reproduction: null,
      gaps,
      explanation:
        preserved.length > 0
          ? `Nenhuma evidência sustenta a maturidade da capacidade; preservados: ${preserved.join(', ')} — provam partes, não a capacidade. Declarado segue manual.`
          : 'Há regra, mas nenhuma evidência foi observada. Declarado segue manual; nada é rebaixado.',
    };
  }

  const derived = assessment!.derivedMaturity;
  const status = compareDeclared(declared, derived);
  const contributingSources = new Set<CapabilityEvidenceSource>(
    ordered.filter(isContributing).map(evidenceSourceOf),
  );
  const maturitySource: CapabilityMaturitySource =
    contributingSources.has('recorded_proof') ? 'hybrid' : 'derived';

  const reproducedOccasions = assessment!.assessment.reproducedOccasions;
  const reproduction: CapabilityReproductionView | null =
    reproducedOccasions === undefined
      ? null
      : { occasions: reproducedOccasions, satisfiesOperational: rule.reproductionSatisfiesOperational };

  const gaps: string[] = [];
  if (reproduction !== null && !reproduction.satisfiesOperational) {
    gaps.push(
      `Reprodução observada em ${reproduction.occasions} ocasiões independentes, mas os critérios de operacional desta capacidade não estão satisfeitos (reprodução ≠ satisfação operacional).`,
    );
  }
  if (status === 'overclaimed') {
    gaps.push(
      `O registry declara ${MATURITY_PT[declared]}, mas a evidência sustenta ${MATURITY_PT[derived]} — revisar a declaração (o motor não a altera).`,
    );
  }
  const gap = nextGap(rule, derived);
  if (gap) gaps.push(gap);

  const rationale = explainCapabilityAssessment(assessment!).rationale;
  const statusText: Record<typeof status, string> = {
    aligned: 'Declarado e derivado coincidem.',
    underclaimed: `Evidência sustenta mais que o declarado (${MATURITY_PT[declared]} → ${MATURITY_PT[derived]}); divergência reportada, não aplicada.`,
    overclaimed: `Declarado (${MATURITY_PT[declared]}) acima do derivado (${MATURITY_PT[derived]}); divergência reportada, não aplicada.`,
  };

  return {
    capabilityId: capability.id,
    declaredMaturity: declared,
    derivedMaturity: derived,
    status,
    maturitySource,
    rule,
    assessment,
    evidence: ordered,
    summary,
    reproduction,
    gaps,
    explanation: `${statusText[status]} ${rationale} Fonte: ${sourcesLabel(contributingSources)}.`,
  };
}

/**
 * Avalia TODAS as capacidades do registry (ordem do registry). Pura e
 * determinística para a mesma entrada. Nunca muta o registry.
 */
export function evaluateCapabilityProofs(
  input: EvaluateCapabilityProofsInput,
): readonly CapabilityProofEvaluation[] {
  const capabilities = input.capabilities ?? ANIMA_CAPABILITY_REGISTRY_V0;
  const rules = input.rules ?? CAPABILITY_PROOF_RULES_V0;
  const unavailable = new Set(input.unavailableSources ?? []);

  const ruleById = new Map<string, CapabilityProofRule>();
  for (const rule of rules) ruleById.set(rule.capabilityId, rule);

  const known = new Set(capabilities.map((capability) => capability.id));
  const evidenceById = new Map<string, CapabilityEvidenceObservation[]>();
  for (const observation of input.evidence) {
    if (!known.has(observation.capabilityId)) continue;
    const list = evidenceById.get(observation.capabilityId) ?? [];
    list.push(observation);
    evidenceById.set(observation.capabilityId, list);
  }

  // A régua é a mesma do V1: só a evidência que a regra aceita entra.
  const ruled = input.evidence.filter((observation) => {
    const rule = ruleById.get(observation.capabilityId);
    return rule !== undefined && rule.sources.includes(evidenceSourceOf(observation));
  });
  // V0.1: o critério operacional e o teto vêm da REGRA, aplicados no engine.
  const projection = assessCapabilitiesFromEvidence(capabilities, ruled, (capabilityId) => {
    const rule = ruleById.get(capabilityId);
    return rule === undefined
      ? undefined
      : {
          reproductionSatisfiesOperational: rule.reproductionSatisfiesOperational,
          maturityCeiling: rule.derivationCeiling,
        };
  });
  const assessmentById = new Map(
    projection.assessments.map((entry) => [entry.capabilityId, entry]),
  );

  const seen = new Set<string>();
  const out: CapabilityProofEvaluation[] = [];
  for (const capability of capabilities) {
    if (seen.has(capability.id)) continue;
    seen.add(capability.id);
    out.push(
      evaluateOne(
        capability,
        ruleById.get(capability.id) ?? null,
        evidenceById.get(capability.id) ?? [],
        assessmentById.get(capability.id) ?? null,
        unavailable,
      ),
    );
  }
  return out;
}

/** Avalia UMA capacidade. Capacidade desconhecida → `null`. */
export function evaluateCapabilityProof(
  capabilityId: string,
  input: EvaluateCapabilityProofsInput,
): CapabilityProofEvaluation | null {
  return (
    evaluateCapabilityProofs(input).find(
      (evaluation) => evaluation.capabilityId === capabilityId,
    ) ?? null
  );
}

/**
 * Ponte de produção: `work_events` (ou `null` se o histórico não pôde ser lido)
 * + evidência registrada → avaliação de todas as capacidades.
 */
export function evaluateCapabilityProofsFromHistory(input: {
  readonly events: readonly WorkEvent[] | null;
  readonly capabilities?: readonly Capability[];
  readonly recorded?: readonly CapabilityEvidenceObservation[];
  readonly rules?: readonly CapabilityProofRule[];
}): readonly CapabilityProofEvaluation[] {
  const canonical =
    input.events === null
      ? []
      : deriveCanonicalWorkCapabilityEvidenceFromEvents(input.events);

  return evaluateCapabilityProofs({
    capabilities: input.capabilities,
    rules: input.rules,
    evidence: [...canonical, ...(input.recorded ?? RECORDED_CAPABILITY_EVIDENCE_V0)],
    unavailableSources: input.events === null ? ['canonical_event_log'] : [],
  });
}

/** Contagem factual por status — sem % global. */
export function summarizeCapabilityProofStatus(
  evaluations: readonly CapabilityProofEvaluation[],
): Readonly<Record<CapabilityProofStatus, number>> {
  const counts: Record<CapabilityProofStatus, number> = {
    aligned: 0,
    underclaimed: 0,
    overclaimed: 0,
    insufficient_evidence: 0,
    not_evaluated: 0,
  };
  for (const evaluation of evaluations) counts[evaluation.status] += 1;
  return counts;
}
