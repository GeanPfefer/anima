import type { CapabilityProofRef } from './capability-map';
import {
  assessCapabilityMaturity,
  deriveCapabilityMaturity,
  REPRODUCTION_THRESHOLD,
  type CapabilityEvidenceClass,
  type CapabilityEvidenceObservation,
  type CapabilityEvidenceOutcome,
} from './capability-proof-engine';

const eventProof = (ref: string): CapabilityProofRef => ({
  kind: 'event',
  ref,
});

function evidence(
  id: string,
  evidenceClass: CapabilityEvidenceClass,
  outcome: CapabilityEvidenceOutcome,
  observedAt: string,
  capabilityId = 'agency.example',
  proofRefs: readonly CapabilityProofRef[] = [eventProof(id)],
  occasionId?: string,
): CapabilityEvidenceObservation {
  return {
    id,
    capabilityId,
    evidenceClass,
    outcome,
    observedAt,
    proofRefs,
    ...(occasionId !== undefined ? { occasionId } : {}),
  };
}

describe('Capability Proof Engine V0', () => {
  test('sem evidência forte preserva somente a maturidade da definição', () => {
    expect(
      deriveCapabilityMaturity({
        capabilityId: 'agency.example',
        definitionMaturity: 'specified',
        evidence: [],
      }),
    ).toBe('specified');
  });

  test('prova de implementação não vira prova de funcionamento', () => {
    const route: CapabilityProofRef = {
      kind: 'route',
      ref: 'apps/web/app/api/example',
    };

    const assessment = assessCapabilityMaturity({
      capabilityId: 'agency.example',
      definitionMaturity: 'specified',
      evidence: [
        evidence(
          'implementation-1',
          'implementation',
          'positive',
          '2026-09-16T12:00:00.000Z',
          'agency.example',
          [route],
        ),
      ],
    });

    expect(assessment.maturity).toBe('implemented');
    expect(assessment.basis).toBe('implementation');
  });

  test('execução verificada sustenta proven', () => {
    const assessment = assessCapabilityMaturity({
      capabilityId: 'agency.example',
      definitionMaturity: 'implemented',
      evidence: [
        evidence(
          'verified-1',
          'verified_execution',
          'positive',
          '2026-09-16T12:00:00.000Z',
        ),
      ],
    });

    expect(assessment).toMatchObject({
      maturity: 'proven',
      basis: 'verified_execution',
      decisiveEvidenceId: 'verified-1',
    });
  });

  test.each([
    ['reproduced_operation', 'operational'],
    ['autonomous_operation', 'autonomous'],
  ] as const)(
    '%s sustenta %s sem contar quantidade arbitrária de proofRefs',
    (evidenceClass, expectedMaturity) => {
      const assessment = assessCapabilityMaturity({
        capabilityId: 'agency.example',
        definitionMaturity: 'implemented',
        evidence: [
          evidence(
            'strong-1',
            evidenceClass,
            'positive',
            '2026-09-16T12:00:00.000Z',
          ),
        ],
      });

      expect(assessment.maturity).toBe(expectedMaturity);
      expect(assessment.basis).toBe(evidenceClass);
    },
  );

  test('evidência forte negativa posterior degrada uma capacidade previamente comprovada', () => {
    const assessment = assessCapabilityMaturity({
      capabilityId: 'agency.example',
      definitionMaturity: 'implemented',
      evidence: [
        evidence(
          'operational-ok',
          'reproduced_operation',
          'positive',
          '2026-09-16T10:00:00.000Z',
        ),
        evidence(
          'runtime-failed',
          'verified_execution',
          'negative',
          '2026-09-16T11:00:00.000Z',
        ),
      ],
    });

    expect(assessment).toMatchObject({
      maturity: 'degraded',
      basis: 'regression',
      decisiveEvidenceId: 'runtime-failed',
    });

    expect(assessment.supportingEvidenceIds).toContain(
      'operational-ok',
    );

    expect(assessment.contradictingEvidenceIds).toContain(
      'runtime-failed',
    );
  });

  test('nova prova posterior à regressão recupera somente o nível novamente demonstrado', () => {
    const assessment = assessCapabilityMaturity({
      capabilityId: 'agency.example',
      definitionMaturity: 'implemented',
      evidence: [
        evidence(
          'old-operational',
          'reproduced_operation',
          'positive',
          '2026-09-16T10:00:00.000Z',
        ),
        evidence(
          'regression',
          'verified_execution',
          'negative',
          '2026-09-16T11:00:00.000Z',
        ),
        evidence(
          'reproved',
          'verified_execution',
          'positive',
          '2026-09-16T12:00:00.000Z',
        ),
      ],
    });

    // A antiga prova operational não é reutilizada depois da regressão.
    expect(assessment).toMatchObject({
      maturity: 'proven',
      basis: 'verified_execution',
      decisiveEvidenceId: 'reproved',
    });

    expect(assessment.supportingEvidenceIds).toEqual([
      'reproved',
    ]);
  });

  test('ignora evidência pertencente a outra capability', () => {
    const maturity = deriveCapabilityMaturity({
      capabilityId: 'agency.example',
      definitionMaturity: 'specified',
      evidence: [
        evidence(
          'other-capability',
          'autonomous_operation',
          'positive',
          '2026-09-16T12:00:00.000Z',
          'agency.other',
        ),
      ],
    });

    expect(maturity).toBe('specified');
  });

  test('uma execução verificada única NÃO basta para operational (reprodução insuficiente)', () => {
    const assessment = assessCapabilityMaturity({
      capabilityId: 'agency.example',
      definitionMaturity: 'implemented',
      evidence: [
        evidence(
          'verified-1',
          'verified_execution',
          'positive',
          '2026-09-16T12:00:00.000Z',
          'agency.example',
          [eventProof('verified-1')],
          'attempt-1',
        ),
      ],
    });

    expect(assessment.maturity).toBe('proven');
    expect(assessment.basis).toBe('verified_execution');
  });

  test('execução verificada reproduzida em ocasiões distintas sustenta operational', () => {
    const assessment = assessCapabilityMaturity({
      capabilityId: 'agency.example',
      definitionMaturity: 'implemented',
      evidence: [
        evidence(
          'verified-1',
          'verified_execution',
          'positive',
          '2026-09-16T12:00:00.000Z',
          'agency.example',
          [eventProof('verified-1')],
          'attempt-1',
        ),
        evidence(
          'verified-2',
          'verified_execution',
          'positive',
          '2026-09-16T13:00:00.000Z',
          'agency.example',
          [eventProof('verified-2')],
          'attempt-2',
        ),
      ],
    });

    expect(assessment.maturity).toBe('operational');
    expect(assessment.basis).toBe('reproduced_operation');
    // O decisivo é a execução verificada mais recente da janela.
    expect(assessment.decisiveEvidenceId).toBe('verified-2');
    expect(assessment.supportingEvidenceIds).toEqual([
      'verified-1',
      'verified-2',
    ]);
  });

  test('REPRODUCTION_THRESHOLD é o mínimo semântico de reprodução (2)', () => {
    expect(REPRODUCTION_THRESHOLD).toBe(2);
  });

  test('duas provas verificadas da MESMA ocasião não contam como reprodução', () => {
    const assessment = assessCapabilityMaturity({
      capabilityId: 'agency.example',
      definitionMaturity: 'implemented',
      evidence: [
        evidence(
          'verified-a',
          'verified_execution',
          'positive',
          '2026-09-16T12:00:00.000Z',
          'agency.example',
          [eventProof('verified-a')],
          'attempt-unico',
        ),
        evidence(
          'verified-b',
          'verified_execution',
          'positive',
          '2026-09-16T12:30:00.000Z',
          'agency.example',
          [eventProof('verified-b')],
          'attempt-unico',
        ),
      ],
    });

    expect(assessment.maturity).toBe('proven');
    expect(assessment.basis).toBe('verified_execution');
  });

  test('execução verificada sem occasionId nunca dispara reprodução (fail-closed)', () => {
    const assessment = assessCapabilityMaturity({
      capabilityId: 'agency.example',
      definitionMaturity: 'implemented',
      evidence: [
        evidence(
          'verified-1',
          'verified_execution',
          'positive',
          '2026-09-16T12:00:00.000Z',
        ),
        evidence(
          'verified-2',
          'verified_execution',
          'positive',
          '2026-09-16T13:00:00.000Z',
        ),
      ],
    });

    expect(assessment.maturity).toBe('proven');
    expect(assessment.basis).toBe('verified_execution');
  });

  test('reprodução só conta ocasiões após a regressão (não reaproveita as antigas)', () => {
    const assessment = assessCapabilityMaturity({
      capabilityId: 'agency.example',
      definitionMaturity: 'implemented',
      evidence: [
        evidence(
          'ok-1',
          'verified_execution',
          'positive',
          '2026-09-16T10:00:00.000Z',
          'agency.example',
          [eventProof('ok-1')],
          'attempt-1',
        ),
        evidence(
          'ok-2',
          'verified_execution',
          'positive',
          '2026-09-16T10:30:00.000Z',
          'agency.example',
          [eventProof('ok-2')],
          'attempt-2',
        ),
        evidence(
          'regression',
          'verified_execution',
          'negative',
          '2026-09-16T11:00:00.000Z',
          'agency.example',
          [eventProof('regression')],
          'attempt-3',
        ),
        evidence(
          'reproved',
          'verified_execution',
          'positive',
          '2026-09-16T12:00:00.000Z',
          'agency.example',
          [eventProof('reproved')],
          'attempt-4',
        ),
      ],
    });

    // Só UMA ocasião positiva depois da regressão: re-prova, não re-opera.
    expect(assessment.maturity).toBe('proven');
    expect(assessment.basis).toBe('verified_execution');
    expect(assessment.supportingEvidenceIds).toEqual(['reproved']);
  });

  test('reprodução é determinística mesmo com evidência fora de ordem', () => {
    const observations = [
      evidence(
        'verified-2',
        'verified_execution',
        'positive',
        '2026-09-16T13:00:00.000Z',
        'agency.example',
        [eventProof('verified-2')],
        'attempt-2',
      ),
      evidence(
        'verified-1',
        'verified_execution',
        'positive',
        '2026-09-16T12:00:00.000Z',
        'agency.example',
        [eventProof('verified-1')],
        'attempt-1',
      ),
    ];

    expect(
      assessCapabilityMaturity({
        capabilityId: 'agency.example',
        definitionMaturity: 'implemented',
        evidence: observations,
      }),
    ).toEqual(
      assessCapabilityMaturity({
        capabilityId: 'agency.example',
        definitionMaturity: 'implemented',
        evidence: [...observations].reverse(),
      }),
    );
  });

  test('recusa timestamp inválido porque recência decide regressão e recuperação', () => {
    expect(() =>
      deriveCapabilityMaturity({
        capabilityId: 'agency.example',
        definitionMaturity: 'implemented',
        evidence: [
          evidence(
            'bad-time',
            'verified_execution',
            'positive',
            'não-é-data',
          ),
        ],
      }),
    ).toThrow(
      'invalid_capability_evidence_timestamp:bad-time',
    );
  });
});