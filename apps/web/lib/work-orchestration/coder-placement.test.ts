import { decideCoderPlacement, readExplicitCoderNodeV0 } from './coder-placement';

const node = (over: Partial<NonNullable<ReturnType<typeof readExplicitCoderNodeV0>>> = {}) => ({
  id: 'gpu-a', endpoint: 'http://127.0.0.1:21434', locality: 'remote' as const,
  enabled: true, healthy: true, capabilities: ['coder_inference'] as const,
  models: ['qwen3-coder:latest'], resourceClass: 'gpu-24gb', billingMode: 'owned' as const,
  ...over,
});

describe('decideCoderPlacement V0', () => {
  test('pressão baixa mantém inferência local', () => {
    expect(decideCoderPlacement({ pressure: 'low', model: 'qwen3-coder:latest', nodes: [node()], paidComputeAuthorized: false }).placement).toBe('local');
  });
  test('pressão moderada/alta escolhe node remoto elegível deterministicamente', () => {
    expect(decideCoderPlacement({ pressure: 'high', model: 'qwen3-coder:latest', nodes: [node()], paidComputeAuthorized: false })).toMatchObject({ placement: 'remote', node: { id: 'gpu-a' } });
  });
  test('sem remoto saudável e capaz adia', () => {
    expect(decideCoderPlacement({ pressure: 'high', model: 'qwen3-coder:latest', nodes: [node({ healthy: false })], paidComputeAuthorized: false })).toEqual({ placement: 'defer', reason: 'no_eligible_remote_node' });
    expect(decideCoderPlacement({ pressure: 'moderate', model: 'outro', nodes: [node()], paidComputeAuthorized: false }).placement).toBe('defer');
  });
  test('compute pago sem autorização falha fechado', () => {
    expect(decideCoderPlacement({ pressure: 'high', model: 'qwen3-coder:latest', nodes: [node({ billingMode: 'paid' })], paidComputeAuthorized: false })).toEqual({ placement: 'defer', reason: 'paid_compute_not_authorized' });
  });
  test('pressão desconhecida nunca delega', () => {
    expect(decideCoderPlacement({ pressure: 'unknown', model: 'qwen3-coder:latest', nodes: [node()], paidComputeAuthorized: true })).toEqual({ placement: 'defer', reason: 'pressure_unknown' });
  });
});

describe('readExplicitCoderNodeV0', () => {
  test('config explícita começa unhealthy e não presume autorização paga', () => {
    const parsed = readExplicitCoderNodeV0('m', {
      ANIMA_WORKTREE_OLLAMA_URL: 'http://127.0.0.1:21434', ANIMA_WORKTREE_OLLAMA_LOCALITY: 'remote',
      ANIMA_WORKTREE_OLLAMA_NODE_ID: 'gpu-a', ANIMA_WORKTREE_OLLAMA_BILLING_MODE: 'paid',
    });
    expect(parsed).toMatchObject({ id: 'gpu-a', healthy: false, enabled: true, billingMode: 'paid', models: ['m'] });
  });
});
