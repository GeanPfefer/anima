import { decideComputeStrategy, type ComputeStrategyOptionV1, type ComputeStrategyV1 } from './compute-strategy-decision';

const option = (strategy: ComputeStrategyV1, overrides: Partial<ComputeStrategyOptionV1> = {}): ComputeStrategyOptionV1 => ({
  strategy,
  available: true,
  meetsRequirements: true,
  estimatedHourlyCost: null,
  estimatedTotalCost: null,
  provisioningLatencyMs: null,
  availableVramGiB: null,
  expectedQuality: null,
  proprietaryDependency: strategy === 'third_party_api',
  confidence: null,
  evidenceNote: null,
  ...overrides,
});

describe('decideComputeStrategy — fronteira humana sobre estratégia de compute', () => {
  test('9) nuvem escolhida pelo humano → selecionada, sem fallback para API terceira', () => {
    const decision = decideComputeStrategy({
      humanSelected: 'cloud_self_hosted',
      options: [option('local', { meetsRequirements: false }), option('cloud_self_hosted'), option('third_party_api')],
    });
    expect(decision).toMatchObject({ status: 'selected', strategy: 'cloud_self_hosted', reasonCode: 'human_selected' });
  });

  test('9b) o Anima NUNCA retorna third_party_api sem seleção humana explícita', () => {
    const decision = decideComputeStrategy({
      humanSelected: null,
      options: [option('local', { available: false }), option('cloud_self_hosted'), option('third_party_api')],
    });
    expect(decision.status).toBe('human_decision_required');
    expect(decision.status === 'human_decision_required' && decision.comparison.options.map(o => o.strategy)).toContain('third_party_api');
    // não "seleciona" nada; a escolha é humana
    expect(decision).not.toMatchObject({ status: 'selected' });
  });

  test('10) sem seleção humana + múltiplas estratégias plausíveis → human_decision_required', () => {
    const decision = decideComputeStrategy({
      humanSelected: null,
      options: [option('local'), option('cloud_self_hosted'), option('third_party_api')],
    });
    expect(decision).toMatchObject({ status: 'human_decision_required', reasonCode: 'multiple_strategies_plausible' });
    // local viável ⇒ preferência aponta para local, mas ainda exige decisão humana
    expect(decision.status === 'human_decision_required' && decision.comparison.preferred).toBe('local');
  });

  test('11a) local suficiente e ÚNICA estratégia viável → seleciona local sem exigir humano', () => {
    const decision = decideComputeStrategy({
      humanSelected: null,
      options: [option('local'), option('cloud_self_hosted', { meetsRequirements: false }), option('third_party_api', { available: false })],
    });
    expect(decision).toMatchObject({ status: 'selected', strategy: 'local', reasonCode: 'local_sufficient' });
  });

  test('11b) local suficiente MAS há escolha estratégica → contrato humano preservado, preferência = local', () => {
    const decision = decideComputeStrategy({
      humanSelected: null,
      options: [option('local'), option('cloud_self_hosted')],
    });
    expect(decision).toMatchObject({ status: 'human_decision_required' });
    expect(decision.status === 'human_decision_required' && decision.comparison.preferred).toBe('local');
  });

  test('humano escolheu uma estratégia inviável → blocked, sem substituição silenciosa', () => {
    const decision = decideComputeStrategy({
      humanSelected: 'cloud_self_hosted',
      options: [option('local'), option('cloud_self_hosted', { available: false })],
    });
    expect(decision).toMatchObject({ status: 'blocked', reasonCode: 'selected_strategy_infeasible' });
  });

  test('nenhuma estratégia viável → blocked no_viable_strategy', () => {
    const decision = decideComputeStrategy({
      humanSelected: null,
      options: [option('local', { available: false }), option('cloud_self_hosted', { meetsRequirements: false })],
    });
    expect(decision).toMatchObject({ status: 'blocked', reasonCode: 'no_viable_strategy' });
  });
});
