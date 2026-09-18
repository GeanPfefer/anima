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
import {
  deriveCanonicalWorkCapabilityEvidenceFromEvents,
  deriveSupervisedSelfDevelopmentEvidenceFromEvents,
  deriveVerifiedWorktreeExecutionEvidenceFromEvents,
  deriveVerifierOperationEvidenceFromEvents,
} from './capability-proof-work-evidence';
import { deriveCapabilityAssessmentsFromWorkHistory } from './capability-proof-assessment';

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
function coderEvent(
  overrides: {
    outcome?: 'succeeded' | 'failed' | 'cancelled';
    backendId?: string;
    attemptId?: string;
    id?: string;
  } = {},
): WorkEvent {
  const attemptId = overrides.attemptId ?? ATTEMPT;
  const backendId = overrides.backendId ?? 'fake';
  const outcome = overrides.outcome ?? 'succeeded';

  const observedAt =
    '2026-09-16T10:00:30.000Z';

  const evidence = {
    schemaVersion: 1,
    workItemId: WORK_ITEM,
    attemptId,
    approvedProposalVersion: VERSION,
    backendId,
    durationMs: 500,
    outcome,
    observedAt,
  };

  return {
    id: overrides.id ?? 'ev-host-coder',
    workItemId: WORK_ITEM,
    type: 'host_observed_coder_evidence_recorded',
    author: 'system',
    proposalVersion: VERSION,
    payload: {
      schema_version: 1,
      data: {
        work_item_id: WORK_ITEM,
        attempt_id: attemptId,
        approved_proposal_version: VERSION,
        origin: 'host',
        evidence: evidence as unknown as Json,
      },
    } as unknown as Json,
    occurredAt: new Date(observedAt),
  };
}

function attributionHistory(): readonly WorkEvent[] {
  return [
    ...fullHistory(),
    coderEvent(),
  ];
}

describe('Capability Attribution V0', () => {
  const capabilityIds = (
    events: readonly WorkEvent[],
  ): readonly string[] =>
    deriveCanonicalWorkCapabilityEvidenceFromEvents(
      events,
    ).map((entry) => entry.capabilityId);

  test('cadeia forte + coder observado atribui as capabilities exercitadas (incl. governance.verifier)', () => {
    expect(
      [
        ...new Set(
          capabilityIds(attributionHistory()),
        ),
      ].sort(),
    ).toEqual([
      'agency.edit-file',
      'agency.produce-change',
      'agency.verify-change',
      'agency.run-tests',
      'governance.verifier',
    ].sort());
  });

  test('Git host-observed sozinho NÃO prova edit-file', () => {
    expect(
      capabilityIds([
        gitEvent(),
      ]),
    ).toEqual([]);
  });

  test('coder observado sozinho NÃO prova edit-file sem mudança Git correlacionada', () => {
    expect(
      capabilityIds([
        coderEvent(),
      ]),
    ).toEqual([]);
  });

  test('coder + Git sem handoff durável NÃO provam edit-file', () => {
    expect(
      capabilityIds([
        coderEvent(),
        gitEvent(),
      ]),
    ).toEqual([]);
  });

  test('handoff + coder succeeded + Git correlacionado provam edit-file', () => {
    expect(
      capabilityIds([
        resultEvent(),
        coderEvent(),
        gitEvent(),
      ]),
    ).toEqual([
      'agency.edit-file',
    ]);
  });

  test('coder failed não prova edit-file mesmo que exista Git na attempt', () => {
    expect(
      capabilityIds([
        resultEvent(),
        coderEvent({
          outcome: 'failed',
        }),
        gitEvent(),
      ]),
    ).toEqual([]);
  });

  test('backend observado precisa ser o mesmo backend do handoff', () => {
    expect(
      capabilityIds([
        resultEvent(),
        coderEvent({
          backendId: 'outro-backend',
        }),
        gitEvent(),
      ]),
    ).toEqual([]);
  });

  test('Git observado precisa corresponder aos arquivos declarados no handoff', () => {
    const differentGit = gitEvidence({
      observedChangedFiles: ['src/b.ts'],
      observedDiffFiles: [
        {
          path: 'src/b.ts',
          insertions: 1,
          deletions: 0,
        },
      ],
    });

    expect(
      capabilityIds([
        resultEvent(),
        coderEvent(),
        gitEvent(differentGit),
      ]),
    ).toEqual([]);
  });

  test('gate host-observed sozinho prova run-tests', () => {
    expect(
      capabilityIds([
        gateEvent(),
      ]),
    ).toEqual([
      'agency.run-tests',
    ]);
  });

  test('resultado + coder + Git + gates sem Verifier preservam edit-file e run-tests, mas não produce/verify', () => {
    const ids = capabilityIds([
      resultEvent(),
      coderEvent(),
      gitEvent(),
      gateEvent(),
    ]);

    expect(
      [...new Set(ids)].sort(),
    ).toEqual([
      'agency.edit-file',
      'agency.run-tests',
    ]);
  });

  test('gate terminal falho não produz evidência positiva de run-tests', () => {
    expect(
      capabilityIds([
        gateEvent(gateEvidence(1)),
      ]),
    ).toEqual([]);
  });

  test('a atribuição continua independente de WorkCapability e texto livre', () => {
    const evidence =
      deriveCanonicalWorkCapabilityEvidenceFromEvents(
        attributionHistory(),
      );

    expect(
      evidence.some(
        (entry) =>
          entry.capabilityId ===
          'agency.produce-change',
      ),
    ).toBe(true);

    expect(
      evidence.some(
        (entry) =>
          entry.capabilityId ===
          'agency.verify-change',
      ),
    ).toBe(true);
  });

  test('cada atribuição mantém proofRefs auditáveis', () => {
    const evidence =
      deriveCanonicalWorkCapabilityEvidenceFromEvents(
        attributionHistory(),
      );

    expect(evidence.length).toBeGreaterThan(0);

    for (const entry of evidence) {
      expect(
        entry.proofRefs.length,
      ).toBeGreaterThan(0);

      expect(
        entry.proofRefs.some(
          (proof) =>
            proof.kind === 'attempt',
        ),
      ).toBe(true);
    }
  });

  test('é determinística mesmo com eventos recebidos fora de ordem', () => {
    const ordered = attributionHistory();
    const reversed = [...ordered].reverse();

    expect(
      deriveCanonicalWorkCapabilityEvidenceFromEvents(
        reversed,
      ),
    ).toEqual(
      deriveCanonicalWorkCapabilityEvidenceFromEvents(
        ordered,
      ),
    );
  });

  test('cada observação carimba occasionId = attempt (sinal de reprodução)', () => {
    const evidence =
      deriveCanonicalWorkCapabilityEvidenceFromEvents(
        attributionHistory(),
      );

    expect(evidence.length).toBeGreaterThan(0);

    for (const entry of evidence) {
      expect(entry.occasionId).toBe(ATTEMPT);
    }
  });
});

function gateEventFor(
  attemptId: string,
  observedAt: string,
  id: string,
): WorkEvent {
  const built = buildHostObservedGateEvidence({
    workItemId: WORK_ITEM,
    attemptId,
    approvedProposalVersion: VERSION,
    gates: [
      {
        label: 'unit',
        command: 'npm test',
        exitCode: 0,
        durationMs: 500,
        timedOut: false,
        cancelled: false,
      },
    ],
    observedAt,
  });

  if (!built.ok) {
    throw new Error(`fixture gate inválida: ${built.explanation}`);
  }

  return {
    id,
    workItemId: WORK_ITEM,
    type: 'host_observed_gate_evidence_recorded',
    author: 'system',
    proposalVersion: VERSION,
    payload: {
      schema_version: 1,
      data: {
        work_item_id: WORK_ITEM,
        attempt_id: attemptId,
        approved_proposal_version: VERSION,
        origin: 'host',
        coverage: {
          gates: true,
        },
        evidence: built.value as unknown as Json,
      },
    } as unknown as Json,
    occurredAt: new Date(observedAt),
  };
}

describe('Capability Reproduction attribution V0', () => {
  test('gates de attempts distintos geram duas ocasiões independentes de run-tests', () => {
    const evidence =
      deriveCanonicalWorkCapabilityEvidenceFromEvents([
        gateEventFor(
          'attempt-1',
          '2026-09-16T10:00:00.000Z',
          'gate-a1',
        ),
        gateEventFor(
          'attempt-2',
          '2026-09-16T11:00:00.000Z',
          'gate-a2',
        ),
      ]);

    const runTests = evidence.filter(
      (entry) => entry.capabilityId === 'agency.run-tests',
    );

    expect(runTests).toHaveLength(2);

    expect(
      new Set(runTests.map((entry) => entry.occasionId)),
    ).toEqual(new Set(['attempt-1', 'attempt-2']));
  });

  test('dois gates da MESMA attempt não criam ocasiões independentes', () => {
    const evidence =
      deriveCanonicalWorkCapabilityEvidenceFromEvents([
        gateEventFor(
          'attempt-unico',
          '2026-09-16T10:00:00.000Z',
          'gate-1',
        ),
        gateEventFor(
          'attempt-unico',
          '2026-09-16T11:00:00.000Z',
          'gate-2',
        ),
      ]);

    const occasions = new Set(
      evidence
        .filter(
          (entry) => entry.capabilityId === 'agency.run-tests',
        )
        .map((entry) => entry.occasionId),
    );

    expect(occasions).toEqual(new Set(['attempt-unico']));
  });
});

// ─── Cadeia parametrizada por attempt (V1.1) ────────────────────────────────────

/**
 * Constrói a cadeia forte de UMA attempt com ids distintos: resultado + Git +
 * gates + parecer do Verifier correlacionados. `verdict` e `gatePassed` permitem
 * cobrir os casos negativos/insuficientes.
 */
function attemptChain(
  attemptId: string,
  suffix: string,
  opts: {
    readonly verdict?: VerifierOpinionV1['verdict'];
    readonly gatePassed?: boolean;
    readonly time?: string;
  } = {},
): WorkEvent[] {
  const verdict = opts.verdict ?? 'verified';
  const gatePassed = opts.gatePassed ?? true;
  const time = opts.time ?? '2026-09-16T10:00:00.000Z';

  const h = buildWorktreeHandoff({
    workItemId: WORK_ITEM,
    attemptId,
    approvedProposalVersion: VERSION,
    executorId: 'worktree-v1',
    backendId: 'fake',
    model: null,
    baseSha: BASE,
    branch: `anima-work/${attemptId}`,
    commitSha: COMMIT,
    status: 'succeeded',
    changedFiles: ['src/a.ts'],
    diffFiles: [{ path: 'src/a.ts', insertions: 3, deletions: 1 }],
    gates: [{ label: 'unit', command: 'npm test', exitCode: 0, outcome: 'passed' }],
  });
  if (!h.ok) throw new Error(`fixture handoff inválida: ${h.explanation}`);

  const resultEv: WorkEvent = {
    id: `ev-result-${suffix}`,
    workItemId: WORK_ITEM,
    type: 'result_submitted',
    author: 'executor',
    proposalVersion: VERSION,
    payload: {
      schema_version: 1,
      data: {
        work_item_id: WORK_ITEM,
        attempt_id: attemptId,
        approved_proposal_version: VERSION,
        summary: 'feito',
        result_references: [],
        executor_signal: { worktreeHandoff: h.value as unknown as Json },
      },
    } as unknown as Json,
    occurredAt: new Date(time),
  };

  const g = buildHostObservedGitEvidence({
    workItemId: WORK_ITEM,
    attemptId,
    approvedProposalVersion: VERSION,
    baseSha: BASE,
    observedCommitSha: COMMIT,
    observedChangedFiles: ['src/a.ts'],
    observedDiffFiles: [{ path: 'src/a.ts', insertions: 3, deletions: 1 }],
    observedAt: time,
  });
  if (!g.ok) throw new Error(`fixture git inválida: ${g.explanation}`);

  const gitEv: WorkEvent = {
    id: `ev-git-${suffix}`,
    workItemId: WORK_ITEM,
    type: 'host_observed_evidence_recorded',
    author: 'system',
    proposalVersion: VERSION,
    payload: {
      schema_version: 1,
      data: {
        work_item_id: WORK_ITEM,
        attempt_id: attemptId,
        approved_proposal_version: VERSION,
        origin: 'host',
        coverage: { git: true, gates: false },
        evidence: g.value as unknown as Json,
      },
    } as unknown as Json,
    occurredAt: new Date(time),
  };

  const ga = buildHostObservedGateEvidence({
    workItemId: WORK_ITEM,
    attemptId,
    approvedProposalVersion: VERSION,
    gates: [
      {
        label: 'unit',
        command: 'npm test',
        exitCode: gatePassed ? 0 : 1,
        durationMs: 500,
        timedOut: false,
        cancelled: false,
      },
    ],
    observedAt: time,
  });
  if (!ga.ok) throw new Error(`fixture gate inválida: ${ga.explanation}`);

  const gateEv: WorkEvent = {
    id: `ev-gate-${suffix}`,
    workItemId: WORK_ITEM,
    type: 'host_observed_gate_evidence_recorded',
    author: 'system',
    proposalVersion: VERSION,
    payload: {
      schema_version: 1,
      data: {
        work_item_id: WORK_ITEM,
        attempt_id: attemptId,
        approved_proposal_version: VERSION,
        origin: 'host',
        coverage: { gates: true },
        evidence: ga.value as unknown as Json,
      },
    } as unknown as Json,
    occurredAt: new Date(time),
  };

  const op = opinion({
    attemptId,
    verdict,
    evidenceBasis: {
      resultEventId: `ev-result-${suffix}`,
      observedEventId: `ev-git-${suffix}`,
      observedGateEventId: `ev-gate-${suffix}`,
      coverage: { git: true, gates: true },
    },
  });

  const verifierEv = verifierEvent(op, {
    id: `ev-verifier-${suffix}`,
    occurredAt: new Date(time),
  });

  return [resultEv, gitEv, gateEv, verifierEv];
}

function acceptEvent(
  suffix: string,
  resultEventId: string,
  time: string,
): WorkEvent {
  return {
    id: `ev-accept-${suffix}`,
    workItemId: WORK_ITEM,
    type: 'result_accepted',
    author: 'user',
    proposalVersion: VERSION,
    payload: {
      schema_version: 1,
      data: { accepted_result_event_id: resultEventId },
    } as unknown as Json,
    occurredAt: new Date(time),
  };
}

function changesRequestedEvent(
  suffix: string,
  resultEventId: string,
  time: string,
): WorkEvent {
  return {
    id: `ev-changes-${suffix}`,
    workItemId: WORK_ITEM,
    type: 'changes_requested',
    author: 'user',
    proposalVersion: VERSION,
    payload: {
      schema_version: 1,
      data: {
        reviewed_result_event_id: resultEventId,
        requested_changes: 'ajustar escopo',
      },
    } as unknown as Json,
    occurredAt: new Date(time),
  };
}

describe('Governance Verifier attribution V1.1', () => {
  test('sem parecer não prova governance.verifier', () => {
    const noVerifier = attemptChain('attempt-1', 'a1').filter(
      (event) => event.type !== 'verifier_opinion_recorded',
    );

    expect(
      deriveVerifierOperationEvidenceFromEvents(noVerifier),
    ).toEqual([]);
  });

  test('parecer válido verified prova que o verifier operou', () => {
    const obs = deriveVerifierOperationEvidenceFromEvents(
      attemptChain('attempt-1', 'a1'),
    );

    expect(obs).toHaveLength(1);
    expect(obs[0]).toMatchObject({
      capabilityId: 'governance.verifier',
      evidenceClass: 'verified_execution',
      outcome: 'positive',
      occasionId: 'attempt-1',
    });
  });

  test('parecer REJECTED válido ainda prova que o verifier operou', () => {
    const obs = deriveVerifierOperationEvidenceFromEvents(
      attemptChain('attempt-1', 'a1', { verdict: 'rejected' }),
    );

    expect(obs).toHaveLength(1);
    expect(obs[0]).toMatchObject({
      capabilityId: 'governance.verifier',
      outcome: 'positive',
    });
  });

  test('gate falho + rejeição continua provando operação do verifier', () => {
    const obs = deriveVerifierOperationEvidenceFromEvents(
      attemptChain('attempt-1', 'a1', {
        verdict: 'rejected',
        gatePassed: false,
      }),
    );

    expect(obs).toHaveLength(1);
    expect(obs[0]?.outcome).toBe('positive');
  });

  test('parecer inconclusive NÃO prova operação do verifier', () => {
    expect(
      deriveVerifierOperationEvidenceFromEvents(
        attemptChain('attempt-1', 'a1', { verdict: 'inconclusive' }),
      ),
    ).toEqual([]);
  });

  test('parecer atestado (sem cobertura independente) não prova governance.verifier', () => {
    const attested = verifierEvent(
      opinion({
        restsOnAttestedEvidence: true,
        evidenceBasis: {
          resultEventId: 'ev-result-a1',
          observedEventId: null,
          observedGateEventId: null,
          coverage: { git: false, gates: false },
        },
      }),
      { id: 'ev-verifier-a1' },
    );

    const events = [
      ...attemptChain('attempt-1', 'a1').filter(
        (event) => event.type !== 'verifier_opinion_recorded',
      ),
      attested,
    ];

    expect(
      deriveVerifierOperationEvidenceFromEvents(events),
    ).toEqual([]);
  });

  test('correlação errada (envelope de outra attempt) não prova', () => {
    const wrong = verifierEvent(
      opinion({
        attemptId: 'attempt-1',
        evidenceBasis: {
          resultEventId: 'ev-result-a1',
          observedEventId: 'ev-git-a1',
          observedGateEventId: 'ev-gate-a1',
          coverage: { git: true, gates: true },
        },
      }),
      { id: 'ev-verifier-a1', envelopeAttemptId: 'attempt-outra' },
    );

    const events = [
      ...attemptChain('attempt-1', 'a1').filter(
        (event) => event.type !== 'verifier_opinion_recorded',
      ),
      wrong,
    ];

    expect(
      deriveVerifierOperationEvidenceFromEvents(events),
    ).toEqual([]);
  });

  test('duas attempts independentes → duas ocasiões de governance.verifier', () => {
    const obs = deriveVerifierOperationEvidenceFromEvents([
      ...attemptChain('attempt-1', 'a1', {
        time: '2026-09-16T10:00:00.000Z',
      }),
      ...attemptChain('attempt-2', 'a2', {
        time: '2026-09-16T11:00:00.000Z',
      }),
    ]);

    expect(obs).toHaveLength(2);
    expect(new Set(obs.map((entry) => entry.occasionId))).toEqual(
      new Set(['attempt-1', 'attempt-2']),
    );
  });

  test('múltiplos pareceres da MESMA attempt → uma ocasião só', () => {
    const chain = attemptChain('attempt-1', 'a1', {
      time: '2026-09-16T10:00:00.000Z',
    });

    const laterOpinion = verifierEvent(
      opinion({
        attemptId: 'attempt-1',
        evidenceBasis: {
          resultEventId: 'ev-result-a1',
          observedEventId: 'ev-git-a1',
          observedGateEventId: 'ev-gate-a1',
          coverage: { git: true, gates: true },
        },
      }),
      { id: 'ev-verifier-a1-b', occurredAt: new Date('2026-09-16T10:05:00.000Z') },
    );

    const obs = deriveVerifierOperationEvidenceFromEvents([
      ...chain,
      laterOpinion,
    ]);

    expect(obs).toHaveLength(1);
    expect(obs[0]?.occasionId).toBe('attempt-1');
  });

  test('duas ocasiões independentes derivam governance.verifier operational', () => {
    const projection = deriveCapabilityAssessmentsFromWorkHistory([
      ...attemptChain('attempt-1', 'a1', {
        time: '2026-09-16T10:00:00.000Z',
      }),
      ...attemptChain('attempt-2', 'a2', {
        time: '2026-09-16T11:00:00.000Z',
      }),
    ]);

    const entry = projection.assessments.find(
      (assessment) => assessment.capabilityId === 'governance.verifier',
    );

    expect(entry?.derivedMaturity).toBe('operational');
    expect(entry?.assessment.basis).toBe('reproduced_operation');
  });
});

describe('Supervised Self-Development attribution V1.1', () => {
  test('histórico vazio não prova supervised self-development', () => {
    expect(
      deriveSupervisedSelfDevelopmentEvidenceFromEvents([]),
    ).toEqual([]);
  });

  test('cadeia forte SEM decisão humana ainda não prova (aguardando supervisão)', () => {
    expect(
      deriveSupervisedSelfDevelopmentEvidenceFromEvents(
        attemptChain('attempt-1', 'a1'),
      ),
    ).toEqual([]);
  });

  test('cadeia forte + aceite humano prova supervised self-development (positiva)', () => {
    const obs = deriveSupervisedSelfDevelopmentEvidenceFromEvents([
      ...attemptChain('attempt-1', 'a1', {
        time: '2026-09-16T10:00:00.000Z',
      }),
      acceptEvent('a1', 'ev-result-a1', '2026-09-16T10:10:00.000Z'),
    ]);

    expect(obs).toHaveLength(1);
    expect(obs[0]).toMatchObject({
      capabilityId: 'agency.supervised-self-development',
      evidenceClass: 'verified_execution',
      outcome: 'positive',
      occasionId: 'attempt-1',
    });
  });

  test('changes_requested torna a ocasião NEGATIVA', () => {
    const obs = deriveSupervisedSelfDevelopmentEvidenceFromEvents([
      ...attemptChain('attempt-1', 'a1', {
        time: '2026-09-16T10:00:00.000Z',
      }),
      changesRequestedEvent('a1', 'ev-result-a1', '2026-09-16T10:10:00.000Z'),
    ]);

    expect(obs).toHaveLength(1);
    expect(obs[0]).toMatchObject({
      outcome: 'negative',
      occasionId: 'attempt-1',
    });
  });

  test('commit/edição sem cadeia verificada não prova, mesmo com aceite', () => {
    const events = [
      ...attemptChain('attempt-1', 'a1').filter(
        (event) => event.type !== 'verifier_opinion_recorded',
      ),
      acceptEvent('a1', 'ev-result-a1', '2026-09-16T10:10:00.000Z'),
    ];

    expect(
      deriveSupervisedSelfDevelopmentEvidenceFromEvents(events),
    ).toEqual([]);
  });

  test('verifier rejected quebra a cadeia forte → sem supervised self-dev mesmo com decisão', () => {
    const events = [
      ...attemptChain('attempt-1', 'a1', { verdict: 'rejected' }),
      changesRequestedEvent('a1', 'ev-result-a1', '2026-09-16T10:10:00.000Z'),
    ];

    expect(
      deriveSupervisedSelfDevelopmentEvidenceFromEvents(events),
    ).toEqual([]);
  });

  test('gate falho quebra a cadeia forte → sem supervised self-dev', () => {
    const events = [
      ...attemptChain('attempt-1', 'a1', { gatePassed: false }),
      acceptEvent('a1', 'ev-result-a1', '2026-09-16T10:10:00.000Z'),
    ];

    expect(
      deriveSupervisedSelfDevelopmentEvidenceFromEvents(events),
    ).toEqual([]);
  });

  test('duas provas da MESMA attempt não são reprodução', () => {
    // Um segundo aceite do MESMO resultado não cria nova ocasião.
    const obs = deriveSupervisedSelfDevelopmentEvidenceFromEvents([
      ...attemptChain('attempt-1', 'a1', {
        time: '2026-09-16T10:00:00.000Z',
      }),
      acceptEvent('a1', 'ev-result-a1', '2026-09-16T10:10:00.000Z'),
    ]);

    expect(new Set(obs.map((entry) => entry.occasionId))).toEqual(
      new Set(['attempt-1']),
    );
  });

  test('duas attempts aceitas → supervised self-development operational', () => {
    const projection = deriveCapabilityAssessmentsFromWorkHistory([
      ...attemptChain('attempt-1', 'a1', {
        time: '2026-09-16T10:00:00.000Z',
      }),
      acceptEvent('a1', 'ev-result-a1', '2026-09-16T10:10:00.000Z'),
      ...attemptChain('attempt-2', 'a2', {
        time: '2026-09-16T11:00:00.000Z',
      }),
      acceptEvent('a2', 'ev-result-a2', '2026-09-16T11:10:00.000Z'),
    ]);

    const entry = projection.assessments.find(
      (assessment) =>
        assessment.capabilityId === 'agency.supervised-self-development',
    );

    expect(entry?.derivedMaturity).toBe('operational');
    expect(entry?.assessment.basis).toBe('reproduced_operation');
  });

  test('aceite seguido de changes_requested em attempt posterior → degraded', () => {
    const projection = deriveCapabilityAssessmentsFromWorkHistory([
      ...attemptChain('attempt-1', 'a1', {
        time: '2026-09-16T10:00:00.000Z',
      }),
      acceptEvent('a1', 'ev-result-a1', '2026-09-16T10:10:00.000Z'),
      ...attemptChain('attempt-2', 'a2', {
        time: '2026-09-16T11:00:00.000Z',
      }),
      changesRequestedEvent('a2', 'ev-result-a2', '2026-09-16T11:10:00.000Z'),
    ]);

    const entry = projection.assessments.find(
      (assessment) =>
        assessment.capabilityId === 'agency.supervised-self-development',
    );

    expect(entry?.derivedMaturity).toBe('degraded');
    expect(entry?.assessment.basis).toBe('regression');
  });

  test('changes_requested depois de aceite na MESMA attempt → decisão mais recente vence (negativa)', () => {
    const obs = deriveSupervisedSelfDevelopmentEvidenceFromEvents([
      ...attemptChain('attempt-1', 'a1', {
        time: '2026-09-16T10:00:00.000Z',
      }),
      acceptEvent('a1', 'ev-result-a1', '2026-09-16T10:10:00.000Z'),
      changesRequestedEvent('a1', 'ev-result-a1', '2026-09-16T10:20:00.000Z'),
    ]);

    expect(obs).toHaveLength(1);
    expect(obs[0]?.outcome).toBe('negative');
  });

  test('provenance preservada: attempt, resultado, verifier e decisão', () => {
    const obs = deriveSupervisedSelfDevelopmentEvidenceFromEvents([
      ...attemptChain('attempt-1', 'a1', {
        time: '2026-09-16T10:00:00.000Z',
      }),
      acceptEvent('a1', 'ev-result-a1', '2026-09-16T10:10:00.000Z'),
    ]);

    const kinds = (obs[0]?.proofRefs ?? []).map((ref) => ref.kind);
    expect(kinds).toContain('attempt');
    expect(kinds).toContain('verifier');
    expect(
      obs[0]?.proofRefs.some((ref) => ref.ref === 'ev-accept-a1'),
    ).toBe(true);
  });
});