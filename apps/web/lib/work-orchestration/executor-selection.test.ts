/** @jest-environment node */
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ScriptedCoderBackend } from './coder-backend';
import { isAnimaProjectRoot, needsAnimaWebTypegen, prepareAnimaValidation, projectRoot, readExecutionContract, resolveExecutorRoute, type ExecutionContract, resolveAnimaNextCli } from './executor-selection';

const SHA = 'a'.repeat(40);
const REPO_ROOT = resolve(__dirname, '../../../..');
const base: ExecutionContract = { executor: null, coderBackend: null, model: null, baseSha: null, targetKind: null, targetReference: null, resumeCheckpointCommitSha: null };
const anima: ExecutionContract = { executor: 'worktree', coderBackend: 'ollama', model: 'qwen3-coder:latest', baseSha: SHA, targetKind: 'project', targetReference: 'anima', resumeCheckpointCommitSha: null };
const legacy: ExecutionContract = { ...base, executor: 'python_runner', targetKind: 'workspace', targetReference: 'legacy-target' };

describe('readExecutionContract', () => {
  test('extrai executor, backend, modelo, SHA-base e alvo do execution_spec', () => {
    const intent = { execution_spec: { executor: 'worktree', coder_backend: 'ollama', model: 'm', base_sha: SHA, target: { kind: 'project', reference: 'anima' } } };
    expect(readExecutionContract(intent)).toEqual({ executor: 'worktree', coderBackend: 'ollama', model: 'm', baseSha: SHA, targetKind: 'project', targetReference: 'anima', resumeCheckpointCommitSha: null });
  });
  test('intent sem execution_spec devolve tudo nulo', () => {
    expect(readExecutionContract({})).toEqual(base);
    expect(readExecutionContract(null)).toEqual(base);
  });
  test('extrai o commit de retomada de resume_from_checkpoint quando é um SHA válido', () => {
    const commit = 'b'.repeat(40);
    const intent = { execution_spec: { executor: 'worktree', base_sha: SHA, target: { kind: 'project', reference: 'anima' }, resume_from_checkpoint: { base_sha: SHA, branch: 'anima-work/x', commit_sha: commit } } };
    expect(readExecutionContract(intent).resumeCheckpointCommitSha).toBe(commit);
  });
  test('ignora resume_from_checkpoint com commit malformado (fail-safe: parte da base)', () => {
    const intent = { execution_spec: { executor: 'worktree', base_sha: SHA, target: { kind: 'project', reference: 'anima' }, resume_from_checkpoint: { commit_sha: 'não-é-sha' } } };
    expect(readExecutionContract(intent).resumeCheckpointCommitSha).toBeNull();
  });
});

describe('projectRoot — independente do cwd', () => {
  const originalCwd = process.cwd();
  const originalConfigured = process.env.ANIMA_PROJECT_ROOT;

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalConfigured === undefined) delete process.env.ANIMA_PROJECT_ROOT;
    else process.env.ANIMA_PROJECT_ROOT = originalConfigured;
  });

  test('mantém a raiz correta a partir do cwd esperado apps/web', () => {
    delete process.env.ANIMA_PROJECT_ROOT;
    process.chdir(resolve(__dirname, '../..'));
    expect(projectRoot()).toBe(resolve(__dirname, '../../../..'));
    expect(isAnimaProjectRoot(projectRoot())).toBe(true);
  });

  test('execução in-process a partir da raiz do monorepo resolve o mesmo repositório', () => {
    delete process.env.ANIMA_PROJECT_ROOT;
    process.chdir(resolve(__dirname, '../../../..'));
    expect(projectRoot()).toBe(resolve(__dirname, '../../../..'));
    expect(isAnimaProjectRoot(projectRoot())).toBe(true);
  });

  test('override inválido falha fechado sem fallback para o default', () => {
    process.env.ANIMA_PROJECT_ROOT = tmpdir();
    expect(projectRoot()).toBe(resolve(tmpdir()));
    expect(isAnimaProjectRoot(projectRoot())).toBe(false);
    const selection = resolveExecutorRoute(anima);
    expect(selection.ok).toBe(false);
    if (!selection.ok) expect(selection.error.code).toBe('project_root_invalid');
  });

  test('cwd fora da árvore falha fechado sem adivinhar o repositório', () => {
    delete process.env.ANIMA_PROJECT_ROOT;
    process.chdir(tmpdir());
    expect(projectRoot()).toBe(resolve(tmpdir()));
    const selection = resolveExecutorRoute(anima);
    expect(selection.ok).toBe(false);
    if (!selection.ok) expect(selection.error.code).toBe('project_root_invalid');
  });
});

describe('resolveExecutorRoute — seleção explícita', () => {
  test('alvo Anima seleciona o executor de worktree', () => {
    const selection = resolveExecutorRoute(anima, { repoRoot: REPO_ROOT });
    expect(selection.ok).toBe(true);
    if (selection.ok) expect(selection.route.adapter.id).toBe('worktree-v1');
  });

  test('config remota explícita identifica o node no candidato sem hardcode de URL', () => {
    const saved = {
      url: process.env.ANIMA_WORKTREE_OLLAMA_URL,
      locality: process.env.ANIMA_WORKTREE_OLLAMA_LOCALITY,
      node: process.env.ANIMA_WORKTREE_OLLAMA_NODE_ID,
    };
    process.env.ANIMA_WORKTREE_OLLAMA_URL = 'http://127.0.0.1:21434';
    process.env.ANIMA_WORKTREE_OLLAMA_LOCALITY = 'remote';
    process.env.ANIMA_WORKTREE_OLLAMA_NODE_ID = 'runpod-a40';
    try {
      const selection = resolveExecutorRoute(anima, { repoRoot: REPO_ROOT });
      expect(selection.ok).toBe(true);
      if (selection.ok) expect(selection.route.candidate.modelRef).toBe('ollama:remote/runpod-a40:qwen3-coder:latest');
    } finally {
      if (saved.url === undefined) delete process.env.ANIMA_WORKTREE_OLLAMA_URL; else process.env.ANIMA_WORKTREE_OLLAMA_URL = saved.url;
      if (saved.locality === undefined) delete process.env.ANIMA_WORKTREE_OLLAMA_LOCALITY; else process.env.ANIMA_WORKTREE_OLLAMA_LOCALITY = saved.locality;
      if (saved.node === undefined) delete process.env.ANIMA_WORKTREE_OLLAMA_NODE_ID; else process.env.ANIMA_WORKTREE_OLLAMA_NODE_ID = saved.node;
    }
  });

  test('placement injeta runtime remoto sem transferir a worktree ao node', () => {
    const selection = resolveExecutorRoute(anima, {
      repoRoot: REPO_ROOT,
      ollamaRuntimeOverride: {
        url: 'http://127.0.0.1:21434',
        backendId: 'ollama:remote/gpu-a:qwen3-coder:latest',
        locality: 'remote',
        nodeId: 'gpu-a',
      },
    });
    expect(selection.ok).toBe(true);
    if (selection.ok) {
      expect(selection.route.adapter.id).toBe('worktree-v1');
      expect(selection.route.candidate.providerRef).toBe('worktree-host');
      expect(selection.route.candidate.modelRef).toBe('ollama:remote/gpu-a:qwen3-coder:latest');
    }
  });

  test('config remota inválida falha fechado sem fallback local', () => {
    const saved = process.env.ANIMA_WORKTREE_OLLAMA_URL;
    process.env.ANIMA_WORKTREE_OLLAMA_URL = 'https://gpu.example:11434';
    try {
      const selection = resolveExecutorRoute(anima, { repoRoot: REPO_ROOT });
      expect(selection.ok).toBe(false);
      if (!selection.ok) expect(selection.error.code).toBe('coder_backend_invalid');
    } finally {
      if (saved === undefined) delete process.env.ANIMA_WORKTREE_OLLAMA_URL; else process.env.ANIMA_WORKTREE_OLLAMA_URL = saved;
    }
  });

  test('backend determinístico só entra por injeção (teste)', () => {
    const selection = resolveExecutorRoute(anima, { repoRoot: REPO_ROOT, backendOverride: new ScriptedCoderBackend([]) });
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
    const selection = resolveExecutorRoute({ ...anima, baseSha: null }, { repoRoot: REPO_ROOT });
    expect(selection.ok).toBe(false);
    if (!selection.ok) expect(selection.error.code).toBe('worktree_base_sha_missing');
  });

  test('SHA-base malformado é recusado', () => {
    const selection = resolveExecutorRoute({ ...anima, baseSha: 'nope' }, { repoRoot: REPO_ROOT });
    expect(selection.ok).toBe(false);
    if (!selection.ok) expect(selection.error.code).toBe('worktree_base_sha_missing');
  });

  test('project:anima NUNCA cai silenciosamente no runner Python', () => {
    const selection = resolveExecutorRoute({ ...anima, executor: 'python_runner' }, { repoRoot: REPO_ROOT });
    expect(selection.ok).toBe(false);
    if (!selection.ok) expect(selection.error.code).toBe('anima_requires_worktree');
  });

  test('executor desconhecido falha explicitamente, sem fallback', () => {
    const selection = resolveExecutorRoute({ ...legacy, executor: 'mistério' });
    expect(selection.ok).toBe(false);
    if (!selection.ok) expect(selection.error.code).toBe('executor_unknown');
  });

  test('backend de código inválido falha explicitamente', () => {
    const selection = resolveExecutorRoute({ ...anima, coderBackend: 'inexistente' }, { repoRoot: REPO_ROOT });
    expect(selection.ok).toBe(false);
    if (!selection.ok) expect(selection.error.code).toBe('coder_backend_invalid');
  });

  test('backend selecionável de nuvem (openai) resolve o worktree com GPT', () => {
    const selection = resolveExecutorRoute({ ...anima, coderBackend: 'openai', model: 'gpt-x' }, {
      repoRoot: REPO_ROOT,
      authorizeOpenAIPaidCall: async () => undefined,
    });
    expect(selection.ok).toBe(true);
    if (selection.ok) {
      expect(selection.route.adapter.id).toBe('worktree-v1');
      expect(selection.route.candidate.modelRef).toBe('openai:gpt-x');
    }
  });

  test('backend OpenAI sem gate financeiro ligado falha antes do dispatch', () => {
    const selection = resolveExecutorRoute({ ...anima, coderBackend: 'openai', model: 'gpt-x' }, { repoRoot: REPO_ROOT });
    expect(selection).toMatchObject({ ok: false, error: { code: 'coder_backend_invalid' } });
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
