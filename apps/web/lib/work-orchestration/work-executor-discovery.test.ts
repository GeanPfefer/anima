import { discoverWorkItemExecutors, governedExecuteOneCommand, nextGovernedSteps } from './work-executor-discovery';
import type { ExecutorObservation } from './executor-discovery';

const intent = {} as never;
const obs = (provider: ExecutorObservation['provider'], availability: ExecutorObservation['availability'], reasonUnavailable: string | null = null): ExecutorObservation => ({ provider, availability, reasonUnavailable });

describe('discoverWorkItemExecutors', () => {
  test('compõe candidatos e recomendação a partir das observações, sem I/O próprio', async () => {
    const probe = jest.fn(async () => [obs('codex-cli', 'ready'), obs('ollama', 'unavailable', 'ollama_unreachable')]);
    const out = await discoverWorkItemExecutors({ item: { intent }, probe, now: () => new Date('2026-11-09T22:00:00Z') });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(out.observedAt).toBe('2026-11-09T22:00:00.000Z');
    expect(out.candidates.some(c => c.provider === 'codex-cli')).toBe(true);
    expect(out.codex).toBeNull();
  });

  test('diagnóstico do Codex só é pedido quando o Codex foi observado e falha vira null', async () => {
    const diagnoseCodex = jest.fn(async () => { throw new Error('boom'); });
    const without = await discoverWorkItemExecutors({ item: { intent }, probe: async () => [obs('ollama', 'ready')], diagnoseCodex });
    expect(diagnoseCodex).not.toHaveBeenCalled();
    expect(without.codex).toBeNull();
    const withCodex = await discoverWorkItemExecutors({ item: { intent }, probe: async () => [obs('codex-cli', 'ready')], diagnoseCodex });
    expect(diagnoseCodex).toHaveBeenCalledTimes(1);
    expect(withCodex.codex).toBeNull();
  });
});

describe('governedExecuteOneCommand', () => {
  test('usa a referência humana quando existe e o UUID caso contrário', () => {
    expect(governedExecuteOneCommand('PROOF-03', 'u', 2)).toBe('npm run anima -- work execute-one PROOF-03 --version 2');
    expect(governedExecuteOneCommand(null, 'abc', 1)).toBe('npm run anima -- work execute-one abc --version 1');
  });
});

describe('nextGovernedSteps', () => {
  const base = { reference: null, workItemId: 'abc', proposalVersion: 1 };
  test('proposed: só a aprovação humana', () => {
    const steps = nextGovernedSteps({ ...base, state: 'proposed', external: true });
    expect(steps).toEqual([expect.objectContaining({ actor: 'human', command: 'npm run anima -- work approve abc' })]);
  });
  test('approved externo: classificação humana com os valores canônicos (sem unknown) antes do execute-one', () => {
    const steps = nextGovernedSteps({ ...base, state: 'approved', external: true });
    expect(steps).toHaveLength(2);
    expect(steps[0]!.command).toContain('work external classify abc --version 1 --complexity <routine|bounded|complex>');
    expect(steps[0]!.command).not.toContain('unknown');
    expect(steps[1]).toMatchObject({ actor: 'supervisor', command: 'npm run anima -- work execute-one abc --version 1' });
  });
  test('approved não externo: só execute-one; review externo: revisão antes do aceite; outros estados: nada', () => {
    expect(nextGovernedSteps({ ...base, state: 'approved', external: false })).toHaveLength(1);
    expect(nextGovernedSteps({ ...base, state: 'review', external: true }).map(s => s.command)).toEqual([
      'npm run anima -- work external review abc --version 1', 'npm run anima -- work accept abc']);
    expect(nextGovernedSteps({ ...base, state: 'completed', external: true })).toEqual([]);
  });
});
