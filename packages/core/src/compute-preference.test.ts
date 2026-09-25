import {
  parseComputePreference,
  projectComputePreference,
  resolveEffectiveComputePreference,
  type ComputePreferenceEventV1,
} from './compute-preference';

const sol = { schemaVersion: 1, strategy: 'provider_api', provider: 'openai', model: 'gpt-5.6-sol' } as const;
const recorded = (preference: unknown, at = '2026-09-25T10:00:00.000Z'): ComputePreferenceEventV1 => ({
  type: 'compute_preference_recorded', payload: { schema_version: 1, data: { preference } }, occurredAt: new Date(at),
});

describe('parseComputePreference', () => {
  test('aceita provider_api/openai/<modelo> e router_default', () => {
    expect(parseComputePreference(sol)).toEqual(sol);
    expect(parseComputePreference({ schemaVersion: 1, strategy: 'router_default' })).toEqual({ schemaVersion: 1, strategy: 'router_default' });
  });
  test('recusa provider fora da estratégia, modelo malformado, campos de dinheiro e versões desconhecidas', () => {
    expect(parseComputePreference({ ...sol, provider: 'ollama' })).toBeNull();
    expect(parseComputePreference({ ...sol, model: 'gpt; drop' })).toBeNull();
    expect(parseComputePreference({ ...sol, maxUsd: 3 })).toBeNull();
    expect(parseComputePreference({ ...sol, schemaVersion: 2 })).toBeNull();
    expect(parseComputePreference({ schemaVersion: 1, strategy: 'router_default', model: 'x' })).toBeNull();
    expect(parseComputePreference(null)).toBeNull();
  });
});

describe('projectComputePreference', () => {
  test('a última preferência válida vence; evento malformado não apaga a anterior', () => {
    const events = [
      { type: 'work_approved', payload: {} },
      recorded(sol, '2026-09-25T10:00:00.000Z'),
      recorded({ ...sol, provider: 'x' }, '2026-09-25T11:00:00.000Z'),
    ];
    expect(projectComputePreference(events)).toEqual({ preference: sol, recordedAt: '2026-09-25T10:00:00.000Z' });
    expect(projectComputePreference([...events, recorded({ schemaVersion: 1, strategy: 'router_default' })])?.preference.strategy).toBe('router_default');
  });
  test('F · item legado sem evento de preferência ⇒ null', () => {
    expect(projectComputePreference([{ type: 'work_proposed', payload: {} }])).toBeNull();
  });
});

describe('resolveEffectiveComputePreference', () => {
  const noContract = { coderBackend: 'ollama', coderBackendSource: 'runtime_default' };
  test('preferência explícita provider_api é autoritativa com o modelo escolhido pelo humano', () => {
    expect(resolveEffectiveComputePreference({ recorded: sol, contract: noContract, runtimeOpenAIModel: 'gpt-5.6-terra' }))
      .toEqual({ provider: 'openai', model: 'gpt-5.6-sol', source: 'work_item_preference' });
  });
  test('A · sem preferência e contrato do runtime ⇒ nenhuma preferência (local-first preservado)', () => {
    expect(resolveEffectiveComputePreference({ recorded: null, contract: noContract, runtimeOpenAIModel: 'gpt-5.6-sol' })).toBeNull();
  });
  test('env do deploy carimbado no contrato (runtime_default) NÃO vira decisão da unidade', () => {
    expect(resolveEffectiveComputePreference({
      recorded: null, contract: { coderBackend: 'openai', coderBackendSource: 'runtime_default' }, runtimeOpenAIModel: 'gpt-5.6-sol',
    })).toBeNull();
  });
  test('F · contrato legado openai sem marca continua preferindo OpenAI no modelo do runtime', () => {
    expect(resolveEffectiveComputePreference({
      recorded: null, contract: { coderBackend: 'openai', coderBackendSource: null }, runtimeOpenAIModel: 'gpt-5.6-sol',
    })).toEqual({ provider: 'openai', model: 'gpt-5.6-sol', source: 'legacy_contract' });
  });
  test('router_default explícito limpa inclusive a preferência legada do contrato', () => {
    expect(resolveEffectiveComputePreference({
      recorded: { schemaVersion: 1, strategy: 'router_default' }, contract: { coderBackend: 'openai', coderBackendSource: null }, runtimeOpenAIModel: 'gpt-5.6-sol',
    })).toBeNull();
  });
});
