import {
  buildHostObservedGateEvidence,
  buildHostObservedGitEvidence,
  buildWorktreeHandoff,
  computeVerifierOpinion,
  parseVerifierOpinion,
  projectVerifierOpinionHistory,
  VERIFIER_VERSION,
  type HostObservedGateEvidenceV1,
  type HostObservedGitEvidenceV1,
  type VerifierOpinionV1,
  type WorkEvent,
  type WorkItem,
  type WorktreeHandoffV1,
} from './index';
import type { Json } from '@anima/types';

const BASE = 'a'.repeat(40);
const COMMIT = 'b'.repeat(40);
const BRANCH = 'anima-work/attempt-1';

const item = (overrides: Partial<WorkItem> = {}): WorkItem => ({
  id: 'work-1', userId: 'user-1', sourceMessageId: 'msg-1',
  state: 'review', impactLevel: 'low', capability: 'programming',
  originalRequest: 'faça X',
  intent: {
    execution_spec: {
      schema_version: 1, target: { kind: 'project', reference: 'proj' },
      permissions: ['workspace_read', 'workspace_write_isolated'],
      validation_criteria: [{ label: 'unit', command: 'npm test' }],
      limits: { max_attempts: 3 },
    },
  } as unknown as WorkItem['intent'],
  proposal: {
    schemaVersion: 1,
    data: { summary: 's', objective: 'o', includedScope: ['src/a.ts'], excludedScope: ['src/z.ts'], expectedEffects: ['e'], risks: [] },
  },
  proposalVersion: 2, createdAt: new Date('2026-08-15T00:00:00Z'), updatedAt: new Date('2026-08-15T00:00:00Z'),
  ...overrides,
});

const handoffWith = (overrides: Partial<Parameters<typeof buildWorktreeHandoff>[0]> = {}): WorktreeHandoffV1 => {
  const built = buildWorktreeHandoff({
    workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 2,
    executorId: 'worktree-v1', backendId: 'fake', model: null,
    baseSha: BASE, branch: BRANCH, commitSha: COMMIT, status: 'succeeded',
    changedFiles: ['src/a.ts'], diffFiles: [{ path: 'src/a.ts', insertions: 3, deletions: 1 }],
    gates: [{ label: 'unit', command: 'npm test', exitCode: 0, outcome: 'passed' }],
    ...overrides,
  });
  if (!built.ok) throw new Error(built.explanation);
  return built.value;
};

const resultEvent = (handoff: WorktreeHandoffV1, id = 'ev-result'): WorkEvent => ({
  id, workItemId: 'work-1', type: 'result_submitted', author: 'executor', proposalVersion: 2,
  payload: {
    schema_version: 1,
    data: {
      work_item_id: 'work-1', attempt_id: handoff.attemptId, approved_proposal_version: 2,
      summary: 'feito', result_references: [], executor_signal: { worktreeHandoff: handoff as unknown as Json },
    },
  } as unknown as Json,
  occurredAt: new Date('2026-08-15T00:00:00Z'),
});

const hostEvidence = (over: Partial<Parameters<typeof buildHostObservedGitEvidence>[0]> = {}): HostObservedGitEvidenceV1 => {
  const built = buildHostObservedGitEvidence({
    workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 2,
    baseSha: BASE, observedCommitSha: COMMIT,
    observedChangedFiles: ['src/a.ts'], observedDiffFiles: [{ path: 'src/a.ts', insertions: 3, deletions: 1 }],
    observedAt: '2026-08-15T12:00:00.000Z', ...over,
  });
  if (!built.ok) throw new Error(built.explanation);
  return built.value;
};

const observedEvent = (evidence: HostObservedGitEvidenceV1, id = 'ev-host'): WorkEvent => ({
  id, workItemId: 'work-1', type: 'host_observed_evidence_recorded', author: 'system', proposalVersion: 2,
  payload: {
    schema_version: 1,
    data: {
      work_item_id: 'work-1', attempt_id: evidence.attemptId, approved_proposal_version: 2,
      origin: 'host', coverage: { git: true, gates: false }, evidence: evidence as unknown as Json,
    },
  } as unknown as Json,
  occurredAt: new Date('2026-08-15T00:01:00Z'),
});

const gateEvidence = (): HostObservedGateEvidenceV1 => {
  const built = buildHostObservedGateEvidence({
    workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 2,
    gates: [{ label: 'unit', command: 'npm test', exitCode: 0, durationMs: 100, timedOut: false, cancelled: false }],
    observedAt: '2026-08-15T12:00:00.000Z',
  });
  if (!built.ok) throw new Error(built.explanation);
  return built.value;
};

const gateEvent = (evidence: HostObservedGateEvidenceV1, id = 'ev-gate'): WorkEvent => ({
  id, workItemId: 'work-1', type: 'host_observed_gate_evidence_recorded', author: 'system', proposalVersion: 2,
  payload: {
    schema_version: 1,
    data: {
      work_item_id: 'work-1', attempt_id: evidence.attemptId, approved_proposal_version: 2,
      origin: 'host', coverage: { gates: true }, evidence: evidence as unknown as Json,
    },
  } as unknown as Json,
  occurredAt: new Date('2026-08-15T00:02:00Z'),
});

describe('computeVerifierOpinion', () => {
  test('sem handoff durável ⇒ null (parecer é sobre um resultado produzido)', () => {
    expect(computeVerifierOpinion(item(), [])).toBeNull();
  });

  test('handoff limpo, sem observação ⇒ verified atestado; base sem observedEventId', () => {
    const opinion = computeVerifierOpinion(item(), [resultEvent(handoffWith())]);
    expect(opinion).not.toBeNull();
    expect(opinion!.verdict).toBe('verified');
    expect(opinion!.verifierVersion).toBe(VERIFIER_VERSION);
    expect(opinion!.restsOnAttestedEvidence).toBe(true);
    expect(opinion!.evidenceBasis.resultEventId).toBe('ev-result');
    expect(opinion!.evidenceBasis.observedEventId).toBeNull();
    expect(opinion!.evidenceBasis.coverage).toEqual({ git: false, gates: false });
    // Achados compactos: sem prosa `detail`.
    expect(opinion!.findings.every(f => !('detail' in f))).toBe(true);
    expect(opinion!.findings.map(f => f.code)).toContain('scope_respected');
  });

  test('handoff + observação coerente ⇒ verified; base referencia a observação; coverage git', () => {
    const opinion = computeVerifierOpinion(item(), [resultEvent(handoffWith()), observedEvent(hostEvidence())]);
    expect(opinion!.verdict).toBe('verified');
    expect(opinion!.evidenceBasis.observedEventId).toBe('ev-host');
    expect(opinion!.evidenceBasis.coverage).toEqual({ git: true, gates: false });
    expect(opinion!.findings.map(f => f.code)).toContain('scope_independently_observed');
  });

  test('handoff + observação que CONTRADIZ o atestado ⇒ rejected (mentira detectada)', () => {
    const observed = hostEvidence({
      observedCommitSha: 'c'.repeat(40),
      observedChangedFiles: ['src/evil.ts'],
      observedDiffFiles: [{ path: 'src/evil.ts', insertions: 9, deletions: 0 }],
    });
    const opinion = computeVerifierOpinion(item(), [resultEvent(handoffWith()), observedEvent(observed)]);
    expect(opinion!.verdict).toBe('rejected');
    expect(opinion!.findings.map(f => f.code)).toContain('attested_contradicts_observed');
    expect(opinion!.evidenceBasis.observedEventId).toBe('ev-host');
  });

  test('git E gate observados juntos (caminho vivo) ⇒ coverage {git,gates}=true, ambas as bases', () => {
    // É o cenário que a rota persiste de fato: git + gate observados na mesma tentativa.
    const opinion = computeVerifierOpinion(item(), [resultEvent(handoffWith()), observedEvent(hostEvidence()), gateEvent(gateEvidence())]);
    expect(opinion!.verdict).toBe('verified');
    expect(opinion!.evidenceBasis.coverage).toEqual({ git: true, gates: true });
    expect(opinion!.evidenceBasis.observedEventId).toBe('ev-host');
    expect(opinion!.evidenceBasis.observedGateEventId).toBe('ev-gate');
    const codes = opinion!.findings.map(f => f.code);
    expect(codes).toContain('scope_independently_observed');
    expect(codes).toContain('gates_independently_observed');
  });

  test('determinístico: mesmos inputs ⇒ parecer idêntico byte a byte', () => {
    const events = [resultEvent(handoffWith()), observedEvent(hostEvidence())];
    expect(computeVerifierOpinion(item(), events)).toEqual(computeVerifierOpinion(item(), events));
  });

  test('evolução legítima da base: a chegada da observação muda o parecer (sem apagar história)', () => {
    // Antes da observação: atestado apenas. Depois: git independente na base.
    const before = computeVerifierOpinion(item(), [resultEvent(handoffWith())])!;
    const after = computeVerifierOpinion(item(), [resultEvent(handoffWith()), observedEvent(hostEvidence())])!;
    expect(before.evidenceBasis.observedEventId).toBeNull();
    expect(after.evidenceBasis.observedEventId).toBe('ev-host');
    // A base difere — é o que legitima um NOVO parecer append-only, não uma sobrescrita.
    expect(before.evidenceBasis).not.toEqual(after.evidenceBasis);
  });
});

describe('parseVerifierOpinion', () => {
  const built = (): VerifierOpinionV1 => computeVerifierOpinion(item(), [resultEvent(handoffWith()), observedEvent(hostEvidence())])!;

  test('ida e volta', () => {
    const parsed = parseVerifierOpinion(built() as unknown as Json);
    expect(parsed).toEqual(built());
  });

  test.each([
    ['verdict inválido', (v: Record<string, Json>) => { v.verdict = 'talvez' as unknown as Json; }],
    ['schemaVersion errado', (v: Record<string, Json>) => { v.schemaVersion = 2; }],
    ['base sem resultEventId', (v: Record<string, Json>) => { (v.evidenceBasis as Record<string, Json>).resultEventId = ''; }],
    ['finding com severidade inválida', (v: Record<string, Json>) => { (v.findings as Record<string, Json>[])[0]!.severity = 'grave' as unknown as Json; }],
    ['coverage não booleano', (v: Record<string, Json>) => { ((v.evidenceBasis as Record<string, Json>).coverage as Record<string, Json>).git = 'sim' as unknown as Json; }],
  ])('fail-closed: %s ⇒ null', (_label, mutate) => {
    const raw = JSON.parse(JSON.stringify(built())) as Record<string, Json>;
    mutate(raw);
    expect(parseVerifierOpinion(raw as Json)).toBeNull();
  });
});

describe('projectVerifierOpinionHistory', () => {
  const opinionEvent = (opinion: VerifierOpinionV1, id: string, envelope?: { attemptId?: string }): WorkEvent => ({
    id, workItemId: 'work-1', type: 'verifier_opinion_recorded', author: 'system', proposalVersion: 2,
    payload: {
      schema_version: 1,
      data: {
        work_item_id: 'work-1', attempt_id: envelope?.attemptId ?? opinion.attemptId, approved_proposal_version: 2,
        origin: 'verifier', verifier_version: opinion.verifierVersion, verdict: opinion.verdict, opinion: opinion as unknown as Json,
      },
    } as unknown as Json,
    occurredAt: new Date('2026-08-15T00:02:00Z'),
  });

  test('preserva o histórico na ordem cronológica (evolução do parecer)', () => {
    const attested = computeVerifierOpinion(item(), [resultEvent(handoffWith())])!;
    const observed = computeVerifierOpinion(item(), [resultEvent(handoffWith()), observedEvent(hostEvidence())])!;
    const history = projectVerifierOpinionHistory([opinionEvent(attested, 'op-1'), opinionEvent(observed, 'op-2')]);
    expect(history).toHaveLength(2);
    expect(history[0]!.evidenceBasis.observedEventId).toBeNull();
    expect(history[1]!.evidenceBasis.observedEventId).toBe('ev-host');
  });

  test('parecer com envelope incoerente é descartado; ausência ⇒ []', () => {
    const opinion = computeVerifierOpinion(item(), [resultEvent(handoffWith())])!;
    expect(projectVerifierOpinionHistory([opinionEvent(opinion, 'op-x', { attemptId: 'outro' })])).toEqual([]);
    expect(projectVerifierOpinionHistory([])).toEqual([]);
  });
});
