import type { Json } from '@anima/types';
import {
  buildHostObservedGateEvidence,
  type WorkEvent,
} from './work-orchestration';
import type {
  Capability,
  CapabilityMaturity,
  CapabilityProofRef,
} from './capability-map';
import type {
  CapabilityEvidenceClass,
  CapabilityEvidenceObservation,
  CapabilityEvidenceOutcome,
} from './capability-proof-engine';
import {
  assessCapabilitiesFromEvidence,
  capabilityDefinitionMaturity,
  deriveCapabilityAssessmentsFromWorkHistory,
} from './capability-proof-assessment';

function capability(
  id: string,
  maturity: CapabilityMaturity = 'implemented',
): Capability {
  return {
    id,
    name: id,
    description: 'fixture',
    domain: 'agency',
    maturity,
    dependsOn: [],
  };
}

const proof = (
  ref: string,
): CapabilityProofRef => ({
  kind: 'event',
  ref,
});

function evidence(
  id: string,
  capabilityId: string,
  evidenceClass: CapabilityEvidenceClass,
  outcome: CapabilityEvidenceOutcome,
  observedAt: string,
): CapabilityEvidenceObservation {
  return {
    id,
    capabilityId,
    evidenceClass,
    outcome,
    observedAt,
    proofRefs: [proof(id)],
  };
}

describe('capabilityDefinitionMaturity', () => {
  test.each([
    ['projected', 'projected'],
    ['specified', 'specified'],
    ['implemented', 'implemented'],
    ['proven', 'implemented'],
    ['operational', 'implemented'],
    ['autonomous', 'implemented'],
    ['degraded', 'implemented'],
  ] satisfies readonly [
    CapabilityMaturity,
    ReturnType<typeof capabilityDefinitionMaturity>,
  ][])(
    '%s vira baseline %s',
    (declared, expected) => {
      expect(
        capabilityDefinitionMaturity(declared),
      ).toBe(expected);
    },
  );
});

describe('assessCapabilitiesFromEvidence', () => {
  test('maturidade forte declarada não se auto-prova', () => {
    const projection =
      assessCapabilitiesFromEvidence(
        [
          capability(
            'agency.example',
            'operational',
          ),
        ],
        [],
      );

    /**
     * Sem evidência dinâmica, V0 não reavalia a capability.
     * Logo não existe conclusão "operational porque o registry disse operational".
     */
    expect(projection).toEqual({
      assessments: [],
      issues: [],
    });
  });

  test('uma execução verificada rederiva proven mesmo quando o registry dizia operational', () => {
    const projection =
      assessCapabilitiesFromEvidence(
        [
          capability(
            'agency.example',
            'operational',
          ),
        ],
        [
          evidence(
            'verified-1',
            'agency.example',
            'verified_execution',
            'positive',
            '2026-09-16T12:00:00.000Z',
          ),
        ],
      );

    expect(projection.issues).toEqual([]);
    expect(projection.assessments).toHaveLength(1);

    expect(
      projection.assessments[0],
    ).toMatchObject({
      capabilityId: 'agency.example',
      declaredMaturity: 'operational',
      definitionMaturity: 'implemented',
      derivedMaturity: 'proven',
      assessment: {
        maturity: 'proven',
        basis: 'verified_execution',
        decisiveEvidenceId: 'verified-1',
      },
    });
  });

  test('evidência autônoma pode derivar autonomous sem herdar o valor declarado', () => {
    const projection =
      assessCapabilitiesFromEvidence(
        [
          capability(
            'agency.example',
            'implemented',
          ),
        ],
        [
          evidence(
            'autonomous-1',
            'agency.example',
            'autonomous_operation',
            'positive',
            '2026-09-16T12:00:00.000Z',
          ),
        ],
      );

    expect(
      projection.assessments[0]?.derivedMaturity,
    ).toBe('autonomous');
  });

  test('regressão posterior é preservada e deriva degraded', () => {
    const projection =
      assessCapabilitiesFromEvidence(
        [
          capability(
            'agency.example',
            'proven',
          ),
        ],
        [
          evidence(
            'verified-ok',
            'agency.example',
            'verified_execution',
            'positive',
            '2026-09-16T12:00:00.000Z',
          ),
          evidence(
            'verified-broke',
            'agency.example',
            'verified_execution',
            'negative',
            '2026-09-16T13:00:00.000Z',
          ),
        ],
      );

    expect(
      projection.assessments[0],
    ).toMatchObject({
      declaredMaturity: 'proven',
      definitionMaturity: 'implemented',
      derivedMaturity: 'degraded',
      assessment: {
        basis: 'regression',
        decisiveEvidenceId: 'verified-broke',
      },
    });
  });

  test('evidência de capability inexistente vira issue e nunca cria capability fantasma', () => {
    const projection =
      assessCapabilitiesFromEvidence(
        [
          capability('agency.known'),
        ],
        [
          evidence(
            'ghost-proof',
            'agency.ghost',
            'verified_execution',
            'positive',
            '2026-09-16T12:00:00.000Z',
          ),
        ],
      );

    expect(projection.assessments).toEqual([]);
    expect(projection.issues).toEqual([
      expect.objectContaining({
        code: 'evidence_for_unknown_capability',
        capabilityId: 'agency.ghost',
      }),
    ]);
  });

  test('definição duplicada vira issue explícita e primeira definição vence deterministicamente', () => {
    const projection =
      assessCapabilitiesFromEvidence(
        [
          capability(
            'agency.example',
            'implemented',
          ),
          capability(
            'agency.example',
            'operational',
          ),
        ],
        [
          evidence(
            'verified-1',
            'agency.example',
            'verified_execution',
            'positive',
            '2026-09-16T12:00:00.000Z',
          ),
        ],
      );

    expect(projection.issues).toEqual([
      expect.objectContaining({
        code: 'duplicate_capability_definition',
        capabilityId: 'agency.example',
      }),
    ]);

    expect(
      projection.assessments[0],
    ).toMatchObject({
      declaredMaturity: 'implemented',
      derivedMaturity: 'proven',
    });
  });

  test('preserva ordem do registry, não ordem aleatória da evidência', () => {
    const projection =
      assessCapabilitiesFromEvidence(
        [
          capability('agency.a'),
          capability('agency.b'),
        ],
        [
          evidence(
            'b',
            'agency.b',
            'verified_execution',
            'positive',
            '2026-09-16T12:00:00.000Z',
          ),
          evidence(
            'a',
            'agency.a',
            'verified_execution',
            'positive',
            '2026-09-16T12:01:00.000Z',
          ),
        ],
      );

    expect(
      projection.assessments.map(
        (entry) => entry.capabilityId,
      ),
    ).toEqual([
      'agency.a',
      'agency.b',
    ]);
  });
});

describe('deriveCapabilityAssessmentsFromWorkHistory', () => {
  function gateEvent(): WorkEvent {
    const built =
      buildHostObservedGateEvidence({
        workItemId: 'work-1',
        attemptId: 'attempt-1',
        approvedProposalVersion: 1,
        gates: [
          {
            label: 'unit',
            command: 'npm test',
            exitCode: 0,
            durationMs: 250,
            timedOut: false,
            cancelled: false,
          },
        ],
        observedAt:
          '2026-09-16T14:00:00.000Z',
      });

    if (!built.ok) {
      throw new Error(
        built.explanation,
      );
    }

    return {
      id: 'event-gate-1',
      workItemId: 'work-1',
      type: 'host_observed_gate_evidence_recorded',
      author: 'system',
      proposalVersion: 1,
      payload: {
        schema_version: 1,
        data: {
          work_item_id: 'work-1',
          attempt_id: 'attempt-1',
          approved_proposal_version: 1,
          origin: 'host',
          coverage: {
            gates: true,
          },
          evidence:
            built.value as unknown as Json,
        },
      } as unknown as Json,
      occurredAt:
        new Date(
          '2026-09-16T14:00:00.000Z',
        ),
    };
  }

  test('faz wiring end-to-end de WorkEvent até maturity derivada', () => {
    const projection =
      deriveCapabilityAssessmentsFromWorkHistory(
        [gateEvent()],
      );

    expect(projection.issues).toEqual([]);
    expect(projection.assessments).toHaveLength(1);

    expect(
      projection.assessments[0],
    ).toMatchObject({
      capabilityId: 'agency.run-tests',

      /**
       * O registry atual declara proven, mas a prova dinâmica precisa
       * rederivar isso a partir de implemented.
       */
      declaredMaturity: 'proven',
      definitionMaturity: 'implemented',
      derivedMaturity: 'proven',

      assessment: {
        maturity: 'proven',
        basis: 'verified_execution',
      },
    });

    expect(
      projection.assessments[0]?.evidence[0],
    ).toMatchObject({
      capabilityId: 'agency.run-tests',
      evidenceClass: 'verified_execution',
      outcome: 'positive',
    });
  });

  test('histórico sem fatos reconhecidos não inventa assessments', () => {
    const unrelated: WorkEvent = {
      id: 'other',
      workItemId: 'work-1',
      type: 'result_submitted',
      author: 'user',
      proposalVersion: 1,
      payload: {} as Json,
      occurredAt:
        new Date(
          '2026-09-16T14:00:00.000Z',
        ),
    };

    expect(
      deriveCapabilityAssessmentsFromWorkHistory(
        [unrelated],
      ),
    ).toEqual({
      assessments: [],
      issues: [],
    });
  });

  test('resultado é determinístico para o mesmo histórico', () => {
    const events = [gateEvent()];

    expect(
      deriveCapabilityAssessmentsFromWorkHistory(
        events,
      ),
    ).toEqual(
      deriveCapabilityAssessmentsFromWorkHistory(
        events,
      ),
    );
  });
});