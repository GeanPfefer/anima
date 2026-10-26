/** @jest-environment node */
import { parseExternalTargetsFile, EXTERNAL_TARGETS_FILE_MAX_BYTES } from './external-targets-registry';

// V1-02 — formato do arquivo de registro de targets externos (puro). Nada é lido do disco nem executado.
const SHA = 'a'.repeat(40);
const entry = (over: Record<string, unknown> = {}) => ({ reference: 'ext:alpha', repoRoot: 'G:/labs/alpha', rootCommitSha: SHA, ...over });
const file = (targets: unknown[], over: Record<string, unknown> = {}) => JSON.stringify({ version: 1, targets, ...over });

describe('parseExternalTargetsFile', () => {
  test('aceita vários targets, com e sem destino de integração', () => {
    const r = parseExternalTargetsFile(file([entry({ integration: { targetRef: 'refs/heads/main' } }), entry({ reference: 'ext:beta', repoRoot: '/srv/beta' })]));
    expect(r).toEqual({ ok: true, entries: [
      { reference: 'ext:alpha', repoRoot: 'G:/labs/alpha', rootCommitSha: SHA, integrationTargetRef: 'refs/heads/main' },
      { reference: 'ext:beta', repoRoot: '/srv/beta', rootCommitSha: SHA },
    ] });
    expect(parseExternalTargetsFile(file([]))).toEqual({ ok: true, entries: [] });
  });

  test('referência duplicada é recusada', () => {
    expect(parseExternalTargetsFile(file([entry(), entry({ repoRoot: 'G:/labs/outro' })]))).toMatchObject({ ok: false, code: 'external_targets_duplicate_reference' });
  });

  test.each([
    ['não é JSON', '{'],
    ['JSON que não é objeto', '[]'],
    ['versão ausente', JSON.stringify({ targets: [] })],
    ['chave extra no topo', file([], { extra: true })],
    ['targets não é lista', JSON.stringify({ version: 1, targets: {} })],
    ['entrada não é objeto', file(['ext:alpha'])],
    ['campo desconhecido na entrada (nenhum comando é aceito)', file([entry({ exec: 'rm -rf /' })])],
    ['campo "command"', file([entry({ command: 'git push' })])],
    ['campo "env"', file([entry({ env: { GIT_DIR: '/x' } })])],
    ['campo obrigatório ausente', file([{ reference: 'ext:alpha', repoRoot: 'G:/labs/alpha' }])],
    ['reference fora de ext:<slug>', file([entry({ reference: 'anima' })])],
    ['reference com maiúsculas', file([entry({ reference: 'ext:Alpha' })])],
    ['repoRoot relativo', file([entry({ repoRoot: 'labs/alpha' })])],
    ['repoRoot com ..', file([entry({ repoRoot: 'G:/labs/../anima' })])],
    ['repoRoot vazio', file([entry({ repoRoot: '' })])],
    ['rootCommitSha curto', file([entry({ rootCommitSha: 'abc' })])],
    ['rootCommitSha com maiúsculas', file([entry({ rootCommitSha: 'A'.repeat(40) })])],
    ['integration com chave extra', file([entry({ integration: { targetRef: 'refs/heads/main', remote: 'origin' } })])],
    ['integration sem targetRef', file([entry({ integration: {} })])],
    ['destino sem refs/heads', file([entry({ integration: { targetRef: 'main' } })])],
    ['destino remoto', file([entry({ integration: { targetRef: 'refs/remotes/origin/main' } })])],
    ['destino no namespace de attempts', file([entry({ integration: { targetRef: 'refs/heads/anima-work/abc' } })])],
    ['destino com ..', file([entry({ integration: { targetRef: 'refs/heads/a..b' } })])],
    ['integration não é objeto', file([entry({ integration: 'refs/heads/main' })])],
  ])('recusa: %s', (_name, raw) => expect(parseExternalTargetsFile(raw)).toMatchObject({ ok: false }));

  test('versão diferente de 1 tem código próprio; arquivo grande demais é recusado', () => {
    expect(parseExternalTargetsFile(JSON.stringify({ version: 2, targets: [] }))).toMatchObject({ ok: false, code: 'external_targets_file_version_unsupported' });
    expect(parseExternalTargetsFile(file([entry({ reference: 'ext:x' })], { pad: 'x'.repeat(EXTERNAL_TARGETS_FILE_MAX_BYTES) }))).toMatchObject({ ok: false, code: 'external_targets_file_too_large' });
  });
});
