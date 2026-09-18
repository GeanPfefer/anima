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

describe('explainCapabilityAssessment — linguagem de domínio (V1.1)', () => {
  function entryForCapability(
    capabilityId: string,
    domain: Capability['domain'],
    evidence: readonly CapabilityEvidenceObservation[],
    declaredMaturity: CapabilityMaturity = 'proven',
  ): CapabilityHistoryAssessment {
    const cap: Capability = {
      id: capabilityId,
      name: capabilityId,
      description: 'fixture',
      domain,
      maturity: declaredMaturity,
      dependsOn: [],
    };

    const projection = assessCapabilitiesFromEvidence([cap], evidence);
    const entry = projection.assessments[0];
    if (!entry) throw new Error('fixture sem assessment');
    return entry;
  }

  function obsFor(
    capabilityId: string,
    id: string,
    occasionId: string,
    observedAt: string,
    outcome: CapabilityEvidenceOutcome = 'positive',
  ): CapabilityEvidenceObservation {
    return {
      id,
      capabilityId,
      evidenceClass: 'verified_execution',
      outcome,
      observedAt,
      occasionId,
      proofRefs: [{ kind: 'attempt', ref: occasionId }],
    };
  }

  test('governance.verifier comprovada usa linguagem do verifier', () => {
    const entry = entryForCapability('governance.verifier', 'governance', [
      obsFor('governance.verifier', 'v1', 'attempt-1', '2026-09-16T12:00:00.000Z'),
    ]);

    const explanation = explainCapabilityAssessment(entry);
    expect(entry.derivedMaturity).toBe('proven');
    expect(explanation.rationale).toContain('o verifier analisou fatos observados');
  });

  test('governance.verifier operacional descreve reprodução da verificação', () => {
    const entry = entryForCapability('governance.verifier', 'governance', [
      obsFor('governance.verifier', 'v1', 'attempt-1', '2026-09-16T12:00:00.000Z'),
      obsFor('governance.verifier', 'v2', 'attempt-2', '2026-09-16T13:00:00.000Z'),
    ]);

    const explanation = explainCapabilityAssessment(entry);
    expect(entry.derivedMaturity).toBe('operational');
    expect(explanation.rationale).toContain(
      'verificação com cobertura independente reproduzida em 2 ocasiões',
    );
  });

  test('supervised self-development comprovada usa linguagem de auto-modificação supervisionada', () => {
    const entry = entryForCapability('agency.supervised-self-development', 'agency', [
      obsFor(
        'agency.supervised-self-development',
        's1',
        'attempt-1',
        '2026-09-16T12:00:00.000Z',
      ),
    ]);

    const explanation = explainCapabilityAssessment(entry);
    expect(explanation.rationale).toContain('o ANIMA modificou o próprio código');
  });

  test('supervised self-development regredida cita o pedido de mudanças da revisão', () => {
    const entry = entryForCapability(
      'agency.supervised-self-development',
      'agency',
      [
        obsFor(
          'agency.supervised-self-development',
          's1',
          'attempt-1',
          '2026-09-16T12:00:00.000Z',
          'positive',
        ),
        obsFor(
          'agency.supervised-self-development',
          's2',
          'attempt-2',
          '2026-09-16T13:00:00.000Z',
          'negative',
        ),
      ],
    );

    const explanation = explainCapabilityAssessment(entry);
    expect(entry.derivedMaturity).toBe('degraded');
    expect(explanation.rationale).toContain('a revisão humana pediu mudanças');
  });
});
