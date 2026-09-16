import type { Json } from '@anima/types';
import {
  buildHostObservedGateEvidence,
  buildHostObservedGitEvidence,
  buildWorktreeHandoff,
  projectVerifierOpinionHistory,
  type HostObservedGateEvidenceV1,
  type HostObservedGitEvidenceV1,
  type VerifierOpinionV1,
  type WorkEvent,
  type WorktreeHandoffV1,
} from './work-orchestration';
import { deriveVerifiedWorktreeExecutionEvidenceFromEvents } from './capability-proof-work-evidence';

const BASE = 'a'.repeat(40);
const COMMIT = 'b'.repeat(40);
const BRANCH = 'anima-work/attempt-1';

const WORK_ITEM = 'work-1';
const ATTEMPT = 'attempt-1';
const VERSION = 2;

function handoff(
  overrides: Partial<Parameters<typeof buildWorktreeHandoff>[0]> = {},
): WorktreeHandoffV1 {
  const built = buildWorktreeHandoff({
    workItemId: WORK_ITEM,
    attemptId: ATTEMPT,
    approvedProposalVersion: VERSION,
    executorId: 'worktree-v1',
    backendId: 'fake',
    model: null,
    baseSha: BASE,
    branch: BRANCH,
    commitSha: COMMIT,
    status: 'succeeded',
    changedFiles: ['src/a.ts'],
    diffFiles: [
      {
        path: 'src/a.ts',
        insertions: 3,
        deletions: 1,
      },
    ],
    gates: [
      {
        label: 'unit',
        command: 'npm test',
        exitCode: 0,
        outcome: 'passed',
      },
    ],
    ...overrides,
  });

  if (!built.ok) {
    throw new Error(`fixture handoff inválida: ${built.explanation}`);
  }

  return built.value;
}

function resultEvent(
  value: WorktreeHandoffV1 = handoff(),
): WorkEvent {
  return {
    id: 'ev-result',
    workItemId: WORK_ITEM,
    type: 'result_submitted',
    author: 'executor',
    proposalVersion: VERSION,
    payload: {
      schema_version: 1,
      data: {
        work_item_id: WORK_ITEM,
        attempt_id: value.attemptId,
        approved_proposal_version: VERSION,
        summary: 'feito',
        result_references: [],
        executor_signal: {
          worktreeHandoff: value as unknown as Json,
        },
      },
    } as unknown as Json,
    occurredAt: new Date('2026-09-16T10:00:00.000Z'),
  };
}

function gitEvidence(
  overrides: Partial<Parameters<typeof buildHostObservedGitEvidence>[0]> = {},
): HostObservedGitEvidenceV1 {
  const built = buildHostObservedGitEvidence({
    workItemId: WORK_ITEM,
    attemptId: ATTEMPT,
    approvedProposalVersion: VERSION,
    baseSha: BASE,
    observedCommitSha: COMMIT,
    observedChangedFiles: ['src/a.ts'],
    observedDiffFiles: [
      {
        path: 'src/a.ts',
        insertions: 3,
        deletions: 1,
      },
    ],
    observedAt: '2026-09-16T10:01:00.000Z',
    ...overrides,
  });

  if (!built.ok) {
    throw new Error(`fixture git inválida: ${built.explanation}`);
  }

  return built.value;
}

function gitEvent(
  value: HostObservedGitEvidenceV1 = gitEvidence(),
): WorkEvent {
  return {
    id: 'ev-host-git',
    workItemId: WORK_ITEM,
    type: 'host_observed_evidence_recorded',
    author: 'system',
    proposalVersion: VERSION,
    payload: {
      schema_version: 1,
      data: {
        work_item_id: WORK_ITEM,
        attempt_id: value.attemptId,
        approved_proposal_version: VERSION,
        origin: 'host',
        coverage: {
          git: true,
          gates: false,
        },
        evidence: value as unknown as Json,
      },
    } as unknown as Json,
    occurredAt: new Date('2026-09-16T10:01:00.000Z'),
  };
}

function gateEvidence(
  exitCode = 0,
): HostObservedGateEvidenceV1 {
  const built = buildHostObservedGateEvidence({
    workItemId: WORK_ITEM,
    attemptId: ATTEMPT,
    approvedProposalVersion: VERSION,
    gates: [
      {
        label: 'unit',
        command: 'npm test',
        exitCode,
        durationMs: 500,
        timedOut: false,
        cancelled: false,
      },
    ],
    observedAt: '2026-09-16T10:02:00.000Z',
  });

  if (!built.ok) {
    throw new Error(`fixture gate inválida: ${built.explanation}`);
  }

  return built.value;
}

function gateEvent(
  value: HostObservedGateEvidenceV1 = gateEvidence(),
): WorkEvent {
  return {
    id: 'ev-host-gates',
    workItemId: WORK_ITEM,
    type: 'host_observed_gate_evidence_recorded',
    author: 'system',
    proposalVersion: VERSION,
    payload: {
      schema_version: 1,
      data: {
        work_item_id: WORK_ITEM,
        attempt_id: value.attemptId,
        approved_proposal_version: VERSION,
        origin: 'host',
        coverage: {
          gates: true,
        },
        evidence: value as unknown as Json,
      },
    } as unknown as Json,
    occurredAt: new Date('2026-09-16T10:02:00.000Z'),
  };
}

function opinion(
  overrides: Partial<VerifierOpinionV1> = {},
): VerifierOpinionV1 {
  return {
    schemaVersion: 1,
    workItemId: WORK_ITEM,
    attemptId: ATTEMPT,
    approvedProposalVersion: VERSION,
    verifierVersion: 'work-verifier-v1',
    verdict: 'verified',
    restsOnAttestedEvidence: false,
    summary: {
      violations: 0,
      gaps: 0,
      checks: 2,
      attested: 0,
      independent: 2,
    },
    findings: [
      {
        code: 'scope_independently_observed',
        severity: 'ok',
        provenance: 'independent',
      },
      {
        code: 'gates_independently_observed',
        severity: 'ok',
        provenance: 'independent',
      },
    ],
    evidenceBasis: {
      resultEventId: 'ev-result',
      observedEventId: 'ev-host-git',
      observedGateEventId: 'ev-host-gates',
      coverage: {
        git: true,
        gates: true,
      },
    },
    ...overrides,
  };
}

function verifierEvent(
  value: VerifierOpinionV1 = opinion(),
  overrides: {
    id?: string;
    occurredAt?: Date;
    envelopeAttemptId?: string;
  } = {},
): WorkEvent {
  return {
    id: overrides.id ?? 'ev-verifier',
    workItemId: WORK_ITEM,
    type: 'verifier_opinion_recorded',
    author: 'system',
    proposalVersion: VERSION,
    payload: {
      schema_version: 1,
      data: {
        work_item_id: WORK_ITEM,
        attempt_id: overrides.envelopeAttemptId ?? value.attemptId,
        approved_proposal_version: VERSION,
        origin: 'verifier',
        verifier_version: value.verifierVersion,
        verdict: value.verdict,
        opinion: value as unknown as Json,
      },
    } as unknown as Json,
    occurredAt:
      overrides.occurredAt ??
      new Date('2026-09-16T10:03:00.000Z'),
  };
}

function fullHistory(): readonly WorkEvent[] {
  return [
    resultEvent(),
    gitEvent(),
    gateEvent(),
    verifierEvent(),
  ];
}

describe('Capability Proof Work Evidence V0', () => {
  test('cadeia real forte deriva verified_execution positiva', () => {
    const evidence =
      deriveVerifiedWorktreeExecutionEvidenceFromEvents(
        'agency.produce-change',
        fullHistory(),
      );

    expect(evidence).toHaveLength(1);

    expect(evidence[0]).toMatchObject({
      capabilityId: 'agency.produce-change',
      evidenceClass: 'verified_execution',
      outcome: 'positive',
      observedAt: '2026-09-16T10:03:00.000Z',
    });

    expect(evidence[0]?.proofRefs).toEqual([
      expect.objectContaining({
        kind: 'attempt',
        ref: ATTEMPT,
      }),
      expect.objectContaining({
        kind: 'event',
        ref: 'ev-result',
      }),
      expect.objectContaining({
        kind: 'event',
        ref: 'ev-host-git',
      }),
      expect.objectContaining({
        kind: 'event',
        ref: 'ev-host-gates',
      }),
      expect.objectContaining({
        kind: 'verifier',
        ref: 'ev-verifier',
      }),
    ]);
  });

  test('verified puramente atestado NÃO vira verified_execution', () => {
    const attested = opinion({
      restsOnAttestedEvidence: true,
      summary: {
        violations: 0,
        gaps: 0,
        checks: 1,
        attested: 1,
        independent: 0,
      },
      findings: [
        {
          code: 'gates_passed',
          severity: 'ok',
          provenance: 'attested',
        },
      ],
      evidenceBasis: {
        resultEventId: 'ev-result',
        observedEventId: null,
        observedGateEventId: null,
        coverage: {
          git: false,
          gates: false,
        },
      },
    });

    expect(
      projectVerifierOpinionHistory([
        verifierEvent(attested),
      ]),
    ).toHaveLength(1);

    expect(
      deriveVerifiedWorktreeExecutionEvidenceFromEvents(
        'agency.produce-change',
        [
          resultEvent(),
          verifierEvent(attested),
        ],
      ),
    ).toEqual([]);
  });

  test('sem um dos fatos independentes exigidos falha fechado', () => {
    const history = fullHistory().filter(
      (event) => event.id !== 'ev-host-gates',
    );

    expect(
      deriveVerifiedWorktreeExecutionEvidenceFromEvents(
        'agency.produce-change',
        history,
      ),
    ).toEqual([]);
  });

  test('gate observado falho impede evidência positiva mesmo com opinion verified adulterada', () => {
    expect(
      deriveVerifiedWorktreeExecutionEvidenceFromEvents(
        'agency.produce-change',
        [
          resultEvent(),
          gitEvent(),
          gateEvent(gateEvidence(1)),
          verifierEvent(),
        ],
      ),
    ).toEqual([]);
  });

  test('commit observado precisa ser exatamente o commit produzido', () => {
    const OTHER_COMMIT = 'c'.repeat(40);

    expect(
      deriveVerifiedWorktreeExecutionEvidenceFromEvents(
        'agency.produce-change',
        [
          resultEvent(),
          gitEvent(
            gitEvidence({
              observedCommitSha: OTHER_COMMIT,
            }),
          ),
          gateEvent(),
          verifierEvent(),
        ],
      ),
    ).toEqual([]);
  });

  test('parecer com envelope de outra attempt é descartado', () => {
    expect(
      deriveVerifiedWorktreeExecutionEvidenceFromEvents(
        'agency.produce-change',
        [
          resultEvent(),
          gitEvent(),
          gateEvent(),
          verifierEvent(opinion(), {
            envelopeAttemptId: 'attempt-outra',
          }),
        ],
      ),
    ).toEqual([]);
  });

  test('parecer válido posterior não-verified suprime verified antigo da mesma attempt', () => {
    const earlier = verifierEvent(opinion(), {
      id: 'verifier-old',
      occurredAt: new Date('2026-09-16T10:03:00.000Z'),
    });

    const rejectedOpinion = opinion({
      verdict: 'rejected',
      restsOnAttestedEvidence: false,
      summary: {
        violations: 1,
        gaps: 0,
        checks: 1,
        attested: 0,
        independent: 1,
      },
      findings: [
        {
          code: 'gate_failed',
          severity: 'violation',
          provenance: 'independent',
        },
      ],
    });

    const later = verifierEvent(rejectedOpinion, {
      id: 'verifier-new',
      occurredAt: new Date('2026-09-16T10:04:00.000Z'),
    });

    expect(
      projectVerifierOpinionHistory([later]),
    ).toHaveLength(1);

    expect(
      deriveVerifiedWorktreeExecutionEvidenceFromEvents(
        'agency.produce-change',
        [
          resultEvent(),
          gitEvent(),
          gateEvent(),
          earlier,
          later,
        ],
      ),
    ).toEqual([]);
  });

  test('resultado é determinístico mesmo quando os eventos chegam fora de ordem', () => {
    const ordered = fullHistory();
    const reversed = [...ordered].reverse();

    expect(
      deriveVerifiedWorktreeExecutionEvidenceFromEvents(
        'agency.produce-change',
        reversed,
      ),
    ).toEqual(
      deriveVerifiedWorktreeExecutionEvidenceFromEvents(
        'agency.produce-change',
        ordered,
      ),
    );
  });

  test('capabilityId vazio não produz evidência', () => {
    expect(
      deriveVerifiedWorktreeExecutionEvidenceFromEvents(
        '   ',
        fullHistory(),
      ),
    ).toEqual([]);
  });
});