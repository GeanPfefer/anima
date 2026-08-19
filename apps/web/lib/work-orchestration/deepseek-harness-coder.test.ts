/** @jest-environment node */
import type { CoderWorkspace } from './coder-backend';
import {
  DEFAULT_HARNESS_TEMPERATURE,
  DEFAULT_HARNESS_TOOLS,
  DeepSeekHarnessCoderBackend,
  type HarnessRunTurnInput,
  type HarnessRunTurnResult,
  type HarnessRuntime,
} from './deepseek-harness-coder';
import { POC_HARNESS_STEP_BUDGET } from '@anima/core';

const ROOT = process.platform === 'win32' ? 'C:\\tmp\\anima-wt\\tree' : '/tmp/anima-wt/tree';

/** Workspace enraizado em memória: expõe `rootPath` como o host faria. `null`
 * omite o campo de propósito (o host não-enraizado), para exercer o fail-closed. */
function rootedWorkspace(rootPath: string | null = ROOT): CoderWorkspace {
  const files = new Map<string, string>();
  return {
    readFile: async path => files.get(path.replace(/\\/g, '/')) ?? null,
    writeFile: async (path, content) => { files.set(path.replace(/\\/g, '/'), content); return true; },
    ...(rootPath !== null ? { rootPath } : {}),
  };
}

/** Runtime falso: grava a entrada recebida e devolve um `turn/end` configurável.
 * Nenhum teste importa o @deepseek-ai/dsh nem chama modelo/rede. */
function fakeRuntime(result: HarnessRunTurnResult): HarnessRuntime & { last: HarnessRunTurnInput | null } {
  const state = { last: null as HarnessRunTurnInput | null };
  return {
    get last() { return state.last; },
    runTurn: async (input: HarnessRunTurnInput) => { state.last = input; return result; },
  };
}

const completed = (over: Partial<HarnessRunTurnResult> = {}): HarnessRunTurnResult => ({
  sessionId: 'session-abc', turnEnd: { kind: 'completed' }, steps: 5, ...over,
});

const request = { objective: 'Corrigir projector', includedScope: ['src/projector.js'], excludedScope: ['node_modules'] };

describe('DeepSeekHarnessCoderBackend — identidade e config', () => {
  test('id é deepseek-harness:<model> (fonte única)', () => {
    const backend = new DeepSeekHarnessCoderBackend({ runtime: fakeRuntime(completed()), model: 'qwen3-coder:latest' });
    expect(backend.id).toBe('deepseek-harness:qwen3-coder:latest');
  });

  test('defaults do POC: temperature=0, ferramentas com str_replace_editor desabilitada, orçamento do POC', async () => {
    const runtime = fakeRuntime(completed());
    const backend = new DeepSeekHarnessCoderBackend({ runtime, model: 'm' });
    await backend.edit(request, rootedWorkspace(), new AbortController().signal);
    expect(runtime.last?.temperature).toBe(DEFAULT_HARNESS_TEMPERATURE);
    expect(runtime.last?.temperature).toBe(0);
    expect(runtime.last?.tools).toEqual(DEFAULT_HARNESS_TOOLS);
    expect(runtime.last?.tools.disabled).toContain('str_replace_editor');
    expect(runtime.last?.tools.enabled).toEqual(expect.arrayContaining(['edit', 'write', 'read', 'glob', 'grep', 'pwsh']));
    expect(runtime.last?.stepBudget).toBe(POC_HARNESS_STEP_BUDGET);
  });

  test('temperature, orçamento e ferramentas são configuráveis', async () => {
    const runtime = fakeRuntime(completed());
    const backend = new DeepSeekHarnessCoderBackend({
      runtime, model: 'm', temperature: 0.4, stepBudget: 6, tools: { enabled: ['read'], disabled: ['pwsh'] },
    });
    await backend.edit(request, rootedWorkspace(), new AbortController().signal);
    expect(runtime.last?.temperature).toBe(0.4);
    expect(runtime.last?.stepBudget).toBe(6);
    expect(runtime.last?.tools).toEqual({ enabled: ['read'], disabled: ['pwsh'] });
  });

  test('orçamento malformado cai no valor do POC (resolveHarnessStepBudget)', async () => {
    const runtime = fakeRuntime(completed());
    const backend = new DeepSeekHarnessCoderBackend({ runtime, model: 'm', stepBudget: -3 });
    await backend.edit(request, rootedWorkspace(), new AbortController().signal);
    expect(runtime.last?.stepBudget).toBe(1); // clampado ao mínimo
  });
});

describe('DeepSeekHarnessCoderBackend — worktree enraizada', () => {
  test('exige rootPath: falha fechado quando ausente', async () => {
    const backend = new DeepSeekHarnessCoderBackend({ runtime: fakeRuntime(completed()), model: 'm' });
    await expect(backend.edit(request, rootedWorkspace(null), new AbortController().signal))
      .rejects.toThrow(/worktree local enraizada/);
  });

  test('encaminha rootPath, escopo, objetivo, carriedContext e signal ao runtime', async () => {
    const runtime = fakeRuntime(completed());
    const backend = new DeepSeekHarnessCoderBackend({ runtime, model: 'm' });
    const signal = new AbortController().signal;
    const carried = {
      isNewAttempt: true, continueFromCheckpoint: true,
      nextStep: 'rodar teste', remainingSteps: ['ajustar projector'],
      risks: [], touchedResources: [], previousFailures: [],
    } as const;
    await backend.edit({ ...request, carriedContext: carried }, rootedWorkspace(), signal);
    expect(runtime.last?.rootPath).toBe(ROOT);
    expect(runtime.last?.objective).toBe('Corrigir projector');
    expect(runtime.last?.includedScope).toEqual(['src/projector.js']);
    expect(runtime.last?.excludedScope).toEqual(['node_modules']);
    expect(runtime.last?.carriedContext).toEqual(carried);
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

    await backend.edit(
      { ...request, hostValidationFeedback: feedback },
      rootedWorkspace(),
      signal,
    );

    expect(runtime.last?.hostValidationFeedback).toEqual(feedback);
    expect(runtime.last?.signal).toBe(signal);
  });
});

describe('DeepSeekHarnessCoderBackend — hook de pré-passo (step budget)', () => {
  test('onPreStep liga à política pura: continua até o orçamento, cancela ao ultrapassar', async () => {
    const runtime = fakeRuntime(completed());
    const backend = new DeepSeekHarnessCoderBackend({ runtime, model: 'm', stepBudget: 3 });
    await backend.edit(request, rootedWorkspace(), new AbortController().signal);
    // O adaptador SEMPRE passa onPreStep (a variante in-process); no port é opcional
    // porque o runtime de subprocesso o ignora (aplica o orçamento no plugin do filho).
    const onPreStep = runtime.last!.onPreStep!;
    expect(onPreStep(3)).toEqual({ cancel: false });
    expect(onPreStep(4)).toEqual({ cancel: true, reason: 'step-budget-exhausted:3' });
  });
});

describe('DeepSeekHarnessCoderBackend — classificação do turn/end', () => {
  test('completed NÃO é sucesso: devolve normalmente, sem atestar arquivos tocados', async () => {
    const backend = new DeepSeekHarnessCoderBackend({ runtime: fakeRuntime(completed({ steps: 11 })), model: 'm' });
    const result = await backend.edit(request, rootedWorkspace(), new AbortController().signal);
    expect(result.touchedResources).toEqual([]);
    expect(result.summary).toContain('completed-unverified');
    expect(result.summary).toContain('11 passo(s)');
    expect(result.summary).toContain('gates do host');
    expect(result.notes).toEqual(expect.arrayContaining(['turn-outcome:completed-unverified', 'session:session-abc', 'steps:11']));
  });

  test('aborted pelo orçamento: devolve normalmente com a razão observável', async () => {
    const runtime = fakeRuntime(completed({ turnEnd: { kind: 'aborted', reasonKind: 'hook', reasonReason: 'step-budget-exhausted:12' } }));
    const backend = new DeepSeekHarnessCoderBackend({ runtime, model: 'm' });
    const result = await backend.edit(request, rootedWorkspace(), new AbortController().signal);
    expect(result.summary).toContain('aborted-by-step-budget');
    expect(result.notes).toEqual(expect.arrayContaining(['turn-outcome:aborted-by-step-budget', 'abort-reason:step-budget-exhausted:12']));
  });

  test('aborted por outra razão (signal do host): devolve normalmente', async () => {
    const runtime = fakeRuntime(completed({ turnEnd: { kind: 'aborted', reasonKind: 'signal', reasonReason: 'host-cancelled' } }));
    const backend = new DeepSeekHarnessCoderBackend({ runtime, model: 'm' });
    const result = await backend.edit(request, rootedWorkspace(), new AbortController().signal);
    expect(result.summary).toContain('aborted-other');
  });

  test('error: lança para o host restaurar e classificar execution_failed', async () => {
    const runtime = fakeRuntime(completed({ turnEnd: { kind: 'error', reasonKind: 'provider', reasonReason: 'unreachable' } }));
    const backend = new DeepSeekHarnessCoderBackend({ runtime, model: 'm' });
    await expect(backend.edit(request, rootedWorkspace(), new AbortController().signal)).rejects.toThrow(/terminou em erro/);
  });

  test('error com diagnóstico: a mensagem inclui o diagnóstico sanitizado antes da descrição do turno', async () => {
    const runtime = fakeRuntime(completed({ turnEnd: { kind: 'error' }, diagnostic: 'exit 134: CSPRNG(nullptr, 0)' }));
    const backend = new DeepSeekHarnessCoderBackend({ runtime, model: 'm' });
    await expect(backend.edit(request, rootedWorkspace(), new AbortController().signal))
      .rejects.toThrow(/exit 134: CSPRNG\(nullptr, 0\) — kind=error/);
  });
});

describe('DeepSeekHarnessCoderBackend — não vaza caminho absoluto', () => {
  test('summary e notes nunca contêm o rootPath (dado sensível)', async () => {
    const backend = new DeepSeekHarnessCoderBackend({ runtime: fakeRuntime(completed()), model: 'm' });
    const result = await backend.edit(request, rootedWorkspace(), new AbortController().signal);
    expect(result.summary).not.toContain(ROOT);
    for (const note of result.notes ?? []) expect(note).not.toContain(ROOT);
  });
});
