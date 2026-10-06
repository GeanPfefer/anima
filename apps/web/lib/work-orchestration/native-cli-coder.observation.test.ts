/** @jest-environment node */
import { buildHostObservedCoderEvidence, type ObservedCoderInput } from '@anima/core';
import type { CoderBackend } from './coder-backend';
import { ClaudeCodeCoderBackend } from './claude-code-coder';
import { CodexCliCoderBackend } from './codex-cli-coder';
import { persistPostTurnHostObservations } from './post-turn-observation';
import type { TrustedSystemWriter } from './trusted-system-writer';
import type { HostObservedCoderEvidenceV1 } from '@anima/core';

// Regressão AKT-02: a observação que o executor de worktree monta a partir de um backend CLI nativo
// precisa ser aceita por buildHostObservedCoderEvidence. Antes, `{placement:'remote', nodeId:null}` era recusado
// ("Placement remoto exige nodeId estável"), a evidência do coder sumia (persistência fail-open) e o lane com
// Verifier obrigatório ficava em `evidence_incomplete` — resultado `verified` nunca liberado para `review`.

const WORK_ITEM = '4b7d0a13-87b6-488a-b85c-0d9c47db27f9';
const ATTEMPT = '8ee9ab5c-37af-47e9-a374-412144372665';

const backends: readonly [string, () => CoderBackend][] = [
  ['codex-cli', () => new CodexCliCoderBackend({ config: { executable: 'codex-native', model: 'default' } })],
  ['claude-code', () => new ClaudeCodeCoderBackend({ config: { executable: 'claude-native', model: 'default' } })],
];

/** Mesma montagem de `observeCoder` em worktree-executor.ts (backendId + duração + desfecho + `backend.observation`). */
const observedBy = (backend: CoderBackend): ObservedCoderInput => ({
  backendId: backend.id,
  durationMs: 35_000,
  outcome: 'succeeded',
  ...(backend.observation ?? {}),
});

const buildFrom = (observed: ObservedCoderInput) => buildHostObservedCoderEvidence({
  workItemId: WORK_ITEM as never, attemptId: ATTEMPT, approvedProposalVersion: 1 as never,
  backendId: observed.backendId, durationMs: observed.durationMs, outcome: observed.outcome,
  ...(observed.placement !== undefined ? { placement: observed.placement, nodeId: observed.nodeId, model: observed.model } : {}),
  observedAt: '2026-10-03T04:03:33.000Z',
});

describe.each(backends)('backend CLI nativo %s → evidência do coder', (kind, make) => {
  test('a observação do host é aceita por buildHostObservedCoderEvidence', () => {
    const backend = make();
    const built = buildFrom(observedBy(backend));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.backendId).toBe(`${kind}:default`);
    expect(built.value.outcome).toBe('succeeded');
    // O host não atesta o nó de inferência de um CLI: nenhuma identidade de placement inventada.
    expect(built.value.placement).toBeUndefined();
    expect(built.value.nodeId).toBeUndefined();
  });

  test('não declara placement remote sem nodeId nem local falso', () => {
    const backend = make();
    expect(backend.observation).toBeUndefined();
  });
});

describe('a invariante global de placement continua valendo', () => {
  test('remote SEM nodeId segue rejeitado', () => {
    const built = buildFrom({ backendId: 'x:y', durationMs: 1, outcome: 'succeeded', placement: 'remote', nodeId: null, model: 'y' });
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.explanation).toMatch(/nodeId/);
  });

  test('remote COM nodeId estável (ex.: OpenAI) e local com nodeId nulo seguem aceitos', () => {
    expect(buildFrom({ backendId: 'openai:m', durationMs: 1, outcome: 'succeeded', placement: 'remote', nodeId: 'openai-api', model: 'm' }).ok).toBe(true);
    expect(buildFrom({ backendId: 'ollama:m', durationMs: 1, outcome: 'succeeded', placement: 'local', nodeId: null, model: 'm' }).ok).toBe(true);
  });
});

describe('seam governada: persistPostTurnHostObservations grava a evidência do coder', () => {
  const writerWith = (recorded: HostObservedCoderEvidenceV1[]): TrustedSystemWriter => {
    const unused = async () => { throw new Error('sink não esperado neste teste'); };
    return {
      available: true,
      hostEvidence: { record: unused } as never,
      gateEvidence: { record: unused } as never,
      coderEvidence: { record: async (evidence: HostObservedCoderEvidenceV1) => { recorded.push(evidence); return { ok: true as const }; } } as never,
      verifierOpinion: { record: unused } as never,
      integrationReceipt: unused as never,
    };
  };
  // terminal `error` sem contrato: pula git (1) e Verifier (2); isola o passo (0b) — a única entrada de coder evidence.
  const run = (observed: ObservedCoderInput, recorded: HostObservedCoderEvidenceV1[]) => persistPostTurnHostObservations({
    client: {} as never,
    result: { attemptId: ATTEMPT, terminalKind: 'error', selection: { workItemId: WORK_ITEM, approvedProposalVersion: 1 } } as never,
    contract: null,
    gateObservations: [],
    coderObservations: [observed],
    systemWriter: writerWith(recorded),
  });

  test.each(backends)('%s: a evidência chega ao sink de sistema (insumo que o release exige)', async (kind, make) => {
    const recorded: HostObservedCoderEvidenceV1[] = [];
    await run(observedBy(make()), recorded);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ workItemId: WORK_ITEM, attemptId: ATTEMPT, approvedProposalVersion: 1, backendId: `${kind}:default`, outcome: 'succeeded' });
  });

  test('controle: a observação antiga {remote, nodeId:null} NÃO produzia evidência (o defeito do AKT-02)', async () => {
    const recorded: HostObservedCoderEvidenceV1[] = [];
    await run({ backendId: 'codex-cli:default', durationMs: 35_000, outcome: 'succeeded', placement: 'remote', nodeId: null, model: 'default' }, recorded);
    expect(recorded).toHaveLength(0);
  });
});

test('generic turn classifier runs only on nonzero direct exit; legacy format unchanged', async () => {
  const { runNativeCliTurn, NativeCliFailureError } = await import('./native-cli-coder');
  const classifyFailure = jest.fn(() => ({ version: 1 as const, category: 'usage_limit_exceeded' as const, exitCode: 1 }));
  const input = { label: 'Codex CLI', executable: 'fake', buildArgs: () => [], env: {},
    rootPath: 'fixture', signal: new AbortController().signal,
    request: { objective: 'fixture', includedScope: [], excludedScope: [], deadlineAtMs: Date.now() + 60000 } as import('./coder-backend').CoderEditRequest,
    classifyFailure };
  const result = { command: 'fake', exitCode: 0, stdout: 'private-sentinel', stderr: '', durationMs: 1, cancelled: false, timedOut: false };
  await expect(runNativeCliTurn({ ...input, run: async () => result })).resolves.toHaveProperty('result.exitCode', 0);
  for (const flags of [{ cancelled: true }, { timedOut: true }]) {
    const error = await runNativeCliTurn({ ...input, run: async () => ({ ...result, exitCode: 1, ...flags }) }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(NativeCliFailureError);
    expect(error).not.toHaveProperty('nativeCliFailure');
  }
  expect(classifyFailure).not.toHaveBeenCalled();
  await expect(runNativeCliTurn({ ...input, classifyFailure: undefined, run: async () => ({ ...result, exitCode: 1, stdout: 'legacy diagnostic' }) }))
    .rejects.toThrow('Codex CLI terminou com exit 1: legacy diagnostic');
});
