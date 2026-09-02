import { resolveCoderCapacityPolicy } from './coder-model-policy';

const env = (over: Record<string, string | undefined>): NodeJS.ProcessEnv => over as NodeJS.ProcessEnv;

describe('resolveCoderCapacityPolicy', () => {
  test('ausência de config ⇒ política DESLIGADA (null)', () => {
    expect(resolveCoderCapacityPolicy(env({}))).toBeNull();
    expect(resolveCoderCapacityPolicy(env({ ANIMA_CODER_VRAM_GB: '16' }))).toBeNull();
    expect(resolveCoderCapacityPolicy(env({ ANIMA_CODER_MODEL_ALLOWLIST: '[{"model":"x","requiresGb":1}]' }))).toBeNull();
  });

  test('config válida ⇒ capacidade + allowlist', () => {
    const policy = resolveCoderCapacityPolicy(env({
      ANIMA_CODER_VRAM_GB: '16',
      ANIMA_CODER_MODEL_ALLOWLIST: '[{"model":"qwen3-coder:latest","requiresGb":18},{"model":"qwen2.5-coder:14b","requiresGb":10}]',
    }));
    expect(policy).toEqual({ capacityGb: 16, allowlist: [{ model: 'qwen3-coder:latest', requiresGb: 18 }, { model: 'qwen2.5-coder:14b', requiresGb: 10 }] });
  });

  test('JSON malformado, entrada inválida, capacidade não positiva ou lista vazia ⇒ null (fail-closed p/ desligar)', () => {
    expect(resolveCoderCapacityPolicy(env({ ANIMA_CODER_VRAM_GB: '16', ANIMA_CODER_MODEL_ALLOWLIST: 'não-json' }))).toBeNull();
    expect(resolveCoderCapacityPolicy(env({ ANIMA_CODER_VRAM_GB: '16', ANIMA_CODER_MODEL_ALLOWLIST: '{}' }))).toBeNull();
    expect(resolveCoderCapacityPolicy(env({ ANIMA_CODER_VRAM_GB: '16', ANIMA_CODER_MODEL_ALLOWLIST: '[]' }))).toBeNull();
    expect(resolveCoderCapacityPolicy(env({ ANIMA_CODER_VRAM_GB: '16', ANIMA_CODER_MODEL_ALLOWLIST: '[{"model":"x"}]' }))).toBeNull();
    expect(resolveCoderCapacityPolicy(env({ ANIMA_CODER_VRAM_GB: '16', ANIMA_CODER_MODEL_ALLOWLIST: '[{"model":"","requiresGb":1}]' }))).toBeNull();
    expect(resolveCoderCapacityPolicy(env({ ANIMA_CODER_VRAM_GB: '16', ANIMA_CODER_MODEL_ALLOWLIST: '[{"model":"x","requiresGb":0}]' }))).toBeNull();
    expect(resolveCoderCapacityPolicy(env({ ANIMA_CODER_VRAM_GB: '0', ANIMA_CODER_MODEL_ALLOWLIST: '[{"model":"x","requiresGb":1}]' }))).toBeNull();
    expect(resolveCoderCapacityPolicy(env({ ANIMA_CODER_VRAM_GB: 'abc', ANIMA_CODER_MODEL_ALLOWLIST: '[{"model":"x","requiresGb":1}]' }))).toBeNull();
  });
});
