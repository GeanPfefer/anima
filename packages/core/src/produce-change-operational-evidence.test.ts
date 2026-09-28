import type { Json } from '@anima/types';
import {
  buildHostObservedGateEvidence,
  buildHostObservedGitEvidence,
  buildWorktreeHandoff,
  type VerifierOpinionFinding,
  type VerifierOpinionV1,
  type WorkEvent,
} from './work-orchestration';
import {
  projectProduceChangeOperationalEvidence,
  type ProduceChangeHistoryV0,
  type ProduceChangeLineageLinkV0,
  type ProduceChangeWorkItemFactsV0,
} from './produce-change-operational-evidence';
import { evaluateCapabilityProofsFromHistory } from './capability-proof-evaluation';
import { ANIMA_CAPABILITY_REGISTRY_V0 } from './capability-registry';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const BASE = 'a'.repeat(40);
const COMMIT = 'b'.repeat(40);
const TRUSTED_SINCE = '2026-09-28T00:00:00.000Z';
const TRUSTED_DAY = Date.parse('2026-09-28T12:00:00.000Z');
const LEGACY_DAY = Date.parse('2026-09-20T12:00:00.000Z');

let sequence = 0;
const nextId = (prefix: string): string => `${prefix}-${++sequence}`;

interface AttemptSpec {
  readonly item: string;
  readonly attempt: string;
  readonly version?: number;
  /** Minutos a partir do dia-base (ordem cronológica entre attempts). */
  readonly at: number;
  readonly day?: number;
  readonly coder?: 'succeeded' | 'failed' | null;
  readonly backendId?: string;
  readonly terminal: 'result' | 'failed' | 'cancelled' | 'none';
  readonly failure?: { readonly code?: string; readonly message?: string };
  readonly changedFiles?: readonly string[];
  readonly observedFiles?: readonly string[];
  readonly observedCommit?: string;
  readonly gates?: readonly { readonly exitCode: number; readonly baseExitCode?: number; readonly timedOut?: boolean }[] | null;
  readonly git?: boolean;
  readonly verdict?: 'verified' | 'rejected' | 'inconclusive' | null;
  readonly findings?: readonly VerifierOpinionFinding[];
  readonly decision?:
    | { readonly kind: 'accept' }
    | { readonly kind: 'changes_requested'; readonly cause?: string }
    | { readonly kind: 'pending_request_changes' }
    | { readonly kind: 'pending_cancel' };
  readonly technicalAuthor?: WorkEvent['author'];
}

function event(item: string, type: WorkEvent['type'], author: WorkEvent['author'], version: number, at: number, data: Record<string, unknown>, id = nextId(type)): WorkEvent {
  return { id, workItemId: item, type, author, proposalVersion: version, payload: { schema_version: 1, data } as unknown as Json, occurredAt: new Date(at) };
}

function proposalEvent(item: string, included: readonly string[], excluded: readonly string[] = ['secret.ts'], version = 1): WorkEvent {
  return event(item, version === 1 ? 'work_proposed' : 'proposal_revised', 'anima', version, LEGACY_DAY - 3_600_000, {
    proposal: { schema_version: 1, data: { summary: 's', objective: 'o', included_scope: included, excluded_scope: excluded, expected_effects: ['e'], risks: [] } },
  });
}

function classificationEvent(item: string, complexity = 'bounded', risk = 'low'): WorkEvent {
  return event(item, 'work_intelligence_classified', 'system', 1, LEGACY_DAY - 3_000_000, {
    classification: {
      schemaVersion: 1, complexity, risk, reversibility: 'reversible', planClarity: 'clear', urgency: 'normal',
      provenance: { kind: 'system_assessed', classifiedAt: '2026-09-01T00:00:00.000Z', classifierId: 'test', policyVersion: 'v1' },
    },
  });
}

function attemptEvents(spec: AttemptSpec): WorkEvent[] {
  const version = spec.version ?? 1;
  const t0 = (spec.day ?? TRUSTED_DAY) + spec.at * 60_000;
  const author = spec.technicalAuthor ?? 'system';
  const common = { work_item_id: spec.item, attempt_id: spec.attempt, approved_proposal_version: version };
  const out: WorkEvent[] = [event(spec.item, 'execution_started', 'anima', version, t0, { ...common, executor_id: 'worktree-v1' })];
  const backendId = spec.backendId ?? 'ollama:qwen';

  if (spec.coder !== null) {
    out.push(event(spec.item, 'host_observed_coder_evidence_recorded', author, version, t0 + 1_000, {
      ...common, origin: 'host',
      evidence: { schemaVersion: 1, workItemId: spec.item, attemptId: spec.attempt, approvedProposalVersion: version, backendId, durationMs: 10, outcome: spec.coder ?? 'succeeded', observedAt: new Date(t0 + 1_000).toISOString() },
    }));
  }

  const changed = spec.changedFiles ?? ['src/a.ts'];
  let resultId: string | null = null;
  if (spec.terminal === 'result') {
    const handoff = buildWorktreeHandoff({
      workItemId: spec.item, attemptId: spec.attempt, approvedProposalVersion: version, executorId: 'worktree-v1', backendId, model: null,
      baseSha: BASE, branch: `anima-work/${spec.attempt}`, commitSha: COMMIT, status: 'succeeded', changedFiles: [...changed],
      diffFiles: changed.map(path => ({ path, insertions: 1, deletions: 0 })),
      gates: [{ label: 'unit', command: 'npm test', exitCode: 0, outcome: 'passed' }],
    });
    if (!handoff.ok) throw new Error(handoff.explanation);
    const result = event(spec.item, 'result_submitted', 'executor', version, t0 + 2_000, { ...common, summary: 'feito', result_references: [], executor_signal: { worktreeHandoff: handoff.value } });
    resultId = result.id;
    out.push(result);
  } else if (spec.terminal === 'failed') {
    out.push(event(spec.item, 'execution_failed', 'executor', version, t0 + 2_000, {
      ...common, reason: 'execution_failed', message: spec.failure?.message ?? 'falhou', retryable: false,
      executor_signal: { code: spec.failure?.code ?? 'execution_failed' },
    }));
  } else if (spec.terminal === 'cancelled') {
    out.push(event(spec.item, 'work_cancelled', 'executor', version, t0 + 2_000, { ...common, reason: 'execution_cancelled' }));
  }

  let gitId: string | null = null;
  if (spec.git ?? spec.terminal === 'result') {
    const observed = spec.observedFiles ?? changed;
    const git = buildHostObservedGitEvidence({
      workItemId: spec.item, attemptId: spec.attempt, approvedProposalVersion: version, baseSha: BASE, observedCommitSha: spec.observedCommit ?? COMMIT,
      observedChangedFiles: [...observed], observedDiffFiles: observed.map(path => ({ path, insertions: 1, deletions: 0 })),
      observedAt: new Date(t0 + 3_000).toISOString(),
    });
    if (!git.ok) throw new Error(git.explanation);
    const e = event(spec.item, 'host_observed_evidence_recorded', author, version, t0 + 3_000, { ...common, origin: 'host', evidence: git.value });
    gitId = e.id;
    out.push(e);
  }

  let gateId: string | null = null;
  const gates = spec.gates === undefined ? (spec.terminal === 'result' ? [{ exitCode: 0 }] : null) : spec.gates;
  if (gates) {
    const built = buildHostObservedGateEvidence({
      workItemId: spec.item, attemptId: spec.attempt, approvedProposalVersion: version,
      gates: gates.map((gate, index) => ({
        label: `g${index}`, command: 'npm test', exitCode: gate.exitCode, durationMs: 5, timedOut: gate.timedOut ?? false, cancelled: false,
        ...(gate.baseExitCode === undefined ? {} : {
          claimKind: 'gate_assertion' as const,
          baseline: {
            baseExitCode: gate.baseExitCode, baseTimedOut: false, baseCancelled: false,
            targets: [{ path: 'src/a.test.ts', existedAtBase: true, changed: false }],
            changedFiles: ['src/a.ts'], changedFilesWithinTargetScope: [], changedFilesOutsideTargetScope: ['src/a.ts'],
            scopeVerification: { status: 'verified', verifiedTargetPaths: ['src/a.test.ts'] },
          } as never,
        }),
      })),
      observedAt: new Date(t0 + 4_000).toISOString(),
    });
    if (!built.ok) throw new Error(built.explanation);
    const e = event(spec.item, 'host_observed_gate_evidence_recorded', author, version, t0 + 4_000, { ...common, origin: 'host', evidence: built.value });
    gateId = e.id;
    out.push(e);
  }

  if (resultId !== null && spec.verdict) {
    const opinion: VerifierOpinionV1 = {
      schemaVersion: 1, workItemId: spec.item, attemptId: spec.attempt, approvedProposalVersion: version, verifierVersion: 'work-verifier-v3',
      verdict: spec.verdict, restsOnAttestedEvidence: false,
      summary: { violations: spec.verdict === 'rejected' ? 1 : 0, gaps: spec.verdict === 'inconclusive' ? 1 : 0, checks: 2, attested: 0, independent: 2 },
      findings: spec.findings ?? [],
      evidenceBasis: { resultEventId: resultId, observedEventId: gitId, observedGateEventId: gateId, coverage: { git: gitId !== null, gates: gateId !== null } },
    };
    out.push(event(spec.item, 'verifier_opinion_recorded', author, version, t0 + 5_000, {
      ...common, origin: 'verifier', verifier_version: opinion.verifierVersion, verdict: opinion.verdict, opinion,
    }));
  }

  if (resultId !== null && spec.decision) {
    const at = t0 + 6_000;
    switch (spec.decision.kind) {
      case 'accept':
        out.push(event(spec.item, 'result_accepted', 'user', version, at, { accepted_result_event_id: resultId }));
        break;
      case 'changes_requested':
        out.push(event(spec.item, 'changes_requested', 'user', version, at, {
          requested_changes: 'mude', reviewed_proposal_version: version, reviewed_result_event_id: resultId,
          ...(spec.decision.cause ? { human_review_cause: spec.decision.cause } : {}),
        }));
        break;
      case 'pending_request_changes':
        out.push(event(spec.item, 'changes_requested', 'user', version, at, {
          origin: 'pending_verification_recovery', resolved_result_event_id: resultId, attempt_id: spec.attempt,
          requested_changes: 'refazer', reviewed_proposal_version: version, reviewed_result_event_id: resultId, verifier_status: 'inconclusive',
        }));
        break;
      case 'pending_cancel':
        out.push(event(spec.item, 'work_cancelled', 'user', version, at, {
          origin: 'pending_verification_recovery', resolved_result_event_id: resultId, attempt_id: spec.attempt, reason: 'cancelar', verifier_status: 'missing',
        }));
        break;
    }
  }
  return out;
}

const item = (id: string, spec: Record<string, unknown> = {}, capability = 'programming'): ProduceChangeWorkItemFactsV0 => ({
  id, capability, impactLevel: 'low',
  intent: { execution_spec: { target: { kind: 'project', reference: 'anima' }, verifier_requirement: 'required_fail_closed', ...spec } },
});

function project(
  attempts: readonly AttemptSpec[],
  options: {
    readonly items?: readonly ProduceChangeWorkItemFactsV0[];
    readonly links?: readonly ProduceChangeLineageLinkV0[];
    readonly trusted?: string | null;
    readonly extraEvents?: readonly WorkEvent[];
    readonly currentFingerprint?: string | null;
    readonly scope?: readonly string[];
    readonly classified?: boolean;
  } = {},
) {
  const itemIds = [...new Set(attempts.map(attempt => attempt.item))];
  const history: ProduceChangeHistoryV0 = {
    events: [
      ...itemIds.map(id => proposalEvent(id, options.scope ?? ['src/a.ts', 'src/b.ts'])),
      ...(options.classified === false ? [] : itemIds.map(id => classificationEvent(id))),
      ...attempts.flatMap(attemptEvents),
      ...(options.extraEvents ?? []),
    ],
    items: options.items ?? itemIds.map(id => item(id)),
    lineageLinks: options.links ?? [],
    trustedSystemEvidenceSince: options.trusted === undefined ? TRUSTED_SINCE : options.trusted,
    currentFingerprint: options.currentFingerprint ?? null,
  };
  return projectProduceChangeOperationalEvidence(history);
}

const strong = (over: Partial<AttemptSpec> & Pick<AttemptSpec, 'item' | 'attempt' | 'at'>): AttemptSpec =>
  ({ terminal: 'result', verdict: 'verified', ...over });

// ─── Testes ──────────────────────────────────────────────────────────────────

describe('Produce-Change Evidence Projection V0', () => {
  test('1. positiva direta qualificada (cadeia forte system_proven)', () => {
    const result = project([strong({ item: 'w1', attempt: 'a1', at: 0 })]);
    expect(result.eligibleLineages).toBe(1);
    expect(result.occasions[0]).toMatchObject({ outcome: 'qualified_positive', recoveryBurden: 'direct', independentPositive: true, evidenceTrust: 'system_proven' });
    expect(result.positives).toEqual({ total: 1, independent: 1, humanRecovered: 0, scopeReduced: 0 });
    // Aceite humano não é requisito universal.
    expect(result.occasions[0]!.humanReviewCause).toBeNull();
  });

  test('2. positiva após falha na mesma unidade com re-admissão só de sistema = self_corrected', () => {
    const readmit = event('w1', 'work_approved', 'system', 1, TRUSTED_DAY + 5 * 60_000, { failure_event_id: 'f', decision: 'approve' });
    const result = project([
      { item: 'w1', attempt: 'a1', at: 0, terminal: 'failed', failure: { code: 'code_failure' } },
      strong({ item: 'w1', attempt: 'a2', at: 10 }),
    ], { extraEvents: [readmit] });
    expect(result.occasions[0]).toMatchObject({ outcome: 'qualified_positive', recoveryBurden: 'self_corrected', independentPositive: true });
    expect(result.occasions[0]!.causes).toEqual(['candidate_or_coder_failure']);
  });

  test('3. falha antes do candidato atribuível ao produtor', () => {
    const result = project([{ item: 'w1', attempt: 'a1', at: 0, terminal: 'failed', failure: { message: 'O backend falhou: [ollama_ambiguous_replacement] x' } }]);
    expect(result.occasions[0]).toMatchObject({ outcome: 'attributed_negative', causes: ['candidate_or_coder_failure'] });
  });

  test('4. falha de provider/transporte ⇒ not_attributable', () => {
    const provider = project([{ item: 'w1', attempt: 'a1', at: 0, terminal: 'failed', failure: { code: 'provider_unavailable' } }]);
    expect(provider.occasions[0]).toMatchObject({ outcome: 'not_attributable', causes: ['provider_failure'] });
    const transport = project([{ item: 'w2', attempt: 'a1', at: 0, terminal: 'failed', failure: { code: 'ollama_transport_error' } }]);
    expect(transport.occasions[0]).toMatchObject({ outcome: 'not_attributable', causes: ['transport_failure'] });
  });

  test('5. violação de escopo observada ⇒ negativa atribuída', () => {
    const result = project([strong({ item: 'w1', attempt: 'a1', at: 0, changedFiles: ['src/a.ts', 'secret.ts'] })]);
    expect(result.occasions[0]).toMatchObject({ outcome: 'attributed_negative', causes: ['scope_violation'] });
  });

  test('6. gate falho causado pelo candidato (baseline passava) ⇒ negativa', () => {
    const result = project([{ item: 'w1', attempt: 'a1', at: 0, terminal: 'failed', failure: { code: 'gate_failed' }, gates: [{ exitCode: 1, baseExitCode: 0 }] }]);
    expect(result.occasions[0]).toMatchObject({ outcome: 'attributed_negative', causes: ['candidate_gate_failure'] });
  });

  test('7. gate falho de infra/baseline ⇒ not_attributable; timeout ⇒ inconclusive; sem baseline ⇒ inconclusive', () => {
    const baseline = project([{ item: 'w1', attempt: 'a1', at: 0, terminal: 'failed', failure: { code: 'gate_failed' }, gates: [{ exitCode: 1, baseExitCode: 1 }] }]);
    expect(baseline.occasions[0]).toMatchObject({ outcome: 'not_attributable', causes: ['toolchain_or_baseline_failure'] });
    const timeout = project([{ item: 'w2', attempt: 'a1', at: 0, terminal: 'failed', failure: { code: 'gate_failed' }, gates: [{ exitCode: 1, timedOut: true }] }]);
    expect(timeout.occasions[0]).toMatchObject({ outcome: 'inconclusive', causes: ['unknown'] });
    const noBaseline = project([{ item: 'w3', attempt: 'a1', at: 0, terminal: 'failed', failure: { code: 'gate_failed' }, gates: [{ exitCode: 1 }] }]);
    expect(noBaseline.occasions[0]).toMatchObject({ outcome: 'inconclusive', causes: ['gate_failure_unattributed'] });
    expect(noBaseline.gaps).toContain('negative_attribution_incomplete');
  });

  test('8. candidato inválido (Git observado contradiz o handoff) ⇒ negativa', () => {
    const result = project([strong({ item: 'w1', attempt: 'a1', at: 0, observedCommit: 'c'.repeat(40) })]);
    expect(result.occasions[0]).toMatchObject({ outcome: 'attributed_negative', causes: ['candidate_contract_violation'] });
    const rejectedInvalid = project([strong({ item: 'w2', attempt: 'a1', at: 0, verdict: 'rejected', findings: [{ code: 'gate_exit_code_incoherent', severity: 'violation', provenance: 'independent' }] })]);
    expect(rejectedInvalid.occasions[0]).toMatchObject({ outcome: 'attributed_negative', causes: ['invalid_candidate'] });
  });

  test('9. sem resultado após execução válida (coder concluiu, nenhum candidato) ⇒ negativa', () => {
    const result = project([{ item: 'w1', attempt: 'a1', at: 0, coder: 'succeeded', terminal: 'failed', failure: { message: 'prosa sem código' } }]);
    expect(result.occasions[0]).toMatchObject({ outcome: 'attributed_negative', causes: ['no_result_after_valid_execution'] });
    // Sem o fato do coder, a mesma prosa não é atribuída.
    const noCoder = project([{ item: 'w2', attempt: 'a1', at: 0, coder: null, terminal: 'failed', failure: { message: 'prosa sem código' } }]);
    expect(noCoder.occasions[0]).toMatchObject({ outcome: 'inconclusive', causes: ['failure_unclassified'] });
  });

  test('10. Verifier rejected por defeito objetivo ⇒ negativa com causa estruturada', () => {
    const scope = project([strong({ item: 'w1', attempt: 'a1', at: 0, verdict: 'rejected', findings: [{ code: 'change_out_of_included_scope', severity: 'violation', provenance: 'independent', subject: 'x' }] })]);
    expect(scope.occasions[0]).toMatchObject({ outcome: 'attributed_negative', causes: ['scope_violation'] });
    const generic = project([strong({ item: 'w2', attempt: 'a1', at: 0, verdict: 'rejected', findings: [] })]);
    expect(generic.occasions[0]).toMatchObject({ outcome: 'attributed_negative', causes: ['verifier_rejected_candidate'] });
  });

  test('11. Verifier inconclusive ⇒ inconclusive', () => {
    const result = project([strong({ item: 'w1', attempt: 'a1', at: 0, verdict: 'inconclusive' })]);
    expect(result.occasions[0]).toMatchObject({ outcome: 'inconclusive', causes: ['verifier_inconclusive'] });
  });

  test('12. changes_requested com candidate_defect ⇒ negativa atribuída', () => {
    const result = project([strong({ item: 'w1', attempt: 'a1', at: 0, decision: { kind: 'changes_requested', cause: 'candidate_defect' } })]);
    expect(result.occasions[0]).toMatchObject({ outcome: 'attributed_negative', causes: ['candidate_defect_from_human_review'], humanReviewCause: 'candidate_defect' });
  });

  test('13. changes_requested com requirement_gap ⇒ not_attributable', () => {
    const result = project([strong({ item: 'w1', attempt: 'a1', at: 0, decision: { kind: 'changes_requested', cause: 'requirement_gap' } })]);
    expect(result.occasions[0]).toMatchObject({ outcome: 'not_attributable', causes: ['requirement_gap'], humanReviewCause: 'requirement_gap' });
  });

  test('14. changes_requested com preference_change ⇒ not_attributable', () => {
    const result = project([strong({ item: 'w1', attempt: 'a1', at: 0, decision: { kind: 'changes_requested', cause: 'preference_change' } })]);
    expect(result.occasions[0]).toMatchObject({ outcome: 'not_attributable', causes: ['preference_change'] });
  });

  test('15. changes_requested sem causa persistida ⇒ undetermined (nunca inferida)', () => {
    const result = project([strong({ item: 'w1', attempt: 'a1', at: 0, decision: { kind: 'changes_requested' } })]);
    expect(result.occasions[0]).toMatchObject({ outcome: 'inconclusive', causes: ['human_review_undetermined'], humanReviewCause: 'undetermined' });
    expect(result.gaps).toContain('human_review_cause_missing');
    // Causa fora do contrato fechado também é undetermined.
    const invalid = project([strong({ item: 'w2', attempt: 'a1', at: 0, decision: { kind: 'changes_requested', cause: 'o modelo errou' } })]);
    expect(invalid.occasions[0]!.humanReviewCause).toBe('undetermined');
  });

  test('16. sucessor positivo não apaga a negativa anterior', () => {
    const result = project([
      { item: 'w1', attempt: 'a1', at: 0, terminal: 'failed', failure: { code: 'code_failure' } },
      strong({ item: 'w2', attempt: 'a2', at: 10 }),
    ], { links: [{ originalWorkItemId: 'w1', successorWorkItemId: 'w2', recoverySequence: 1 }] });
    expect(result.eligibleLineages).toBe(1);
    const occasion = result.occasions[0]!;
    expect(occasion).toMatchObject({ lineageId: 'w1', outcome: 'qualified_positive', recoveryBurden: 'recovered', independentPositive: true });
    expect(occasion.causes).toEqual(['candidate_or_coder_failure']);
    expect(occasion.attempts[0]!.outcome).toBe('attributed_negative');
    expect(result.attributedNegativeAttempts).toBe(1);
  });

  test('17. human_recovered não qualifica operação independente', () => {
    const result = project([
      { item: 'w1', attempt: 'a1', at: 0, terminal: 'failed', failure: { code: 'code_failure' } },
      strong({ item: 'w2', attempt: 'a2', at: 10 }),
    ], {
      items: [item('w1'), item('w2', { human_resume: { schemaVersion: 1 } })],
      links: [{ originalWorkItemId: 'w1', successorWorkItemId: 'w2', recoverySequence: 1 }],
    });
    expect(result.occasions[0]).toMatchObject({ outcome: 'qualified_positive', recoveryBurden: 'human_recovered', independentPositive: false });
    expect(result.positives).toEqual({ total: 1, independent: 0, humanRecovered: 1, scopeReduced: 0 });
  });

  test('18. scope_reduced prova só o escopo reduzido', () => {
    const result = project([
      strong({ item: 'w1', attempt: 'a1', at: 0, decision: { kind: 'changes_requested', cause: 'candidate_defect' } }),
      strong({ item: 'w2', attempt: 'a2', at: 10 }),
    ], {
      items: [item('w1'), item('w2', { correction_scope: { effectiveScope: ['src/a.ts'] } })],
      links: [{ originalWorkItemId: 'w1', successorWorkItemId: 'w2', recoverySequence: 1 }],
    });
    expect(result.occasions[0]).toMatchObject({ outcome: 'qualified_positive', recoveryBurden: 'scope_reduced', provesReducedScopeOnly: true, independentPositive: false });
    expect(result.occasions[0]!.causes).toEqual(['candidate_defect_from_human_review']);
    expect(result.positives.scopeReduced).toBe(1);
  });

  test('19. attempts da mesma lineage contam UMA ocasião', () => {
    const result = project([
      { item: 'w1', attempt: 'a1', at: 0, terminal: 'failed', failure: { code: 'no_progress' } },
      { item: 'w1', attempt: 'a2', at: 10, terminal: 'failed', failure: { code: 'no_progress' } },
      { item: 'w2', attempt: 'a3', at: 20, terminal: 'failed', failure: { code: 'no_progress' } },
    ], { links: [{ originalWorkItemId: 'w1', successorWorkItemId: 'w2', recoverySequence: 1 }] });
    expect(result.eligibleLineages).toBe(1);
    expect(result.occasions[0]!.attemptIds).toEqual(['a1', 'a2', 'a3']);
    expect(result.negatives).toBe(1);
    expect(result.attributedNegativeAttempts).toBe(3);
  });

  test('20. lineages distintas permanecem independentes', () => {
    const result = project([strong({ item: 'w1', attempt: 'a1', at: 0 }), strong({ item: 'w2', attempt: 'a2', at: 10 })]);
    expect(result.eligibleLineages).toBe(2);
    expect(result.positives.independent).toBe(2);
  });

  test('21. mudança de fingerprint separa gerações', () => {
    const result = project([
      strong({ item: 'w1', attempt: 'a1', at: 0, backendId: 'ollama:qwen' }),
      strong({ item: 'w2', attempt: 'a2', at: 10, backendId: 'openai:gpt-5' }),
    ]);
    const [left, right] = result.occasions;
    expect(left!.operationalFingerprint).not.toBe(right!.operationalFingerprint);
    expect(Object.keys(result.coverageByFingerprint)).toHaveLength(2);
    // Cobertura da geração corrente exige positiva independente NAQUELE fingerprint.
    const covered = project([strong({ item: 'w1', attempt: 'a1', at: 0 })], { currentFingerprint: left!.operationalFingerprint });
    expect(covered.gaps).not.toContain('fingerprint_current_generation_uncovered');
    const uncovered = project([strong({ item: 'w1', attempt: 'a1', at: 0 })], { currentFingerprint: 'pcf0-outra' });
    expect(uncovered.gaps).toContain('fingerprint_current_generation_uncovered');
  });

  test('22. changeClass unknown não conta para cobertura por classe', () => {
    const result = project([strong({ item: 'w1', attempt: 'a1', at: 0 })], { classified: false });
    expect(result.occasions[0]!.changeClass).toEqual({ kind: 'unknown' });
    expect(result.coverageByChangeClass).toEqual({});
    expect(result.gaps).toEqual(expect.arrayContaining(['change_class_missing', 'change_class_taxonomy_missing']));
    const classified = project([strong({ item: 'w2', attempt: 'a1', at: 0 })]);
    expect(classified.occasions[0]!.changeClass).toEqual({ kind: 'structural', key: 'target=project;impact=low;complexity=bounded;risk=low' });
  });

  test('23. fatos técnicos exigem evidência system_proven', () => {
    const legacy = project([strong({ item: 'w1', attempt: 'a1', at: 0, day: LEGACY_DAY })]);
    expect(legacy.occasions[0]).toMatchObject({ outcome: 'inconclusive', causes: ['technical_evidence_not_system_proven'], evidenceTrust: 'legacy_unproven' });
    expect(legacy.occasions[0]!.attempts[0]!.wouldQualifyWithTrustedEvidence).toBe(true);
    const noBoundary = project([strong({ item: 'w2', attempt: 'a1', at: 0 })], { trusted: null });
    expect(noBoundary.positives.total).toBe(0);
    expect(noBoundary.gaps).toContain('trusted_evidence_generation_missing');
    const wrongAuthor = project([strong({ item: 'w3', attempt: 'a1', at: 0, technicalAuthor: 'executor' })]);
    expect(wrongAuthor.occasions[0]!.outcome).toBe('inconclusive');
  });

  test('24. result_submitted residente sozinho não qualifica positiva', () => {
    const result = project([{ item: 'w1', attempt: 'a1', at: 0, terminal: 'result', git: false, gates: null, coder: null, verdict: null }]);
    expect(result.occasions[0]).toMatchObject({ outcome: 'inconclusive', causes: ['verification_pending'] });
    expect(result.positives.total).toBe(0);
  });

  test('25. recuperação humana de candidato pendente NÃO vira candidate_defect', () => {
    const requestChanges = project([strong({ item: 'w1', attempt: 'a1', at: 0, verdict: 'inconclusive', decision: { kind: 'pending_request_changes' } })]);
    expect(requestChanges.occasions[0]).toMatchObject({ outcome: 'inconclusive', causes: ['verifier_inconclusive'], humanReviewCause: 'undetermined', recoveryBurden: 'human_recovered' });
    const cancel = project([strong({ item: 'w2', attempt: 'a1', at: 0, verdict: null, decision: { kind: 'pending_cancel' } })]);
    expect(cancel.occasions[0]).toMatchObject({ outcome: 'inconclusive', causes: ['verification_pending'] });
    expect([...requestChanges.occasions, ...cancel.occasions].flatMap(o => o.causes)).not.toContain('candidate_defect_from_human_review');
  });

  test('harness_recovery estruturado no sucessor reclassifica a falha original como harness', () => {
    const result = project([
      { item: 'w1', attempt: 'a1', at: 0, terminal: 'failed', failure: { message: 'sem código' } },
    ], {
      items: [item('w1'), item('w2', { harness_recovery: { failureClass: 'harness' } })],
      links: [{ originalWorkItemId: 'w1', successorWorkItemId: 'w2', recoverySequence: 1 }],
    });
    expect(result.occasions[0]!.attempts[0]).toMatchObject({ outcome: 'not_attributable', cause: 'harness_failure' });
  });

  test('denominador: toda lineage de programação exercida; demais excluídas com motivo', () => {
    const result = project([strong({ item: 'w1', attempt: 'a1', at: 0 })], {
      items: [item('w1'), item('w-proposed'), item('w-research', {}, 'research')],
      extraEvents: [proposalEvent('w-proposed', ['x']), proposalEvent('w-research', ['x'])],
    });
    expect(result.eligibleLineages).toBe(1);
    expect(result.excluded).toEqual(expect.arrayContaining([
      { lineageId: 'w-proposed', reason: 'not_exercised' },
      { lineageId: 'w-research', reason: 'not_programming' },
    ]));
    const missing = project([strong({ item: 'w9', attempt: 'a1', at: 0 })], { items: [] });
    expect(missing.eligibleLineages).toBe(0);
    expect(missing.gaps).toContain('work_item_facts_missing');
  });

  test('determinística: ordem de entrada irrelevante', () => {
    const attempts = [
      { item: 'w1', attempt: 'a1', at: 0, terminal: 'failed', failure: { code: 'code_failure' } } as AttemptSpec,
      strong({ item: 'w2', attempt: 'a2', at: 10 }),
    ];
    sequence = 1000;
    const forward = project(attempts, { links: [{ originalWorkItemId: 'w1', successorWorkItemId: 'w2', recoverySequence: 1 }] });
    sequence = 1000;
    const history = {
      events: [...[proposalEvent('w1', ['src/a.ts']), proposalEvent('w2', ['src/a.ts']), classificationEvent('w1'), classificationEvent('w2')], ...attempts.flatMap(attemptEvents)],
      items: [item('w1'), item('w2')],
      lineageLinks: [{ originalWorkItemId: 'w1', successorWorkItemId: 'w2', recoverySequence: 1 }],
      trustedSystemEvidenceSince: TRUSTED_SINCE,
    };
    const a = projectProduceChangeOperationalEvidence(history);
    const b = projectProduceChangeOperationalEvidence({ ...history, events: [...history.events].reverse(), items: [...history.items].reverse() });
    expect(b).toEqual(a);
    expect(forward.occasions[0]!.outcome).toBe(a.occasions[0]!.outcome);
  });

  test('26. a projeção NÃO promove: produce-change segue no máximo proven', () => {
    const many = project(Array.from({ length: 5 }, (_, index) => strong({ item: `w${index}`, attempt: `a${index}`, at: index * 10 })), { currentFingerprint: null });
    expect(many.positives.independent).toBe(5);
    expect(many.maturityCeiling).toBe('proven');
    expect(many.gaps).toContain('operational_predicate_not_defined');
    // Registry e avaliação canônica inalterados: teto de derivação `proven`, sem
    // reprodução satisfazendo operational.
    const registry = ANIMA_CAPABILITY_REGISTRY_V0.find(capability => capability.id === 'agency.produce-change');
    expect(registry?.maturity).toBe('proven');
    const evaluation = evaluateCapabilityProofsFromHistory({ events: [] }).find(entry => entry.capabilityId === 'agency.produce-change');
    expect(evaluation?.rule?.derivationCeiling).toBe('proven');
    expect(evaluation?.rule?.reproductionSatisfiesOperational).toBe(false);
  });
});
