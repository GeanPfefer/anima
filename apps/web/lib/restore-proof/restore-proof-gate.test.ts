/** @jest-environment node */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../../..');
let execution: SpawnSyncReturns<string> | undefined;
let output = '';
let before = '';
let after = '';

function status(): string {
  const result = spawnSync('git', ['status', '--porcelain', '--', 'supabase'], {
    cwd: root, encoding: 'utf8', shell: false,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Não foi possível observar o Git: ${result.error?.message ?? result.stderr}`);
  }
  return result.stdout;
}

function hasBytecode(directory: string): boolean {
  return readdirSync(directory, { withFileTypes: true }).some((entry) =>
    entry.name === '__pycache__' ||
    (entry.isDirectory() && hasBytecode(path.join(directory, entry.name))),
  );
}

beforeAll(() => {
  before = status();
  const args = ['-B', '-m', 'unittest', 'discover', '-s', 'supabase/tests',
    '-p', 'restore_proof_snapshot_test.py', '-v'];
  const options = {
    cwd: root, encoding: 'utf8' as const, shell: false,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    timeout: 600000, maxBuffer: 8 * 1024 * 1024,
  };
  execution = spawnSync('python', args, options);
  // Retry only when the executable is absent; never run the suite twice.
  if (execution.error && 'code' in execution.error && execution.error.code === 'ENOENT') {
    execution = spawnSync('py', ['-3', ...args], options);
  }
  output = `${execution.stdout ?? ''}\n${execution.stderr ?? ''}`;
  after = status();
}, 650000);

test('Encontra o interpretador disponível', () => {
  expect(execution).toBeDefined();
  expect(execution?.error).toBeUndefined();
});

test('Encerra a suíte sintética com sucesso', () => {
  if (execution?.status !== 0) throw new Error(output || execution?.error?.message || 'Execução ausente');
  expect(execution.status).toBe(0);
});

test('Comprova a quantidade mínima de provas executadas', () => {
  expect(output).toMatch(/\bOK\b/);
  const match = /Ran (\d+) tests?\b/.exec(output);
  expect(match).not.toBeNull();
  expect(Number(match?.[1] ?? '0')).toBeGreaterThanOrEqual(15);
});

test('Recusa falhas e provas omitidas', () => {
  expect(output).not.toMatch(/Traceback|FAILED|skipped/);
});

test('Preserva os arquivos observados pelo repositório', () => {
  expect(after).toBe(before);
  expect(hasBytecode(path.join(root, 'supabase'))).toBe(false);
});
