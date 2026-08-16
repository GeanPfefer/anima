import { projectHostObservedEvidence } from './host-observed-evidence';
import { projectHostObservedGateEvidence } from './host-observed-gate-evidence';
import type { ProposalVersion, WorkEvent, WorkItem, WorkItemId } from './types';
import {
  verifyPersistedWorkResult,
  type WorkVerificationFindingCode,
  type WorkVerificationProvenance,
  type WorkVerificationReport,
  type WorkVerificationSeverity,
  type WorkVerificationVerdict,
} from './work-verification';
import { projectWorktreeHandoff } from './worktree-handoff';
import type { Json } from '@anima/types';

// PARECER do Verifier, persistível e VERSIONADO — a distinção canônica do recorte:
//
//   EVIDÊNCIA (histórico observado/atestado)  ≠  PARECER (interpretação versionada
//   dessa evidência)  ≠  DECISÃO (autorização humana/política).
//
// O `WorkVerificationReport` já é o parecer EM MEMÓRIA, puro e determinístico. Este
// módulo o embala num `VerifierOpinionV1` durável, acrescentando o que a persistência
// append-only precisa para ser auditável e honesta ao longo do tempo:
//
//   * `verifierVersion` — a versão da LÓGICA do Verifier que produziu o parecer, para
//     que um Verifier futuro (V2) que discorde do V1 seja distinguível, nunca uma
//     sobrescrita. A política de verificação está embutida na lógica; não há hoje uma
//     configuração de política separada a versionar (se surgir, ganha campo próprio).
//   * `evidenceBasis` — a IDENTIDADE do estado de evidência sobre o qual o parecer foi
//     computado (o `result_submitted` do handoff e o `host_observed_evidence_recorded`,
//     quando presente) + a cobertura independente. É o que torna legítima a evolução do
//     parecer: quando a evidência observada aparece, a base muda e um novo parecer é
//     acrescentado — sem apagar o anterior.
//
// O parecer NÃO é autorização, merge, publicação, integração nem maturidade. Ele é
// ADVISORY e RECOMPUTÁVEL: `computeVerifierOpinion` é uma função pura de (item, eventos),
// então perder a persistência não perde informação — recomputa-se do log. A persistência
// é AUDITORIA/HISTÓRICO ("o que o Verifier concluiu, com qual versão, sobre qual estado
// de evidência"), nunca uma verdade que a execução precise proteger com efeito externo.

/** Versão da lógica do Verifier. Bump quando a derivação do parecer mudar de forma
 * que um mesmo estado de evidência possa produzir veredito diferente. */
export const VERIFIER_VERSION = 'work-verifier-v1';

/** Achado compactado para o parecer durável: a espinha estruturada (código +
 * severidade + proveniência + sujeito), sem a prosa `detail` — que é recomputável. */
export interface VerifierOpinionFinding {
  readonly code: WorkVerificationFindingCode;
  readonly severity: WorkVerificationSeverity;
  readonly provenance: WorkVerificationProvenance;
  readonly subject?: string;
}

export interface VerifierOpinionEvidenceBasis {
  /** O `result_submitted` cujo handoff foi verificado. Identidade append-only. */
  readonly resultEventId: string;
  /** O `host_observed_evidence_recorded` (git) considerado, ou `null` quando ainda
   * não há evidência independente de git — a diferença que legitima um novo parecer. */
  readonly observedEventId: string | null;
  /** O `host_observed_gate_evidence_recorded` considerado, ou `null` quando ainda não
   * há evidência independente de gate. Faz parte da identidade do parecer: quando a
   * evidência de gate aparece, a base muda e um NOVO parecer é acrescentado (não um
   * conflito com o anterior). */
  readonly observedGateEventId: string | null;
  /** O que foi observado de forma INDEPENDENTE no momento deste parecer. */
  readonly coverage: { readonly git: boolean; readonly gates: boolean };
}

export interface VerifierOpinionV1 {
  readonly schemaVersion: 1;
  readonly workItemId: WorkItemId;
  readonly attemptId: string;
  readonly approvedProposalVersion: ProposalVersion;
  readonly verifierVersion: string;
  readonly verdict: WorkVerificationVerdict;
  readonly restsOnAttestedEvidence: boolean;
  readonly summary: WorkVerificationReport['summary'];
  readonly findings: readonly VerifierOpinionFinding[];
  readonly evidenceBasis: VerifierOpinionEvidenceBasis;
}

const lastEventOfType = (events: readonly WorkEvent[], type: WorkEvent['type']): WorkEvent | null => {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!;
    if (event.type === type) return event;
  }
  return null;
};

/**
 * Deriva o parecer durável do Verifier de forma pura e determinística. Devolve `null`
 * quando não há um resultado de worktree a verificar (sem handoff durável) — o parecer
 * é sobre um resultado produzido, não sobre a ausência dele.
 *
 * A base de evidência é a identidade dos eventos que o Verifier consumiu: o último
 * `result_submitted` (fonte do handoff) e o último `host_observed_evidence_recorded`
 * (quando presente). Como `verifyPersistedWorkResult` usa exatamente esses "últimos",
 * a base corresponde ao que o veredito enxergou.
 */
export function computeVerifierOpinion(item: WorkItem, events: readonly WorkEvent[]): VerifierOpinionV1 | null {
  const handoff = projectWorktreeHandoff(events);
  if (!handoff) return null;
  const resultEvent = lastEventOfType(events, 'result_submitted');
  if (!resultEvent) return null;
  const observed = projectHostObservedEvidence(events);
  const observedEvent = lastEventOfType(events, 'host_observed_evidence_recorded');
  const observedGates = projectHostObservedGateEvidence(events);
  const observedGateEvent = lastEventOfType(events, 'host_observed_gate_evidence_recorded');
  // Evidência de gate usável = presente e correlacionada a ESTA tentativa/versão.
  const gatesUsable = observedGates !== null
    && observedGates.attemptId === handoff.attemptId
    && observedGates.workItemId === item.id
    && observedGates.approvedProposalVersion === item.proposalVersion;
  const report = verifyPersistedWorkResult(item, events);
  return {
    schemaVersion: 1,
    workItemId: item.id,
    attemptId: handoff.attemptId,
    approvedProposalVersion: item.proposalVersion,
    verifierVersion: VERIFIER_VERSION,
    verdict: report.verdict,
    restsOnAttestedEvidence: report.restsOnAttestedEvidence,
    summary: report.summary,
    findings: report.findings.map(finding => finding.subject === undefined
      ? { code: finding.code, severity: finding.severity, provenance: finding.provenance }
      : { code: finding.code, severity: finding.severity, provenance: finding.provenance, subject: finding.subject }),
    evidenceBasis: {
      resultEventId: resultEvent.id,
      // Só referencia a observação quando ela é a base real do veredito (correlacionada).
      observedEventId: observed !== null && observedEvent !== null ? observedEvent.id : null,
      observedGateEventId: gatesUsable && observedGateEvent !== null ? observedGateEvent.id : null,
      coverage: { git: observed !== null, gates: gatesUsable },
    },
  };
}

const object = (value: Json | undefined): Record<string, Json | undefined> | null =>
  value !== null && value !== undefined && !Array.isArray(value) && typeof value === 'object' ? value : null;
const nonBlank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const positiveInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0;
const isVerdict = (value: unknown): value is WorkVerificationVerdict => value === 'verified' || value === 'inconclusive' || value === 'rejected';
const isSeverity = (value: unknown): value is WorkVerificationSeverity => value === 'ok' || value === 'gap' || value === 'violation';
const isProvenance = (value: unknown): value is WorkVerificationProvenance => value === 'independent' || value === 'attested';

/**
 * Reconstrói o parecer do JSON persistido, fail-closed em qualquer elo malformado —
 * usado na auditoria/leitura, nunca confiando cegamente no persistido.
 */
export function parseVerifierOpinion(value: Json | undefined): VerifierOpinionV1 | null {
  const root = object(value);
  if (!root || root.schemaVersion !== 1) return null;
  const summary = object(root.summary);
  const basis = object(root.evidenceBasis);
  const coverage = basis ? object(basis.coverage) : null;
  if (!summary || !basis || !coverage || !Array.isArray(root.findings)) return null;
  const findings: VerifierOpinionFinding[] = [];
  for (const entry of root.findings) {
    const finding = object(entry);
    if (!finding || !nonBlank(finding.code) || !isSeverity(finding.severity) || !isProvenance(finding.provenance)) return null;
    const base = { code: finding.code as WorkVerificationFindingCode, severity: finding.severity, provenance: finding.provenance };
    if (finding.subject === undefined) { findings.push(base); continue; }
    if (!nonBlank(finding.subject)) return null;
    findings.push({ ...base, subject: finding.subject });
  }
  const counts = ['violations', 'gaps', 'checks', 'attested', 'independent'] as const;
  if (!counts.every(key => typeof summary[key] === 'number' && Number.isInteger(summary[key]))) return null;
  if (!nonBlank(root.workItemId) || !nonBlank(root.attemptId) || !positiveInt(root.approvedProposalVersion)
    || !nonBlank(root.verifierVersion) || !isVerdict(root.verdict) || typeof root.restsOnAttestedEvidence !== 'boolean'
    || !nonBlank(basis.resultEventId) || (basis.observedEventId !== null && !nonBlank(basis.observedEventId))
    || (basis.observedGateEventId !== null && !nonBlank(basis.observedGateEventId))
    || typeof coverage.git !== 'boolean' || typeof coverage.gates !== 'boolean') {
    return null;
  }
  return {
    schemaVersion: 1,
    workItemId: root.workItemId,
    attemptId: root.attemptId,
    approvedProposalVersion: root.approvedProposalVersion,
    verifierVersion: root.verifierVersion,
    verdict: root.verdict,
    restsOnAttestedEvidence: root.restsOnAttestedEvidence,
    summary: {
      violations: summary.violations as number, gaps: summary.gaps as number, checks: summary.checks as number,
      attested: summary.attested as number, independent: summary.independent as number,
    },
    findings,
    evidenceBasis: {
      resultEventId: basis.resultEventId,
      observedEventId: (basis.observedEventId as string | null) ?? null,
      observedGateEventId: (basis.observedGateEventId as string | null) ?? null,
      coverage: { git: coverage.git, gates: coverage.gates },
    },
  };
}

/**
 * Projeta o HISTÓRICO append-only de pareceres de um log de eventos, na ordem
 * cronológica (mais antigo → mais novo). Cada `verifier_opinion_recorded` é
 * reconstruído e cruzado contra o envelope do próprio evento; um parecer cuja tríade
 * discorde do envelope é incoerente e é descartado (não confia cegamente).
 *
 * É a leitura de auditoria: preserva a evolução do parecer (V1 inconclusive → V1
 * verified após a observação → V2 rejected), sem que uma entrada apague a anterior.
 */
export function projectVerifierOpinionHistory(events: readonly WorkEvent[]): readonly VerifierOpinionV1[] {
  const history: VerifierOpinionV1[] = [];
  for (const event of events) {
    if (event.type !== 'verifier_opinion_recorded') continue;
    const data = object(object(event.payload)?.data);
    const opinion = parseVerifierOpinion(data?.opinion);
    if (!opinion) continue;
    if (data?.work_item_id !== opinion.workItemId
      || data?.attempt_id !== opinion.attemptId
      || data?.approved_proposal_version !== opinion.approvedProposalVersion) {
      continue;
    }
    history.push(opinion);
  }
  return history;
}
