import { WORKTREE_CODER_BACKENDS, type CoderProvider } from './coder-backend';
import { projectExecutorCandidates, recommendExecutor, type ExecutorAvailability, type ExecutorObservation } from './executor-discovery';

const obs = (provider: CoderProvider, availability: ExecutorAvailability, reasonUnavailable: string | null = null): ExecutorObservation =>
  ({ provider, availability, reasonUnavailable });
const allReady: readonly ExecutorObservation[] = WORKTREE_CODER_BACKENDS.map(provider => obs(provider, 'ready'));
const contractOf = (coderBackend: string | null, model: string | null = null) => ({ coderBackend, model });

describe('projectExecutorCandidates', () => {
  test('lista os cinco providers do registry em ordem estável, mesmo sem observações', () => {
    const candidates = projectExecutorCandidates({ contract: contractOf(null), observations: [] });
    expect(candidates.map(c => c.provider)).toEqual([...WORKTREE_CODER_BACKENDS]);
    expect(candidates).toHaveLength(5);
    const reversed = projectExecutorCandidates({ contract: contractOf(null), observations: [...allReady].reverse() });
    expect(reversed.map(c => c.provider)).toEqual([...WORKTREE_CODER_BACKENDS]);
  });

  test('observação ausente ⇒ unknown / readiness_not_probed', () => {
    const [ollama] = projectExecutorCandidates({ contract: contractOf(null), observations: [] });
    expect(ollama).toMatchObject({ provider: 'ollama', availability: 'unknown', eligibility: 'eligible', reasonUnavailable: 'readiness_not_probed', reasonIneligible: null });
  });

  test('ready / unavailable / unknown preservam o motivo estável', () => {
    const candidates = projectExecutorCandidates({
      contract: contractOf(null),
      observations: [obs('ollama', 'ready'), obs('codex-cli', 'unavailable', 'codex_not_logged_in'), obs('openai', 'unknown', 'paid_authority_required_per_item')],
    });
    const by = (p: string) => candidates.find(c => c.provider === p)!;
    expect(by('ollama')).toMatchObject({ availability: 'ready', reasonUnavailable: null });
    expect(by('codex-cli')).toMatchObject({ availability: 'unavailable', reasonUnavailable: 'codex_not_logged_in' });
    expect(by('openai')).toMatchObject({ availability: 'unknown', reasonUnavailable: 'paid_authority_required_per_item' });
  });

  test('deepseek-harness é sempre estacionado e inelegível, mesmo se a observação disser ready', () => {
    const candidates = projectExecutorCandidates({ contract: contractOf(null), observations: allReady });
    expect(candidates.find(c => c.provider === 'deepseek-harness')).toMatchObject({
      availability: 'unavailable', eligibility: 'ineligible', reasonUnavailable: 'parked_not_operational', reasonIneligible: 'parked_not_operational', costClass: 'unknown',
    });
  });

  test('classe de custo e modelo: contrato só vale para o provider coincidente', () => {
    const candidates = projectExecutorCandidates({ contract: contractOf('claude-code', 'sonnet-x'), observations: allReady });
    expect(Object.fromEntries(candidates.map(c => [c.provider, c.costClass]))).toEqual({
      ollama: 'local', openai: 'paid_api', 'deepseek-harness': 'unknown', 'codex-cli': 'subscription', 'claude-code': 'subscription',
    });
    const claude = candidates.find(c => c.provider === 'claude-code')!;
    expect(claude).toMatchObject({ model: 'sonnet-x', backendId: 'claude-code:sonnet-x' });
    expect(candidates.find(c => c.provider === 'codex-cli')).toMatchObject({ model: 'default', backendId: 'codex-cli:default' });
  });
});

describe('recommendExecutor', () => {
  const recommend = (contractBackend: string | null, observations: readonly ExecutorObservation[]) => {
    const contract = contractOf(contractBackend);
    return recommendExecutor(projectExecutorCandidates({ contract, observations }), contract);
  };

  test('contract_declared quando o backend do contrato está pronto e elegível', () => {
    const { recommendation } = recommend('claude-code', allReady);
    expect(recommendation).toMatchObject({ provider: 'claude-code', rule: 'contract_declared', fallback: { provider: 'ollama' } });
    expect(recommendation!.reason).toContain('não afirma adequação do modelo');
  });

  test('local_first quando o declarado não está pronto', () => {
    const { recommendation } = recommend('claude-code', [obs('claude-code', 'unavailable', 'claude_not_logged_in'), obs('codex-cli', 'ready'), obs('ollama', 'ready')]);
    expect(recommendation).toMatchObject({ provider: 'ollama', rule: 'local_first', fallback: { provider: 'codex-cli' } });
  });

  test('local_first ordena local < subscription < paid_api e desempata pela ordem do registry', () => {
    expect(recommend(null, [obs('openai', 'ready'), obs('claude-code', 'ready'), obs('codex-cli', 'ready')]).recommendation)
      .toMatchObject({ provider: 'codex-cli', fallback: { provider: 'claude-code' } });
    expect(recommend(null, [obs('openai', 'ready'), obs('claude-code', 'ready')]).recommendation)
      .toMatchObject({ provider: 'claude-code', fallback: { provider: 'openai' } });
  });

  test('fallback é null quando só há um pronto', () => {
    expect(recommend(null, [obs('codex-cli', 'ready')]).recommendation).toMatchObject({ provider: 'codex-cli', fallback: null });
  });

  test('unknown nunca é recomendado, nem se declarado no contrato', () => {
    const { recommendation } = recommend('openai', [obs('openai', 'unknown', 'paid_authority_required_per_item'), obs('codex-cli', 'ready')]);
    expect(recommendation).toMatchObject({ provider: 'codex-cli', rule: 'local_first' });
  });

  test('nenhum backend disponível ⇒ sem recomendação, com motivo por candidato', () => {
    const { recommendation, noRecommendation } = recommend('ollama', [obs('ollama', 'unavailable', 'ollama_unreachable'), obs('openai', 'unknown', 'paid_authority_required_per_item')]);
    expect(recommendation).toBeNull();
    expect(noRecommendation?.reason).toBe('no_ready_candidate');
    expect(noRecommendation?.candidates.map(c => [c.provider, c.reason])).toEqual([
      ['ollama', 'ollama_unreachable'],
      ['openai', 'paid_authority_required_per_item'],
      ['deepseek-harness', 'parked_not_operational'],
      ['codex-cli', 'readiness_not_probed'],
      ['claude-code', 'readiness_not_probed'],
    ]);
  });

  test('determinismo: mesma entrada ⇒ mesma saída', () => {
    const run = () => recommend('codex-cli', [...allReady]);
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});
