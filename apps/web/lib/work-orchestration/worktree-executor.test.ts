/** @jest-environment node */
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildHostObservedGateEvidence,
  buildWorktreeHandoff,
  decideRecovery,
  validateWorkExecutorTranscript,
  verifyWorkResult,
  type ChangeAuthorizationFactsV1,
  type ObservedCoderInput,
  type ObservedGateInput,
  type WorkCapability,
  buildCoderTaskSpec,
  type WorkExecutorRequest,
  type WorkExecutorSignal,
  type WorktreeHandoffV1,
} from '@anima/core';
import { GitWorktree, runProcess } from './worktree';
import { prepareAnimaValidation } from './executor-selection';
import { ScriptedCoderBackend, withCoderFailureUsage, type CoderBackend, type CoderEditRequest, type CoderEditResult, type CoderWorkspace } from './coder-backend';
import { OllamaCoderBackend } from './ollama-coder';
import { WorktreeExecutorAdapter, isGateFailureEligibleForCoderRepair, summarizeGateFailureForRetry, verifyGateTargetScope, type WorktreeTargetResolver } from './worktree-executor';
import { gateIdentityFromExecution } from './gate-identity';

// Operações git reais podem ficar lentas sob carga paralela; folga o timeout
// para não flakar por contenção (o padrão de 5s do jest é curto demais aqui).
jest.setTimeout(30_000);

const git = (repo: string, args: readonly string[]) => runProcess('git', ['-C', repo, ...args], { cwd: repo, timeoutMs: 30_000 });

// Repositório temporário com scripts npm triviais (test/typecheck passam, build
// falha) — exercita o gate npm REAL sem depender de node_modules.
async function makeNpmRepo(): Promise<{ repo: string; sha: string; resolver: WorktreeTargetResolver; cleanup: () => Promise<void> }> {
  const repo = await mkdtemp(join(tmpdir(), 'anima-npm-'));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.name', 'test']);
  await git(repo, ['config', 'user.email', 'test@anima.local']);
  await git(repo, ['config', 'commit.gpgsign', 'false']);
  await writeFile(join(repo, 'package.json'), JSON.stringify({
    name: 'fixture', version: '0.0.0', private: true,
    scripts: {
      test: 'node retry-gate.js',
      typecheck: 'node -e "process.exit(0)"',
      build: 'node -e "process.exit(1)"',
    },
  }, null, 2));
  await writeFile(
    join(repo, 'retry-gate.js'),
    // Gate determinístico que EMITE um diagnóstico na falha (como jest/tsc reais):
    // o host precisa de saída para sanitizar e realimentar; um gate mudo não produz
    // diagnóstico algum (é o comportamento correto — não há o que diagnosticar).
    `const fs = require('fs');
if (!process.argv.slice(2).some(arg => arg.includes('retry'))) process.exit(0);
const p = 'src/added.ts';
if (fs.existsSync(p) && fs.readFileSync(p, 'utf8').includes('fixed')) process.exit(0);
console.error('retry-gate: marcador "fixed" ausente em src added.ts');
process.exit(1);
`,
  );
  await mkdir(join(repo, 'src'), { recursive: true });
  await writeFile(join(repo, 'src', 'existing.ts'), 'export const one = 1;\n');
  await writeFile(join(repo, '.gitignore'), 'node_modules/\n');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'inicial']);
  const head = await git(repo, ['rev-parse', 'HEAD']);
  const sha = head.stdout.trim();
  return { repo, sha, resolver: { resolve: reference => reference === 'anima' ? { repoRoot: repo, sha } : null }, cleanup: () => rm(repo, { recursive: true, force: true }) };
}

let counter = 0;
test('transcript survives backend failure through the host observation channel', async () => {
  const ctx = await makeNpmRepo();
  const observations: ObservedCoderInput[] = [];
  try {
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver,
      onCoderObserved: observation => { observations.push(observation); },
      backend: { id: 'fixture', edit: async req => {
        req.onTranscript?.({ schemaVersion: 1, call: 0, previousCall: null,
          gateFingerprint: null, diffFingerprint: null, termination: 'ollama_ambiguous_replacement', truncated: false, entries: [] });
        throw new Error('fixture failure');
      } },
    });
    const signals = await collect(adapter, request(), new AbortController().signal);
    expect(signals.at(-1)?.kind).toBe('error');
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({ outcome: 'failed', transcripts: [{ termination: 'ollama_ambiguous_replacement' }] });
  } finally { await ctx.cleanup(); }
});

// Deadline GLOBAL da tentativa: o coder recebe um instante absoluto ancorado no INÍCIO da
// execução (contrato maxDurationMinutes), não um relógio que reinicia a cada chamada/reparo.
test('o coder recebe deadlineAtMs absoluto do contrato, ancorado no início da tentativa', async () => {
  const ctx = await makeNpmRepo();
  let received: number | undefined;
  const before = Date.now();
  try {
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver,
      backend: { id: 'fixture', edit: async req => { received = req.deadlineAtMs; throw new Error('fixture stop'); } },
    });
    const req = request();
    await collect(adapter, req, new AbortController().signal);
    const budgetMs = (req.limits.maxDurationMinutes ?? 30) * 60_000;
    expect(received).toBeGreaterThanOrEqual(before + budgetMs);
    expect(received).toBeLessThanOrEqual(Date.now() + budgetMs);
  } finally { await ctx.cleanup(); }
});

// Barreira real (2ª prova paga, attempt c284f09c): a attempt falhou e a evidência não
// registrou tokens nem chamadas — o uso pago de uma falha era descartado.
test('uso de provider de uma chamada que FALHOU chega à observação host-side', async () => {
  const ctx = await makeNpmRepo();
  const observations: ObservedCoderInput[] = [];
  const usage = { schemaVersion: 1 as const, inputTokens: 120, outputTokens: 30, totalTokens: 150, cachedInputTokens: 40 };
  try {
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver,
      onCoderObserved: observation => { observations.push(observation); },
      backend: { id: 'fixture', edit: async () => { throw withCoderFailureUsage(new Error('esgotamento'), { providerUsage: usage, providerCallCount: 7 }); } },
    });
    const signals = await collect(adapter, request(), new AbortController().signal);
    expect(signals.at(-1)?.kind).toBe('error');
    expect(observations).toEqual([expect.objectContaining({ outcome: 'failed', providerUsage: usage, providerCallCount: 7 })]);
  } finally { await ctx.cleanup(); }
});

const fixtureTaskSpec = (base: Omit<WorkExecutorRequest, 'taskSpec'>) => buildCoderTaskSpec({
  workItemId: base.workItemId, approvedProposalVersion: base.approvedProposalVersion,
  proposal: { summary: base.objective, objective: base.objective, includedScope: base.includedScope, excludedScope: base.excludedScope, expectedEffects: [], risks: [] },
  spec: { validationCriteria: base.validationCriteria }, verifierRequirement: 'advisory', contextReferences: base.contextReferences,
});
const request = (overrides: Partial<WorkExecutorRequest> = {}): WorkExecutorRequest => {
  const base: Omit<WorkExecutorRequest, 'taskSpec'> = {
  attemptId: `att-${Date.now()}-${counter++}`,
  workItemId: 'item-1',
  approvedProposalVersion: 1,
  capability: 'programming' as WorkCapability,
  objective: 'Adicionar uma função pura e seu teste',
  includedScope: ['src/added.ts'],
  excludedScope: ['src/other.ts'],
  target: { kind: 'project', reference: 'anima' },
  permissions: ['workspace_read', 'workspace_write_isolated'],
  validationCriteria: [{ label: 'testes', command: 'npm test' }],
  limits: { maxDurationMinutes: 1 },
  contextReferences: [],
  ...overrides,
  };
  return { ...base, taskSpec: overrides.taskSpec ?? fixtureTaskSpec(base) };
};

describe('verifyGateTargetScope — fronteira independente comando↔targets', () => {
  test('verifica filtro de teste por arquivo exato, inclusive sob workspace', () => {
    expect(verifyGateTargetScope('npm test --workspace=apps/web -- lib/ai/x.test.ts', ['apps/web/lib/ai/x.test.ts']))
      .toEqual({ status: 'verified', verifiedTargetPaths: ['apps/web/lib/ai/x.test.ts'] });
  });
  test.each(['npm run typecheck --workspace=apps/web', 'npm run build', 'npm test'])(
    'gate amplo/ambíguo %s fica explicitamente unverified', command => {
      expect(verifyGateTargetScope(command, ['apps/web/lib/ai/x.test.ts'])).toEqual({
        status: 'unverified', verifiedTargetPaths: [], reason: 'gate_scope_not_concrete',
      });
    });
  test('diretório declarado não cobre implicitamente o arquivo filtrado', () => {
    expect(verifyGateTargetScope('npm test -- apps/web/lib/foo/bar.test.ts', ['apps/web/lib/foo']))
      .toEqual({ status: 'mismatch', verifiedTargetPaths: ['apps/web/lib/foo/bar.test.ts'], reason: 'declared_scope_differs_from_gate' });
  });
});

async function collect(adapter: WorktreeExecutorAdapter, req: WorkExecutorRequest, signal: AbortSignal): Promise<WorkExecutorSignal[]> {
  const signals: WorkExecutorSignal[] = [];
  for await (const value of adapter.execute(req, signal)) signals.push(value);
  return signals;
}

describe('WorktreeExecutorAdapter', () => {
  let ctx: Awaited<ReturnType<typeof makeNpmRepo>>;
  beforeAll(async () => { ctx = await makeNpmRepo(); });
  afterAll(async () => { await ctx.cleanup(); });

  const added = { path: 'src/added.ts', content: 'export const two = 2;\n' };

  test('sucesso: edita, valida pelo gate real e entrega result — original intacto', async () => {
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, backend: new ScriptedCoderBackend([added]), emitCheckpoint: true });
    const req = request();
    const signals = await collect(adapter, req, new AbortController().signal);

    expect(validateWorkExecutorTranscript(signals)).toBeNull();
    expect(signals.map(s => s.kind)).toEqual(['checkpoint', 'result']);
    const result = signals.at(-1)!;
    expect(result.kind).toBe('result');
    if (result.kind === 'result') {
      expect(result.validations).toEqual([{ label: 'testes', outcome: 'passed' }]);
      // INT-05: o resultado carrega o handoff durável, coerente com o git real.
      expect(result.worktreeHandoff).toBeDefined();
      const h = result.worktreeHandoff!;
      expect({ workItemId: h.workItemId, attemptId: h.attemptId, baseSha: h.baseSha, branch: h.branch, status: h.status })
        .toEqual({ workItemId: req.workItemId, attemptId: req.attemptId, baseSha: ctx.sha, branch: `anima-work/${req.attemptId}`, status: 'succeeded' });
      expect(h.changedFiles).toContain('src/added.ts');
      expect(h.gates.some(g => g.outcome === 'passed')).toBe(true);
      expect(h).not.toHaveProperty('createdAt');
      const branchSha = (await git(ctx.repo, ['rev-parse', `anima-work/${req.attemptId}`])).stdout.trim();
      expect(h.commitSha).toBe(branchSha); // commitSha durável == commit real da branch
    }

    // Workspace ORIGINAL comprovadamente inalterado.
    await expect(stat(join(ctx.repo, 'src', 'added.ts'))).rejects.toBeTruthy();
    expect((await git(ctx.repo, ['status', '--porcelain'])).stdout.trim()).toBe('');
    // A branch descartável ficou como referência, com o commit.
    expect((await git(ctx.repo, ['branch', '--list', `anima-work/${req.attemptId}`])).stdout).toContain(req.attemptId);
    await git(ctx.repo, ['branch', '-D', `anima-work/${req.attemptId}`]);
  });

  test('gate falhando vira error (sem result de revisão)', async () => {
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, backend: new ScriptedCoderBackend([added]) });
    const signals = await collect(adapter, request({ validationCriteria: [{ label: 'build', command: 'npm run build' }] }), new AbortController().signal);
    const terminal = signals.at(-1)!;
    expect(terminal.kind).toBe('error');
    if (terminal.kind === 'error') expect(terminal.code).toBe('execution_failed');
    expect(validateWorkExecutorTranscript(signals)).toBeNull();
  });

  test('produz baseline diferencial real somente para a superfície targetPaths do gate', async () => {
    const observed: ObservedGateInput[] = [];
    const req = request({
      includedScope: ['src/added.ts'],
      validationCriteria: [{ label: 'retry', command: 'npm test -- retry-gate.js', claimKind: 'gate_assertion', targetPaths: ['retry-gate.js'] }],
    });
    const signals = await collect(new WorktreeExecutorAdapter({
      targets: ctx.resolver,
      backend: new ScriptedCoderBackend([{ path: 'src/added.ts', content: 'export const fixed = "fixed";\n' }]),
      onGateObserved: outcome => observed.push(outcome),
    }), req, new AbortController().signal);
    expect(signals.at(-1)?.kind).toBe('result');
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({
      exitCode: 0,
      claimKind: 'gate_assertion',
      baseline: {
        baseExitCode: 1, baseTimedOut: false, baseCancelled: false,
        targetExistedAtBase: true, changeTouchedGateTargets: false,
        targets: [{ path: 'retry-gate.js', existedAtBase: true, changed: false }],
        changedFilesWithinTargetScope: [], changedFilesOutsideTargetScope: ['src/added.ts'],
        scopeVerification: { status: 'verified', verifiedTargetPaths: ['retry-gate.js'] },
      },
    });
  });

  test('cadeia completa: baseline discriminating + gate_assertion + change-auth verificada ⇒ readiness eligible', async () => {
    // PROVA END-TO-END do pipeline real de evidência: a saída OBSERVADA do executor
    // (baseline diferencial + fatos de autorização de mudança), quando construída na
    // MESMA evidência que o host persiste, produz readiness `eligible`. É a primeira
    // prova de que uma execução real PODE alcançar o grau `eligible` — o que a
    // Readiness Calibration mostrou nunca ter acontecido no histórico (dados antigos,
    // não defeito do pipeline). Continua shadow/advisory: nada é executado ou aceito.
    const observed: ObservedGateInput[] = [];
    let changeAuth: ChangeAuthorizationFactsV1 | undefined;
    const req = request({
      includedScope: ['src/added.ts'],
      // O gate exercita `retry-gate.js` (target que EXISTE no base e NÃO é alterado);
      // a correção vive em `src/added.ts` (fora do gate target, mas dentro do escopo
      // AUTORIZADO). base FALHA → resultado PASSA = flip discriminating limpo.
      validationCriteria: [{ label: 'retry', command: 'npm test -- retry-gate.js', claimKind: 'gate_assertion', targetPaths: ['retry-gate.js'] }],
    });
    const signals = await collect(new WorktreeExecutorAdapter({
      targets: ctx.resolver,
      backend: new ScriptedCoderBackend([{ path: 'src/added.ts', content: 'export const fixed = "fixed";\n' }]),
      onGateObserved: outcome => observed.push(outcome),
      onChangeAuthorizationObserved: facts => { changeAuth = facts; },
    }), req, new AbortController().signal);

    expect(signals.at(-1)?.kind).toBe('result');
    expect(observed).toHaveLength(1);
    expect(changeAuth).toBeDefined();
    expect(changeAuth!.declaredScope).toEqual(['src/added.ts']);
    expect(changeAuth!.changedFiles).toContain('src/added.ts');

    // Constrói a MESMA evidência host-observada com os fatos REAIS observados.
    const built = buildHostObservedGateEvidence({
      workItemId: 'w1', attemptId: 'a1', approvedProposalVersion: 2,
      gates: observed, changeAuthorization: changeAuth!, observedAt: new Date().toISOString(),
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.changeAuthorization).toMatchObject({ status: 'verified', unauthorizedChangedFiles: [] });
    expect(built.value.shadowReadinessDecisions).toHaveLength(1);
    // A cadeia completa converge para o único caminho `eligible` da readiness.
    expect(built.value.shadowReadinessDecisions[0]).toMatchObject({
      disposition: 'eligible',
      reasonCode: 'discriminating_gate_candidate',
      claimKind: 'gate_assertion',
    });
  });

  test('target alterado e target inexistente no base permanecem fatos por-path', async () => {
    const observed: ObservedGateInput[] = [];
    const req = request({ validationCriteria: [{ label: 'target novo', command: 'npm test -- src/added.ts', targetPaths: ['src/added.ts'] }] });
    await collect(new WorktreeExecutorAdapter({ targets: ctx.resolver, backend: new ScriptedCoderBackend([added]),
      onGateObserved: outcome => observed.push(outcome) }), req, new AbortController().signal);
    expect(observed[0]?.baseline).toMatchObject({
      targetExistedAtBase: false, changeTouchedGateTargets: true,
      targets: [{ path: 'src/added.ts', existedAtBase: false, changed: true }],
      changedFilesWithinTargetScope: ['src/added.ts'], changedFilesOutsideTargetScope: [],
      scopeVerification: { status: 'verified' },
    });
  });

  test('múltiplos targets preservam existência parcial e arquivo alterado fora do scope', async () => {
    const observed: ObservedGateInput[] = [];
    const criteria = [{ label: 'multi', command: 'npm test -- retry-gate.js src/missing.test.ts', targetPaths: ['retry-gate.js', 'src/missing.test.ts'] }];
    await collect(new WorktreeExecutorAdapter({ targets: ctx.resolver,
      backend: new ScriptedCoderBackend([{ path: 'src/added.ts', content: 'export const fixed = "fixed";\n' }]),
      onGateObserved: outcome => observed.push(outcome) }), request({ validationCriteria: criteria }), new AbortController().signal);
    expect(observed[0]?.baseline).toMatchObject({
      targets: [{ path: 'retry-gate.js', existedAtBase: true, changed: false }, { path: 'src/missing.test.ts', existedAtBase: false, changed: false }],
      changedFilesWithinTargetScope: [], changedFilesOutsideTargetScope: ['src/added.ts'],
    });
  });

  test('falha ao restaurar baseline encerra antes do coder, sem retry', async () => {
    let edits = 0;
    const restore = jest.spyOn(GitWorktree.prototype, 'restoreToBase').mockResolvedValueOnce(false);
    const req = request({ validationCriteria: [{ label: 'base', command: 'npm test -- src/added.ts', targetPaths: ['src/added.ts'] }] });
    const terminal = (await collect(new WorktreeExecutorAdapter({ targets: ctx.resolver, backend: {
      id: 'must-not-run', edit: async () => { edits++; return { summary: 'não deveria rodar', touchedResources: [] }; },
    } }), req, new AbortController().signal)).at(-1)!;
    restore.mockRestore();
    expect(edits).toBe(0);
    expect(terminal).toMatchObject({ kind: 'error', code: 'execution_failed', retryable: false });
    if (terminal.kind === 'error') expect(terminal.message).toContain('coder não foi executado');
    await git(ctx.repo, ['branch', '-D', `anima-work/${req.attemptId}`]).catch(() => undefined);
  });

  test('gate sem targetPaths preserva fluxo antigo e não produz baseline', async () => {
    const observed: ObservedGateInput[] = [];
    await collect(new WorktreeExecutorAdapter({
      targets: ctx.resolver, backend: new ScriptedCoderBackend([added]),
      onGateObserved: outcome => observed.push(outcome),
    }), request(), new AbortController().signal);
    expect(observed).toHaveLength(1);
    expect(observed[0]).not.toHaveProperty('baseline');
  });

  test('gate falho após repair preserva causa classificável sem autorizar terceira edição ou retry', async () => {
    let edits = 0;
    const observed: ObservedGateInput[] = [];
    const backend: CoderBackend = {
      id: 'unsuccessful-repair',
      async edit(_req, workspace) {
        edits++;
        await workspace.writeFile('src/added.ts', `export const broken = ${edits};\n`);
        return { summary: 'edição sem resolver o gate', touchedResources: ['src/added.ts'] };
      },
    };
    const req = request({ validationCriteria: [{ label: 'teste', command: 'npm test -- retry' }] });
    const signals = await collect(new WorktreeExecutorAdapter({
      targets: ctx.resolver, backend, gateRetryLimit: 1,
      onGateObserved: outcome => observed.push(outcome),
    }), req, new AbortController().signal);
    expect(edits).toBe(2);
    expect(observed.map(gate => gate.exitCode)).toEqual([1, 1]);
    expect(signals.some(signal => signal.kind === 'result')).toBe(false);
    const terminal = signals.at(-1)!;
    expect(terminal.kind).toBe('error');
    if (terminal.kind !== 'error') throw new Error('terminal inesperado');
    expect(terminal.retryable).toBe(false);
    expect(decideRecovery({ code: terminal.code, safeMessage: terminal.message,
      retryable: terminal.retryable, attemptsUsed: 2, maxAttempts: 3, repeatedSameFailure: false,
    })).toMatchObject({ failureKind: 'gate_failure', normalizedCode: 'gate_failed', action: 'human_required' });
    expect(validateWorkExecutorTranscript(signals)).toBeNull();
    await git(ctx.repo, ['branch', '-D', `anima-work/${req.attemptId}`]);
  });

  test('alteração fora do escopo aprovado vira contract_violation', async () => {
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, backend: new ScriptedCoderBackend([{ path: 'src/evil.ts', content: 'x' }]) });
    const terminal = (await collect(adapter, request(), new AbortController().signal)).at(-1)!;
    expect(terminal.kind).toBe('error');
    if (terminal.kind === 'error') expect(terminal.code).toBe('contract_violation');
  });

  // ── Contrato do harness: os dois modos de falha recorrentes são bloqueados
  // FAIL-CLOSED antes dos gates caros (o fixture `npm test` PASSARIA nestes
  // arquivos; é o harness — não o gate — que os rejeita). ────────────────────
  test('teste importando vitest (workspace Jest) vira contract_violation antes do gate — nunca result', async () => {
    const vitestTest = { path: 'src/added.test.ts', content: `import { test, expect } from 'vitest';\ntest('x', () => expect(1).toBe(1));\n` };
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, backend: new ScriptedCoderBackend([vitestTest]) });
    const signals = await collect(adapter, request({ includedScope: ['src/added.test.ts'] }), new AbortController().signal);
    expect(signals.some(s => s.kind === 'result')).toBe(false);
    const terminal = signals.at(-1)!;
    expect(terminal.kind).toBe('error');
    if (terminal.kind === 'error') {
      expect(terminal.code).toBe('contract_violation');
      expect(terminal.retryable).toBe(false);
      expect(terminal.message).toContain('vitest');
    }
    expect(validateWorkExecutorTranscript(signals)).toBeNull();
  });

  test('leitura de entry.coderBackend (fonte não autoritativa) vira contract_violation — nunca result', async () => {
    const badSource = { path: 'src/added.ts', content: `export const routedToOpenAI = (entry: { coderBackend?: string }) => entry.coderBackend === 'openai';\n` };
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, backend: new ScriptedCoderBackend([badSource]) });
    const signals = await collect(adapter, request(), new AbortController().signal);
    expect(signals.some(s => s.kind === 'result')).toBe(false);
    const terminal = signals.at(-1)!;
    expect(terminal.kind).toBe('error');
    if (terminal.kind === 'error') {
      expect(terminal.code).toBe('contract_violation');
      expect(terminal.retryable).toBe(false);
      expect(terminal.message).toContain('entry.coderBackend');
    }
  });

  test('teste Jest legítimo (@jest/globals) passa o harness e chega a result — sem falso-positivo', async () => {
    const jestTest = { path: 'src/added.test.ts', content: `import { test, expect } from '@jest/globals';\ntest('ok', () => expect(1).toBe(1));\n` };
    const req = request({ includedScope: ['src/added.test.ts'] });
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, backend: new ScriptedCoderBackend([jestTest]) });
    const signals = await collect(adapter, req, new AbortController().signal);
    const terminal = signals.at(-1)!;
    expect(terminal.kind).toBe('result');
    await git(ctx.repo, ['branch', '-D', `anima-work/${req.attemptId}`]);
  });

  test('PRÉ-CODER: o executor injeta a política canônica no request ANTES da inferência', async () => {
    let captured: CoderEditRequest | null = null;
    const backend: CoderBackend = {
      id: 'capture-policy',
      async edit(req, ws) {
        captured = req;
        await ws.writeFile('src/added.ts', 'export const two = 2;\n');
        return { summary: 'ok', touchedResources: ['src/added.ts'] };
      },
    };
    const req = request();
    await collect(new WorktreeExecutorAdapter({ targets: ctx.resolver, backend }), req, new AbortController().signal);
    expect(captured).not.toBeNull();
    const policy = captured!.harnessPolicy;
    expect(policy).toBeDefined();
    expect(policy!.canonicalTestRunner).toBe('jest');
    expect(policy!.incompatibleTestRunners).toContain('vitest');
    expect(policy!.forbiddenBackendSources).toContain('entry.coderBackend');
    expect(captured!.validationCommands).toEqual([
      { label: 'testes', program: 'npm', args: ['test'], gateIdentity: gateIdentityFromExecution({ kind: 'test', program: 'npm', args: ['test'] }) },
    ]);
    await git(ctx.repo, ['branch', '-D', `anima-work/${req.attemptId}`]);
  });

  test('policy override VAZIA não enfraquece o gate vivo: vitest ainda é bloqueado', async () => {
    const vitestTest = { path: 'src/added.test.ts', content: `import { test } from 'vitest';\ntest('x', () => {});\n` };
    const adapter = new WorktreeExecutorAdapter({
      targets: ctx.resolver,
      backend: new ScriptedCoderBackend([vitestTest]),
      // Caller tenta desligar o gate com listas vazias — resolveEffective ignora.
      harnessPolicy: { schemaVersion: 1, canonicalTestRunner: 'jest', incompatibleTestRunners: [], forbiddenBackendSources: [] },
    });
    const signals = await collect(adapter, request({ includedScope: ['src/added.test.ts'] }), new AbortController().signal);
    expect(signals.some(s => s.kind === 'result')).toBe(false);
    const terminal = signals.at(-1)!;
    expect(terminal.kind).toBe('error');
    if (terminal.kind === 'error') expect(terminal.code).toBe('contract_violation');
  });

  test('backend que retorna sucesso sem tocar arquivo vira error, nunca um result de revisão vazio', async () => {
    // Defesa em profundidade: um backend pode alegar sucesso e não escrever nada.
    // A worktree sem mudança não pode virar um result que iria a revisão humana.
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, backend: new ScriptedCoderBackend([]) });
    const signals = await collect(adapter, request(), new AbortController().signal);
    const terminal = signals.at(-1)!;
    expect(terminal.kind).toBe('error');
    if (terminal.kind === 'error') {
      expect(terminal.code).toBe('execution_failed');
      expect(terminal.retryable).toBe(false);
      expect(terminal.message).toContain('nenhuma alteração');
    }
    // Nenhum result é emitido: o desfecho é fechado, não uma revisão de nada.
    expect(signals.some(s => s.kind === 'result')).toBe(false);
    expect(validateWorkExecutorTranscript(signals)).toBeNull();
  });

  test('permissão insuficiente vira invalid_request antes de criar worktree', async () => {
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, backend: new ScriptedCoderBackend([added]) });
    const terminal = (await collect(adapter, request({ permissions: ['workspace_read'] }), new AbortController().signal)).at(-1)!;
    expect(terminal.kind).toBe('error');
    if (terminal.kind === 'error') expect(terminal.code).toBe('invalid_request');
  });

  test('comando de gate fora da allowlist vira invalid_request', async () => {
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, backend: new ScriptedCoderBackend([added]) });
    const terminal = (await collect(adapter, request({ validationCriteria: [{ label: 'x', command: 'curl http://x' }] }), new AbortController().signal)).at(-1)!;
    expect(terminal.kind).toBe('error');
    if (terminal.kind === 'error') expect(terminal.code).toBe('invalid_request');
  });

  test('cancelamento cooperativo durante a edição vira cancelled', async () => {
    const controller = new AbortController();
    const backend: CoderBackend = {
      id: 'aborting',
      async edit(_req, _ws, _signal): Promise<CoderEditResult> { controller.abort(); return { summary: '', touchedResources: [] }; },
    };
    const terminal = (await collect(new WorktreeExecutorAdapter({ targets: ctx.resolver, backend }), request(), controller.signal)).at(-1)!;
    expect(terminal.kind).toBe('cancelled');
  });

  test('a workspace original permanece intacta mesmo estando suja', async () => {
    // Suja o original com um arquivo não commitado.
    await writeFile(join(ctx.repo, 'src', 'dirty.ts'), 'export const dirty = true;\n');
    try {
      const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, backend: new ScriptedCoderBackend([added]) });
      const req = request();
      const signals = await collect(adapter, req, new AbortController().signal);
      expect(signals.at(-1)!.kind).toBe('result');
      // O arquivo sujo continua lá, intocado, e o worktree não o viu.
      expect((await stat(join(ctx.repo, 'src', 'dirty.ts'))).isFile()).toBe(true);
      await git(ctx.repo, ['branch', '-D', `anima-work/${req.attemptId}`]);
    } finally {
      await rm(join(ctx.repo, 'src', 'dirty.ts'), { force: true });
    }
  });

  test('SHA-base inexistente/inalcançável é recusado (execution_failed)', async () => {
    const adapter = new WorktreeExecutorAdapter({ targets: { resolve: () => ({ repoRoot: ctx.repo, sha: 'b'.repeat(40) }) }, backend: new ScriptedCoderBackend([added]) });
    const terminal = (await collect(adapter, request(), new AbortController().signal)).at(-1)!;
    expect(terminal.kind).toBe('error');
    if (terminal.kind === 'error') expect(terminal.code).toBe('execution_failed');
  });

  test('backend em caminho sensível falha fechado (execution_failed)', async () => {
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, backend: new ScriptedCoderBackend([{ path: '../escape.ts', content: 'x' }]) });
    const terminal = (await collect(adapter, request(), new AbortController().signal)).at(-1)!;
    expect(terminal.kind).toBe('error');
    if (terminal.kind === 'error') expect(terminal.code).toBe('execution_failed');
  });

  test('retomada: carriedContext chega ao backend e um checkpoint é emitido', async () => {
    let received: unknown = 'ausente';
    const backend: CoderBackend = {
      id: 'capture',
      async edit(req, ws): Promise<CoderEditResult> { received = req.carriedContext; await ws.writeFile(added.path, added.content); return { summary: 'ok', touchedResources: [added.path] }; },
    };
    const carriedContext = { isNewAttempt: true as const, continueFromCheckpoint: true as const, remainingSteps: ['terminar'], nextStep: 'terminar', risks: [], touchedResources: [], previousFailures: [] };
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, backend, emitCheckpoint: true });
    const req = request({ carriedContext });
    const signals = await collect(adapter, req, new AbortController().signal);
    expect(received).toEqual(carriedContext);
    expect(signals.some(s => s.kind === 'checkpoint')).toBe(true);
    expect(signals.at(-1)!.kind).toBe('result');
    await git(ctx.repo, ['branch', '-D', `anima-work/${req.attemptId}`]);
  });

  test('successor entrega evidência seletiva de ancestors ao backend sem ampliar escopo', async () => {
    let received: CoderEditRequest['recoveryEvidence'];
    const backend: CoderBackend = {
      id: 'capture-recovery-evidence',
      async edit(req, ws): Promise<CoderEditResult> {
        received = req.recoveryEvidence;
        await ws.writeFile(added.path, added.content);
        return { summary: 'ok', touchedResources: [added.path] };
      },
    };
    const recoveryEvidence = { schemaVersion: 1 as const, truncated: false, references: [{ kind: 'work_event', id: 'event-1' }], items: [{
      sourceWorkItemId: 'ancestor', sourceAttemptId: 'attempt-1', sourceEventId: 'event-1',
      gateIdentity: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      failedCommand: 'npm test -- src/added.ts', observedFailure: 'ReferenceError',
      provenCorrection: { passedCommand: 'npm test -- src/added.ts', changedFiles: ['src/added.ts'] },
      references: [{ kind: 'work_event', id: 'event-1' }],
    }] };
    const req = request({ recoveryEvidence });
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, backend });
    const terminal = (await collect(adapter, req, new AbortController().signal)).at(-1)!;
    expect(received).toEqual(recoveryEvidence);
    expect(terminal.kind).toBe('result');
    await git(ctx.repo, ['branch', '-D', `anima-work/${req.attemptId}`]);
  });

  test('retomada permite o diff herdado fora do novo escopo e fiscaliza somente o delta da attempt', async () => {
    await writeFile(join(ctx.repo, 'src', 'implementation.ts'), 'export const value = 1;\n');
    await git(ctx.repo, ['add', '.']);
    await git(ctx.repo, ['commit', '-m', 'base da implementação']);
    const baseSha = (await git(ctx.repo, ['rev-parse', 'HEAD'])).stdout.trim();
    await writeFile(join(ctx.repo, 'src', 'implementation.ts'), 'export const value = 2;\n');
    await git(ctx.repo, ['add', '.']);
    await git(ctx.repo, ['commit', '-m', 'checkpoint preservado']);
    const checkpointSha = (await git(ctx.repo, ['rev-parse', 'HEAD'])).stdout.trim();

    const observed: ObservedGateInput[] = [];
    const req = request({ includedScope: ['src/added.ts'], excludedScope: ['src/implementation.ts'],
      validationCriteria: [{ label: 'retomada', command: 'npm test -- src/added.ts', targetPaths: ['src/added.ts'] }] });
    const adapter = new WorktreeExecutorAdapter({
      targets: { resolve: () => ({ repoRoot: ctx.repo, sha: baseSha, startSha: checkpointSha }) },
      backend: new ScriptedCoderBackend([added]), emitCheckpoint: true, onGateObserved: outcome => observed.push(outcome),
    });
    const signals = await collect(adapter, req, new AbortController().signal);
    expect(signals.at(-1)?.kind).toBe('result');
    const total = await git(ctx.repo, ['diff', '--name-only', baseSha, `anima-work/${req.attemptId}`]);
    expect(total.stdout).toContain('src/implementation.ts');
    expect(total.stdout).toContain('src/added.ts');
    const attemptOnly = await git(ctx.repo, ['diff', '--name-only', checkpointSha, `anima-work/${req.attemptId}`]);
    expect(attemptOnly.stdout.trim()).toBe('src/added.ts');
    expect(observed[0]?.baseline).toMatchObject({ targets: [{ path: 'src/added.ts', existedAtBase: false, changed: true }] });
    await git(ctx.repo, ['branch', '-D', `anima-work/${req.attemptId}`]);
  });

  test('retomada recusa nova escrita no arquivo preservado fora do escopo', async () => {
    await writeFile(join(ctx.repo, 'src', 'implementation.ts'), 'export const value = 3;\n');
    await git(ctx.repo, ['add', '.']);
    await git(ctx.repo, ['commit', '-m', 'checkpoint seguinte']);
    const checkpointSha = (await git(ctx.repo, ['rev-parse', 'HEAD'])).stdout.trim();
    const req = request({ includedScope: ['src/added.ts'], excludedScope: ['src/implementation.ts'] });
    const adapter = new WorktreeExecutorAdapter({
      targets: { resolve: () => ({ repoRoot: ctx.repo, sha: ctx.sha, startSha: checkpointSha }) },
      backend: new ScriptedCoderBackend([{ path: 'src/implementation.ts', content: 'export const value = 4;\n' }]),
    });
    const terminal = (await collect(adapter, req, new AbortController().signal)).at(-1)!;
    expect(terminal).toMatchObject({ kind: 'error', code: 'contract_violation' });
    await git(ctx.repo, ['branch', '-D', `anima-work/${req.attemptId}`]);
  });

  test('concorrência no mesmo alvo: attemptIds distintos, branches isoladas', async () => {
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, backend: new ScriptedCoderBackend([added]) });
    const [reqA, reqB] = [request(), request()];
    const [a, b] = await Promise.all([collect(adapter, reqA, new AbortController().signal), collect(adapter, reqB, new AbortController().signal)]);
    expect(a.at(-1)!.kind).toBe('result');
    expect(b.at(-1)!.kind).toBe('result');
    expect(reqA.attemptId).not.toBe(reqB.attemptId);
    for (const id of [reqA.attemptId, reqB.attemptId]) {
      expect((await git(ctx.repo, ['branch', '--list', `anima-work/${id}`])).stdout).toContain(id);
      await git(ctx.repo, ['branch', '-D', `anima-work/${id}`]);
    }
    // Original permanece intacto após duas execuções concorrentes.
    expect((await git(ctx.repo, ['status', '--porcelain'])).stdout.trim()).toBe('');
  });

  test('idempotência: repetir o mesmo attemptId falha fechado sem reaplicar', async () => {
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, backend: new ScriptedCoderBackend([added]) });
    const req = request();
    expect((await collect(adapter, req, new AbortController().signal)).at(-1)!.kind).toBe('result');
    // A segunda vez com a MESMA tentativa colide na branch e recusa — nunca
    // reaplica nem produz um segundo resultado.
    const second = (await collect(adapter, req, new AbortController().signal)).at(-1)!;
    expect(second.kind).toBe('error');
    await git(ctx.repo, ['branch', '-D', `anima-work/${req.attemptId}`]);
  });

  test('falha na aplicação do lote: restaura ao base, execution_failed, nada commitado, sem gate', async () => {
    // Backend que escreve (estado parcial) e então lança — exercita o caminho de
    // falha da aplicação. O executor deve chamar restoreToBase antes de finalizar.
    const writeThenThrow: CoderBackend = {
      id: 'write-then-throw',
      edit: async (_req, workspace: CoderWorkspace): Promise<CoderEditResult> => {
        await workspace.writeFile('src/added.ts', 'parcial\n');
        throw new Error('falha proposital do backend');
      },
    };
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, backend: writeThenThrow, emitCheckpoint: true });
    const req = request();
    const signals = await collect(adapter, req, new AbortController().signal);
    // Nenhum checkpoint (edit falhou), nenhum result, nenhum gate: só o erro.
    expect(signals.map(s => s.kind)).toEqual(['error']);
    expect((signals[0] as Extract<WorkExecutorSignal, { kind: 'error' }>).code).toBe('execution_failed');
    // Nada commitado: a branch preservada aponta exatamente ao SHA-base.
    const tip = await git(ctx.repo, ['rev-parse', `anima-work/${req.attemptId}`]);
    expect(tip.stdout.trim()).toBe(ctx.sha);
    await git(ctx.repo, ['branch', '-D', `anima-work/${req.attemptId}`]).catch(() => undefined);
  });

  test('sucesso multi-arquivo: o commit contém todas as alterações', async () => {
    const backend = new ScriptedCoderBackend([
      { path: 'src/added.ts', content: 'export const two = 2;\n' },
      { path: 'src/more.ts', content: 'export const three = 3;\n' },
    ]);
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, backend, emitCheckpoint: false });
    const req = request({ includedScope: ['src/added.ts', 'src/more.ts'] });
    const signals = await collect(adapter, req, new AbortController().signal);
    expect(signals.at(-1)!.kind).toBe('result');
    const files = await git(ctx.repo, ['show', '--name-only', '--format=', `anima-work/${req.attemptId}`]);
    expect(files.stdout).toContain('src/added.ts');
    expect(files.stdout).toContain('src/more.ts');
    await git(ctx.repo, ['branch', '-D', `anima-work/${req.attemptId}`]).catch(() => undefined);
  });

  test('cancelamento DURANTE a aplicação: restaura ao base, emite cancelled, nada commitado, sem gate', async () => {
    const controller = new AbortController();
    // Backend escreve estado parcial e cancela a tentativa no meio da aplicação.
    const abortMidEdit: CoderBackend = {
      id: 'abort-mid-edit',
      edit: async (_req, workspace: CoderWorkspace): Promise<CoderEditResult> => {
        await workspace.writeFile('src/added.ts', 'parcial durante cancelamento\n');
        controller.abort();
        throw new Error('abortado durante a edição');
      },
    };
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, backend: abortMidEdit, emitCheckpoint: true });
    const req = request();
    const signals = await collect(adapter, req, controller.signal);
    // A restauração (não-cancelável) é tentada ANTES de classificar; desfecho: cancelled.
    expect(signals.map(s => s.kind)).toEqual(['cancelled']);
    // Nenhum gate/commit/result: a branch preservada aponta exatamente ao SHA-base.
    const tip = await git(ctx.repo, ['rev-parse', `anima-work/${req.attemptId}`]);
    expect(tip.stdout.trim()).toBe(ctx.sha);
    await git(ctx.repo, ['branch', '-D', `anima-work/${req.attemptId}`]).catch(() => undefined);
  });
});

describe('WorktreeExecutorAdapter — evidência de gate observada de primeira parte (ponta a ponta)', () => {
  let ctx: Awaited<ReturnType<typeof makeNpmRepo>>;
  beforeAll(async () => { ctx = await makeNpmRepo(); });
  afterAll(async () => { await ctx.cleanup(); });
  const added = { path: 'src/added.ts', content: 'export const two = 2;\n' };

  // Coletor host-side idêntico ao que a rota /supervisor-turn injeta.
  const runWithObserver = async (req: WorkExecutorRequest) => {
    const observed: ObservedGateInput[] = [];
    const adapter = new WorktreeExecutorAdapter({
      targets: ctx.resolver, backend: new ScriptedCoderBackend([added]),
      onGateObserved: o => observed.push(o),
    });
    const signals = await collect(adapter, req, new AbortController().signal);
    return { observed, terminal: signals.at(-1)! };
  };

  test('gate REAL que passa: host observa exitCode 0 e o Verifier confirma independentemente', async () => {
    const req = request(); // npm test → exit 0
    const { observed, terminal } = await runWithObserver(req);
    // 1) O adaptador reportou a observação BRUTA de primeira parte do host.
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({ label: 'testes', exitCode: 0, timedOut: false, cancelled: false });
    expect(observed[0]!.command).toContain('test');
    // 2) A evidência construída dos fatos observados deriva 'passed'.
    const built = buildHostObservedGateEvidence({ workItemId: req.workItemId, attemptId: req.attemptId, approvedProposalVersion: req.approvedProposalVersion, gates: observed, observedAt: new Date().toISOString() });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.gates[0]!.outcome).toBe('passed');
    // 3) O Verifier, com o handoff atestado REAL + a evidência observada, confirma o gate.
    expect(terminal.kind).toBe('result');
    const handoff = (terminal as { worktreeHandoff?: WorktreeHandoffV1 }).worktreeHandoff!;
    const report = verifyWorkResult({
      expected: { workItemId: req.workItemId, attemptId: req.attemptId, approvedProposalVersion: req.approvedProposalVersion },
      authorized: { includedScope: req.includedScope, excludedScope: req.excludedScope, validationCriteria: req.validationCriteria },
      handoff, observedGates: built.value,
    });
    expect(report.findings.map(f => f.code)).toContain('gates_independently_observed');
    expect(report.verdict).toBe('verified');
    await git(ctx.repo, ['branch', '-D', `anima-work/${req.attemptId}`]).catch(() => undefined);
  });

  test('gate REAL que falha: host observa exitCode≠0 e o Verifier detecta a mentira do atestado', async () => {
    const req = request({ validationCriteria: [{ label: 'build', command: 'npm run build' }] }); // exit 1
    const { observed, terminal } = await runWithObserver(req);
    // O adaptador honesto termina em erro (sem result) — mas a observação do host EXISTE.
    expect(terminal.kind).toBe('error');
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({ label: 'build', timedOut: false, cancelled: false });
    expect(observed[0]!.exitCode).not.toBe(0);
    const built = buildHostObservedGateEvidence({ workItemId: req.workItemId, attemptId: req.attemptId, approvedProposalVersion: req.approvedProposalVersion, gates: observed, observedAt: new Date().toISOString() });
    expect(built.ok && built.value.gates[0]!.outcome).toBe('failed');
    if (!built.ok) return;
    // Adversário: um handoff que MENTE que o mesmo gate passou. A observação é REAL;
    // só a atestação é fabricada, como um executor mal-comportado faria.
    const lying = buildWorktreeHandoff({
      workItemId: req.workItemId, attemptId: req.attemptId, approvedProposalVersion: req.approvedProposalVersion,
      executorId: 'worktree-v1', backendId: 'fake', model: null,
      baseSha: 'a'.repeat(40), branch: `anima-work/${req.attemptId}`, commitSha: 'b'.repeat(40), status: 'succeeded',
      changedFiles: ['src/added.ts'], diffFiles: [{ path: 'src/added.ts', insertions: 1, deletions: 0 }],
      gates: [{ label: 'build', command: 'npm run build', exitCode: 0, outcome: 'passed' }],
    });
    expect(lying.ok).toBe(true);
    if (!lying.ok) return;
    const report = verifyWorkResult({
      expected: { workItemId: req.workItemId, attemptId: req.attemptId, approvedProposalVersion: req.approvedProposalVersion },
      authorized: { includedScope: req.includedScope, excludedScope: req.excludedScope, validationCriteria: req.validationCriteria },
      handoff: lying.value, observedGates: built.value,
    });
    const codes = report.findings.map(f => f.code);
    expect(codes).toContain('attested_gate_contradicts_observed');
    expect(codes).toContain('gate_failed');
    expect(report.verdict).toBe('rejected');
    await git(ctx.repo, ['branch', '-D', `anima-work/${req.attemptId}`]).catch(() => undefined);
  });
});

describe('WorktreeExecutorAdapter — duração do coder observada de primeira parte pelo host', () => {
  let ctx: Awaited<ReturnType<typeof makeNpmRepo>>;
  beforeAll(async () => { ctx = await makeNpmRepo(); });
  afterAll(async () => { await ctx.cleanup(); });
  const added = { path: 'src/added.ts', content: 'export const two = 2;\n' };

  const runWithCoderObserver = async (req: WorkExecutorRequest, backend: CoderBackend, signal?: AbortSignal) => {
    const observed: ObservedCoderInput[] = [];
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, backend, onCoderObserved: o => observed.push(o) });
    const signals = await collect(adapter, req, signal ?? new AbortController().signal);
    return { observed, terminal: signals.at(-1)! };
  };

  test('endpoint remoto controlado devolve operação; host local aplica, cria checkpoint e roda gate', async () => {
    const server = createServer((req, response) => {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        // Completa o protocolo V3 real (EDIT → validação focal → git diff → SUBMIT),
        // reagindo ao marcador de estado que o prompt do laço carrega. SUBMIT só é
        // enviado quando o host anuncia READY_TO_SUBMIT.
        let prompt = '';
        try {
          const payload = JSON.parse(body) as { messages?: { content?: string }[]; prompt?: string };
          prompt = payload.messages?.at(-1)?.content ?? payload.prompt ?? '';
        } catch { /* deixa o fake no estado inicial */ }
        const state = /Ações permitidas nesta rodada \(estado (exploring|dirty_unvalidated|dirty_validated|ready_to_submit)\)/
          .exec(prompt)?.[1] ?? 'exploring';
        const content = state === 'ready_to_submit' ? { action: 'submit' }
          : state === 'dirty_validated' ? { action: 'exec', program: 'git', args: ['diff'] }
          : state === 'dirty_unvalidated' ? { action: 'exec', program: 'npm', args: ['test'] }
          : { action: 'edit', operations: [{ kind: 'create_file', path: 'src/added.ts', content: added.content }] };
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({
          message: { content: JSON.stringify(content) },
          prompt_eval_count: 100_000, eval_count: 50, done_reason: 'stop',
        }));
      });
    });
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolveListen);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('endpoint de teste sem porta');
    const backend = new OllamaCoderBackend({
      model: 'qwen3-coder:latest', url: `http://127.0.0.1:${address.port}`,
      backendId: 'ollama:remote/test-node:qwen3-coder:latest', locality: 'remote', nodeId: 'test-node', timeoutMs: 2_000,
    });
    const req = request();
    try {
      const { observed, terminal } = await runWithCoderObserver(req, backend);
      expect(terminal.kind).toBe('result');
      expect(observed[0]).toMatchObject({ placement: 'remote', nodeId: 'test-node', outcome: 'succeeded' });
      const branch = `anima-work/${req.attemptId}`;
      expect((await git(ctx.repo, ['show', `${branch}:src/added.ts`])).stdout).toContain('export const two = 2');
      expect((await git(ctx.repo, ['show', 'main:src/added.ts'])).exitCode).not.toBe(0);
      await git(ctx.repo, ['branch', '-D', branch]).catch(() => undefined);
    } finally {
      await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    }
  });

  test('edição que resolve: host observa backendId, duração e desfecho succeeded', async () => {
    const req = request();
    const { observed, terminal } = await runWithCoderObserver(req, new ScriptedCoderBackend([added], 'ok', 'scripted-coder'));
    expect(terminal.kind).toBe('result');
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({ backendId: 'scripted-coder', outcome: 'succeeded' });
    expect(observed[0]!.durationMs).toBeGreaterThanOrEqual(0);
    // A duração é do coder, NÃO do gate: reportada mesmo antes de qualquer gate.
    expect(Number.isInteger(observed[0]!.durationMs)).toBe(true);
    await git(ctx.repo, ['branch', '-D', `anima-work/${req.attemptId}`]).catch(() => undefined);
  });

  test('host observa placement remoto declarado pelo backend, sem confiar na resposta do node', async () => {
    const backend: CoderBackend = {
      id: 'ollama:remote/gpu-a:qwen3-coder:latest',
      observation: { placement: 'remote', nodeId: 'gpu-a', model: 'qwen3-coder:latest' },
      async edit(_req, workspace) {
        await workspace.writeFile(added.path, added.content);
        return { summary: 'operação remota aplicada pelo host', touchedResources: [added.path] };
      },
    };
    const req = request();
    const { observed, terminal } = await runWithCoderObserver(req, backend);
    expect(terminal.kind).toBe('result');
    expect(observed[0]).toMatchObject({
      backendId: backend.id, placement: 'remote', nodeId: 'gpu-a', model: 'qwen3-coder:latest', outcome: 'succeeded',
    });
    await git(ctx.repo, ['branch', '-D', `anima-work/${req.attemptId}`]).catch(() => undefined);
  });

  test('edição que lança sem cancelamento: host observa failed com a duração medida', async () => {
    const throwing: CoderBackend = {
      id: 'throwing-coder',
      edit: async (_req, workspace: CoderWorkspace): Promise<CoderEditResult> => {
        await workspace.writeFile('src/added.ts', 'parcial\n');
        throw new Error('falha proposital');
      },
    };
    const req = request();
    const { observed, terminal } = await runWithCoderObserver(req, throwing);
    expect(terminal.kind).toBe('error');
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({ backendId: 'throwing-coder', outcome: 'failed' });
    await git(ctx.repo, ['branch', '-D', `anima-work/${req.attemptId}`]).catch(() => undefined);
  });

  test('cancelamento durante a edição: host observa cancelled (medição parcial)', async () => {
    const controller = new AbortController();
    const aborting: CoderBackend = {
      id: 'aborting-coder',
      edit: async (_req, workspace: CoderWorkspace): Promise<CoderEditResult> => {
        await workspace.writeFile('src/added.ts', 'parcial durante cancelamento\n');
        controller.abort();
        throw new Error('abortado durante a edição');
      },
    };
    const req = request();
    const { observed, terminal } = await runWithCoderObserver(req, aborting, controller.signal);
    expect(terminal.kind).toBe('cancelled');
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({ backendId: 'aborting-coder', outcome: 'cancelled' });
    await git(ctx.repo, ['branch', '-D', `anima-work/${req.attemptId}`]).catch(() => undefined);
  });
});

describe('WorktreeExecutorAdapter — retry interno dirigido por gate do host', () => {
  let ctx: Awaited<ReturnType<typeof makeNpmRepo>>;

  beforeAll(async () => { ctx = await makeNpmRepo(); });
  afterAll(async () => { await ctx.cleanup(); });

  test('gate FAIL realimentado ao coder permite uma correção limitada na mesma tentativa antes do commit', async () => {
    await mkdir(join(ctx.repo, 'node_modules'), { recursive: true });
    await writeFile(join(ctx.repo, 'node_modules', '.anima-retry-sentinel'), 'real-node-modules\n');

    let edits = 0;
    const receivedFeedback: unknown[] = [];
    const observed: ObservedGateInput[] = [];

    const backend: CoderBackend = {
      id: 'gate-retry-coder',
      async edit(req, ws): Promise<CoderEditResult> {
        edits += 1;

        const feedback = req.hostValidationFeedback;

        receivedFeedback.push(feedback);

        expect(ws.rootPath).toBeDefined();
        const nodeModulesVisible = await stat(join(ws.rootPath!, 'node_modules'))
          .then(() => true, () => false);
        expect(nodeModulesVisible).toBe(true);

        // Reproduz o ponto estrutural da attempt real: o coder roda o gate npm
        // dentro de backend.edit(), antes dos gates finais do host. O comando
        // precisa enxergar a mesma preparação da worktree em todas as voltas.
        if (edits === 1) {
          expect(ws.exec).toBeDefined();
          const selfValidation = await ws.exec!(
            { program: 'npm', args: ['test'], timeoutMs: 10_000 },
            new AbortController().signal,
          );
          expect(selfValidation.exitCode).toBe(0);
        }

        await ws.writeFile(
          'src/added.ts',
          edits === 1
            ? 'export const state = "broken";\n'
            : 'export const state = "fixed";\n',
        );

        return {
          summary: `edição ${edits}`,
          touchedResources: ['src/added.ts'],
        };
      },
    };

    const options = {
      targets: ctx.resolver,
      backend,
      linkNodeModules: true,
      gateRetryLimit: 1,
      onGateObserved: (outcome: ObservedGateInput) => observed.push(outcome),
    };

    const req = request({
      validationCriteria: [{ label: 'retry gate', command: 'npm test -- retry' }],
    });

    const signals = await collect(
      new WorktreeExecutorAdapter(options),
      req,
      new AbortController().signal,
    );


    expect(edits).toBe(2);
    expect(receivedFeedback[0]).toBeUndefined();
    expect(receivedFeedback[1]).toEqual(expect.objectContaining({
      kind: 'gate-failure',
      failedGate: expect.objectContaining({
        label: 'retry gate',
        exitCode: expect.any(Number),
      }),
      changedFiles: ['src/added.ts'],
      diffSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      diagnostic: expect.any(String),
    }));

    expect(observed).toHaveLength(2);
    expect(observed[0]!.exitCode).not.toBe(0);
    expect(observed[1]!.exitCode).toBe(0);

    const terminal = signals.at(-1)!;
    expect(terminal.kind).toBe('result');

    const branch = `anima-work/${req.attemptId}`;
    const committed = await git(ctx.repo, ['show', `${branch}:src/added.ts`]);
    expect(committed.stdout).toContain('fixed');
    expect(committed.stdout).not.toContain('broken');

    await git(ctx.repo, ['branch', '-D', branch]).catch(() => undefined);
  });

  test('repair que falha preserva na branch o checkpoint anterior ao gate', async () => {
    let edits = 0;
    const backend: CoderBackend = {
      id: 'failing-repair-coder',
      async edit(_req, ws): Promise<CoderEditResult> {
        edits += 1;
        if (edits === 1) {
          await ws.writeFile('src/added.ts', 'export const state = "broken";\n');
          return { summary: 'edit inicial', touchedResources: ['src/added.ts'] };
        }
        await ws.writeFile('src/added.ts', 'export const state = "partial";\n');
        throw new Error('repair interrompido');
      },
    };
    const req = request({ validationCriteria: [{ label: 'retry gate', command: 'npm test -- retry' }] });
    const signals = await collect(new WorktreeExecutorAdapter({
      targets: ctx.resolver, backend, gateRetryLimit: 1, emitCheckpoint: true,
    }), req, new AbortController().signal);

    expect(signals.map(signal => signal.kind)).toEqual(['checkpoint', 'error']);
    const branch = `anima-work/${req.attemptId}`;
    const preserved = await git(ctx.repo, ['show', `${branch}:src/added.ts`]);
    expect(preserved.stdout).toContain('broken');
    expect(preserved.stdout).not.toContain('partial');
    expect((await git(ctx.repo, ['rev-list', '--count', `${ctx.sha}..${branch}`])).stdout.trim()).toBe('1');
    await git(ctx.repo, ['branch', '-D', branch]).catch(() => undefined);
  });
  test('no-change inicial ainda pode receber feedback de gate e corrigir no retry', async () => {
    let edits = 0;
    const receivedFeedback: unknown[] = [];
    const observed: ObservedGateInput[] = [];

    const backend: CoderBackend = {
      id: 'no-change-retry-coder',

      async edit(req, ws): Promise<CoderEditResult> {
        edits += 1;
        receivedFeedback.push(req.hostValidationFeedback);

        if (edits === 2) {
          await ws.writeFile(
            'src/added.ts',
            'export const state = "fixed";\n',
          );
        }

        return {
          summary: `turn-${edits}`,
          touchedResources: edits === 1 ? [] : ['src/added.ts'],
        };
      },
    };

    const req = request({
      validationCriteria: [
        { label: 'retry gate', command: 'npm test -- retry' },
      ],
    });

    const signals = await collect(
      new WorktreeExecutorAdapter({
        targets: ctx.resolver,
        backend,
        gateRetryLimit: 1,
        onGateObserved: outcome => observed.push(outcome),
      }),
      req,
      new AbortController().signal,
    );

    expect(edits).toBe(2);

    expect(receivedFeedback[0]).toBeUndefined();
    expect(receivedFeedback[1]).toEqual({
      kind: 'no-change',
      retryIndex: 1,
      retryLimit: 1,
    });

    // O primeiro turno sem diff nao roda gate apenas para criar motivo de retry.
    // O unico gate observado acontece depois da edicao real do segundo turno.
    expect(observed).toHaveLength(1);
    expect(observed[0]!.exitCode).toBe(0);

    expect(signals.at(-1)?.kind).toBe('result');

    const branch = `anima-work/${req.attemptId}`;
    const committed = await git(
      ctx.repo,
      ['show', `${branch}:src/added.ts`],
    );

    expect(committed.stdout).toContain('fixed');

    await git(ctx.repo, ['branch', '-D', branch]).catch(() => undefined);
  });

});

describe('summarizeGateFailureForRetry', () => {
  test('preserva diagnostico util e redige credenciais e caminhos absolutos', () => {
    const diagnostic = summarizeGateFailureForRetry(
      [
        'FAIL apps/web/lib/example.test.ts',
        'Expected: true',
        'Received: false',
        'OPENAI_API_KEY=sk-live-secret-value',
        'at C:/Users/Gean/anima/apps/web/lib/example.test.ts:42',
      ].join('\n'),
      'Authorization: Bearer abcdefghijklmnopqrstuvwxyz',
    );

    expect(diagnostic).toContain('Expected: true');
    expect(diagnostic).toContain('Received: false');
    expect(diagnostic).toContain('<redacted>');
    expect(diagnostic).toContain('<path>');
    expect(diagnostic).not.toContain('sk-live-secret-value');
    expect(diagnostic).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(diagnostic).not.toContain('C:/Users/Gean');
    expect((diagnostic ?? '').length).toBeLessThanOrEqual(700);
  });

  test('prefere causa do teste ao rodape do npm', () => {
    const diagnostic = summarizeGateFailureForRetry(
      [
        'FAIL src/project-work-planner.test.ts',
        '  project work planner',
        '    x cria plano esperado',
        '',
        '  Expected: "approved"',
        '  Received: "proposed"',
        '',
        'Test Suites: 1 failed, 1 total',
        'Tests:       1 failed, 8 passed, 9 total',
        'Snapshots:   0 total',
        'Time:        2.4 s',
        'Ran all test suites.',
        'npm error Lifecycle script \`test\` failed with error:',
        'npm error code 1',
        'npm error workspace @anima/web@0.0.1',
        'npm error command failed',
        'npm error command jest --runInBand',
      ].join('\n'),
      '',
    );

    expect(diagnostic).toContain('Expected: "approved"');
    expect(diagnostic).toContain('Received: "proposed"');
    expect(diagnostic).not.toContain('npm error workspace');
    expect(diagnostic).not.toContain('npm error command jest');
  });

  test('preserva algum diagnostico quando a saida contem somente rodape', () => {
    const diagnostic = summarizeGateFailureForRetry(
      [
        'Test Suites: 1 failed, 1 total',
        'Tests:       1 failed, 1 total',
        'npm error code 1',
        'npm error command failed',
      ].join('\n'),
      '',
    );

    expect(diagnostic).toBeDefined();
    expect(diagnostic).toContain('npm error code 1');
  });

  test('devolve undefined sem stdout ou stderr', () => {
    expect(summarizeGateFailureForRetry('', '')).toBeUndefined();
  });
});


describe('WorktreeExecutorAdapter - validation preparation seam', () => {
  let repo: string;
  let sha: string;
  let resolver: WorktreeTargetResolver;

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'anima-validation-prep-'));

    await git(repo, ['init', '-b', 'main']);
    await git(repo, ['config', 'user.name', 'test']);
    await git(repo, ['config', 'user.email', 'test@anima.local']);
    await git(repo, ['config', 'commit.gpgsign', 'false']);

    await mkdir(join(repo, 'src'), { recursive: true });

    await writeFile(
      join(repo, 'package.json'),
      JSON.stringify({
        name: 'validation-prep-fixture',
        version: '0.0.0',
        private: true,
        scripts: {
          typecheck: 'node typecheck-generated-gate.js',
        },
      }, null, 2),
    );

    await writeFile(
      join(repo, 'typecheck-generated-gate.js'),
      `const fs = require('fs');
if (fs.existsSync('.generated/typecheck-ready')) process.exit(0);
console.error('validation preparation artifact is required before the gate');
process.exit(1);
`,
    );

    await writeFile(
      join(repo, 'src', 'existing.ts'),
      'export const existing = true;\n',
    );

    await writeFile(
      join(repo, '.gitignore'),
      'node_modules/\n.generated/\n',
    );

    await git(repo, ['add', '-A']);
    await git(repo, ['commit', '-m', 'initial validation preparation fixture']);

    const head = await git(repo, ['rev-parse', 'HEAD']);
    sha = head.stdout.trim();

    resolver = {
      resolve: reference =>
        reference === 'anima'
          ? { repoRoot: repo, sha }
          : null,
    };
  });

  afterAll(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  test('validation preparation artifact is required before the gate', async () => {
    const req = request({
      includedScope: ['src/added.ts'],
      validationCriteria: [
        { label: 'typecheck', command: 'npm run typecheck' },
      ],
    });

    const signals = await collect(
      new WorktreeExecutorAdapter({
        targets: resolver,
        backend: new ScriptedCoderBackend([
          {
            path: 'src/added.ts',
            content: 'export const prepared = true;\n',
          },
        ]),
        linkNodeModules: true,

        prepareValidation: async ({ rootPath, signal }) => {
          if (signal.aborted) throw new Error('cancelled');

          await mkdir(join(rootPath, '.generated'), { recursive: true });
          await writeFile(
            join(rootPath, '.generated', 'typecheck-ready'),
            'prepared\n',
          );
        },
      }),
      req,
      new AbortController().signal,
    );

    expect(signals.at(-1)?.kind).toBe('result');
  });

  test('validation preparation failure is fail-closed', async () => {
    const observed: ObservedGateInput[] = [];

    const req = request({
      includedScope: ['src/added.ts'],
      validationCriteria: [
        { label: 'typecheck', command: 'npm run typecheck' },
      ],
    });

    const signals = await collect(
      new WorktreeExecutorAdapter({
        targets: resolver,
        backend: new ScriptedCoderBackend([
          {
            path: 'src/added.ts',
            content: 'export const prepared = false;\n',
          },
        ]),
        linkNodeModules: true,
        prepareValidation: async () => {
          throw new Error('synthetic preparation failure');
        },
        onGateObserved: outcome => observed.push(outcome),
      }),
      req,
      new AbortController().signal,
    );

    const terminal = signals.at(-1);

    expect(terminal?.kind).toBe('error');

    if (terminal?.kind === 'error') {
      expect(terminal.code).toBe('execution_failed');
      expect(terminal.message).toContain(
        'Falha ao preparar o ambiente de validacao',
      );
      expect(terminal.message).toContain(
        'synthetic preparation failure',
      );
    }

    expect(observed).toHaveLength(0);
    expect(signals.some(signal => signal.kind === 'result')).toBe(false);

    const branch = `anima-work/${req.attemptId}`;

    // A branch da tentativa nasce antes da validacao e e preservada por design,
    // mas falha de preparacao jamais pode produzir commit de sucesso.
    const branchExists = await git(repo, ['branch', '--list', branch]);
    expect(branchExists.stdout).toContain(branch);

    const branchHead = await git(repo, ['rev-parse', branch]);
    expect(branchHead.stdout.trim()).toBe(sha);

    await git(repo, ['branch', '-D', branch]).catch(() => undefined);
  });

  test('repair que repete o mesmo diff para sem reexecutar o gate', async () => {
    let edits = 0;
    const observed: ObservedGateInput[] = [];
    const backend: CoderBackend = {
      id: 'same-diff-coder',
      async edit(_req, ws): Promise<CoderEditResult> {
        edits += 1;
        await ws.writeFile('src/added.ts', 'export const state = "broken";\n');
        return { summary: `turn-${edits}`, touchedResources: ['src/added.ts'] };
      },
    };
    const req = request({ validationCriteria: [{ label: 'retry gate', command: 'npm test -- retry' }] });

    const signals = await collect(new WorktreeExecutorAdapter({
      targets: resolver,
      backend,
      gateRetryLimit: 1,
      onGateObserved: outcome => observed.push(outcome),
    }), req, new AbortController().signal);

    expect(edits).toBe(2);
    expect(observed).toHaveLength(1);
    const terminal = signals.at(-1);
    expect(terminal).toMatchObject({ kind: 'error', retryable: false });
    if (terminal?.kind === 'error') expect(terminal.message).toContain('repair não alterou o diff');
    await git(repo, ['branch', '-D', `anima-work/${req.attemptId}`]).catch(() => undefined);
  });

});

describe('isGateFailureEligibleForCoderRepair', () => {
  test('aceita falha ordinaria atribuivel e recusa sucesso, timeout, cancelamento e ambiente', () => {
    expect(isGateFailureEligibleForCoderRepair({ exitCode: 2, timedOut: false, cancelled: false, diagnostic: "Property 'location' does not exist" })).toBe(true);
    expect(isGateFailureEligibleForCoderRepair({ exitCode: 0, timedOut: false, cancelled: false })).toBe(false);
    expect(isGateFailureEligibleForCoderRepair({ exitCode: 1, timedOut: true, cancelled: false })).toBe(false);
    expect(isGateFailureEligibleForCoderRepair({ exitCode: 1, timedOut: false, cancelled: true })).toBe(false);
    expect(isGateFailureEligibleForCoderRepair({ exitCode: 1, timedOut: false, cancelled: false, diagnostic: 'apps/web/.next/types/routes.d.ts ausente' })).toBe(false);
    expect(isGateFailureEligibleForCoderRepair({ exitCode: 1, timedOut: false, cancelled: false, diagnostic: 'ECONNREFUSED 127.0.0.1' })).toBe(false);
  });
});

// DEADLINE GLOBAL da tentativa: baseline, coder, repair e gates compartilham o MESMO
// relógio. O relógio é deslocado (Date.now) a partir de dentro da tentativa para provar
// cada fronteira sem esperar minutos reais.
describe('WorktreeExecutorAdapter — deadline global como autoridade temporal', () => {
  let ctx: Awaited<ReturnType<typeof makeNpmRepo>>;
  beforeAll(async () => { ctx = await makeNpmRepo(); });
  afterAll(async () => { await ctx.cleanup(); });

  const realNow = Date.now.bind(Date);
  let offset = 0;
  let nowSpy: jest.SpyInstance;
  beforeEach(() => { offset = 0; nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + offset); });
  afterEach(() => nowSpy.mockRestore());

  const lastError = (signals: readonly WorkExecutorSignal[]) => {
    const last = signals.at(-1)!;
    expect(last.kind).toBe('error');
    return last.kind === 'error' ? last : null;
  };
  const writeAdded = async (workspace: CoderWorkspace, content = 'export const two = 2;\n') => {
    await workspace.writeFile('src/added.ts', content);
    return { summary: 'ok', touchedResources: ['src/added.ts'] };
  };

  test('coder que retorna DEPOIS do deadline não segue para gates: runner_timeout + candidato preservado', async () => {
    const gates: ObservedGateInput[] = [];
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, onGateObserved: g => { gates.push(g); },
      backend: { id: 'slow', edit: async (req, workspace) => { const r = await writeAdded(workspace); offset = req.deadlineAtMs! - realNow() + 1; return r; } } });
    const error = lastError(await collect(adapter, request(), new AbortController().signal));
    expect(error?.message).toContain('[runner_timeout]');
    expect(error?.message).toContain('após o coder');
    expect(error?.retryable).toBe(false);
    expect(gates).toHaveLength(0);
    const sha = /commit ([0-9a-f]{40})/.exec(error?.message ?? '')?.[1];
    expect(sha).toBeDefined();
    const shown = await git(ctx.repo, ['show', '--name-only', '--format=%s', sha!]);
    expect(shown.stdout).toContain('src/added.ts');
    expect(decideRecovery({ code: error!.code, safeMessage: error!.message, retryable: false, attemptsUsed: 1, maxAttempts: 1, repeatedSameFailure: false }).failureKind).toBe('timeout');
  });

  test('gate final recebe só o tempo RESTANTE: gate lento é cortado e a tentativa termina em runner_timeout', async () => {
    const slow = await makeNpmRepo();
    try {
      // typecheck dorme 20 s; o restante no início dos gates é ~1,5 s.
      const pkg = JSON.parse(await readFile(join(slow.repo, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
      pkg.scripts.typecheck = 'node -e "setTimeout(() => {}, 20000)"';
      await writeFile(join(slow.repo, 'package.json'), JSON.stringify(pkg, null, 2));
      await git(slow.repo, ['commit', '-am', 'slow typecheck']);
      const sha = (await git(slow.repo, ['rev-parse', 'HEAD'])).stdout.trim();
      const gates: ObservedGateInput[] = [];
      const adapter = new WorktreeExecutorAdapter({
        targets: { resolve: reference => reference === 'anima' ? { repoRoot: slow.repo, sha } : null },
        onGateObserved: g => { gates.push(g); },
        backend: { id: 'fast', edit: async (req, workspace) => { const r = await writeAdded(workspace); offset = req.deadlineAtMs! - realNow() - 1_500; return r; } },
      });
      const started = realNow();
      const error = lastError(await collect(adapter, request({ validationCriteria: [{ label: 'tc', command: 'npm run typecheck' }] }), new AbortController().signal));
      expect(realNow() - started).toBeLessThan(15_000);
      expect(gates[0]?.timedOut).toBe(true);
      expect(error?.message).toContain('[runner_timeout]');
      expect(error?.message).not.toContain('[gate_failed]');
    } finally { await slow.cleanup(); }
  });

  test('REPAIR não começa depois do deadline (gate falhou e o tempo acabou durante ele)', async () => {
    let edits = 0;
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver, gateRetryLimit: 1,
      // O gate observado "consome" o resto do prazo.
      onGateObserved: () => { offset = 10 * 60_000; },
      backend: { id: 'needs-repair', edit: async (_req, workspace) => { edits += 1; return writeAdded(workspace, 'export const broken = 1;\n'); } } });
    const error = lastError(await collect(adapter, request({ validationCriteria: [{ label: 'retry', command: 'npm test -- retry' }] }), new AbortController().signal));
    expect(edits).toBe(1);
    expect(error?.message).toContain('[runner_timeout]');
    expect(error?.message).toContain('após os gates');
  });

  test('timeout do CODER depois de editar mantém [ollama_timeout] e preserva o candidato', async () => {
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver,
      backend: { id: 'coder-timeout', edit: async (_req, workspace) => {
        await writeAdded(workspace);
        throw new Error('[ollama_timeout] deadline global da tentativa atingido após executar comando.');
      } } });
    const error = lastError(await collect(adapter, request(), new AbortController().signal));
    expect(error?.message).toContain('[ollama_timeout]');
    expect(error?.message).toMatch(/Candidato preservado no commit [0-9a-f]{40}/);
    expect(decideRecovery({ code: error!.code, safeMessage: error!.message, retryable: false, attemptsUsed: 1, maxAttempts: 1, repeatedSameFailure: false }).failureKind).toBe('timeout');
  });

  test('deadline já vencido antes do coder: zero chamadas ao backend', async () => {
    let edits = 0;
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver,
      prepareValidation: async () => { offset = 10 * 60_000; },
      backend: { id: 'never', edit: async () => { edits += 1; return { summary: '', touchedResources: [] }; } } });
    const error = lastError(await collect(adapter, request(), new AbortController().signal));
    expect(edits).toBe(0);
    expect(error?.message).toContain('[runner_timeout]');
  });
});

describe('WorktreeExecutorAdapter — deadline: preparação e result (rodada 3)', () => {
  let ctx: Awaited<ReturnType<typeof makeNpmRepo>>;
  beforeAll(async () => { ctx = await makeNpmRepo(); });
  afterAll(async () => { await ctx.cleanup(); });

  const realNow = Date.now.bind(Date);
  let offset = 0;
  let nowSpy: jest.SpyInstance;
  beforeEach(() => { offset = 0; nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + offset); });
  afterEach(() => nowSpy.mockRestore());
  const writeAdded = async (workspace: CoderWorkspace) => {
    await workspace.writeFile('src/added.ts', 'export const two = 2;\n');
    return { summary: 'ok', touchedResources: ['src/added.ts'] };
  };

  test('prepareValidation recebe o tempo RESTANTE (não 120 s fixos)', async () => {
    const received: number[] = [];
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver,
      prepareValidation: async input => { received.push(input.timeoutMs); },
      backend: { id: 'ok', edit: async (_req, workspace) => writeAdded(workspace) } });
    await collect(adapter, request({ limits: { maxDurationMinutes: 1 } }), new AbortController().signal);
    expect(received.length).toBeGreaterThanOrEqual(2);
    for (const value of received) { expect(value).toBeGreaterThan(0); expect(value).toBeLessThanOrEqual(60_000); }
  });

  test('prepareAnimaValidation usa min(120 s, restante) e não inicia sem tempo', async () => {
    const runs: number[] = [];
    const deps = { resolveNextCli: () => 'next', run: (async (_f: string, _a: readonly string[], o: { timeoutMs: number }) => { runs.push(o.timeoutMs); return { command: '', exitCode: 0, stdout: '', stderr: '', durationMs: 1, timedOut: false, cancelled: false }; }) as never };
    const criteria = [{ label: 'tc', command: 'npm run typecheck --workspace=apps/web' }];
    await prepareAnimaValidation({ rootPath: ctx.repo, validationCriteria: criteria, signal: new AbortController().signal, timeoutMs: 4_000 }, deps);
    await prepareAnimaValidation({ rootPath: ctx.repo, validationCriteria: criteria, signal: new AbortController().signal, timeoutMs: 999_999 }, deps);
    expect(runs).toEqual([4_000, 120_000]);
    await expect(prepareAnimaValidation({ rootPath: ctx.repo, validationCriteria: criteria, signal: new AbortController().signal, timeoutMs: 0 }, deps)).rejects.toThrow('deadline');
    expect(runs).toHaveLength(2);
  });

  test('preparação que atravessa o prazo vira [runner_timeout], nunca erro genérico, e o coder não roda', async () => {
    let edits = 0;
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver,
      prepareValidation: async () => { offset = 10 * 60_000; throw new Error('typegen morto pelo timeout'); },
      backend: { id: 'never', edit: async () => { edits += 1; return { summary: '', touchedResources: [] }; } } });
    const signals = await collect(adapter, request(), new AbortController().signal);
    const last = signals.at(-1)!;
    expect(last.kind).toBe('error');
    if (last.kind === 'error') {
      expect(last.message).toContain('[runner_timeout]');
      expect(last.message).not.toContain('Falha ao preparar');
    }
    expect(edits).toBe(0);
  });

  test('preparação NÃO inicia com o prazo já vencido (antes dos gates)', async () => {
    let preparations = 0;
    // O prazo vence DEPOIS da checagem pós-coder e antes da preparação dos gates.
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver,
      prepareValidation: async () => { preparations += 1; },
      onChangeAuthorizationObserved: () => { offset = 10 * 60_000; },
      backend: { id: 'ok', edit: async (_req, workspace) => writeAdded(workspace) } });
    const signals = await collect(adapter, request(), new AbortController().signal);
    expect(preparations).toBe(1); // só a do coder; a dos gates não começa
    const last = signals.at(-1)!;
    expect(last.kind).toBe('error');
    if (last.kind === 'error') expect(last.message).toContain('antes de preparar os gates');
  });

  test('commit final que termina DEPOIS do deadline: sem result, sem handoff; commit só como evidência', async () => {
    const gates: ObservedGateInput[] = [];
    const adapter = new WorktreeExecutorAdapter({ targets: ctx.resolver,
      onGateObserved: g => { gates.push(g); },
      backend: { id: 'ok', edit: async (_req, workspace) => writeAdded(workspace) } });
    // O commit é a próxima operação após o último gate observado: o relógio vence durante ela.
    const commitSpy = jest.spyOn(GitWorktree.prototype, 'commit');
    commitSpy.mockImplementation(async function (this: GitWorktree, ...args: Parameters<GitWorktree['commit']>) {
      commitSpy.mockRestore();
      const sha = await GitWorktree.prototype.commit.apply(this, args);
      offset = 10 * 60_000;
      return sha;
    });
    try {
      const signals = await collect(adapter, request(), new AbortController().signal);
      expect(gates.length).toBeGreaterThan(0);
      expect(signals.some(s => s.kind === 'result')).toBe(false);
      const last = signals.at(-1)!;
      expect(last.kind).toBe('error');
      if (last.kind === 'error') {
        expect(last.message).toContain('[runner_timeout]');
        expect(last.message).toMatch(/após o commit final\. Candidato preservado no commit [0-9a-f]{40}/);
      }
    } finally { commitSpy.mockRestore(); }
  });
});
