/** @jest-environment node */
import { describeComputeRoutingConfig } from './compute-routing-config';

describe('describeComputeRoutingConfig', () => {
  test('ausência de configuração ⇒ Router desligado e defaults históricos do coder', () => {
    expect(describeComputeRoutingConfig({})).toMatchObject({
      ok: true, routerEnabled: false,
      openAICoder: { credentialPresent: false, model: 'gpt-5.6-terra', reasoningEffort: null, timeoutMs: 90_000, outputTokens: 16_384 },
    });
  });

  test('configuração forte do operador é refletida sem expor a credencial', () => {
    const config = describeComputeRoutingConfig({
      ANIMA_COMPUTE_ROUTER_V1_ENABLED: '1', OPENAI_API_KEY: 'sk-secret', OPENAI_MODEL: 'gpt-5.6-terra',
      ANIMA_CODER_MODEL: 'gpt-5.6-sol', ANIMA_OPENAI_CODER_REASONING_EFFORT: 'high',
      ANIMA_OPENAI_CODER_TIMEOUT_MS: '300000', ANIMA_OPENAI_CODER_OUTPUT_TOKENS: '32000',
    });
    expect(config).toMatchObject({
      ok: true, routerEnabled: true,
      openAICoder: {
        credentialPresent: true, model: 'gpt-5.6-sol', resourceClass: 'provider_api:gpt-5.6-sol',
        reasoningEffort: 'high', timeoutMs: 300_000, outputTokens: 32_000,
      },
    });
    expect(JSON.stringify(config)).not.toContain('sk-secret');
  });

  test('valor inválido falha cedo e fechado, com o motivo', () => {
    const config = describeComputeRoutingConfig({ ANIMA_COMPUTE_ROUTER_V1_ENABLED: '1', ANIMA_OPENAI_CODER_REASONING_EFFORT: 'turbo' });
    expect(config.ok).toBe(false);
    expect(config.routerEnabled).toBe(true);
    if (!config.ok) expect(config.error).toContain('ANIMA_OPENAI_CODER_REASONING_EFFORT');
  });
});
