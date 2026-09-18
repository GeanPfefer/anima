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
import { REPRODUCTION_THRESHOLD } from './capability-proof-engine';
import {
  assessCapabilitiesFromEvidence,
  type CapabilityHistoryAssessment,
} from './capability-proof-assessment';
import { explainCapabilityAssessment } from './capability-assessment-explanation';

const CAPABILITY_ID = 'agency.example';

function capability(
  maturity: CapabilityMaturity = 'implemented',
): Capability {
  return {
    id: CAPABILITY_ID,
    name: CAPABILITY_ID,
    description: 'fixture',
    domain: 'agency',
    maturity,
    dependsOn: [],
  };
}

function observation(
  id: string,
  evidenceClass: CapabilityEvidenceClass,
  outcome: CapabilityEvidenceOutcome,
  observedAt: string,
  occasionId?: string,
  proofRefs: readonly CapabilityProofRef[] = [{ kind: 'event', ref: id }],
): CapabilityEvidenceObservation {
  return {
    id,
    capabilityId: CAPABILITY_ID,
    evidenceClass,
    outcome,
    observedAt,
    proofRefs,
    ...(occasionId !== undefined ? { occasionId } : {}),
  };
}

function entryFor(
  evidence: readonly CapabilityEvidenceObservation[],
  declaredMaturity: CapabilityMaturity = 'implemented',
): CapabilityHistoryAssessment {
  const projection = assessCapabilitiesFromEvidence(
    [capability(declaredMaturity)],
    evidence,
  );

  const entry = projection.assessments[0];
  if (!entry) {
    throw new Error('fixture sem assessment derivado');
  }

  return entry;
}

describe('explainCapabilityAssessment', () => {
  test('execução verificada única: comprovada e aponta reprodução como próxima prova', () => {
    const entry = entryFor([
      observation(
        'verified-1',
        'verified_execution',
        'positive',
        '2026-09-16T12:00:00.000Z',
        'attempt-1',
        [
          { kind: 'attempt', ref: 'attempt-1' },
          { kind: 'event', ref: 'ev-1' },
        ],
      ),
    ]);

    const explanation = explainCapabilityAssessment(entry);

    expect(entry.derivedMaturity).toBe('proven');
    expect(explanation.basis).toBe('verified_execution');
    expect(explanation.basisLabel).toBe('execução verificada');
    expect(explanation.distinctOccasions).toBe(1);
    expect(explanation.rationale).toContain('Comprovada por execução verificada');
    expect(explanation.nextProof).toContain(
      `${REPRODUCTION_THRESHOLD} ocasiões independentes`,
    );

    // Provenance: as provas decisivas são exatamente as da observação decisiva.
    expect(explanation.decisiveProofRefs).toEqual([
      { kind: 'attempt', ref: 'attempt-1' },
      { kind: 'event', ref: 'ev-1' },
    ]);
    expect(explanation.contradictingProofRefs).toEqual([]);
  });

  test('reprodução em ocasiões distintas: operacional com contagem de ocasiões', () => {
    const entry = entryFor([
      observation(
        'verified-1',
        'verified_execution',
        'positive',
        '2026-09-16T12:00:00.000Z',
        'attempt-1',
      ),
      observation(
        'verified-2',
        'verified_execution',
        'positive',
        '2026-09-16T13:00:00.000Z',
        'attempt-2',
      ),
    ]);

    const explanation = explainCapabilityAssessment(entry);

    expect(entry.derivedMaturity).toBe('operational');
    expect(explanation.basis).toBe('reproduced_operation');
    expect(explanation.basisLabel).toBe('reprodução');
    expect(explanation.distinctOccasions).toBe(2);
    expect(explanation.rationale).toContain('reproduzida em 2 ocasiões');
    expect(explanation.nextProof).toContain('autônoma');
  });

  test('regressão: descreve a queda e as provas que contradizem', () => {
    const entry = entryFor(
      [
        observation(
          'ok',
          'verified_execution',
          'positive',
          '2026-09-16T12:00:00.000Z',
          'attempt-1',
        ),
        observation(
          'broke',
          'verified_execution',
          'negative',
          '2026-09-16T13:00:00.000Z',
          'attempt-2',
          [{ kind: 'verifier', ref: 'verifier-broke' }],
        ),
      ],
      'proven',
    );

    const explanation = explainCapabilityAssessment(entry);

    expect(entry.derivedMaturity).toBe('degraded');
    expect(explanation.basis).toBe('regression');
    expect(explanation.basisLabel).toBe('regressão');
    expect(explanation.rationale).toContain('Regredida');
    expect(explanation.contradictingProofRefs).toEqual([
      { kind: 'verifier', ref: 'verifier-broke' },
    ]);
    expect(explanation.nextProof).toContain('posterior à regressão');
  });

  test('só implementação positiva: descreve implementação sem comprovação', () => {
    const entry = entryFor([
      observation(
        'impl',
        'implementation',
        'positive',
        '2026-09-16T12:00:00.000Z',
        undefined,
        [{ kind: 'route', ref: 'apps/web/app/api/example' }],
      ),
    ]);

    const explanation = explainCapabilityAssessment(entry);

    expect(entry.derivedMaturity).toBe('implemented');
    expect(explanation.basis).toBe('implementation');
    expect(explanation.rationale).toContain('Implementação observada');
    expect(explanation.nextProof).toContain('execução verificada');
  });

  test('somente evidência inconclusiva: nível fica na definição, sem inventar prova', () => {
    const entry = entryFor([
      observation(
        'incon',
        'verified_execution',
        'inconclusive',
        '2026-09-16T12:00:00.000Z',
        'attempt-1',
      ),
    ]);

    const explanation = explainCapabilityAssessment(entry);

    expect(explanation.basis).toBe('definition');
    expect(explanation.decisiveProofRefs).toEqual([]);
    expect(explanation.rationale).toContain('definição do registry');
  });

  test('mesma prova não é contada duas vezes nas contradições', () => {
    const shared: CapabilityProofRef = { kind: 'event', ref: 'ev-shared' };

    const entry = entryFor(
      [
        observation(
          'ok',
          'verified_execution',
          'positive',
          '2026-09-16T12:00:00.000Z',
          'attempt-1',
        ),
        observation(
          'broke-1',
          'verified_execution',
          'negative',
          '2026-09-16T13:00:00.000Z',
          'attempt-2',
          [shared],
        ),
        observation(
          'broke-2',
          'verified_execution',
          'negative',
          '2026-09-16T13:30:00.000Z',
          'attempt-3',
          [shared],
        ),
      ],
      'proven',
    );

    const explanation = explainCapabilityAssessment(entry);

    expect(explanation.contradictingProofRefs).toEqual([shared]);
  });

  test('é determinística para a mesma entrada', () => {
    const evidence = [
      observation(
        'verified-1',
        'verified_execution',
        'positive',
        '2026-09-16T12:00:00.000Z',
        'attempt-1',
      ),
      observation(
        'verified-2',
        'verified_execution',
        'positive',
        '2026-09-16T13:00:00.000Z',
        'attempt-2',
      ),
    ];

    const entry = entryFor(evidence);

    expect(explainCapabilityAssessment(entry)).toEqual(
      explainCapabilityAssessment(entry),
    );
  });
});
