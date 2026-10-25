/** @jest-environment node */
import { parseArgs, USAGE } from './args';
import { runWorkExternalClassify, runWorkExternalPropose } from './app';
import { EXIT } from './exit-codes';
import { renderHuman } from './render';
import type { ExternalClassificationPort, ExternalWorkPrepareDeps } from '@/lib/work-orchestration/external-work-materializer';

const ID = '123e4567-e89b-42d3-a456-426614174000';
const BIND = JSON.stringify({ covers: ['A1', 'A2'], file: 'src/clamp.test.js', bound_tests: ['clamp retorna max quando o valor excede o máximo', 'clamp aceita os limites exatos'] });
const head = ['work', 'external', 'propose', '--target', 'ext:shop', '--objective', 'Corrigir clamp', '--scope', 'src/clamp.js', '--scope', 'src/clamp.test.js', '--exclude', 'package.json'];
const proofs = ['--accept', 'A1=clamp(15, 0, 10) devolve 10', '--accept', 'A2=demais comportamentos continuam corretos', '--accept', 'A3=npm test passa', '--accept', 'A4=testes não enfraquecidos',
  '--bind', BIND, '--gate-covers', 'A3=npm test', '--review', 'A4'];
const tail = ['--backend', 'codex-cli'];
const propose = [...head, ...proofs, ...tail];
const classify = ['work', 'external', 'classify', ID, '--version', '1', '--complexity', 'bounded', '--risk', 'low', '--reversibility', 'reversible', '--plan-clarity', 'clear', '--urgency', 'normal'];

describe('parseArgs — work external propose (acceptance_contract v2)', () => {
  test('critérios com id estável e provas explícitas: binding, gate com covers e revisão humana', () => {
    expect(parseArgs([...propose, '--json'])).toEqual({ ok: true, command: {
      kind: 'work-external-propose', reference: 'ext:shop', objective: 'Corrigir clamp', scope: ['src/clamp.js', 'src/clamp.test.js'], excluded: ['package.json'],
      acceptance: [{ id: 'A1', text: 'clamp(15, 0, 10) devolve 10' }, { id: 'A2', text: 'demais comportamentos continuam corretos' }, { id: 'A3', text: 'npm test passa' }, { id: 'A4', text: 'testes não enfraquecidos' }],
      gates: [{ command: 'npm test', covers: ['A3'] }],
      bindings: [{ covers: ['A1', 'A2'], file: 'src/clamp.test.js', minNewTests: 0, boundTests: ['clamp retorna max quando o valor excede o máximo', 'clamp aceita os limites exatos'] }],
      reviews: ['A4'], backend: 'codex-cli', maxAttempts: 1, maxMinutes: 30, json: true } });
  });
  test('gate simples (sem covers), base-sha, limites e ollama com modelo', () => {
    const argv = [...head, '--accept', 'A1=um', '--accept', 'A2=dois', '--gate-covers', 'A1,A2=npm test', '--gate', 'npm run typecheck', '--backend', 'ollama', '--model', 'qwen3-coder:latest',
      '--base-sha', 'a'.repeat(40), '--max-attempts', '2', '--max-minutes', '45'];
    expect(parseArgs(argv)).toMatchObject({ ok: true, command: { backend: 'ollama', model: 'qwen3-coder:latest', baseSha: 'a'.repeat(40), maxAttempts: 2, maxMinutes: 45,
      gates: [{ command: 'npm run typecheck' }, { command: 'npm test', covers: ['A1', 'A2'] }] } });
  });
  test.each([
    ['--accept sem identificação estável', [...head, '--accept', 'critério solto', '--gate-covers', 'A1=npm test', ...tail]],
    ['critério sem prova (A2 descoberto)', [...head, '--accept', 'A1=um', '--accept', 'A2=dois', '--gate-covers', 'A1=npm test', ...tail]],
    ['covers de efeito desconhecido', [...head, '--accept', 'A1=um', '--gate-covers', 'A1,A9=npm test', ...tail]],
    ['critério coberto duas vezes', [...head, '--accept', 'A1=um', '--gate-covers', 'A1=npm test', '--review', 'A1', ...tail]],
    ['só revisão humana (sem prova automática)', [...head, '--accept', 'A1=um', '--review', 'A1', '--gate', 'npm test', ...tail]],
    ['--gate-covers malformado', [...head, '--accept', 'A1=um', '--gate-covers', 'npm test', ...tail]],
    ['gate fora da allowlist', [...head, '--accept', 'A1=um', '--gate-covers', 'A1=rm -rf /', ...tail]],
    ['--bind não é JSON', [...head, '--accept', 'A1=um', '--bind', '{covers', ...tail]],
    ['--bind com campo desconhecido', [...head, '--accept', 'A1=um', '--bind', JSON.stringify({ covers: ['A1'], file: 'src/clamp.test.js', bound_tests: ['x'], extra: 1 }), ...tail]],
    ['--bind vazio (sem teste vinculado nem teste novo)', [...head, '--accept', 'A1=um', '--bind', JSON.stringify({ covers: ['A1'], file: 'src/clamp.test.js' }), '--gate', 'npm test', ...tail]],
    ['--bind de arquivo fora do escopo', [...head, '--accept', 'A1=um', '--bind', JSON.stringify({ covers: ['A1'], file: 'src/outro.test.js', bound_tests: ['x'] }), '--gate', 'npm test', ...tail]],
    ['--review com id inválido', [...head, '--accept', 'A1=um', '--gate-covers', 'A1=npm test', '--review', 'revisar', ...tail]],
    ['sem --exclude', [...propose.filter((_, i) => i !== 11 && i !== 12)]],
    ['alvo anima', propose.map(x => x === 'ext:shop' ? 'anima' : x)],
    ['backend fora da lista', propose.map(x => x === 'codex-cli' ? 'openai' : x)],
    ['flag desconhecida', [...propose, '--auto-approve', 'yes']],
    ['flag única duplicada', [...propose, '--objective', 'outro']],
    ['valor ausente', [...propose, '--accept']],
    ['limite inválido', [...propose, '--max-attempts', '9']],
    ['base-sha curto', [...propose, '--base-sha', 'abc']],
  ])('recusa: %s', (_n, argv) => expect(parseArgs(argv)).toMatchObject({ ok: false }));
  test('a mensagem de recusa nomeia o critério sem cobertura', () => {
    expect(parseArgs([...head, '--accept', 'A1=um', '--accept', 'A2=dois', '--gate-covers', 'A1=npm test', ...tail])).toMatchObject({ ok: false, error: expect.stringContaining('acceptance_uncovered:A2') });
  });
  test('subcomando desconhecido e ajuda', () => {
    expect(parseArgs(['work', 'external', 'approve'])).toMatchObject({ ok: false });
    expect(parseArgs(['work', 'external', 'propose', '--help'])).toEqual({ ok: true, command: { kind: 'help' } });
  });
  test('a ajuda documenta os comandos, as provas e deixa aprovação/classificação como atos humanos', () => {
    expect(USAGE).toContain('anima work external propose');
    expect(USAGE).toContain('--gate-covers');
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
    readFileAtBase: async () => { throw new Error('não deveria ler o base'); },
    persistSourceMessage: async () => null, service: { createProposal: async () => { throw new Error('não deveria criar'); } }, ...over });
  const request = () => {
    const parsed = parseArgs(propose); if (!parsed.ok || parsed.command.kind !== 'work-external-propose') throw new Error('setup');
    const { kind: _k, json: _j, ...req } = parsed.command; return req;
  };

  test('propose: contrato sem cobertura vira recusa (exit 3) sem tocar o alvo', async () => {
    const result = await runWorkExternalPropose({ ...request(), reviews: [] }, deps());
    expect(result.exitCode).toBe(EXIT.REJECTED);
    expect(result.payload).toMatchObject({ ok: false, kind: 'error', code: 'acceptance_uncovered:A4' });
  });

  test('propose: sucesso devolve proposed, base SHA e orienta que aprovação/classificação/execução são atos posteriores', async () => {
    const sha = 'a'.repeat(40);
    const captured = { ok: true as const, specTarget: { kind: 'project', reference: 'ext:shop', identity: { repo_root_canonical: '/srv/shop', git_common_dir_canonical: '/srv/shop/.git', root_commit_sha: 'b'.repeat(40), base_sha: sha } },
      target: { reference: 'ext:shop', identity: { repoRootCanonical: '/srv/shop', gitCommonDirCanonical: '/srv/shop/.git', rootCommitSha: 'b'.repeat(40), baseSha: sha } } };
    const createProposal = jest.fn(async () => ({ ok: true as const, value: { id: 'w-1' } }));
    const clampTest = "describe('clamp', () => {\n  test('retorna max quando o valor excede o máximo', () => {});\n  test('aceita os limites exatos', () => {});\n});\n";
    const result = await runWorkExternalPropose(request(), deps({
      capture: async () => captured, verify: async () => ({ ok: true, reference: 'ext:shop', repoRoot: '/srv/shop', identity: captured.target.identity }),
      readFileAtBase: async () => clampTest, persistSourceMessage: async () => 'msg', service: { createProposal } as never }));
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
