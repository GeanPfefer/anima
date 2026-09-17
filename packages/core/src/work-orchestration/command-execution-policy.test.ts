import {
  AUTONOMOUS_COMMAND_EXECUTION_POLICY_V1,
  SUPERVISED_COMMAND_EXECUTION_POLICY_V1,
  resolveCommandExecution,
  resolveCommandExecutionPolicy,
} from './command-execution-policy';

const P = SUPERVISED_COMMAND_EXECUTION_POLICY_V1;

describe('CommandExecutionPolicyV1 — EXEC governado (SHELL/TEST/GIT)', () => {
  test('comando de dev permitido é aceito e o timeout é clampado', () => {
    const d = resolveCommandExecution({ program: 'npm', args: ['test', '--', 'src/foo.test.ts'], timeoutMs: 5_000 }, P);
    expect(d).toMatchObject({ ok: true, program: 'npm', category: 'dev', timeoutMs: 5_000 });
  });

  test('programa fora da allowlist é recusado', () => {
    expect(resolveCommandExecution({ program: 'curl', args: ['http://x'] }, P)).toMatchObject({ ok: false });
    expect(resolveCommandExecution({ program: 'rm', args: ['-rf', 'x'] }, P)).toMatchObject({ ok: false });
    expect(resolveCommandExecution({ program: 'bash', args: ['-c', 'x'] }, P)).toMatchObject({ ok: false });
  });

  test('git é read-only: status/diff/log/show aceitos; mutação recusada', () => {
    for (const sub of ['status', 'diff', 'log', 'show']) {
      expect(resolveCommandExecution({ program: 'git', args: [sub] }, P)).toMatchObject({ ok: true, category: 'git-read' });
    }
    for (const sub of ['commit', 'reset', 'push', 'fetch', 'pull', 'merge', 'rebase', 'checkout', 'clean', 'add', 'tag', 'branch']) {
      expect(resolveCommandExecution({ program: 'git', args: [sub] }, P)).toMatchObject({ ok: false });
    }
  });

  test('git diff --stat / log --oneline são aceitos; --output é recusado', () => {
    expect(resolveCommandExecution({ program: 'git', args: ['diff', '--stat'] }, P)).toMatchObject({ ok: true });
    expect(resolveCommandExecution({ program: 'git', args: ['log', '--oneline', '-n', '20'] }, P)).toMatchObject({ ok: true });
    expect(resolveCommandExecution({ program: 'git', args: ['diff', '--output=leak.txt'] }, P)).toMatchObject({ ok: false });
  });

  test('npm/pnpm só run/test: install/ci/publish/exec recusados', () => {
    expect(resolveCommandExecution({ program: 'npm', args: ['run', 'typecheck'] }, P)).toMatchObject({ ok: true });
    for (const sub of ['install', 'ci', 'publish', 'exec', 'x', 'audit', 'update', 'add']) {
      expect(resolveCommandExecution({ program: 'npm', args: [sub] }, P)).toMatchObject({ ok: false });
      expect(resolveCommandExecution({ program: 'pnpm', args: [sub] }, P)).toMatchObject({ ok: false });
    }
  });

  test('argumentos com metacaractere de shell ou ".." são recusados (defesa em profundidade)', () => {
    for (const bad of ['&&', ';rm', '|cat', '>out', '$(x)', '`x`', '../escape', 'a..b']) {
      expect(resolveCommandExecution({ program: 'node', args: [bad] }, P)).toMatchObject({ ok: false });
    }
  });

  test('perfil autônomo é mais conservador que o supervisionado', () => {
    expect(AUTONOMOUS_COMMAND_EXECUTION_POLICY_V1.allowedPrograms.length)
      .toBeLessThan(SUPERVISED_COMMAND_EXECUTION_POLICY_V1.allowedPrograms.length);
    expect(AUTONOMOUS_COMMAND_EXECUTION_POLICY_V1.maxTimeoutMs)
      .toBeLessThan(SUPERVISED_COMMAND_EXECUTION_POLICY_V1.maxTimeoutMs);
    expect(resolveCommandExecutionPolicy('autonomous').network).toBe('denied');
    expect(resolveCommandExecutionPolicy('supervised').network).toBe('denied');
    // npx não está no perfil autônomo.
    expect(resolveCommandExecution({ program: 'npx', args: ['jest'] }, AUTONOMOUS_COMMAND_EXECUTION_POLICY_V1)).toMatchObject({ ok: false });
  });
});
