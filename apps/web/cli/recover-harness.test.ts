import { runWorkRecoverHarness } from './app';
import { parseArgs } from './args';
import { renderHuman } from './render';
import { EXIT } from './exit-codes';

describe('work recover-harness', () => {
  test('parse exige fix, evidência e motivo', () => {
    expect(parseArgs(['work', 'recover-harness', 'w1', '--fix', 'd17dcbe', '--fix', 'b496708', '--evidence', 'docs/registros/x.md', '--reason', 'defeito de harness corrigido']))
      .toEqual({ ok: true, command: { kind: 'work-recover-harness', id: 'w1', fixCommits: ['d17dcbe', 'b496708'], evidenceReference: 'docs/registros/x.md', reason: 'defeito de harness corrigido', json: false } });
    expect(parseArgs(['work', 'recover-harness', 'w1', '--evidence', 'docs/registros/x.md', '--reason', 'x']).ok).toBe(false);
    expect(parseArgs(['work', 'recover-harness', 'w1', '--fix', 'd17dcbe', '--reason', 'x']).ok).toBe(false);
    expect(parseArgs(['work', 'show', 'w1', '--fix', 'd17dcbe']).ok).toBe(false);
  });
  test('sucesso informa sucessor e que aprovação/preferência/authority seguem separados', async () => {
    const result = await runWorkRecoverHarness(async () => ({
      ok: true, recoveryId: 'r1', successorWorkItemId: 's1', lineageId: 'l1', sourceAttemptId: 'a1', replayed: false,
      authorization: { fixCommits: ['d17dcbe'.padEnd(40, 'a')] },
    }), 'w1');
    expect(result.exitCode).toBe(EXIT.OK);
    const text = renderHuman(result.payload);
    expect(text).toContain('Sucessor: s1');
    expect(text).toContain('authority continuam atos separados');
  });
  test('recusa por regra ⇒ exit REJECTED', async () => {
    const result = await runWorkRecoverHarness(async () => ({ ok: false, code: '55000', message: 'recovery_already_allocated', rejected: true }), 'w1');
    expect(result.exitCode).toBe(EXIT.REJECTED);
  });
});
