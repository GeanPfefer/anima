import {
  evaluateClassificationReadiness,
  validateWorkIntelligenceClassification,
  workComplexities,
  workPlanClarities,
  workReversibilities,
  workRisks,
  workUrgencies,
  type WorkIntelligenceClassificationV1,
} from './work-intelligence-classification';

const complete = (): WorkIntelligenceClassificationV1 => ({
  schemaVersion: 1,
  complexity: 'bounded',
  risk: 'moderate',
  reversibility: 'conditionally_reversible',
  planClarity: 'partial',
  urgency: 'normal',
  provenance: {
    kind: 'human_confirmed',
    classifiedAt: '2026-07-28T22:00:00.000Z',
    classifierId: 'human:primary',
  },
});

describe('INTEL-01 — classificação contratual V1', () => {
  test.each(workComplexities)('aceita complexidade %s', complexity => {
    expect(validateWorkIntelligenceClassification({ ...complete(), complexity })).toBeNull();
  });

  test.each(workRisks)('aceita risco %s', risk => {
    expect(validateWorkIntelligenceClassification({ ...complete(), risk })).toBeNull();
  });

  test.each(workReversibilities)('aceita reversibilidade %s', reversibility => {
    expect(validateWorkIntelligenceClassification({ ...complete(), reversibility })).toBeNull();
  });

  test.each(workPlanClarities)('aceita clareza do plano %s', planClarity => {
    expect(validateWorkIntelligenceClassification({ ...complete(), planClarity })).toBeNull();
  });

  test.each(workUrgencies)('aceita urgência %s', urgency => {
    expect(validateWorkIntelligenceClassification({ ...complete(), urgency })).toBeNull();
  });

  test.each([
    ['complexity', { complexity: 'unknown' }],
    ['risk', { risk: 'unknown' }],
    ['reversibility', { reversibility: 'unknown' }],
    ['planClarity', { planClarity: 'unknown' }],
    ['urgency', { urgency: 'unknown' }],
  ] as const)('preserva unknown em %s sem erro estrutural', (_axis, replacement) => {
    const classification = { ...complete(), ...replacement };
    expect(validateWorkIntelligenceClassification(classification)).toBeNull();
    expect(classification).toEqual(expect.objectContaining(replacement));
  });

  test('unknown torna a classificação incompleta numa ordem determinística', () => {
    const classification: WorkIntelligenceClassificationV1 = {
      ...complete(),
      complexity: 'unknown',
      reversibility: 'unknown',
      urgency: 'unknown',
    };
    expect(evaluateClassificationReadiness(classification)).toEqual({
      ready: false,
      reason: 'classification_incomplete',
      unknownAxes: ['complexity', 'reversibility', 'urgency'],
    });
  });

  test.each(['complexity', 'risk', 'reversibility', 'planClarity', 'urgency'] as const)(
    'recusa ausência do eixo %s em vez de convertê-la em unknown',
    axis => {
      const value: Record<string, unknown> = { ...complete() };
      delete value[axis];
      expect(validateWorkIntelligenceClassification(value)).not.toBeNull();
    },
  );

  test.each(['complexity', 'risk', 'reversibility', 'planClarity', 'urgency'] as const)(
    'recusa valor externo no eixo %s',
    axis => expect(validateWorkIntelligenceClassification({ ...complete(), [axis]: 'invented' })).not.toBeNull(),
  );

  test('recusa schemaVersion diferente de 1', () => {
    expect(validateWorkIntelligenceClassification({ ...complete(), schemaVersion: 2 })).not.toBeNull();
  });

  test('aceita human_confirmed estrito', () => {
    expect(validateWorkIntelligenceClassification(complete())).toBeNull();
  });

  test('aceita system_assessed com policyVersion', () => {
    expect(validateWorkIntelligenceClassification({
      ...complete(),
      provenance: {
        kind: 'system_assessed',
        classifiedAt: '2026-07-28T19:00:00-03:00',
        classifierId: 'classification-policy:primary',
        policyVersion: 'classification-v1',
      },
    })).toBeNull();
  });

  test('recusa system_assessed sem policyVersion', () => {
    expect(validateWorkIntelligenceClassification({
      ...complete(),
      provenance: {
        kind: 'system_assessed',
        classifiedAt: '2026-07-28T22:00:00.000Z',
        classifierId: 'classification-policy:primary',
      },
    })).not.toBeNull();
  });

  test('recusa policyVersion em human_confirmed', () => {
    expect(validateWorkIntelligenceClassification({
      ...complete(),
      provenance: { ...complete().provenance, policyVersion: 'classification-v1' },
    })).not.toBeNull();
  });

  test.each(['não-é-data', '2026-02-30T12:00:00Z', '', '2026-07-28'])(
    'recusa classifiedAt inválido: %s',
    classifiedAt => expect(validateWorkIntelligenceClassification({
      ...complete(), provenance: { ...complete().provenance, classifiedAt },
    })).not.toBeNull(),
  );

  test('recusa classifierId vazio', () => {
    expect(validateWorkIntelligenceClassification({
      ...complete(), provenance: { ...complete().provenance, classifierId: '  ' },
    })).not.toBeNull();
  });

  test('a mesma entrada produz sempre o mesmo resultado', () => {
    const classification = { ...complete(), risk: 'unknown' as const };
    expect(validateWorkIntelligenceClassification(classification))
      .toBe(validateWorkIntelligenceClassification(classification));
    expect(evaluateClassificationReadiness(classification))
      .toEqual(evaluateClassificationReadiness(classification));
  });

  test('o contrato recusa campos de roteamento, fornecedor, modelo, esforço, custo, cota e disponibilidade', () => {
    for (const key of ['executor', 'provider', 'model', 'effort', 'cost', 'quota', 'availability']) {
      expect(validateWorkIntelligenceClassification({ ...complete(), [key]: 'invented' })).not.toBeNull();
    }
  });

  test('avaliar prontidão não seleciona nem inicia executor', () => {
    expect(Object.keys(evaluateClassificationReadiness(complete())).sort()).toEqual(['ready', 'unknownAxes']);
    expect(Object.keys(evaluateClassificationReadiness({ ...complete(), risk: 'unknown' })).sort())
      .toEqual(['ready', 'reason', 'unknownAxes']);
  });

  test('classificação completa está pronta para uma futura etapa de roteamento', () => {
    expect(evaluateClassificationReadiness(complete())).toEqual({ ready: true, unknownAxes: [] });
  });
});
