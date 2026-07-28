import {
  evaluateAutonomousEligibility,
  evaluateAutonomousIntelligenceEligibility,
  evaluateClassificationReadiness,
  type WorkIntelligenceClassificationV1,
  type WorkItem,
} from '.';

const item = (state: WorkItem['state'] = 'approved'): WorkItem => ({
  id: 'item-1', userId: 'user-1', sourceMessageId: 'message-1', state,
  impactLevel: 'low', capability: 'programming', originalRequest: 'corrigir',
  proposalVersion: 1, createdAt: new Date(0), updatedAt: new Date(0),
  intent: { execution_spec: {
    schema_version: 1, target: { kind: 'project', reference: 'anima' },
    permissions: [], validation_criteria: [{ label: 'tests' }],
    limits: { max_attempts: 1 },
  } },
  proposal: { schemaVersion: 1, data: {
    summary: 's', objective: 'corrigir', includedScope: ['a.py'],
    excludedScope: ['deploy'], expectedEffects: ['tests'], risks: [],
  } },
});
const complete: WorkIntelligenceClassificationV1 = {
  schemaVersion: 1, complexity: 'bounded', risk: 'low',
  reversibility: 'reversible', planClarity: 'clear', urgency: 'normal',
  provenance: {
    kind: 'human_confirmed', classifiedAt: '2026-07-28T12:00:00Z',
    classifierId: 'user:opaque',
  },
};
const compose = (
  workItem: WorkItem,
  classification: WorkIntelligenceClassificationV1 | null,
) => evaluateAutonomousIntelligenceEligibility({
  auto01: evaluateAutonomousEligibility(workItem),
  currentClassification: classification,
  readiness: classification === null ? null : evaluateClassificationReadiness(classification),
});

describe('gate autônomo do INTEL-01', () => {
  test('AUTO-01 elegível e classificação completa tornam o item elegível', () => {
    expect(compose(item(), complete)).toMatchObject({
      eligible: true, classification: complete,
      spec: { target: { reference: 'anima' } },
    });
  });

  test('classificação ausente bloqueia com razão tipada', () => {
    expect(compose(item(), null)).toEqual({
      eligible: false,
      reason: 'work_intelligence_classification_missing',
      unknownAxes: [],
    });
  });

  test('qualquer unknown bloqueia e preserva os eixos na ordem canônica', () => {
    const incomplete = {
      ...complete, complexity: 'unknown', risk: 'unknown', urgency: 'unknown',
    } as const;
    expect(compose(item(), incomplete)).toEqual({
      eligible: false,
      reason: 'work_intelligence_classification_incomplete',
      unknownAxes: ['complexity', 'risk', 'urgency'],
    });
  });

  test('bloqueio anterior do AUTO-01 prevalece sobre classificação ausente', () => {
    const result = compose(item('proposed'), null);
    expect(result).toMatchObject({ eligible: false, reason: 'auto_01_ineligible' });
    expect(result.eligible ? [] : result.reason === 'auto_01_ineligible'
      ? result.auto01.gaps.map(gap => gap.code) : []).toEqual([
      'proposal_not_approved', 'human_decision_pending',
    ]);
  });

  test('classificação completa não corrige bloqueio do AUTO-01', () => {
    expect(compose(item('blocked'), complete)).toMatchObject({
      eligible: false,
      reason: 'auto_01_ineligible',
      auto01: { gaps: [{ code: 'work_blocked_unresolved' }] },
    });
  });

  test('a mesma entrada produz o mesmo resultado', () => {
    expect(compose(item(), complete)).toEqual(compose(item(), complete));
  });

  test('entrada inválida falha fechado como classificação vigente ausente', () => {
    expect(compose(item(), { ...complete, provider: 'externo' } as never)).toMatchObject({
      eligible: false,
      reason: 'work_intelligence_classification_missing',
    });
  });

  test('o resultado não contém seleção de executor, provedor, modelo ou esforço', () => {
    const serialized = JSON.stringify(compose(item(), complete));
    expect(serialized).not.toMatch(/executor|provider|model|effort/i);
  });
});
