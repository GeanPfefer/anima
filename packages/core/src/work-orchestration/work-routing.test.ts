import type { WorkCapability } from './types';
import type { WorkIntelligenceClassificationV1 } from './work-intelligence-classification';
import {
  requiredEffortFor,
  selectWorkRoute,
  validateWorkRoutingCandidate,
  type WorkRoutingCandidateV1,
} from './work-routing';

const classification = (
  overrides: Partial<WorkIntelligenceClassificationV1> = {},
): WorkIntelligenceClassificationV1 => ({
  schemaVersion: 1,
  complexity: 'routine',
  risk: 'low',
  reversibility: 'reversible',
  planClarity: 'clear',
  urgency: 'normal',
  provenance: {
    kind: 'human_confirmed',
    classifiedAt: '2026-07-28T18:00:00-03:00',
    classifierId: 'user:owner',
  },
  ...overrides,
});

const route = (
  routeId: string,
  effort: WorkRoutingCandidateV1['effort'],
  overrides: Partial<WorkRoutingCandidateV1> = {},
): WorkRoutingCandidateV1 => ({
  schemaVersion: 1,
  routeId,
  executorId: `executor:${routeId}`,
  providerRef: `provider:${routeId}`,
  modelRef: `model:${routeId}`,
  effort,
  capabilities: ['programming'],
  availability: 'available',
  latency: 'normal',
  priority: 10,
  ...overrides,
});

describe('política V0 de roteamento de inteligência', () => {
  test('mapeia somente o caso estritamente simples para light', () => {
    expect(requiredEffortFor(classification())).toBe('light');
    expect(requiredEffortFor(classification({ complexity: 'bounded' }))).toBe('standard');
    expect(requiredEffortFor(classification({ risk: 'moderate' }))).toBe('standard');
    expect(requiredEffortFor(classification({ reversibility: 'conditionally_reversible' }))).toBe('standard');
    expect(requiredEffortFor(classification({ planClarity: 'partial' }))).toBe('standard');
  });

  test.each([
    { complexity: 'complex' },
    { risk: 'high' },
    { risk: 'critical' },
    { reversibility: 'irreversible' },
    { planClarity: 'unclear' },
  ] as const)('qualquer fator forte exige strong: %o', override => {
    expect(requiredEffortFor(classification(override))).toBe('strong');
  });

  test('escolhe a menor capacidade suficiente e explica todas as recusas', () => {
    const result = selectWorkRoute({
      capability: 'programming',
      classification: classification({ complexity: 'bounded' }),
      candidates: [
        route('light', 'light'),
        route('standard', 'standard'),
        route('strong', 'strong'),
        route('offline', 'standard', { availability: 'unavailable' }),
        route('wrong-capability', 'standard', { capabilities: ['research'] }),
      ],
    });
    expect(result).toMatchObject({
      outcome: 'selected',
      decision: {
        requiredEffort: 'standard',
        selected: { routeId: 'standard', effort: 'standard' },
        rejectedCandidates: [
          { routeId: 'light', reasons: ['effort_insufficient'] },
          { routeId: 'strong', reasons: ['higher_effort_than_needed'] },
          { routeId: 'offline', reasons: ['unavailable'] },
          { routeId: 'wrong-capability', reasons: ['capability_unsupported'] },
        ],
      },
    });
  });

  test('urgência desempata apenas candidatos equivalentes por latência', () => {
    const normal = selectWorkRoute({
      capability: 'programming',
      classification: classification(),
      candidates: [
        route('prioritário', 'light', { priority: 1, latency: 'high' }),
        route('rápido', 'light', { priority: 10, latency: 'low' }),
      ],
    });
    expect(normal).toMatchObject({ outcome: 'selected', decision: { selected: { routeId: 'prioritário' }, factors: { urgencyTieBreakApplied: false } } });

    const urgent = selectWorkRoute({
      capability: 'programming',
      classification: classification({ urgency: 'immediate' }),
      candidates: [
        route('prioritário', 'light', { priority: 1, latency: 'high' }),
        route('rápido', 'light', { priority: 10, latency: 'low' }),
      ],
    });
    expect(urgent).toMatchObject({ outcome: 'selected', decision: { selected: { routeId: 'rápido' }, factors: { urgencyTieBreakApplied: true } } });
  });

  test('não reduz esforço quando não há rota capaz', () => {
    expect(selectWorkRoute({
      capability: 'programming',
      classification: classification({ risk: 'critical' }),
      candidates: [route('light', 'light'), route('standard', 'standard')],
    })).toMatchObject({
      outcome: 'unavailable',
      reason: 'no_capable_route',
      rejectedCandidates: [
        { routeId: 'light', reasons: ['effort_insufficient'] },
        { routeId: 'standard', reasons: ['effort_insufficient'] },
      ],
    });
  });

  test('respeita piso elevado pelo INTEL-03 e jamais aceita redução abaixo do baseline', () => {
    expect(selectWorkRoute({
      capability: 'programming',
      classification: classification(),
      minimumEffort: 'standard',
      candidates: [route('light', 'light'), route('standard', 'standard')],
    })).toMatchObject({
      outcome: 'selected',
      decision: { requiredEffort: 'standard', selected: { routeId: 'standard' } },
    });
    expect(selectWorkRoute({
      capability: 'programming',
      classification: classification({ risk: 'high' }),
      minimumEffort: 'light',
      candidates: [route('light', 'light'), route('strong', 'strong')],
    })).toMatchObject({
      outcome: 'selected',
      decision: { requiredEffort: 'strong', selected: { routeId: 'strong' } },
    });
  });

  test('falha fechado com classificação incompleta ou catálogo inválido', () => {
    expect(selectWorkRoute({
      capability: 'programming',
      classification: classification({ complexity: 'unknown' }),
      candidates: [route('local', 'strong')],
    })).toMatchObject({ outcome: 'unavailable', reason: 'classification_incomplete' });
    expect(selectWorkRoute({
      capability: 'programming',
      classification: classification(),
      candidates: [route('', 'light')],
    })).toMatchObject({ outcome: 'unavailable', reason: 'no_capable_route' });
  });

  test('valida identificadores, vocabulário, prioridade e capacidades', () => {
    expect(validateWorkRoutingCandidate(route('ok', 'standard'))).toBeNull();
    expect(validateWorkRoutingCandidate(route('', 'standard'))).toContain('identificadores');
    expect(validateWorkRoutingCandidate(route('bad', 'standard', { priority: -1 }))).toContain('prioridade');
    expect(validateWorkRoutingCandidate(route('bad', 'standard', { capabilities: [] }))).toContain('capacidades');
  });

  test('aceita qualquer capacidade declarada no catálogo sem conhecer fornecedor', () => {
    const capability: WorkCapability = 'research';
    expect(selectWorkRoute({
      capability,
      classification: classification(),
      candidates: [route('research-local', 'light', { capabilities: [capability] })],
    })).toMatchObject({ outcome: 'selected', decision: { capability, selected: { routeId: 'research-local' } } });
  });
});
