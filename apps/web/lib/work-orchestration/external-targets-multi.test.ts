/** @jest-environment node */
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectIntegrationStatus } from '@anima/core';
import { listExternalTargets, captureExternalTargetSpec, defaultExternalTargetDeps, loadConfiguredExternalTargets, resolveExternalTargetConfig, verifyExternalTargetForContract, EXTERNAL_TARGET_ENV, type ExternalTargetDeps } from './external-target-resolver';
import { EXTERNAL_TARGETS_FILE_ENV } from './external-targets-registry';
import { EXTERNAL_INTEGRATION_ENV, resolveExternalIntegrationConfig } from './external-integration';
import { authorizeExternalIntegration, executeExternalIntegration, inspectExternalIntegration, type ExternalIntegrationRuntime } from './external-integration-service';
import { runWorkExternalTargets } from '../../cli/app';
import { parseArgs } from '../../cli/args';
import { renderHuman } from '../../cli/render';
import { authorize, cleanupSandboxes, git, main, makeLab, sandbox, world, type Lab, type LeaseState, type World } from './external-integration.fixture';

// V1-02 — vários targets externos por host. Repositórios Git reais e descartáveis; banco, lease e Trusted System Writer por doubles.
jest.setTimeout(120_000);
afterAll(cleanupSandboxes);

/** Laboratório com commit raiz DISTINTO (makeLab produz o mesmo conteúdo; no mesmo segundo o SHA coincidiria). */
function lab(name: string, marker: string): Lab {
  const l = makeLab(name);
  git(l.root, 'commit', '--amend', '-q', '-m', `base ${marker}`);
  const sha = git(l.root, 'rev-parse', 'HEAD');
  return { root: l.root, rootSha: sha, baseSha: sha };
}
function fakeAnima(): string {
  const dir = sandbox(); mkdirSync(join(dir, 'apps/web'), { recursive: true });
  writeFileSync(join(dir, 'apps/web/package.json'), '{}'); writeFileSync(join(dir, 'package.json'), '{}');
  git(dir, 'init', '-q', '-b', 'main'); writeFileSync(join(dir, 'a'), '1'); git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'a');
  return git(dir, 'rev-parse', '--show-toplevel') && dir;
}
const entry = (l: Lab, reference: string, targetRef?: string) => ({ reference, repoRoot: l.root, rootCommitSha: l.rootSha, ...(targetRef ? { integration: { targetRef } } : {}) });
function registry(targets: unknown[]): Record<string, string> {
  const path = join(sandbox(), 'targets.json');
  writeFileSync(path, JSON.stringify({ version: 1, targets }));
  return { [EXTERNAL_TARGETS_FILE_ENV]: path };
}
const targetDeps = (): ExternalTargetDeps => ({ ...defaultExternalTargetDeps, animaRoot: () => fakeAnimaRoot });
let fakeAnimaRoot = '';
beforeAll(() => { fakeAnimaRoot = fakeAnima(); });
const contractOf = (reference: string, captured: Extract<Awaited<ReturnType<typeof captureExternalTargetSpec>>, { ok: true }>) =>
  ({ targetKind: 'project' as const, targetReference: reference, baseSha: captured.target.identity.baseSha, targetSpec: captured.specTarget });

describe('resolução por referência — dois targets no mesmo host', () => {
  test('cada referência resolve o SEU repositório (identidade física distinta) e a verificação volta ao repositório certo', async () => {
    const a = lab('alpha', 'A'); const b = lab('beta', 'B');
    expect(a.rootSha).not.toBe(b.rootSha);
    const env = registry([entry(a, 'ext:alpha', 'refs/heads/main'), entry(b, 'ext:beta', 'refs/heads/main')]);
    const ca = await captureExternalTargetSpec(env, { reference: 'ext:alpha', deps: targetDeps() });
    const cb = await captureExternalTargetSpec(env, { reference: 'ext:beta', deps: targetDeps() });
    if (!ca.ok || !cb.ok) throw new Error('captura falhou');
    expect(ca.target.identity.repoRootCanonical).toBe(a.root); expect(cb.target.identity.repoRootCanonical).toBe(b.root);
    expect(ca.target.identity.rootCommitSha).toBe(a.rootSha); expect(cb.target.identity.rootCommitSha).toBe(b.rootSha);
    expect(ca.target.identity.gitCommonDirCanonical).not.toBe(cb.target.identity.gitCommonDirCanonical);
    expect(await verifyExternalTargetForContract(contractOf('ext:alpha', ca), env, targetDeps())).toMatchObject({ ok: true, repoRoot: a.root });
    expect(await verifyExternalTargetForContract(contractOf('ext:beta', cb), env, targetDeps())).toMatchObject({ ok: true, repoRoot: b.root });
  });

  test('referência desconhecida falha fechado — inclusive quando só existe UM target (nenhum fallback)', async () => {
    const a = lab('alpha', 'A');
    const env = registry([entry(a, 'ext:alpha')]);
    expect(await captureExternalTargetSpec(env, { reference: 'ext:gamma', deps: targetDeps() })).toMatchObject({ ok: false, code: 'external_target_unknown' });
    expect(resolveExternalTargetConfig(env, 'ext:gamma')).toMatchObject({ ok: false, code: 'external_target_unknown' });
    expect(resolveExternalTargetConfig({}, 'ext:alpha')).toMatchObject({ ok: false, code: 'external_target_not_configured' });
  });

  test('com registro configurado a captura SEM referência é recusada (não escolhe sozinha)', async () => {
    const a = lab('alpha', 'A');
    expect(await captureExternalTargetSpec(registry([entry(a, 'ext:alpha')]), { deps: targetDeps() })).toMatchObject({ ok: false, code: 'external_target_reference_required' });
  });

  test.each([
    ['arquivo inexistente', () => ({ [EXTERNAL_TARGETS_FILE_ENV]: join(sandbox(), 'nao-existe.json') }), 'external_targets_file_unreadable'],
    ['caminho do arquivo relativo', () => ({ [EXTERNAL_TARGETS_FILE_ENV]: 'targets.json' }), 'external_targets_file_path_invalid'],
    ['conteúdo inválido', () => { const p = join(sandbox(), 't.json'); writeFileSync(p, '{"version":1,"targets":[{"reference":"ext:a"}]}'); return { [EXTERNAL_TARGETS_FILE_ENV]: p }; }, 'external_targets_file_invalid'],
    ['referência duplicada', () => { const l = lab('d', 'D'); return registry([entry(l, 'ext:dup'), entry(l, 'ext:dup')]); }, 'external_targets_duplicate_reference'],
    ['legado malformado junto de um registro válido', () => { const l = lab('e', 'E'); return { ...registry([entry(l, 'ext:alpha')]), [EXTERNAL_TARGET_ENV]: '{' }; }, 'external_target_config_invalid'],
  ])('configuração inválida (%s) falha fechado para TODAS as referências', async (_n, make, code) => {
    expect(resolveExternalTargetConfig(make(), 'ext:alpha')).toMatchObject({ ok: false, code });
    expect(loadConfiguredExternalTargets(make())).toMatchObject({ ok: false });
  });

  test('caminho de repositório incorreto e commit raiz incompatível são recusados pela identidade (T1)', async () => {
    const a = lab('alpha', 'A'); const b = lab('beta', 'B');
    const wrongPath = registry([{ reference: 'ext:alpha', repoRoot: b.root, rootCommitSha: a.rootSha }]);
    expect(await captureExternalTargetSpec(wrongPath, { reference: 'ext:alpha', deps: targetDeps() })).toMatchObject({ ok: false, code: expect.stringMatching(/^external_target_(root_commit_mismatch|base_sha_invalid)$/) });
    const wrongRoot = registry([{ reference: 'ext:alpha', repoRoot: a.root, rootCommitSha: 'f'.repeat(40) }]);
    expect(await captureExternalTargetSpec(wrongRoot, { reference: 'ext:alpha', deps: targetDeps() })).toMatchObject({ ok: false, code: 'external_target_root_commit_mismatch' });
    const missing = registry([{ reference: 'ext:alpha', repoRoot: join(sandbox(), 'nao-existe'), rootCommitSha: a.rootSha }]);
    expect(await captureExternalTargetSpec(missing, { reference: 'ext:alpha', deps: targetDeps() })).toMatchObject({ ok: false, code: 'external_target_root_unreadable' });
  });

  test('work item vinculado ao target errado: registro repontado ou referência divergente do contrato', async () => {
    const a = lab('alpha', 'A'); const b = lab('beta', 'B');
    const env = registry([entry(a, 'ext:alpha'), entry(b, 'ext:beta')]);
    const ca = await captureExternalTargetSpec(env, { reference: 'ext:alpha', deps: targetDeps() });
    if (!ca.ok) throw new Error('captura');
    // o registro passa a apontar ext:alpha para OUTRO repositório
    const repointed = registry([{ reference: 'ext:alpha', repoRoot: b.root, rootCommitSha: b.rootSha }, entry(b, 'ext:beta')]);
    expect(await verifyExternalTargetForContract(contractOf('ext:alpha', ca), repointed, targetDeps())).toMatchObject({ ok: false });
    // contrato que declara uma referência e carrega a identidade de outra
    expect(await verifyExternalTargetForContract(contractOf('ext:beta', ca), env, targetDeps())).toMatchObject({ ok: false, code: 'external_target_reference_invalid' });
  });
});

describe('compatibilidade com a configuração legada e conflitos', () => {
  test('somente legado: continua válido para a SUA referência; outras são desconhecidas', async () => {
    const a = lab('alpha', 'A');
    const env = { [EXTERNAL_TARGET_ENV]: JSON.stringify({ reference: 'ext:alpha', repoRoot: a.root, rootCommitSha: a.rootSha }) };
    const legacyNoRef = await captureExternalTargetSpec(env, { deps: targetDeps() });
    const withRef = await captureExternalTargetSpec(env, { reference: 'ext:alpha', deps: targetDeps() });
    expect(legacyNoRef).toMatchObject({ ok: true }); expect(withRef).toMatchObject({ ok: true });
    expect(await captureExternalTargetSpec(env, { reference: 'ext:beta', deps: targetDeps() })).toMatchObject({ ok: false, code: 'external_target_unknown' });
    if (!withRef.ok) throw new Error('captura');
    expect(await verifyExternalTargetForContract(contractOf('ext:alpha', withRef), env, targetDeps())).toMatchObject({ ok: true, repoRoot: a.root });
  });

  test('mesma referência no arquivo E no legado ⇒ conflito (mesmo se idênticas); referências diferentes coexistem', async () => {
    const a = lab('alpha', 'A'); const b = lab('beta', 'B');
    const legacyA = JSON.stringify({ reference: 'ext:alpha', repoRoot: a.root, rootCommitSha: a.rootSha });
    const both = { ...registry([entry(a, 'ext:alpha')]), [EXTERNAL_TARGET_ENV]: legacyA };
    expect(resolveExternalTargetConfig(both, 'ext:alpha')).toMatchObject({ ok: false, code: 'external_target_config_conflict' });
    expect(await captureExternalTargetSpec(both, { reference: 'ext:alpha', deps: targetDeps() })).toMatchObject({ ok: false, code: 'external_target_config_conflict' });
    const coexist = { ...registry([entry(b, 'ext:beta')]), [EXTERNAL_TARGET_ENV]: legacyA };
    expect(resolveExternalTargetConfig(coexist, 'ext:alpha')).toMatchObject({ ok: true, entry: { source: 'legacy' } });
    expect(resolveExternalTargetConfig(coexist, 'ext:beta')).toMatchObject({ ok: true, entry: { source: 'file' } });
  });

  test('destino de integração: arquivo, legado só para a sua referência, conflito e ausência', () => {
    const a = lab('alpha', 'A'); const b = lab('beta', 'B');
    const env = registry([entry(a, 'ext:alpha', 'refs/heads/main'), entry(b, 'ext:beta')]);
    expect(resolveExternalIntegrationConfig(env, 'ext:alpha')).toEqual({ ok: true, config: { reference: 'ext:alpha', targetRef: 'refs/heads/main' } });
    expect(resolveExternalIntegrationConfig(env, 'ext:beta')).toMatchObject({ ok: false, code: 'external_integration_not_configured' });
    const legacyBeta = { ...env, [EXTERNAL_INTEGRATION_ENV]: JSON.stringify({ reference: 'ext:beta', targetRef: 'refs/heads/release' }) };
    expect(resolveExternalIntegrationConfig(legacyBeta, 'ext:beta')).toEqual({ ok: true, config: { reference: 'ext:beta', targetRef: 'refs/heads/release' } });
    expect(resolveExternalIntegrationConfig(legacyBeta, 'ext:alpha')).toEqual({ ok: true, config: { reference: 'ext:alpha', targetRef: 'refs/heads/main' } }); // legado de outra referência não vaza
    const conflict = { ...env, [EXTERNAL_INTEGRATION_ENV]: JSON.stringify({ reference: 'ext:alpha', targetRef: 'refs/heads/main' }) };
    expect(resolveExternalIntegrationConfig(conflict, 'ext:alpha')).toMatchObject({ ok: false, code: 'external_integration_config_conflict' });
  });
});

describe('aliases do mesmo repositório físico', () => {
  test('duas referências para o mesmo git-common-dir (junction, grafia diferente) são recusadas — nenhuma burla a exclusividade', async () => {
    const a = lab('alpha', 'A');
    const alias = join(sandbox(), 'alias-de-alpha');
    symlinkSync(a.root, alias, 'junction');
    const viaLink = registry([entry(a, 'ext:alpha'), { reference: 'ext:alias', repoRoot: alias, rootCommitSha: a.rootSha }]);
    for (const reference of ['ext:alpha', 'ext:alias']) {
      expect(resolveExternalTargetConfig(viaLink, reference)).toMatchObject({ ok: false, code: 'external_target_alias_conflict' });
      expect(await captureExternalTargetSpec(viaLink, { reference, deps: targetDeps() })).toMatchObject({ ok: false, code: 'external_target_alias_conflict' });
    }
    const spelling = registry([entry(a, 'ext:alpha'), { reference: 'ext:alias2', repoRoot: a.root.split('\\').join('/'), rootCommitSha: a.rootSha }]);
    expect(resolveExternalTargetConfig(spelling, 'ext:alpha')).toMatchObject({ ok: false, code: 'external_target_alias_conflict' });
  });
});

describe('listagem (somente leitura)', () => {
  test('lista cada target com o estado; conflito e aliases aparecem como status', async () => {
    const a = lab('alpha', 'A'); const b = lab('beta', 'B');
    const env = registry([entry(a, 'ext:alpha', 'refs/heads/main'), entry(b, 'ext:beta')]);
    const before = git(a.root, 'reflog', 'show', 'HEAD');
    const listed = await listExternalTargets(env, targetDeps());
    expect(listed).toMatchObject({ ok: true, configured: true });
    if (!listed.ok) throw new Error('lista');
    expect(listed.targets.map(t => [t.reference, t.status, t.source, t.integrationTargetRef])).toEqual([['ext:alpha', 'ok', 'file', 'refs/heads/main'], ['ext:beta', 'ok', 'file', null]]);
    expect(listed.targets[0]).toMatchObject({ repoRoot: a.root, rootCommitSha: a.rootSha, headSha: a.baseSha });
    expect(git(a.root, 'reflog', 'show', 'HEAD')).toBe(before);
    const conflict = { ...env, [EXTERNAL_TARGET_ENV]: JSON.stringify({ reference: 'ext:alpha', repoRoot: a.root, rootCommitSha: a.rootSha }) };
    const l2 = await listExternalTargets(conflict, targetDeps());
    if (!l2.ok) throw new Error('lista');
    expect(l2.targets.filter(t => t.reference === 'ext:alpha').every(t => t.status === 'external_target_config_conflict')).toBe(true);
    expect(await listExternalTargets({}, targetDeps())).toEqual({ ok: true, configured: false, targets: [] });
    expect(await listExternalTargets({ [EXTERNAL_TARGETS_FILE_ENV]: join(sandbox(), 'x.json') }, targetDeps())).toMatchObject({ ok: false, code: 'external_targets_file_unreadable' });
  });

  test('comando da CLI: parsing, execução e render', async () => {
    expect(parseArgs(['work', 'external', 'targets'])).toEqual({ ok: true, command: { kind: 'work-external-targets', json: false } });
    expect(parseArgs(['work', 'external', 'targets', '--json'])).toEqual({ ok: true, command: { kind: 'work-external-targets', json: true } });
    expect(parseArgs(['work', 'external', 'targets', '--force'])).toMatchObject({ ok: false });
    expect(parseArgs(['work', 'external', 'targets', 'ext:alpha'])).toMatchObject({ ok: false });
    const a = lab('alpha', 'A');
    const env = registry([entry(a, 'ext:alpha', 'refs/heads/main')]);
    const result = await runWorkExternalTargets(() => listExternalTargets(env, targetDeps()));
    expect(result).toMatchObject({ exitCode: 0, payload: { ok: true, kind: 'work-external-targets', configured: true } });
    expect(renderHuman(result.payload)).toContain('ext:alpha');
    expect(renderHuman(result.payload)).toContain('destino de integração: refs/heads/main');
    const bad = await runWorkExternalTargets(() => listExternalTargets({ [EXTERNAL_TARGETS_FILE_ENV]: 'rel.json' }, targetDeps()));
    expect(bad).toMatchObject({ exitCode: 3, payload: { ok: false, code: 'external_targets_file_path_invalid' } });
    expect(renderHuman((await runWorkExternalTargets(() => listExternalTargets({}, targetDeps()))).payload)).toContain('Nenhum target externo configurado');
  });
});

describe('integração de dois targets pela CLI (serviço) — cada item no SEU repositório', () => {
  interface Side { w: World; rt: ExternalIntegrationRuntime; writer: { ready: boolean } }
  async function side(l: Lab, reference: string, env: Record<string, string>, leases: LeaseState, owner: string): Promise<Side> {
    const w = await world({ lab: l, reference, env: () => env, leaseState: leases, owner });
    const writer = { ready: true };
    let n = 0;
    const rt: ExternalIntegrationRuntime = {
      config: { ok: false, code: 'external_integration_reference_required', message: 'por referência' },
      configFor: ref => resolveExternalIntegrationConfig(env, ref),
      common: { getItem: w.deps.getItem, listEvents: w.deps.listEvents, verifyTarget: w.deps.verifyTarget, gitFor: w.deps.gitFor, exists: w.deps.exists },
      rpc: async args => {
        authorize(w, { id: args.authorization_id, expected: args.expected_target_sha, targetRef: args.target_ref });
        const e = w.events.at(-1)!;
        return { data: { action: 'recorded', operation_key: (e.payload as { data: { operation_key: string } }).data.operation_key }, error: null };
      },
      lease: w.deps.lease, humanReviewRefusal: w.deps.humanReviewRefusal, persist: w.deps.persist, writerReady: async () => writer.ready,
      workTreeOptions: w.deps.workTreeOptions ?? [], newAuthorizationId: ref => `ext-int-${ref.replace(/^ext:/, '')}-${String(++n).padStart(4, '0')}-${Math.random().toString(16).slice(2, 8)}`,
      ownerInstanceId: () => owner,
    };
    return { w, rt, writer };
  }
  const refMain = (l: Lab) => git(l.root, 'rev-parse', 'refs/heads/main');

  test('authorize e execute separados para cada target; o outro repositório não é tocado; recibos e lease por item', async () => {
    const a = lab('alpha', 'A'); const b = lab('beta', 'B');
    const env = registry([entry(a, 'ext:alpha', 'refs/heads/main'), entry(b, 'ext:beta', 'refs/heads/main')]);
    const leases: LeaseState = { held: new Map(), released: [], seq: 0 };
    const sa = await side(a, 'ext:alpha', env, leases, 'host-1'); const sb = await side(b, 'ext:beta', env, leases, 'host-1');
    const insp = await inspectExternalIntegration('w1', sb.rt);
    expect(insp).toMatchObject({ ok: true, inspection: { reference: 'ext:beta', repoRoot: b.root, destination: 'refs/heads/main', ready: true } });
    const authB = await authorizeExternalIntegration('w1', sb.rt);
    if (!authB.ok) throw new Error(JSON.stringify(authB));
    expect(refMain(b)).toBe(b.baseSha); expect(sb.w.receipts).toHaveLength(0); // authorize não executa
    expect(await executeExternalIntegration('w1', authB.authorizationId, sb.rt)).toMatchObject({ status: 'integrated', disposition: 'effected' });
    expect(refMain(b)).toBe(sb.w.commit); expect(refMain(a)).toBe(a.baseSha); expect(sa.w.receipts).toHaveLength(0);
    const authA = await authorizeExternalIntegration('w1', sa.rt);
    if (!authA.ok) throw new Error(JSON.stringify(authA));
    expect(await executeExternalIntegration('w1', authA.authorizationId, sa.rt)).toMatchObject({ status: 'integrated' });
    expect(refMain(a)).toBe(sa.w.commit);
    expect(projectIntegrationStatus(sa.w.events)).toBe('integrated'); expect(projectIntegrationStatus(sb.w.events)).toBe('integrated');
    expect(leases.released.map(r => r.reason)).toEqual(['completed', 'completed']);
  });

  test('referência sem destino no registro: authorize recusado antes do RPC; o outro target segue integrável', async () => {
    const a = lab('alpha', 'A'); const b = lab('beta', 'B');
    const env = registry([entry(a, 'ext:alpha', 'refs/heads/main'), entry(b, 'ext:beta')]);
    const leases: LeaseState = { held: new Map(), released: [], seq: 0 };
    const sa = await side(a, 'ext:alpha', env, leases, 'host-1'); const sb = await side(b, 'ext:beta', env, leases, 'host-1');
    expect(await authorizeExternalIntegration('w1', sb.rt)).toMatchObject({ ok: false, code: 'external_integration_not_configured' });
    expect(sb.w.events.some(e => e.type === 'integration_effect_authorized')).toBe(false);
    expect(await authorizeExternalIntegration('w1', sa.rt)).toMatchObject({ ok: true });
  });

  test('registro repontado depois da autorização: a identidade física é revalidada e NENHUM repositório muda', async () => {
    const a = lab('alpha', 'A'); const b = lab('beta', 'B');
    const env = registry([entry(a, 'ext:alpha', 'refs/heads/main'), entry(b, 'ext:beta', 'refs/heads/main')]);
    const leases: LeaseState = { held: new Map(), released: [], seq: 0 };
    const sa = await side(a, 'ext:alpha', env, leases, 'host-1');
    const auth = await authorizeExternalIntegration('w1', sa.rt);
    if (!auth.ok) throw new Error('authorize');
    // o registro do host passa a apontar ext:alpha para OUTRO repositório (o histórico persistido do item é o mesmo)
    const repointed = registry([{ reference: 'ext:alpha', repoRoot: b.root, rootCommitSha: b.rootSha, integration: { targetRef: 'refs/heads/main' } }]);
    const sa2 = { ...sa.rt, configFor: (ref: string) => resolveExternalIntegrationConfig(repointed, ref),
      common: { ...sa.rt.common, verifyTarget: (c: Parameters<typeof verifyExternalTargetForContract>[0]) => verifyExternalTargetForContract(c, repointed, sa.w.targetDeps) } };
    const out = await executeExternalIntegration('w1', auth.authorizationId, sa2);
    expect(out.status).toBe('denied');
    expect(refMain(a)).toBe(a.baseSha); expect(refMain(b)).toBe(b.baseSha);
    expect(leases.seq).toBe(0);
  });

  test('Trusted System Writer continua obrigatório com vários targets', async () => {
    const a = lab('alpha', 'A');
    const env = registry([entry(a, 'ext:alpha', 'refs/heads/main')]);
    const leases: LeaseState = { held: new Map(), released: [], seq: 0 };
    const sa = await side(a, 'ext:alpha', env, leases, 'host-1');
    const auth = await authorizeExternalIntegration('w1', sa.rt);
    if (!auth.ok) throw new Error('authorize');
    sa.writer.ready = false;
    expect(await executeExternalIntegration('w1', auth.authorizationId, sa.rt)).toEqual({ status: 'denied', reason: 'trusted_system_writer_unavailable' });
    expect(main(sa.w)).toBe(a.baseSha); expect(leases.seq).toBe(0);
  });
});
