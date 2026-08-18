/** @jest-environment node */
import { zstdCompressSync } from 'node:zlib';
import type { HarnessRunTurnInput } from '../deepseek-harness-coder';
import {
  DeepSeekHarnessRuntime,
  composeHarnessTask,
  deriveTurnEndFromProcess,
  extractTurnEndFromLog,
  mapTurnEndReason,
  type HarnessFileSystem,
  type HarnessProcessResult,
  type HarnessSpawner,
} from './deepseek-harness-runtime';

const ROOT = 'C:/tmp/anima-wt/tree';

const input = (over: Partial<HarnessRunTurnInput> = {}): HarnessRunTurnInput => ({
  rootPath: ROOT,
  objective: 'Corrigir o projector',
  includedScope: ['src/projector.js'],
  excludedScope: ['node_modules'],
  temperature: 0,
  tools: { enabled: ['edit', 'write', 'read', 'pwsh'], disabled: ['str_replace_editor'] },
  stepBudget: 12,
  signal: new AbortController().signal,
  ...over,
});

const jsonl = (...events: object[]): string => events.map(e => JSON.stringify(e)).join('\n') + '\n';
const zstd = (text: string): Buffer => zstdCompressSync(Buffer.from(text, 'utf8'));

function fakeFs(over: Partial<HarnessFileSystem> & { log?: Buffer | null; sessionDirs?: string[] } = {}): HarnessFileSystem & { writes: Map<string, string>; mkdirs: string[] } {
  const writes = new Map<string, string>();
  const mkdirs: string[] = [];
  return {
    writes, mkdirs,
    mkdirp: async dir => { mkdirs.push(dir); },
    writeFile: async (path, content) => { writes.set(path, content); },
    listSessionDirs: over.listSessionDirs ?? (async () => over.sessionDirs ?? ['C:/dshhome/sessions/cwd/session-abc123']),
    readSessionLog: over.readSessionLog ?? (async () => over.log ?? null),
  };
}

function fakeSpawner(result: HarnessProcessResult): HarnessSpawner & { last: Parameters<HarnessSpawner['run']>[0] | null } {
  const state = { last: null as Parameters<HarnessSpawner['run']>[0] | null };
  return {
    get last() { return state.last; },
    run: async args => { state.last = args; return result; },
  };
}

const runtime = (fs: HarnessFileSystem, spawner: HarnessSpawner) => new DeepSeekHarnessRuntime({
  nodeExecPath: 'C:/node/node.exe',
  dshBinPath: 'C:/anima/node_modules/@deepseek-ai/dsh/lib/bin.js',
  pluginPath: 'G:/anima/apps/web/lib/work-orchestration/harness/anima-harness-plugin.mjs',
  ollamaBaseUrl: 'http://127.0.0.1:11434/v1',
  model: 'qwen3-coder:latest',
  dshHomeFactory: () => 'C:/tmp/anima-wt/dsh-home',
  fs, spawner,
});

describe('composeHarnessTask', () => {
  test('inclui objetivo, escopo permitido/excluído e o encerramento', () => {
    const task = composeHarnessTask(input());
    expect(task).toContain('Corrigir o projector');
    expect(task).toContain('src/projector.js');
    expect(task).toContain('Do NOT modify');
    expect(task).toContain('node_modules');
    expect(task).toContain('Make the change, then stop.');
  });

  test('carriedContext is prior-attempt resumption, not internal gate retry', () => {
    const carried = {
      isNewAttempt: true,
      continueFromCheckpoint: true,
      nextStep: 'ajustar projector',
      remainingSteps: ['rodar teste'],
      risks: [],
      touchedResources: [],
      previousFailures: ['npm test: 1 failing'],
    } as const;

    const task = composeHarnessTask(input({ carriedContext: carried }));

    expect(task).toContain('resuming work from a previous attempt');
    expect(task).not.toContain('retry after the host observed a gate failure');
    expect(task).toContain('npm test: 1 failing');
    expect(task).toContain('ajustar projector');
  });

  test('hostValidationFeedback is internal retry after real host gate failure', () => {
    const feedback = {
      failedGate: {
        label: 'unit',
        command: 'npm test',
        exitCode: 1,
        timedOut: false,
        cancelled: false,
      },
      retryIndex: 1,
      retryLimit: 1,
    } as const;

    const task = composeHarnessTask(input({ hostValidationFeedback: feedback }));

    expect(task).toContain('retry after the host observed a gate failure');
    expect(task).toContain('do NOT claim tests pass');
    expect(task).toContain('unit');
    expect(task).toContain('npm test');
    expect(task).toContain('exitCode: 1');
    expect(task).toContain('retry 1 of 1');
  });
});

describe('mapTurnEndReason', () => {
  test('completed → completed (nunca sucesso; o core classifica)', () => {
    expect(mapTurnEndReason({ kind: 'completed' })).toEqual({ kind: 'completed' });
  });
  test('aborted pelo step budget preserva a causa aninhada hook', () => {
    expect(mapTurnEndReason({ kind: 'aborted', reason: { kind: 'hook', reason: 'step-budget-exhausted:12' } }))
      .toEqual({ kind: 'aborted', reasonKind: 'hook', reasonReason: 'step-budget-exhausted:12' });
  });
  test('aborted por outra causa (user) preserva a causa', () => {
    expect(mapTurnEndReason({ kind: 'aborted', reason: { kind: 'user' } }))
      .toEqual({ kind: 'aborted', reasonKind: 'user', reasonReason: null });
  });
  test('kinds terminais/desconhecidos caem em error (fail-closed)', () => {
    expect(mapTurnEndReason({ kind: 'error', error: {} })).toEqual({ kind: 'error' });
    expect(mapTurnEndReason({ kind: 'max-tokens' })).toEqual({ kind: 'error' });
    expect(mapTurnEndReason({ kind: 'blocked' })).toEqual({ kind: 'error' });
    expect(mapTurnEndReason({})).toBeNull();
    expect(mapTurnEndReason(null)).toBeNull();
  });
});

describe('extractTurnEndFromLog', () => {
  test('extrai o último turn/end do JSONL plano; ignora outros eventos', () => {
    const log = jsonl(
      { type: 'session', id: 'session-x' },
      { type: 'turn/start', turn: 0 },
      { type: 'turn/end', turn: 0, reason: { kind: 'completed' } },
    );
    expect(extractTurnEndFromLog(log)).toEqual({ kind: 'completed' });
  });
  test('sem turn/end (saída suja sem flush) → null', () => {
    expect(extractTurnEndFromLog(jsonl({ type: 'session', id: 'y' }))).toBeNull();
  });
});

describe('deriveTurnEndFromProcess', () => {
  test('host matou → aborted/signal; exit 0 → completed; exit != 0 → error', () => {
    expect(deriveTurnEndFromProcess({ exitCode: null, hostAborted: true }))
      .toEqual({ kind: 'aborted', reasonKind: 'signal', reasonReason: 'host-cancelled' });
    expect(deriveTurnEndFromProcess({ exitCode: 0, hostAborted: false })).toEqual({ kind: 'completed' });
    expect(deriveTurnEndFromProcess({ exitCode: 1, hostAborted: false })).toEqual({ kind: 'error' });
  });
});

describe('DeepSeekHarnessRuntime.runTurn — I/O injetado', () => {
  test('escreve o patch, cria o DSH_HOME e spawna node+dsh com cwd/env/args corretos', async () => {
    const log = zstd(jsonl({ type: 'turn/end', turn: 0, reason: { kind: 'completed' } }));
    const fs = fakeFs({ log });
    const spawner = fakeSpawner({ exitCode: 0, hostAborted: false });
    const result = await runtime(fs, spawner).runTurn(input());

    // patch escrito com o formato verificado (rota Ollama + plugin).
    const patch = [...fs.writes.values()][0] ?? '';
    expect(patch).toContain('provider: ollama');
    expect(patch).toContain("model: 'qwen3-coder:latest'");
    expect(patch).toContain('anima-harness-budget');
    // Catálogo focado por default (correção do tool-protocol, prova viva).
    expect(patch).toContain('- id: tool-web');
    expect(patch).toContain('- id: tool-goal');
    expect(fs.mkdirs).toContain('C:/tmp/anima-wt/dsh-home');
    // spawn: node + bin do dsh, cwd = worktree, envelope no env.
    expect(spawner.last?.command).toBe('C:/node/node.exe');
    expect(spawner.last?.args[0]).toBe('C:/anima/node_modules/@deepseek-ai/dsh/lib/bin.js');
    expect(spawner.last?.args).toEqual(expect.arrayContaining(['--profile', 'headless', '--patch']));
    expect(spawner.last?.cwd).toBe(ROOT);
    expect(spawner.last?.env.DSH_TELEMETRY_MODE).toBe('DISABLED');
    expect(spawner.last?.env.DSH_PERMISSION_MODE).toBe('workspace-write');
    // turn/end do log + sessionId do diretório.
    expect(result.turnEnd).toEqual({ kind: 'completed' });
    expect(result.sessionId).toBe('session-abc123');
  });

  test('turn/end aborted pelo step budget é lido do log (evidência de runaway contido)', async () => {
    const log = zstd(jsonl({ type: 'turn/end', turn: 0, reason: { kind: 'aborted', reason: { kind: 'hook', reason: 'step-budget-exhausted:12' } } }));
    const fs = fakeFs({ log });
    const result = await runtime(fs, fakeSpawner({ exitCode: 0, hostAborted: false })).runTurn(input());
    expect(result.turnEnd).toEqual({ kind: 'aborted', reasonKind: 'hook', reasonReason: 'step-budget-exhausted:12' });
  });

  test('cancelamento do host: mata o filho, NÃO lê o log, desfecho aborted/signal', async () => {
    const fs = fakeFs({ log: zstd(jsonl({ type: 'turn/end', turn: 0, reason: { kind: 'completed' } })) });
    let readCalled = false;
    fs.readSessionLog = async () => { readCalled = true; return null; };
    const result = await runtime(fs, fakeSpawner({ exitCode: null, hostAborted: true })).runTurn(input());
    expect(result.turnEnd).toEqual({ kind: 'aborted', reasonKind: 'signal', reasonReason: 'host-cancelled' });
    expect(readCalled).toBe(false);
  });

  test('log sem flush cai nos sinais de processo (exit 0 → completed)', async () => {
    const fs = fakeFs({ log: zstd(jsonl({ type: 'session', id: 'z' })) }); // sem turn/end
    const result = await runtime(fs, fakeSpawner({ exitCode: 0, hostAborted: false })).runTurn(input());
    expect(result.turnEnd).toEqual({ kind: 'completed' });
  });

  test('fail-closed: rootPath não absoluto faz o planejador (e o runTurn) rejeitarem', async () => {
    const fs = fakeFs();
    await expect(runtime(fs, fakeSpawner({ exitCode: 0, hostAborted: false })).runTurn(input({ rootPath: 'relativo' })))
      .rejects.toThrow(/worktreeRoot/);
  });
});
