import {
  planResultReview,
  readAutonomousExecutionSpec,
  reconstructWorkPresentation,
  type ResolveWorkApprovalCommand,
  type ResultReviewDecision,
  type WorkContextSnapshot,
  type WorkEvent,
  type WorkItem,
  type WorkOrchestrationService,
  type WorkPresentation,
  type WorkVerificationReport,
} from '@anima/core';
import type { WorkOrchestrationErrorCode, WorkOperationResult } from '@anima/core';
import { parseAutonomyFlag } from '@/lib/resident-host/ports';
import type { ReviewCorrectionResult } from '@/lib/work-orchestration/review-correction-orchestration';
import { EXIT, type ExitCode } from './exit-codes';

// A CLI depende do APPLICATION SERVICE (a mesma abstração que as rotas web usam),
// não do transporte Supabase. `WorkOrchestrationPort` é o subconjunto exato de
// operações que a CLI exerce — o entrypoint passa `createWorkOrchestrationService(client)`
// e os testes passam um duplo. Assim a regra fica no serviço/core, não no adapter.
export type WorkOrchestrationPort = Pick<
  WorkOrchestrationService,
  'getItem' | 'listEvents' | 'listContexts' | 'findResumableWorkItems' | 'reviewResult' | 'resolveApproval'
>;

// Camada de APLICAÇÃO da CLI. Cada runner recebe o cliente user-scoped já resolvido
// e chama EXATAMENTE os mesmos application services que as rotas web chamam
// (`createWorkOrchestrationService`) + as projeções PURAS do core. Nenhuma regra de
// negócio nova mora aqui: "pode pedir mudanças?", "qual o próximo estado?", "como a
// cobertura funciona?" pertencem ao core/serviço/RPC. Este módulo só resolve o que
// mostrar e monta o comando canônico pela regra compartilhada (`planResultReview`).
//
// O payload retornado É a interface JSON estável (`--json`); o modo humano é
// derivado dele (render.ts). Todo payload carrega `ok` para automação.

export type ReviewOutcomeState = 'changes_requested' | 'completed' | string;

export interface AcceptanceCriterionCoverage {
  readonly criterion: string;
  readonly covered: boolean;
  /** Requisito de prova declarado no execution_spec: `gate` (comando), `scope`
   * (invariante observada) ou `null` quando nenhum critério de validação o cobre. */
  readonly proof: 'gate' | 'scope' | null;
}
export interface ValidationCriterionCoverage {
  readonly label: string;
  readonly status: 'covered' | 'gap' | 'unverifiable';
}
export interface VerifierSummaryPayload {
  readonly verdict: WorkVerificationReport['verdict'];
  readonly violations: number;
  readonly gaps: number;
  readonly checks: number;
  readonly restsOnAttestedEvidence: boolean;
}
export interface PlannedGatePayload {
  readonly label: string;
  readonly command: string | null;
  readonly covers: readonly string[];
}
export interface WorkShowPayload {
  readonly ok: true;
  readonly kind: 'work-show';
  readonly id: string;
  readonly state: string;
  readonly proposalVersion: number;
  readonly phase: string | null;
  readonly attemptId: string | null;
  readonly summary: string;
  readonly objective: string;
  readonly includedScope: readonly string[];
  readonly excludedScope: readonly string[];
  readonly risks: readonly string[];
  /** Gates planejados no execution_spec, com `covers` (Verifier v2). Vazio quando o
   * item não declara execução autônoma. Essencial para inspeção de governança de um
   * sucessor `proposed` antes da aprovação. */
  readonly plannedGates: readonly PlannedGatePayload[];
  readonly latestResult: { readonly eventId: string; readonly proposalVersion: number; readonly summary: string } | null;
  /** Veredito recomputado AGORA pelo Verifier vigente (v2). */
  readonly verifierLive: VerifierSummaryPayload | null;
  /** Último parecer PERSISTIDO (pode ter sido gravado por uma versão anterior do Verifier). */
  readonly verifierRecorded: { readonly verdict: WorkVerificationReport['verdict']; readonly opinions: number } | null;
  readonly acceptance: { readonly total: number; readonly covered: number; readonly missing: number; readonly criteria: readonly AcceptanceCriterionCoverage[] };
  readonly availableActions: readonly string[];
  readonly suggestedDecision: 'request_changes' | null;
  readonly provenance: { readonly status: string; readonly issues: readonly string[] };
}
export interface WorkEvidencePayload {
  readonly ok: true;
  readonly kind: 'work-evidence';
  readonly id: string;
  readonly state: string;
  readonly proposalVersion: number;
  readonly attemptId: string | null;
  readonly verifierLive: VerifierSummaryPayload | null;
  readonly verifierRecorded: { readonly verdict: WorkVerificationReport['verdict']; readonly opinions: number } | null;
  readonly acceptanceCriteria: readonly AcceptanceCriterionCoverage[];
  readonly validationCriteria: readonly ValidationCriterionCoverage[];
  readonly declaredValidations: readonly { readonly label: string; readonly outcome: string }[] | null;
  readonly gaps: readonly { readonly code: string; readonly detail: string; readonly subject: string | null }[];
  readonly violations: readonly { readonly code: string; readonly detail: string; readonly subject: string | null }[];
  readonly findings: readonly { readonly code: string; readonly severity: string; readonly provenance: string; readonly subject: string | null; readonly detail: string }[];
}
export interface StatusPayload {
  readonly ok: true;
  readonly kind: 'status';
  readonly userId: string;
  readonly supabaseUrl: string;
  readonly autonomyEnabled: boolean;
  readonly resumable: { readonly total: number; readonly byState: Readonly<Record<string, number>> };
}
export interface WorkListPayload {
  readonly ok: true;
  readonly kind: 'work-list';
  readonly items: readonly { readonly id: string; readonly state: string; readonly proposalVersion: number; readonly phase: string | null; readonly summary: string }[];
}
export interface ReviewPayload {
  readonly ok: true;
  readonly kind: 'review';
  readonly workItemId: string;
  readonly decision: ResultReviewDecision['type'];
  readonly state: ReviewOutcomeState;
  readonly reviewedResultEventId: string;
  readonly message: string;
}
export interface ApprovePayload {
  readonly ok: true;
  readonly kind: 'approve';
  readonly workItemId: string;
  readonly state: string;
  readonly message: string;
}
export interface WorkCorrectPayload {
  readonly ok: true;
  readonly kind: 'work-correct';
  readonly originalWorkItemId: string;
  readonly successorWorkItemId: string;
  readonly lineageId: string;
  readonly recoverySequence: number;
  /** Replay idempotente: a mesma unidade sucessora já existia e foi reencontrada. */
  readonly replayed: boolean;
  readonly message: string;
}
export interface ErrorPayload {
  readonly ok: false;
  readonly kind: 'error';
  readonly error: string;
  readonly code: string | null;
}
export interface HelpPayload {
  readonly ok: true;
  readonly kind: 'help';
  readonly usage: string;
}

export type CliPayload =
  | StatusPayload | WorkListPayload | WorkShowPayload | WorkEvidencePayload | ReviewPayload | ApprovePayload | WorkCorrectPayload | ErrorPayload | HelpPayload;

/** Capacidade de correção pós-review (a MESMA que a rota web usa): recebe o id do
 * item em `changes_requested` e materializa/replaya o sucessor governado. Injetada
 * como porta para o entrypoint ligar `correctReviewedWorkItem(client, id)` e os
 * testes um duplo — a regra permanece no application service. */
export type ReviewCorrectionCapability = (workItemId: string) => Promise<ReviewCorrectionResult>;

export interface CommandResult {
  readonly exitCode: ExitCode;
  readonly payload: CliPayload;
}

// --- Mapa código de domínio → exit code. Regras/governança ⇒ 3; operacional ⇒ 1. ---
const REJECTED_CODES: ReadonlySet<WorkOrchestrationErrorCode> = new Set<WorkOrchestrationErrorCode>([
  'orchestration_not_enabled', 'source_message_not_eligible', 'invalid_input', 'invalid_transition', 'version_conflict', 'permission_denied',
]);
function exitCodeForError(code: WorkOrchestrationErrorCode): ExitCode {
  return REJECTED_CODES.has(code) ? EXIT.REJECTED : EXIT.ERROR;
}
const errorResult = (error: string, code: string | null, exitCode: ExitCode): CommandResult =>
  ({ exitCode, payload: { ok: false, kind: 'error', error, code } });

const subjectOf = (subject: string | undefined): string | null => subject ?? null;

// --- Presentation compartilhada (mesma reconstrução das rotas web). ---
async function loadPresentation(
  service: WorkOrchestrationPort,
  id: string,
): Promise<{ ok: true; item: WorkItem; events: readonly WorkEvent[]; presentation: WorkPresentation } | { ok: false; result: CommandResult }> {
  const item = await service.getItem(id);
  if (!item.ok) return { ok: false, result: errorResult(item.error.message, item.error.code, exitCodeForError(item.error.code)) };
  const [events, contexts] = await Promise.all([service.listEvents(id), service.listContexts(id)]);
  if (!events.ok) return { ok: false, result: errorResult(events.error.message, events.error.code, exitCodeForError(events.error.code)) };
  if (!contexts.ok) return { ok: false, result: errorResult(contexts.error.message, contexts.error.code, exitCodeForError(contexts.error.code)) };
  const references = (contexts.value as readonly WorkContextSnapshot[]).flatMap(context => context.references);
  const presentation = reconstructWorkPresentation(item.value, events.value, references);
  return { ok: true, item: item.value, events: events.value, presentation };
}

function verifierLiveSummary(report: WorkVerificationReport | null | undefined): VerifierSummaryPayload | null {
  if (!report) return null;
  return {
    verdict: report.verdict,
    violations: report.summary.violations,
    gaps: report.summary.gaps,
    checks: report.summary.checks,
    restsOnAttestedEvidence: report.restsOnAttestedEvidence,
  };
}

/** Mapa critério de aceite → requisito de prova declarado (gate/scope), lido do
 * execution_spec (independente do resultado). Nem toda prova é um gate. */
function acceptanceProofKinds(item: WorkItem): ReadonlyMap<string, 'gate' | 'scope'> {
  const spec = readAutonomousExecutionSpec(item.intent);
  const map = new Map<string, 'gate' | 'scope'>();
  for (const criterion of spec?.validationCriteria ?? []) {
    const kind: 'gate' | 'scope' | null = criterion.proof === 'scope' ? 'scope'
      : criterion.proof === 'gate' ? 'gate'
      : typeof criterion.command === 'string' && criterion.command.trim().length > 0 ? 'gate' : null;
    if (kind === null) continue;
    for (const covered of criterion.covers ?? []) if (!map.has(covered)) map.set(covered, kind);
  }
  return map;
}

function acceptanceCoverage(item: WorkItem, report: WorkVerificationReport | null | undefined): readonly AcceptanceCriterionCoverage[] {
  const criteria = item.proposal.data.expectedEffects;
  const proofKinds = acceptanceProofKinds(item);
  const covered = report
    ? new Set(report.findings.filter(f => f.code === 'acceptance_criterion_covered' && f.subject !== undefined).map(f => f.subject!))
    : new Set<string>();
  return criteria.map(criterion => ({ criterion, covered: covered.has(criterion), proof: proofKinds.get(criterion) ?? null }));
}

function validationCoverage(report: WorkVerificationReport | null | undefined): readonly ValidationCriterionCoverage[] {
  if (!report) return [];
  const out: ValidationCriterionCoverage[] = [];
  for (const f of report.findings) {
    if (f.subject === undefined) continue;
    if (f.code === 'criterion_covered') out.push({ label: f.subject, status: 'covered' });
    else if (f.code === 'criterion_without_gate_coverage') out.push({ label: f.subject, status: 'gap' });
    else if (f.code === 'declared_criterion_unverifiable') out.push({ label: f.subject, status: 'unverifiable' });
  }
  return out;
}

function recordedVerifier(presentation: WorkPresentation): { verdict: WorkVerificationReport['verdict']; opinions: number } | null {
  const history = presentation.opinionHistory;
  if (!history || history.length === 0) return null;
  return { verdict: history[history.length - 1]!.verdict, opinions: history.length };
}

// ============================================================
// Runners.
// ============================================================

export async function runStatus(service: WorkOrchestrationPort, userId: string, env: Readonly<Record<string, string | undefined>>): Promise<CommandResult> {
  const items = await service.findResumableWorkItems();
  if (!items.ok) return errorResult(items.error.message, items.error.code, exitCodeForError(items.error.code));
  const byState: Record<string, number> = {};
  for (const item of items.value) byState[item.state] = (byState[item.state] ?? 0) + 1;
  return {
    exitCode: EXIT.OK,
    payload: {
      ok: true, kind: 'status', userId,
      supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL ?? '(desconhecido)',
      autonomyEnabled: parseAutonomyFlag(env.ANIMA_AUTONOMY_ENABLED),
      resumable: { total: items.value.length, byState },
    },
  };
}

export async function runWorkList(service: WorkOrchestrationPort): Promise<CommandResult> {
  const items = await service.findResumableWorkItems();
  if (!items.ok) return errorResult(items.error.message, items.error.code, exitCodeForError(items.error.code));
  return {
    exitCode: EXIT.OK,
    payload: {
      ok: true, kind: 'work-list',
      items: items.value.map(item => ({
        id: item.id, state: item.state, proposalVersion: item.proposalVersion,
        phase: null, summary: item.proposal.data.summary,
      })),
    },
  };
}

export async function runWorkShow(service: WorkOrchestrationPort, id: string): Promise<CommandResult> {
  const loaded = await loadPresentation(service, id);
  if (!loaded.ok) return loaded.result;
  const { item, presentation } = loaded;
  const live = presentation.verification;
  const coverage = acceptanceCoverage(item, live);
  const missing = coverage.filter(c => !c.covered).length;
  const inReview = item.state === 'review';
  const suggestedDecision: 'request_changes' | null =
    inReview && ((live && live.verdict !== 'verified') || missing > 0) ? 'request_changes' : null;
  const spec = readAutonomousExecutionSpec(item.intent);
  const plannedGates: readonly PlannedGatePayload[] = (spec?.validationCriteria ?? []).map(criterion => ({
    label: criterion.label,
    command: criterion.command ?? null,
    covers: criterion.covers ?? [],
  }));
  return {
    exitCode: EXIT.OK,
    payload: {
      ok: true, kind: 'work-show', id: item.id, state: item.state, proposalVersion: item.proposalVersion,
      phase: presentation.progress?.label ?? null,
      attemptId: presentation.execution?.attemptId ?? live?.attemptId ?? null,
      summary: item.proposal.data.summary,
      objective: item.proposal.data.objective,
      includedScope: item.proposal.data.includedScope,
      excludedScope: item.proposal.data.excludedScope,
      risks: item.proposal.data.risks,
      plannedGates,
      latestResult: presentation.latestResult
        ? { eventId: presentation.latestResult.eventId, proposalVersion: presentation.latestResult.proposalVersion, summary: presentation.latestResult.summary }
        : null,
      verifierLive: verifierLiveSummary(live),
      verifierRecorded: recordedVerifier(presentation),
      acceptance: { total: coverage.length, covered: coverage.length - missing, missing, criteria: coverage },
      availableActions: presentation.availableActions,
      suggestedDecision,
      provenance: { status: presentation.provenance?.status ?? 'unknown', issues: presentation.provenance?.issues ?? [] },
    },
  };
}

export async function runWorkEvidence(service: WorkOrchestrationPort, id: string): Promise<CommandResult> {
  const loaded = await loadPresentation(service, id);
  if (!loaded.ok) return loaded.result;
  const { item, presentation } = loaded;
  const live = presentation.verification;
  const findings = live?.findings ?? [];
  return {
    exitCode: EXIT.OK,
    payload: {
      ok: true, kind: 'work-evidence', id: item.id, state: item.state, proposalVersion: item.proposalVersion,
      attemptId: presentation.execution?.attemptId ?? live?.attemptId ?? null,
      verifierLive: verifierLiveSummary(live),
      verifierRecorded: recordedVerifier(presentation),
      acceptanceCriteria: acceptanceCoverage(item, live),
      validationCriteria: validationCoverage(live),
      declaredValidations: presentation.latestResult?.validations
        ? presentation.latestResult.validations.map(v => ({ label: v.label, outcome: v.outcome }))
        : null,
      gaps: findings.filter(f => f.severity === 'gap').map(f => ({ code: f.code, detail: f.detail, subject: subjectOf(f.subject) })),
      violations: findings.filter(f => f.severity === 'violation').map(f => ({ code: f.code, detail: f.detail, subject: subjectOf(f.subject) })),
      findings: findings.map(f => ({ code: f.code, severity: f.severity, provenance: f.provenance, subject: subjectOf(f.subject), detail: f.detail })),
    },
  };
}

export async function runWorkReview(
  service: WorkOrchestrationPort,
  id: string,
  decision: ResultReviewDecision,
): Promise<CommandResult> {
  const loaded = await loadPresentation(service, id);
  if (!loaded.ok) return loaded.result;
  const { item, events } = loaded;
  const plan = planResultReview(item, events, decision);
  if (!plan.ok) {
    const message =
      plan.reason === 'not_in_review' ? `O item está em "${item.state}", não em "review": não há resultado a revisar.`
      : plan.reason === 'no_reviewable_result' ? 'Não há resultado submetido reconstituível para revisar.'
      : 'O resultado mais recente pertence a outra versão de proposta; revise a versão vigente.';
    return errorResult(message, plan.reason, EXIT.REJECTED);
  }
  const reviewed: WorkOperationResult<WorkItem> = await service.reviewResult(plan.command);
  if (!reviewed.ok) return errorResult(reviewed.error.message, reviewed.error.code, exitCodeForError(reviewed.error.code));
  const message = decision.type === 'accept'
    ? `Resultado aceito. Novo estado: ${reviewed.value.state}.`
    : `Correções solicitadas. Novo estado: ${reviewed.value.state}.`;
  return {
    exitCode: EXIT.OK,
    payload: {
      ok: true, kind: 'review', workItemId: reviewed.value.id, decision: decision.type,
      state: reviewed.value.state, reviewedResultEventId: plan.command.reviewedResultEventId, message,
    },
  };
}

/**
 * Aprova uma PROPOSTA (`proposed → approved`) pelo application service canônico
 * (`resolveApproval` com `{type:'approve'}`) — distinto de aceitar um RESULTADO em
 * review (`work accept`/`reviewResult`). A regra "aprovável quando proposed com
 * proveniência íntegra" vem da projeção (`availableWorkActions`), não do adapter; a
 * autoridade final é do service/RPC. NÃO executa nem inicia o trabalho.
 */
export async function runWorkApprove(service: WorkOrchestrationPort, id: string): Promise<CommandResult> {
  const loaded = await loadPresentation(service, id);
  if (!loaded.ok) return loaded.result;
  const { item, presentation } = loaded;
  if (!presentation.availableActions.includes('approve')) {
    if (item.state !== 'proposed') {
      return errorResult(`O item está em "${item.state}", não em "proposed": não há proposta a aprovar.`, 'not_proposed', EXIT.REJECTED);
    }
    const issues = presentation.provenance?.issues ?? [];
    return errorResult(
      `A proposta não está aprovável — proveniência ${presentation.provenance?.status ?? 'desconhecida'}${issues.length ? ` (${issues.join(', ')})` : ''}.`,
      'provenance_incomplete', EXIT.REJECTED,
    );
  }
  const command: ResolveWorkApprovalCommand = { workItemId: item.id, expectedProposalVersion: item.proposalVersion, decision: { type: 'approve' } };
  const resolved = await service.resolveApproval(command);
  if (!resolved.ok) return errorResult(resolved.error.message, resolved.error.code, exitCodeForError(resolved.error.code));
  return {
    exitCode: EXIT.OK,
    payload: { ok: true, kind: 'approve', workItemId: resolved.value.id, state: resolved.value.state, message: `Proposta aprovada. Novo estado: ${resolved.value.state}.` },
  };
}

// Recusas de correção que são de INFRAESTRUTURA (a rota web as trata como 5xx) →
// erro operacional (exit 1). As demais são precondições de estado/envelope (422 na
// rota) → recusa por regra (exit 3). Espelha exatamente o split da rota.
const CORRECTION_INFRA_REASONS: ReadonlySet<string> = new Set(['events_unavailable', 'lineage_read_failed', 'persistence_failed']);
function correctionReasonMessage(reason: string): string {
  switch (reason) {
    case 'item_unavailable': return 'O item não está em "changes_requested": não há correção a materializar.';
    case 'review_request_missing': return 'Não há pedido de revisão persistido (requested_changes) para derivar a correção.';
    case 'reviewed_result_missing': return 'O resultado revisado não pôde ser correlacionado à tentativa (attempt_id).';
    case 'checkpoint_evidence_missing': return 'Não há checkpoint git durável elegível da tentativa revisada para retomar.';
    case 'derivation_refused': return 'A derivação da correção por retomada foi recusada (envelope não satisfeito).';
    case 'candidate_invalid': return 'O candidato de correção falhou na validação de envelope.';
    case 'events_unavailable': return 'Não foi possível ler os eventos do item.';
    case 'lineage_read_failed': return 'Não foi possível ler o lineage de recuperação.';
    case 'persistence_failed': return 'Falha ao persistir o sucessor de correção.';
    default: return 'Não foi possível materializar a correção.';
  }
}

/**
 * Materializa (ou replaya) o sucessor de correção governada de um item em
 * `changes_requested`, usando a MESMA capacidade que a rota web `review-corrections`
 * (`correctReviewedWorkItem`). Boundary máximo `proposed`: NÃO aprova nem executa —
 * a aprovação continua sendo ato humano (via `anima work approve`). Idempotente: um
 * replay devolve o mesmo sucessor.
 */
export async function runWorkCorrect(correct: ReviewCorrectionCapability, id: string): Promise<CommandResult> {
  const result = await correct(id);
  if (result.ok) {
    const message = result.replayed
      ? `Sucessor de correção já existente (replay idempotente): ${result.successorWorkItemId} (seq ${result.recoverySequence}).`
      : `Sucessor de correção materializado em proposed: ${result.successorWorkItemId} (seq ${result.recoverySequence}). Aguarda aprovação humana.`;
    return {
      exitCode: EXIT.OK,
      payload: {
        ok: true, kind: 'work-correct', originalWorkItemId: id,
        successorWorkItemId: result.successorWorkItemId, lineageId: result.lineageId,
        recoverySequence: result.recoverySequence, replayed: result.replayed, message,
      },
    };
  }
  const detail = [...(result.refusals ?? []), ...(result.gaps ?? [])];
  const suffix = detail.length > 0 ? ` (${detail.join(', ')})` : result.message ? ` (${result.message})` : '';
  const exitCode = CORRECTION_INFRA_REASONS.has(result.reason) ? EXIT.ERROR : EXIT.REJECTED;
  return errorResult(`${correctionReasonMessage(result.reason)}${suffix}`, result.reason, exitCode);
}
