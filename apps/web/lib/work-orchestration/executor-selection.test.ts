/** @jest-environment node */
import { tmpdir } from 'node:os';
import { ScriptedCoderBackend } from './coder-backend';
import { readExecutionContract, resolveExecutorRoute, type ExecutionContract } from './executor-selection';

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
});
