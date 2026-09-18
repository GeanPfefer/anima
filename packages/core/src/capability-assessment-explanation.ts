// Capability Assessment Explanation — a PROJEÇÃO humana da conclusão do Proof
// Engine. Não é uma nova régua: é a tradução de um `CapabilityHistoryAssessment`
// (conclusão + evidência) para linguagem compreensível + as provas decisivas que
// a sustentam. Assim a Evolution responde "esta capacidade está neste nível POR
// CAUSA DESTAS provas", em vez de despejar eventos crus.
//
// Regra de ouro: as REGRAS de maturidade vivem no engine; aqui só se DESCREVE a
// conclusão já derivada. Nenhuma promoção/rebaixamento acontece neste módulo.

import type { CapabilityProofRef } from './capability-map';
import type { CapabilityHistoryAssessment } from './capability-proof-assessment';
import {
  REPRODUCTION_THRESHOLD,
  type CapabilityEvidenceObservation,
  type CapabilityProofBasis,
} from './capability-proof-engine';

export interface CapabilityAssessmentExplanation {
  /** Base decisiva da conclusão (espelha `assessment.basis`). */
  readonly basis: CapabilityProofBasis;

  /** Rótulo curto e humano da base decisiva. */
  readonly basisLabel: string;

  /** Frase única em PT: por que a capacidade está no nível derivado. */
  readonly rationale: string;

  /**
   * Ocasiões independentes (occasionId distinto) presentes na janela positiva
   * que sustenta a conclusão atual. É a mesma contagem que o engine usa para
   * decidir reprodução — reproduzida aqui só para a projeção, nunca para julgar.
   */
  readonly distinctOccasions: number;

  /** Provas da observação decisiva — o "por causa DESTAS provas". */
  readonly decisiveProofRefs: readonly CapabilityProofRef[];

  /** Provas das observações que contradizem a capacidade (quando regredida). */
  readonly contradictingProofRefs: readonly CapabilityProofRef[];

  /**
   * O que ainda falta para o próximo degrau, DERIVADO da evidência (não do texto
   * livre do registry). `null` quando não há próximo degrau natural a descrever.
   */
  readonly nextProof: string | null;
}

const BASIS_LABEL: Record<CapabilityProofBasis, string> = {
  definition: 'definição',
  implementation: 'implementação',
  verified_execution: 'execução verificada',
  reproduced_operation: 'reprodução',
  autonomous_operation: 'operação autônoma',
  regression: 'regressão',
};

/**
 * Linguagem de DOMÍNIO por capacidade, mantida no core (nunca hardcoded na UI).
 * `proven`/`reproduced`/`regressed` são frases-sujeito que a explicação injeta
 * nos templates por base. Capacidades sem entrada usam a linguagem genérica.
 */
interface CapabilityRationaleSubject {
  readonly proven: string;
  readonly reproduced: string;
  readonly regressed: string;
}

const CAPABILITY_RATIONALE: Record<string, CapabilityRationaleSubject> = {
  'governance.verifier': {
    proven:
      'o verifier analisou fatos observados de forma independente (Git + gates) e emitiu um parecer conclusivo com cobertura suficiente',
    reproduced: 'verificação com cobertura independente',
    regressed: 'uma verificação recente deixou de se sustentar',
  },
  'agency.supervised-self-development': {
    proven:
      'o ANIMA modificou o próprio código com resultado observado, verificado e ACEITO pela revisão humana',
    reproduced: 'self-development supervisionado válido',
    regressed:
      'a revisão humana pediu mudanças no resultado — o self-development supervisionado não se sustentou',
  },
};

function proofKey(ref: CapabilityProofRef): string {
  return `${ref.kind}:${ref.ref}`;
}

/**
 * Une provas de várias observações preservando ordem e sem repetir o mesmo
 * ponteiro (kind+ref) — a mesma prova não deve aparecer duas vezes.
 */
function dedupeProofRefs(
  observations: readonly CapabilityEvidenceObservation[],
): readonly CapabilityProofRef[] {
  const seen = new Set<string>();
  const out: CapabilityProofRef[] = [];

  for (const observation of observations) {
    for (const ref of observation.proofRefs) {
      const key = proofKey(ref);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ref);
    }
  }

  return out;
}

/**
 * Descreve uma conclusão já derivada pelo Proof Engine em linguagem de produto,
 * com a proveniência que a sustenta. Puro e determinístico para a mesma entrada.
 */
export function explainCapabilityAssessment(
  entry: CapabilityHistoryAssessment,
): CapabilityAssessmentExplanation {
  const { assessment, evidence } = entry;

  const byId = new Map<string, CapabilityEvidenceObservation>();
  for (const observation of evidence) {
    byId.set(observation.id, observation);
  }

  const decisive =
    assessment.decisiveEvidenceId !== null
      ? byId.get(assessment.decisiveEvidenceId) ?? null
      : null;

  const decisiveProofRefs = decisive ? decisive.proofRefs : [];

  const contradictingProofRefs = dedupeProofRefs(
    assessment.contradictingEvidenceIds
      .map((id) => byId.get(id))
      .filter(
        (observation): observation is CapabilityEvidenceObservation =>
          observation !== undefined,
      ),
  );

  // Ocasiões independentes na janela que sustenta a conclusão. Mesma semântica
  // do engine: só occasionId explícito conta.
  const occasions = new Set<string>();
  for (const id of assessment.supportingEvidenceIds) {
    const observation = byId.get(id);
    if (observation?.occasionId !== undefined) {
      occasions.add(observation.occasionId);
    }
  }
  const distinctOccasions = occasions.size;

  const basisLabel = BASIS_LABEL[assessment.basis];
  const subject = CAPABILITY_RATIONALE[entry.capabilityId] ?? null;

  let rationale: string;
  let nextProof: string | null;

  switch (assessment.basis) {
    case 'regression':
      rationale = subject
        ? `Regredida: ${subject.regressed}.`
        : 'Regredida: evidência forte recente contradisse uma capacidade antes comprovada — precisa ser re-provada.';
      nextProof =
        'Falta uma nova execução verificada posterior à regressão para voltar a comprovar.';
      break;

    case 'reproduced_operation':
      rationale = subject
        ? `Operacional: ${subject.reproduced} reproduzida em ${distinctOccasions} ocasiões independentes.`
        : `Operacional: execução verificada reproduzida em ${distinctOccasions} ocasiões independentes.`;
      nextProof =
        'Falta operação verificada de forma autônoma sob governança válida para chegar a autônoma.';
      break;

    case 'autonomous_operation':
      rationale =
        'Autônoma: operação verificada de forma autônoma sob governança válida.';
      nextProof = null;
      break;

    case 'verified_execution':
      rationale = subject
        ? `Comprovada: ${subject.proven} (1 ocasião; falta reproduzir para operacional).`
        : distinctOccasions <= 1
          ? 'Comprovada por execução verificada em 1 ocasião — resultado observado com prova independente, mas ainda sem reprodução.'
          : `Comprovada por execução verificada; reprodução ainda não pôde ser contada em ocasiões independentes (${distinctOccasions}).`;
      nextProof = `Falta reproduzir a execução verificada em pelo menos ${REPRODUCTION_THRESHOLD} ocasiões independentes (hoje: ${distinctOccasions}) para operacional.`;
      break;

    case 'implementation':
      rationale =
        'Implementação observada: o código foi exercitado, mas ainda sem execução verificada correlacionada.';
      nextProof =
        'Falta uma execução verificada (resultado + Git + gates + Verifier correlacionados) para comprovar.';
      break;

    case 'definition':
    default:
      rationale =
        'Sem prova dinâmica decisiva: o nível vem apenas da definição do registry.';
      nextProof =
        'Falta evidência dinâmica correlacionada para derivar a maturidade da capacidade.';
      break;
  }

  return {
    basis: assessment.basis,
    basisLabel,
    rationale,
    distinctOccasions,
    decisiveProofRefs,
    contradictingProofRefs,
    nextProof,
  };
}
