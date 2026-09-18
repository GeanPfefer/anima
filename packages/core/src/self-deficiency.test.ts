import type { Json } from '@anima/types';
import {
  buildHostObservedGateEvidence,
  buildHostObservedGitEvidence,
  buildWorktreeHandoff,
  type VerifierOpinionV1,
  type WorkEvent,
} from './work-orchestration';
import {
  detectSelfDeficiencies,
  resolveSelfDeficiencyLifecycle,
  selfDeficienciesAwaitingProposal,
  selfDeficiencyDedupeKey,
  type SelfDeficiencyCoverage,
} from './self-deficiency';

// ------------------------------------------------------------------
// Fixtures. `failEvent` cobre repeated_failure (trivial); `strongChain` +
// `acceptEvent`/`changesRequestedEvent` reproduzem a cadeia forte necessária
// para as derivações de capability_regression e verifier_recurrent_issue.
// ------------------------------------------------------------------

const BASE = 'a'.repeat(40);
const COMMIT = 'b'.repeat(40);
const VERSION = 2;
const SUPERVISED = 'agency.supervised-self-development';

function failEvent(input: {
  readonly id: string;
  readonly workItemId: string;
  readonly attemptId: string;
  readonly reason: string;
  readonly time: string;
}): WorkEvent {
  return {
    id: input.id,
    workItemId: input.workItemId,
    type: 'execution_failed',
    author: 'system',
    proposalVersion: VERSION,
    payload: {
      schema_version: 1,
      data: { attempt_id: input.attemptId, reason: input.reason, retryable: false },
    } as unknown as Json,
    occurredAt: new Date(input.time),
  };
}

function opinion(attemptId: string, suffix: string, verdict: VerifierOpinionV1['verdict']): VerifierOpinionV1 {
  return {
    schemaVersion: 1,
    workItemId: 'work-1',
    attemptId,
    approvedProposalVersion: VERSION,
    verifierVersion: 'work-verifier-v1',
    verdict,
    restsOnAttestedEvidence: false,
    summary: { violations: 0, gaps: 0, checks: 2, attested: 0, independent: 2 },
    findings: [
      { code: 'scope_independently_observed', severity: 'ok', provenance: 'independent' },
      { code: 'gates_independently_observed', severity: 'ok', provenance: 'independent' },
    ],
    evidenceBasis: {
      resultEventId: `ev-result-${suffix}`,
      observedEventId: `ev-git-${suffix}`,
      observedGateEventId: `ev-gate-${suffix}`,
      coverage: { git: true, gates: true },
    },
  };
}

/** Cadeia forte verificada de UMA attempt (result + git + gate + verifier). */
function strongChain(attemptId: string, suffix: string, time: string): WorkEvent[] {
  const h = buildWorktreeHandoff({
    workItemId: 'work-1', attemptId, approvedProposalVersion: VERSION, executorId: 'worktree-v1',
    backendId: 'fake', model: null, baseSha: BASE, branch: `anima-work/${attemptId}`, commitSha: COMMIT,
    status: 'succeeded', changedFiles: ['src/a.ts'], diffFiles: [{ path: 'src/a.ts', insertions: 3, deletions: 1 }],
    gates: [{ label: 'unit', command: 'npm test', exitCode: 0, outcome: 'passed' }],
  });
  if (!h.ok) throw new Error(`handoff: ${h.explanation}`);
  const g = buildHostObservedGitEvidence({
    workItemId: 'work-1', attemptId, approvedProposalVersion: VERSION, baseSha: BASE, observedCommitSha: COMMIT,
    observedChangedFiles: ['src/a.ts'], observedDiffFiles: [{ path: 'src/a.ts', insertions: 3, deletions: 1 }], observedAt: time,
  });
  if (!g.ok) throw new Error(`git: ${g.explanation}`);
  const ga = buildHostObservedGateEvidence({
    workItemId: 'work-1', attemptId, approvedProposalVersion: VERSION,
    gates: [{ label: 'unit', command: 'npm test', exitCode: 0, durationMs: 500, timedOut: false, cancelled: false }], observedAt: time,
  });
  if (!ga.ok) throw new Error(`gate: ${ga.explanation}`);
  const base = (id: string, type: WorkEvent['type'], data: Record<string, unknown>): WorkEvent => ({
    id, workItemId: 'work-1', type, author: 'system', proposalVersion: VERSION,
    payload: { schema_version: 1, data } as unknown as Json, occurredAt: new Date(time),
  });
  return [
    base(`ev-result-${suffix}`, 'result_submitted', {
      work_item_id: 'work-1', attempt_id: attemptId, approved_proposal_version: VERSION, summary: 'feito', result_references: [],
      executor_signal: { worktreeHandoff: h.value as unknown as Json },
    }),
    base(`ev-git-${suffix}`, 'host_observed_evidence_recorded', {
      work_item_id: 'work-1', attempt_id: attemptId, approved_proposal_version: VERSION, origin: 'host',
      coverage: { git: true, gates: false }, evidence: g.value as unknown as Json,
    }),
    base(`ev-gate-${suffix}`, 'host_observed_gate_evidence_recorded', {
      work_item_id: 'work-1', attempt_id: attemptId, approved_proposal_version: VERSION, origin: 'host',
      coverage: { gates: true }, evidence: ga.value as unknown as Json,
    }),
    base(`ev-verifier-${suffix}`, 'verifier_opinion_recorded', {
      work_item_id: 'work-1', attempt_id: attemptId, approved_proposal_version: VERSION, origin: 'verifier',
      verifier_version: 'work-verifier-v1', verdict: 'verified', opinion: opinion(attemptId, suffix, 'verified') as unknown as Json,
    }),
  ];
}

function acceptEvent(suffix: string, time: string): WorkEvent {
  return {
    id: `ev-accept-${suffix}`, workItemId: 'work-1', type: 'result_accepted', author: 'user', proposalVersion: VERSION,
    payload: { schema_version: 1, data: { accepted_result_event_id: `ev-result-${suffix}` } } as unknown as Json,
    occurredAt: new Date(time),
  };
}

function changesRequestedEvent(suffix: string, time: string): WorkEvent {
  return {
    id: `ev-changes-${suffix}`, workItemId: 'work-1', type: 'changes_requested', author: 'user', proposalVersion: VERSION,
    payload: { schema_version: 1, data: { reviewed_result_event_id: `ev-result-${suffix}`, requested_changes: 'ajustar' } } as unknown as Json,
    occurredAt: new Date(time),
  };
}

describe('Self-Deficiency V0 — detecção', () => {
  test('1. histórico sem deficiência', () => {
    expect(detectSelfDeficiencies({ events: [] })).toEqual([]);
  });

  test('2. falha única não é deficiência estrutural', () => {
    const events = [failEvent({ id: 'e1', workItemId: 'w1', attemptId: 'a1', reason: 'gate_failed', time: '2026-09-10T10:00:00Z' })];
    expect(detectSelfDeficiencies({ events })).toEqual([]);
  });

  test('3. mesma causa em dois work_items distintos cria UMA deficiency', () => {
    const events = [
      failEvent({ id: 'e1', workItemId: 'w1', attemptId: 'a1', reason: 'gate_failed', time: '2026-09-10T10:00:00Z' }),
      failEvent({ id: 'e2', workItemId: 'w2', attemptId: 'a2', reason: 'gate_failed', time: '2026-09-11T10:00:00Z' }),
    ];
    const found = detectSelfDeficiencies({ events });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'repeated_failure', subject: 'gate_failed', occasions: 2, occurrences: 2 });
  });

  test('4. terceira ocorrência atualiza/deduplica (uma só deficiency)', () => {
    const events = [
      failEvent({ id: 'e1', workItemId: 'w1', attemptId: 'a1', reason: 'gate_failed', time: '2026-09-10T10:00:00Z' }),
      failEvent({ id: 'e2', workItemId: 'w2', attemptId: 'a2', reason: 'gate_failed', time: '2026-09-11T10:00:00Z' }),
      failEvent({ id: 'e3', workItemId: 'w3', attemptId: 'a3', reason: 'gate_failed', time: '2026-09-12T10:00:00Z' }),
    ];
    const found = detectSelfDeficiencies({ events });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ occurrences: 3, occasions: 3 });
    expect(found[0]?.lastObservedAt).toBe('2026-09-12T10:00:00.000Z');
    expect(found[0]?.id).toBe(selfDeficiencyDedupeKey('repeated_failure', 'gate_failed'));
  });

  test('5. causas diferentes NÃO colapsam', () => {
    const events = [
      failEvent({ id: 'e1', workItemId: 'w1', attemptId: 'a1', reason: 'gate_failed', time: '2026-09-10T10:00:00Z' }),
      failEvent({ id: 'e2', workItemId: 'w2', attemptId: 'a2', reason: 'gate_failed', time: '2026-09-11T10:00:00Z' }),
      failEvent({ id: 'e3', workItemId: 'w3', attemptId: 'a3', reason: 'ollama_read_round_limit', time: '2026-09-12T10:00:00Z' }),
      failEvent({ id: 'e4', workItemId: 'w4', attemptId: 'a4', reason: 'ollama_read_round_limit', time: '2026-09-13T10:00:00Z' }),
    ];
    const found = detectSelfDeficiencies({ events });
    const subjects = found.map(d => d.subject).sort();
    expect(subjects).toEqual(['gate_failed', 'ollama_read_round_limit']);
    expect(new Set(found.map(d => d.id)).size).toBe(2);
  });

  test('9. evidenceRefs/provenance preservadas (eventos, attempts, work_items reais)', () => {
    const events = [
      failEvent({ id: 'e1', workItemId: 'w1', attemptId: 'a1', reason: 'gate_failed', time: '2026-09-10T10:00:00Z' }),
      failEvent({ id: 'e2', workItemId: 'w2', attemptId: 'a2', reason: 'gate_failed', time: '2026-09-11T10:00:00Z' }),
    ];
    const found = detectSelfDeficiencies({ events });
    const refs = found[0]!.evidenceRefs;
    expect(refs).toEqual(expect.arrayContaining([
      { kind: 'work_event', ref: 'e1' },
      { kind: 'work_event', ref: 'e2' },
      { kind: 'attempt', ref: 'a1' },
      { kind: 'work_item', ref: 'w1' },
      { kind: 'work_item', ref: 'w2' },
    ]));
  });

  test('11. payload inválido / causa não-classificável não vira deficiency', () => {
    const events = [
      // reason ausente → código nulo → ignorado.
      { id: 'e1', workItemId: 'w1', type: 'execution_failed', author: 'system', proposalVersion: VERSION, payload: { schema_version: 1, data: {} } as unknown as Json, occurredAt: new Date('2026-09-10T10:00:00Z') } as WorkEvent,
      // reason fora da allowlist → código nulo → ignorado.
      failEvent({ id: 'e2', workItemId: 'w2', attemptId: 'a2', reason: 'algo_que_nao_existe', time: '2026-09-11T10:00:00Z' }),
    ];
    expect(detectSelfDeficiencies({ events })).toEqual([]);
  });

  test('10. histórico incompatível (timestamp inválido) falha fechado sem derrubar o scan', () => {
    const broken = { id: 'e1', workItemId: 'w1', type: 'execution_failed', author: 'system', proposalVersion: VERSION, payload: { schema_version: 1, data: { attempt_id: 'a1', reason: 'gate_failed' } } as unknown as Json, occurredAt: new Date('data-invalida') } as WorkEvent;
    const ok = failEvent({ id: 'e2', workItemId: 'w2', attemptId: 'a2', reason: 'gate_failed', time: '2026-09-11T10:00:00Z' });
    // O evento quebrado é ignorado; sobra só 1 work_item válido → abaixo do limiar → sem deficiency, sem throw.
    expect(() => detectSelfDeficiencies({ events: [broken, ok] })).not.toThrow();
    expect(detectSelfDeficiencies({ events: [broken, ok] })).toEqual([]);
  });

  test('12. regressão de capability gera deficiency (aceite depois pedido de mudanças)', () => {
    const events = [
      ...strongChain('attempt-1', 'a1', '2026-09-16T10:00:00.000Z'),
      acceptEvent('a1', '2026-09-16T10:10:00.000Z'),
      ...strongChain('attempt-2', 'a2', '2026-09-16T11:00:00.000Z'),
      changesRequestedEvent('a2', '2026-09-16T11:10:00.000Z'),
    ];
    const found = detectSelfDeficiencies({ events });
    const regression = found.find(d => d.kind === 'capability_regression');
    expect(regression).toBeDefined();
    expect(regression).toMatchObject({ subject: SUPERVISED, id: selfDeficiencyDedupeKey('capability_regression', SUPERVISED) });
    expect(regression!.evidenceRefs.length).toBeGreaterThan(0);
  });

  test('D. verifier_recurrent_issue: duas rejeições de auto-modificação verificada', () => {
    const events = [
      ...strongChain('attempt-1', 'a1', '2026-09-16T10:00:00.000Z'),
      changesRequestedEvent('a1', '2026-09-16T10:10:00.000Z'),
      ...strongChain('attempt-2', 'a2', '2026-09-16T11:00:00.000Z'),
      changesRequestedEvent('a2', '2026-09-16T11:10:00.000Z'),
    ];
    const found = detectSelfDeficiencies({ events });
    const recurrent = found.find(d => d.kind === 'verifier_recurrent_issue');
    expect(recurrent).toBeDefined();
    expect(recurrent).toMatchObject({ subject: SUPERVISED, occasions: 2 });
  });

  test('verifier_recurrent_issue exige recorrência: uma única rejeição não basta', () => {
    const events = [
      ...strongChain('attempt-1', 'a1', '2026-09-16T10:00:00.000Z'),
      changesRequestedEvent('a1', '2026-09-16T10:10:00.000Z'),
    ];
    const found = detectSelfDeficiencies({ events });
    expect(found.find(d => d.kind === 'verifier_recurrent_issue')).toBeUndefined();
  });

  test('18/19. execução repetida do detector é idempotente e determinística', () => {
    const events = [
      failEvent({ id: 'e1', workItemId: 'w1', attemptId: 'a1', reason: 'gate_failed', time: '2026-09-10T10:00:00Z' }),
      failEvent({ id: 'e2', workItemId: 'w2', attemptId: 'a2', reason: 'gate_failed', time: '2026-09-11T10:00:00Z' }),
      ...strongChain('attempt-1', 'a1', '2026-09-16T10:00:00.000Z'),
      acceptEvent('a1', '2026-09-16T10:10:00.000Z'),
      ...strongChain('attempt-2', 'a2', '2026-09-16T11:00:00.000Z'),
      changesRequestedEvent('a2', '2026-09-16T11:10:00.000Z'),
    ];
    const first = detectSelfDeficiencies({ events });
    const second = detectSelfDeficiencies({ events: [...events].reverse() });
    expect(second).toEqual(first);
  });
});

describe('Self-Deficiency V0 — ciclo de vida (dedup vs trabalho)', () => {
  const events = [
    failEvent({ id: 'e1', workItemId: 'w1', attemptId: 'a1', reason: 'gate_failed', time: '2026-09-10T10:00:00Z' }),
    failEvent({ id: 'e2', workItemId: 'w2', attemptId: 'a2', reason: 'gate_failed', time: '2026-09-11T10:00:00Z' }),
  ];
  const deficiencyId = selfDeficiencyDedupeKey('repeated_failure', 'gate_failed');

  test('6. deficiency coberta por work COMPLETADO (sem sinal posterior) → resolved, não ativa', () => {
    const detected = detectSelfDeficiencies({ events });
    const coverage: SelfDeficiencyCoverage[] = [
      { deficiencyId, workItemId: 'wi-fix', state: 'completed', updatedAt: '2026-09-20T10:00:00Z' },
    ];
    const resolved = resolveSelfDeficiencyLifecycle(detected, coverage);
    expect(resolved[0]?.status).toBe('resolved');
    expect(selfDeficienciesAwaitingProposal(resolved)).toEqual([]);
  });

  test('7. recorrência após resolução → reopened (semântica explícita)', () => {
    const detected = detectSelfDeficiencies({ events });
    const coverage: SelfDeficiencyCoverage[] = [
      // Completou ANTES do último sinal observado (2026-09-11) → recorrência.
      { deficiencyId, workItemId: 'wi-fix', state: 'completed', updatedAt: '2026-09-10T12:00:00Z' },
    ];
    const resolved = resolveSelfDeficiencyLifecycle(detected, coverage);
    expect(resolved[0]?.status).toBe('reopened');
    expect(selfDeficienciesAwaitingProposal(resolved)).toHaveLength(1);
  });

  test('8. work ATIVO equivalente impede nova proposta (covered)', () => {
    const detected = detectSelfDeficiencies({ events });
    for (const activeState of ['proposed', 'approved', 'in_progress', 'review'] as const) {
      const resolved = resolveSelfDeficiencyLifecycle(detected, [
        { deficiencyId, workItemId: 'wi-fix', state: activeState, updatedAt: '2026-09-12T10:00:00Z' },
      ]);
      expect(resolved[0]?.status).toBe('covered');
      expect(selfDeficienciesAwaitingProposal(resolved)).toEqual([]);
    }
  });

  test('cobertura só terminal-negativa (failed) NÃO resolve — segue open', () => {
    const detected = detectSelfDeficiencies({ events });
    const resolved = resolveSelfDeficiencyLifecycle(detected, [
      { deficiencyId, workItemId: 'wi-fix', state: 'failed', updatedAt: '2026-09-20T10:00:00Z' },
    ]);
    expect(resolved[0]?.status).toBe('open');
    expect(selfDeficienciesAwaitingProposal(resolved)).toHaveLength(1);
  });
});
