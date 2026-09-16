import type { CapabilityProofRef } from './capability-map';
import {
  assessCapabilityMaturity,
  deriveCapabilityMaturity,
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
): CapabilityEvidenceObservation {
  return {
    id,
    capabilityId,
    evidenceClass,
    outcome,
    observedAt,
    proofRefs,
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