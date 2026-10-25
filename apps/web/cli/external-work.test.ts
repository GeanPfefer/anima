/** @jest-environment node */
import { parseArgs, USAGE } from './args';
import { runWorkExternalClassify, runWorkExternalPropose } from './app';
import { EXIT } from './exit-codes';
import { renderHuman } from './render';
import type { ExternalClassificationPort, ExternalWorkPrepareDeps } from '@/lib/work-orchestration/external-work-materializer';

const ID = '123e4567-e89b-42d3-a456-426614174000';
const propose = ['work', 'external', 'propose', '--target', 'ext:shop', '--objective', 'Adicionar total()', '--scope', 'src/cart.ts', '--scope', 'src/cart.test.ts',
  '--exclude', 'package.json', '--accept', 'total soma os itens', '--gate', 'npm test', '--backend', 'ollama', '--model', 'qwen3-coder:latest'];
const classify = ['work', 'external', 'classify', ID, '--version', '1', '--complexity', 'bounded', '--risk', 'low', '--reversibility', 'reversible', '--plan-clarity', 'clear', '--urgency', 'normal'];

describe('parseArgs — work external propose', () => {
  test('flags repetíveis, padrões (1 tentativa, 30 min) e saída JSON opcional', () => {
    expect(parseArgs([...propose, '--json'])).toEqual({ ok: true, command: {
      kind: 'work-external-propose', reference: 'ext:shop', objective: 'Adicionar total()', scope: ['src/cart.ts', 'src/cart.test.ts'], excluded: ['package.json'],
      acceptance: ['total soma os itens'], gates: ['npm test'], backend: 'ollama', model: 'qwen3-coder:latest', maxAttempts: 1, maxMinutes: 30, json: true } });
  });
  test('base-sha, limites e codex-cli sem modelo', () => {
    const argv = ['work', 'external', 'propose', '--target', 'ext:shop', '--objective', 'x', '--scope', 'a', '--exclude', 'b', '--accept', 'c', '--gate', 'npm test', '--backend', 'codex-cli',
      '--base-sha', 'a'.repeat(40), '--max-attempts', '2', '--max-minutes', '45'];
    expect(parseArgs(argv)).toMatchObject({ ok: true, command: { backend: 'codex-cli', baseSha: 'a'.repeat(40), maxAttempts: 2, maxMinutes: 45 } });
  });
  test.each([
    ['sem --target', propose.filter((_, i) => i !== 3 && i !== 4)],
    ['alvo anima', propose.map(x => x === 'ext:shop' ? 'anima' : x)],
    ['sem --exclude', propose.filter((_, i) => i !== 11 && i !== 12)],
    ['gate fora da allowlist', propose.map(x => x === 'npm test' ? 'rm -rf /' : x)],
    ['backend fora da lista', propose.map(x => x === 'ollama' ? 'openai' : x)],
    ['flag desconhecida', [...propose, '--auto-approve', 'yes']],
    ['flag única duplicada', [...propose, '--objective', 'outro']],
    ['valor ausente', [...propose, '--accept']],
    ['limite inválido', [...propose, '--max-attempts', '9']],
    ['base-sha curto', [...propose, '--base-sha', 'abc']],
  ])('recusa de uso: %s', (_n, argv) => expect(parseArgs(argv)).toMatchObject({ ok: false }));
  test('subcomando desconhecido e ajuda', () => {
    expect(parseArgs(['work', 'external', 'approve'])).toMatchObject({ ok: false });
    expect(parseArgs(['work', 'external', 'propose', '--help'])).toEqual({ ok: true, command: { kind: 'help' } });
  });
  test('a ajuda documenta os dois comandos e deixa aprovação/classificação como atos humanos', () => {
    expect(USAGE).toContain('anima work external propose');
    expect(USAGE).toContain('anima work external classify');
    expect(USAGE).toContain('aprovação e classificação são atos humanos');
  });
});

describe('parseArgs — work external classify', () => {
  test('cinco eixos e versão explícitos', () => {
    expect(parseArgs(classify)).toEqual({ ok: true, command: { kind: 'work-external-classify', id: ID, expectedProposalVersion: 1,
      axes: { complexity: 'bounded', risk: 'low', reversibility: 'reversible', planClarity: 'clear', urgency: 'normal' }, json: false } });
  });
  test.each([
    ['sem eixo', classify.slice(0, -2)],
    ['sem versão', classify.filter((_, i) => i !== 4 && i !== 5)],
    ['eixo inválido', classify.map(x => x === 'low' ? 'baixíssimo' : x)],
    ['id não UUID', classify.map((x, i) => i === 3 ? 'SDC-01' : x)],
    ['flag repetida', [...classify, '--risk', 'high']],
  ])('recusa: %s', (_n, argv) => expect(parseArgs(argv)).toMatchObject({ ok: false }));
});

describe('runners (mesma função que o dispatch usa)', () => {
  const deps = (over: Partial<ExternalWorkPrepareDeps> = {}): ExternalWorkPrepareDeps => ({
    capture: async () => { throw new Error('não deveria capturar'); }, verify: async () => { throw new Error('não deveria verificar'); },
    persistSourceMessage: async () => null, service: { createProposal: async () => { throw new Error('não deveria criar'); } }, ...over });

  test('propose: dados inválidos viram recusa (exit 3) sem tocar o alvo, e o payload é de erro tipado', async () => {
    const parsed = parseArgs(propose); if (!parsed.ok || parsed.command.kind !== 'work-external-propose') throw new Error('setup');
    const { kind: _k, json: _j, ...request } = parsed.command;
    const result = await runWorkExternalPropose({ ...request, scope: ['../fora'] }, deps());
    expect(result.exitCode).toBe(EXIT.REJECTED);
    expect(result.payload).toMatchObject({ ok: false, kind: 'error', code: 'scope_invalid' });
  });

  test('propose: sucesso devolve proposed, base SHA e orienta que aprovação/classificação/execução são atos posteriores', async () => {
    const parsed = parseArgs(propose); if (!parsed.ok || parsed.command.kind !== 'work-external-propose') throw new Error('setup');
    const sha = 'a'.repeat(40);
    const captured = { ok: true as const, specTarget: { kind: 'project', reference: 'ext:shop', identity: { repo_root_canonical: '/srv/shop', git_common_dir_canonical: '/srv/shop/.git', root_commit_sha: 'b'.repeat(40), base_sha: sha } },
      target: { reference: 'ext:shop', identity: { repoRootCanonical: '/srv/shop', gitCommonDirCanonical: '/srv/shop/.git', rootCommitSha: 'b'.repeat(40), baseSha: sha } } };
    const createProposal = jest.fn(async () => ({ ok: true as const, value: { id: 'w-1' } }));
    const { kind: _k, json: _j, ...request } = parsed.command;
    const result = await runWorkExternalPropose(request, deps({
      capture: async () => captured, verify: async () => ({ ok: true, reference: 'ext:shop', repoRoot: '/srv/shop', identity: captured.target.identity }),
      persistSourceMessage: async () => 'msg', service: { createProposal } as never }));
    expect(result.exitCode).toBe(EXIT.OK);
    expect(result.payload).toMatchObject({ ok: true, kind: 'work-external-propose', workItemId: 'w-1', state: 'proposed', baseSha: sha });
    expect(createProposal).toHaveBeenCalledTimes(1);
    const text = renderHuman(result.payload);
    expect(text).toContain('nada foi aprovado nem iniciado');
    expect(text).toContain('work external classify');
  });

  test('classify: item não aprovado ⇒ recusa (exit 3) e nada é gravado', async () => {
    const parsed = parseArgs(classify); if (!parsed.ok || parsed.command.kind !== 'work-external-classify') throw new Error('setup');
    const record = jest.fn();
    const port: ExternalClassificationPort = { readItem: async () => ({ state: 'proposed', proposalVersion: 1, intent: {} }), readCurrent: async () => ({ ok: true, classification: null }), record };
    const result = await runWorkExternalClassify(port, { workItemId: parsed.command.id, expectedProposalVersion: parsed.command.expectedProposalVersion, axes: parsed.command.axes });
    expect(result.exitCode).toBe(EXIT.REJECTED);
    expect(result.payload).toMatchObject({ ok: false, code: 'not_approved' });
    expect(record).not.toHaveBeenCalled();
  });
});
