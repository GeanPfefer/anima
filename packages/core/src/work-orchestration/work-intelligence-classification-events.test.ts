import {
  reconstructCurrentWorkIntelligenceClassification,
  type WorkIntelligenceClassificationEventV1,
} from './work-intelligence-classification-events';
import type { WorkIntelligenceClassificationV1 } from './work-intelligence-classification';

const human: WorkIntelligenceClassificationV1 = {
  schemaVersion: 1,
  complexity: 'bounded',
  risk: 'low',
  reversibility: 'reversible',
  planClarity: 'clear',
  urgency: 'normal',
  provenance: {
    kind: 'human_confirmed',
    classifiedAt: '2026-07-28T12:00:00Z',
    classifierId: 'user:opaque',
  },
};
const system: WorkIntelligenceClassificationV1 = {
  schemaVersion: 1,
  complexity: 'complex',
  risk: 'high',
  reversibility: 'conditionally_reversible',
  planClarity: 'partial',
  urgency: 'time_sensitive',
  provenance: {
    kind: 'system_assessed',
    classifiedAt: '2026-07-28T12:05:00Z',
    classifierId: 'system:opaque',
    policyVersion: 'policy-v1',
  },
};

const event = (
  overrides: Partial<WorkIntelligenceClassificationEventV1> = {},
): WorkIntelligenceClassificationEventV1 => ({
  schemaVersion: 1,
  eventId: 'event-1',
  sequence: 10,
  workItemId: 'item-1',
  approvedProposalVersion: 1,
  classificationRevision: 1,
  previousClassificationRevision: 0,
  supersedesEventId: null,
  classification: human,
  ...overrides,
});

describe('reconstructCurrentWorkIntelligenceClassification', () => {
  it('reconstrói a primeira classificação da versão corrente', () => {
    expect(reconstructCurrentWorkIntelligenceClassification({
      workItemId: 'item-1', currentProposalVersion: 1, events: [event()],
    })).toEqual({
      ok: true,
      current: {
        eventId: 'event-1',
        sequence: 10,
        proposalVersion: 1,
        classificationRevision: 1,
        classification: human,
        readiness: { ready: true, unknownAxes: [] },
      },
    });
  });

  it('escolhe a reclassificação e preserva a supersessão', () => {
    const second = event({
      eventId: 'event-2',
      sequence: 20,
      classificationRevision: 2,
      previousClassificationRevision: 1,
      supersedesEventId: 'event-1',
      classification: system,
    });
    const result = reconstructCurrentWorkIntelligenceClassification({
      workItemId: 'item-1', currentProposalVersion: 1, events: [event(), second],
    });
    expect(result).toMatchObject({
      ok: true,
      current: { eventId: 'event-2', classificationRevision: 2, classification: system },
    });
  });

  it('é determinístico com eventos fora de ordem e em replay da projeção', () => {
    const second = event({
      eventId: 'event-2',
      sequence: 20,
      classificationRevision: 2,
      previousClassificationRevision: 1,
      supersedesEventId: 'event-1',
      classification: system,
    });
    const input = {
      workItemId: 'item-1',
      currentProposalVersion: 1,
      events: [second, event()],
    };
    const firstRun = reconstructCurrentWorkIntelligenceClassification(input);
    expect(reconstructCurrentWorkIntelligenceClassification(input)).toEqual(firstRun);
    expect(firstRun).toMatchObject({ ok: true, current: { eventId: 'event-2' } });
  });

  it('não reutiliza classificação de uma versão anterior da proposta', () => {
    expect(reconstructCurrentWorkIntelligenceClassification({
      workItemId: 'item-1', currentProposalVersion: 2, events: [event()],
    })).toEqual({ ok: true, current: null });
  });

  it('mantém cadeias independentes e reinicia a revisão por proposta', () => {
    const versionTwo = event({
      eventId: 'event-v2-1',
      sequence: 30,
      approvedProposalVersion: 2,
      classification: system,
    });
    expect(reconstructCurrentWorkIntelligenceClassification({
      workItemId: 'item-1', currentProposalVersion: 2, events: [versionTwo, event()],
    })).toMatchObject({
      ok: true,
      current: { eventId: 'event-v2-1', proposalVersion: 2, classificationRevision: 1 },
    });
  });

  it('preserva unknown e informa que ainda não está pronta para futuro roteamento', () => {
    const incomplete = event({
      classification: { ...human, risk: 'unknown', planClarity: 'unknown' },
    });
    expect(reconstructCurrentWorkIntelligenceClassification({
      workItemId: 'item-1', currentProposalVersion: 1, events: [incomplete],
    })).toMatchObject({
      ok: true,
      current: {
        readiness: {
          ready: false,
          reason: 'classification_incomplete',
          unknownAxes: ['risk', 'planClarity'],
        },
      },
    });
  });

  it.each([
    ['evento com classificação inválida', event({ classification: { ...human, risk: 'invented' } as never })],
    ['evento de outro item', event({ workItemId: 'item-2' })],
    ['revisão com lacuna', event({ classificationRevision: 2 })],
    ['revisão sem predecessor declarado', event({ previousClassificationRevision: 1 })],
    ['primeiro evento que supersede outro', event({ supersedesEventId: 'ghost' })],
  ])('falha fechado para %s', (_label, invalid) => {
    expect(reconstructCurrentWorkIntelligenceClassification({
      workItemId: 'item-1', currentProposalVersion: 1, events: [invalid],
    })).toMatchObject({ ok: false });
  });

  it('recusa bifurcação da cadeia mesmo que a sequência seja posterior', () => {
    const fork = event({ eventId: 'event-fork', sequence: 20 });
    expect(reconstructCurrentWorkIntelligenceClassification({
      workItemId: 'item-1', currentProposalVersion: 1, events: [event(), fork],
    })).toMatchObject({ ok: false });
  });

  it('recusa sequência persistida duplicada', () => {
    const second = event({
      eventId: 'event-2',
      classificationRevision: 2,
      previousClassificationRevision: 1,
      supersedesEventId: 'event-1',
    });
    expect(reconstructCurrentWorkIntelligenceClassification({
      workItemId: 'item-1', currentProposalVersion: 1, events: [event(), second],
    })).toMatchObject({ ok: false });
  });
});
