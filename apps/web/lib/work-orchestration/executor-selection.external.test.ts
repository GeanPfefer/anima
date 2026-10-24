/** @jest-environment node */
import { projectRoot, readExecutionContract, resolveExecutorRoute, type ExecutionContract } from './executor-selection';

const SHA = 'a'.repeat(40);
const identity = { repo_root_canonical: '/srv/shop', git_common_dir_canonical: '/srv/shop/.git', root_commit_sha: 'b'.repeat(40), base_sha: SHA };
const contractOf = (target: Record<string, unknown>, executor: string = 'worktree', extra: Record<string, unknown> = {}): ExecutionContract =>
  readExecutionContract({ execution_spec: { executor, coder_backend: 'ollama', model: 'm', base_sha: SHA, target, ...extra } });
const external = contractOf({ kind: 'project', reference: 'ext:shop', identity });

type Targets = { options: { targets: { resolve: (ref: string) => { repoRoot: string; sha: string } | null } } };
const targetsOf = (selection: ReturnType<typeof resolveExecutorRoute>) => {
  if (!selection.ok) throw new Error(`seleção falhou: ${selection.error.code}`);
  return (selection.route.adapter as unknown as Targets).options.targets;
};

describe('resolveExecutorRoute — target externo', () => {
  test('o contrato externo carrega o target cru; o do Anima não muda de forma', () => {
    expect(external.targetSpec).toMatchObject({ reference: 'ext:shop', identity });
    expect(contractOf({ kind: 'project', reference: 'anima' }).targetSpec).toBeUndefined();
  });

  test('sem verificação do host nenhuma raiz é presumida — nem com repoRoot do Anima', () => {
    for (const options of [{}, { repoRoot: projectRoot() }]) {
      expect(resolveExecutorRoute(external, options)).toMatchObject({ ok: false, error: { code: 'external_target_unverified' } });
    }
  });

  test('verificação para OUTRA referência não vale', () => {
    expect(resolveExecutorRoute(external, { externalTarget: { reference: 'ext:other', repoRoot: '/srv/other' } }))
      .toMatchObject({ ok: false, error: { code: 'external_target_unverified' } });
  });

  test('com o target verificado, o adapter resolve SOMENTE aquela referência para a raiz verificada, sobre o SHA-base', () => {
    const selection = resolveExecutorRoute(external, { externalTarget: { reference: 'ext:shop', repoRoot: '/srv/shop' }, repoRoot: projectRoot() });
    const targets = targetsOf(selection);
    expect(targets.resolve('ext:shop')).toMatchObject({ repoRoot: '/srv/shop', sha: SHA });
    expect(targets.resolve('anima')).toBeNull();
    expect(targets.resolve('ext:other')).toBeNull();
  });

  test('o target externo não herda a preparação do Anima (typegen)', () => {
    const selection = resolveExecutorRoute(external, { externalTarget: { reference: 'ext:shop', repoRoot: '/srv/shop' } });
    if (!selection.ok) throw new Error('setup');
    const options = (selection.route.adapter as unknown as { options: { prepareValidation?: unknown } }).options;
    expect(options.prepareValidation).toBeUndefined();
  });

  test('exige worktree: nunca cai no runner Python', () => {
    const c = contractOf({ kind: 'project', reference: 'ext:shop', identity }, 'python_runner');
    expect(resolveExecutorRoute(c, { externalTarget: { reference: 'ext:shop', repoRoot: '/srv/shop' } })).toMatchObject({ ok: false, error: { code: 'external_requires_worktree' } });
  });

  test('investigação read-only continua exclusiva de project:anima', () => {
    const c = contractOf({ kind: 'project', reference: 'ext:shop', identity }, 'investigation-v1', { effect_class: 'read_only', permissions: ['workspace_read'], coder_backend: 'codex-cli', model: 'default' });
    expect(resolveExecutorRoute(c, { externalTarget: { reference: 'ext:shop', repoRoot: '/srv/shop' } }).ok).toBe(false);
  });

  test('identidade externa pendurada numa referência não-externa (anima disfarçado) é recusada', () => {
    for (const reference of ['anima', 'project:anima', 'shop']) {
      const c = contractOf({ kind: 'project', reference, identity });
      expect(resolveExecutorRoute(c, { repoRoot: projectRoot() })).toMatchObject({ ok: false, error: { code: 'external_identity_on_non_external_target' } });
    }
  });

  test('referência desconhecida no worktree não cai mais silenciosamente na raiz do Anima', () => {
    const c = contractOf({ kind: 'project', reference: 'qualquer-coisa' });
    expect(resolveExecutorRoute(c, { repoRoot: projectRoot() })).toMatchObject({ ok: false, error: { code: 'worktree_target_unknown' } });
  });

  test('regressão: project:anima segue resolvendo a raiz do Anima', () => {
    const c = contractOf({ kind: 'project', reference: 'anima' });
    expect(targetsOf(resolveExecutorRoute(c, { repoRoot: projectRoot() })).resolve('anima')).toMatchObject({ repoRoot: projectRoot() });
  });
});
