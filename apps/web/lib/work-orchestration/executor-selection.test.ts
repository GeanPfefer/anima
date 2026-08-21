/** @jest-environment node */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ScriptedCoderBackend } from './coder-backend';
import { needsAnimaWebTypegen, prepareAnimaValidation, readExecutionContract, resolveExecutorRoute, type ExecutionContract, resolveAnimaNextCli } from './executor-selection';

const SHA = 'a'.repeat(40);
const base: ExecutionContract = { executor: null, coderBackend: null, model: null, baseSha: null, targetKind: null, targetReference: null };
const anima: ExecutionContract = { executor: 'worktree', coderBackend: 'ollama', model: 'qwen3-coder:latest', baseSha: SHA, targetKind: 'project', targetReference: 'anima' };
const legacy: ExecutionContract = { ...base, executor: 'python_runner', targetKind: 'workspace', targetReference: 'legacy-target' };

describe('readExecutionContract', () => {
  test('extrai executor, backend, modelo, SHA-base e alvo do execution_spec', () => {
    const intent = { execution_spec: { executor: 'worktree', coder_backend: 'ollama', model: 'm', base_sha: SHA, target: { kind: 'project', reference: 'anima' } } };
    expect(readExecutionContract(intent)).toEqual({ executor: 'worktree', coderBackend: 'ollama', model: 'm', baseSha: SHA, targetKind: 'project', targetReference: 'anima' });
  });
  test('intent sem execution_spec devolve tudo nulo', () => {
    expect(readExecutionContract({})).toEqual(base);
    expect(readExecutionContract(null)).toEqual(base);
  });
});

describe('resolveExecutorRoute — seleção explícita', () => {
  test('alvo Anima seleciona o executor de worktree', () => {
    const selection = resolveExecutorRoute(anima, { repoRoot: tmpdir() });
    expect(selection.ok).toBe(true);
    if (selection.ok) expect(selection.route.adapter.id).toBe('worktree-v1');
  });

  test('backend determinístico só entra por injeção (teste)', () => {
    const selection = resolveExecutorRoute(anima, { repoRoot: tmpdir(), backendOverride: new ScriptedCoderBackend([]) });
    expect(selection.ok).toBe(true);
    if (selection.ok) expect(selection.route.candidate.executorId).toBe('worktree-v1');
  });

  describe('caminho legado (runner Python)', () => {
    const saved = { root: process.env.ANIMA_LOCAL_RUNNER_ROOT, targets: process.env.ANIMA_LOCAL_TARGETS_JSON };
    beforeAll(() => {
      process.env.ANIMA_LOCAL_RUNNER_ROOT = tmpdir();
      process.env.ANIMA_LOCAL_TARGETS_JSON = JSON.stringify({ 'legacy-target': tmpdir() });
    });
    afterAll(() => {
      if (saved.root === undefined) delete process.env.ANIMA_LOCAL_RUNNER_ROOT; else process.env.ANIMA_LOCAL_RUNNER_ROOT = saved.root;
      if (saved.targets === undefined) delete process.env.ANIMA_LOCAL_TARGETS_JSON; else process.env.ANIMA_LOCAL_TARGETS_JSON = saved.targets;
    });

    test('alvo legado continua selecionando o runner Python', () => {
      const selection = resolveExecutorRoute(legacy);
      expect(selection.ok).toBe(true);
      if (selection.ok) expect(selection.route.adapter.id).toBe('local-runner-v1');
    });

    test('executor ausente (item legado) usa o runner Python', () => {
      const selection = resolveExecutorRoute({ ...legacy, executor: null });
      expect(selection.ok).toBe(true);
      if (selection.ok) expect(selection.route.adapter.id).toBe('local-runner-v1');
    });
  });

  test('config inválida (worktree sem SHA-base) falha explicitamente', () => {
    const selection = resolveExecutorRoute({ ...anima, baseSha: null }, { repoRoot: tmpdir() });
    expect(selection.ok).toBe(false);
    if (!selection.ok) expect(selection.error.code).toBe('worktree_base_sha_missing');
  });

  test('SHA-base malformado é recusado', () => {
    const selection = resolveExecutorRoute({ ...anima, baseSha: 'nope' }, { repoRoot: tmpdir() });
    expect(selection.ok).toBe(false);
    if (!selection.ok) expect(selection.error.code).toBe('worktree_base_sha_missing');
  });

  test('project:anima NUNCA cai silenciosamente no runner Python', () => {
    const selection = resolveExecutorRoute({ ...anima, executor: 'python_runner' }, { repoRoot: tmpdir() });
    expect(selection.ok).toBe(false);
    if (!selection.ok) expect(selection.error.code).toBe('anima_requires_worktree');
  });

  test('executor desconhecido falha explicitamente, sem fallback', () => {
    const selection = resolveExecutorRoute({ ...legacy, executor: 'mistério' });
    expect(selection.ok).toBe(false);
    if (!selection.ok) expect(selection.error.code).toBe('executor_unknown');
  });

  test('backend de código inválido falha explicitamente', () => {
    const selection = resolveExecutorRoute({ ...anima, coderBackend: 'inexistente' }, { repoRoot: tmpdir() });
    expect(selection.ok).toBe(false);
    if (!selection.ok) expect(selection.error.code).toBe('coder_backend_invalid');
  });

  test('backend selecionável de nuvem (openai) resolve o worktree com GPT', () => {
    const selection = resolveExecutorRoute({ ...anima, coderBackend: 'openai', model: 'gpt-x' }, { repoRoot: tmpdir() });
    expect(selection.ok).toBe(true);
    if (selection.ok) {
      expect(selection.route.adapter.id).toBe('worktree-v1');
      expect(selection.route.candidate.modelRef).toBe('openai:gpt-x');
    }
  });
});


describe('needsAnimaWebTypegen', () => {
  test('root typecheck alcanca apps/web', () => {
    expect(needsAnimaWebTypegen([
      { label: 'typecheck', command: 'npm run typecheck' },
    ])).toBe(true);
  });

  test('typecheck explicitamente escopado para apps/web precisa de typegen', () => {
    expect(needsAnimaWebTypegen([
      { label: 'web', command: 'npm run typecheck --workspace=apps/web' },
    ])).toBe(true);
  });

  test('typecheck de packages/core nao precisa de typegen web', () => {
    expect(needsAnimaWebTypegen([
      { label: 'core', command: 'npm run typecheck --workspace=packages/core' },
    ])).toBe(false);
  });

  test('gates sem typecheck web nao precisam de typegen', () => {
    expect(needsAnimaWebTypegen([
      { label: 'tests', command: 'npm test' },
      { label: 'build', command: 'npm run build' },
      { label: 'declared-only' },
    ])).toBe(false);
  });

  test('qualquer criterio que alcance o web e suficiente', () => {
    expect(needsAnimaWebTypegen([
      { label: 'core', command: 'npm run typecheck --workspace=packages/core' },
      { label: 'web', command: 'npm run typecheck --workspace=apps/web' },
    ])).toBe(true);
  });

  test('typecheck escopado por NOME do pacote (@anima/web) tambem precisa de typegen', () => {
    // safeValidationCommand admite e o npm resolve `--workspace=@anima/web` ao
    // mesmo apps/web; sem detectar essa forma, o gate falharia na worktree.
    expect(needsAnimaWebTypegen([
      { label: 'web', command: 'npm run typecheck --workspace=@anima/web' },
    ])).toBe(true);
    expect(needsAnimaWebTypegen([
      { label: 'web', command: 'npm.cmd run typecheck --workspace=@anima/web' },
    ])).toBe(true);
  });

  test('variantes de normalizacao do seletor apps/web sao cobertas', () => {
    expect(needsAnimaWebTypegen([{ label: 'web', command: 'npm.cmd run typecheck --workspace=apps/web' }])).toBe(true);
    expect(needsAnimaWebTypegen([{ label: 'web', command: 'npm run typecheck --workspace=apps/web/' }])).toBe(true);
    expect(needsAnimaWebTypegen([{ label: 'web', command: '  NPM RUN TYPECHECK --workspace=apps/web  ' }])).toBe(true);
    expect(needsAnimaWebTypegen([{ label: 'web', command: 'npm run typecheck --workspace=apps/web -- --pretty' }])).toBe(true);
  });

  test('typecheck do core por caminho ou por nome NAO dispara typegen web', () => {
    expect(needsAnimaWebTypegen([{ label: 'core', command: 'npm run typecheck --workspace=packages/core' }])).toBe(false);
    expect(needsAnimaWebTypegen([{ label: 'core', command: 'npm run typecheck --workspace=@anima/core' }])).toBe(false);
  });

  test('gates de test/build do web nao dependem de .next/types (build gera os proprios tipos)', () => {
    expect(needsAnimaWebTypegen([{ label: 'test', command: 'npm test --workspace=apps/web' }])).toBe(false);
    expect(needsAnimaWebTypegen([{ label: 'build', command: 'npm run build --workspace=@anima/web' }])).toBe(false);
  });
});


describe('resolveAnimaNextCli', () => {
  test('resolve o CLI pelo node_modules fisico do workspace web', () => {
    const webRoot = process.cwd();
    const resolved = resolveAnimaNextCli(webRoot);

    expect(resolved).toBe(
      join(webRoot, 'node_modules', 'next', 'dist', 'bin', 'next'),
    );
  });

  test('falha explicitamente quando o workspace nao possui Next', () => {
    expect(() =>
      resolveAnimaNextCli(join(process.cwd(), '__missing-web-workspace__')),
    ).toThrow(/Next CLI nao encontrado no workspace web/);
  });
});

describe('prepareAnimaValidation', () => {
  test('nao executa typegen quando os gates nao alcancam apps/web', async () => {
    const calls: unknown[] = [];

    await prepareAnimaValidation(
      {
        rootPath: 'C:/fake/worktree',
        validationCriteria: [
          { label: 'core', command: 'npm run typecheck --workspace=packages/core' },
        ],
        signal: new AbortController().signal,
      },
      {
        resolveNextCli: () => {
          throw new Error('nao deveria resolver Next');
        },
        run: async (...args) => {
          calls.push(args);
          throw new Error('nao deveria executar processo');
        },
      },
    );

    expect(calls).toHaveLength(0);
  });

  test('typecheck web resolve Next pelo apps/web da worktree e executa typegen', async () => {
    const resolvedFrom: string[] = [];
    const calls: Array<{
      file: string;
      args: readonly string[];
      options: { cwd: string; timeoutMs: number; signal?: AbortSignal };
    }> = [];

    const signal = new AbortController().signal;

    await prepareAnimaValidation(
      {
        rootPath: 'C:/fake/worktree',
        validationCriteria: [
          { label: 'web', command: 'npm run typecheck --workspace=apps/web' },
        ],
        signal,
      },
      {
        resolveNextCli: webRoot => {
          resolvedFrom.push(webRoot);
          return 'C:/fake/next/dist/bin/next';
        },
        run: async (file, args, options) => {
          calls.push({ file, args, options });
          return {
            command: [file, ...args].join(' '),
            exitCode: 0,
            stdout: 'ok',
            stderr: '',
            durationMs: 10,
            timedOut: false,
            cancelled: false,
          };
        },
      },
    );

    expect(resolvedFrom).toEqual([join('C:/fake/worktree', 'apps', 'web')]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      file: process.execPath,
      args: ['C:/fake/next/dist/bin/next', 'typegen', '.'],
      options: {
        cwd: join('C:/fake/worktree', 'apps', 'web'),
        timeoutMs: 120000,
        signal,
      },
    });
  });

  test('gate escopado por nome do pacote (@anima/web) TAMBEM executa o typegen', async () => {
    // Fecha o loop do fix: a deteccao cobre @anima/web, entao a preparacao roda
    // o typegen — sem isso o gate falharia na worktree (.next/types ausente).
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    await prepareAnimaValidation(
      {
        rootPath: 'C:/fake/worktree',
        validationCriteria: [
          { label: 'web', command: 'npm run typecheck --workspace=@anima/web' },
        ],
        signal: new AbortController().signal,
      },
      {
        resolveNextCli: () => 'C:/fake/next/dist/bin/next',
        run: async (file, args) => {
          calls.push({ file, args });
          return { command: [file, ...args].join(' '), exitCode: 0, stdout: 'ok', stderr: '', durationMs: 10, timedOut: false, cancelled: false };
        },
      },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ file: process.execPath, args: ['C:/fake/next/dist/bin/next', 'typegen', '.'] });
  });

  test('falha do next typegen rejeita a preparacao', async () => {
    await expect(
      prepareAnimaValidation(
        {
          rootPath: 'C:/fake/worktree',
          validationCriteria: [
            { label: 'typecheck', command: 'npm run typecheck' },
          ],
          signal: new AbortController().signal,
        },
        {
          resolveNextCli: () => 'C:/fake/next/dist/bin/next',
          run: async (file, args) => ({
            command: [file, ...args].join(' '),
            exitCode: 1,
            stdout: '',
            stderr: 'synthetic typegen failure',
            durationMs: 20,
            timedOut: false,
            cancelled: false,
          }),
        },
      ),
    ).rejects.toThrow('synthetic typegen failure');
  });
});
