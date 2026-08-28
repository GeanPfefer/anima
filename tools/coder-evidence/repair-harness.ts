import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ObservedCoderInput,
  ObservedGateInput,
  WorkExecutorRequest,
  WorkExecutorSignal,
} from '../../packages/core/src/index.ts';
import type { CoderBackend, CoderEditRequest, CoderEditResult, CoderWorkspace } from '../../apps/web/lib/work-orchestration/coder-backend.ts';
import { OllamaCoderBackend } from '../../apps/web/lib/work-orchestration/ollama-coder.ts';
import { WorktreeExecutorAdapter } from '../../apps/web/lib/work-orchestration/worktree-executor.ts';
import { REALISTIC_FIXTURES } from './realistic-fixtures.ts';

const ROOT = process.cwd();
const MODEL = process.env.OLLAMA_MODEL ?? 'qwen3-coder:latest';
const URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]!
  : join('tools', 'coder-evidence', 'runs', `${stamp}-repair-live`);
const fixture = REALISTIC_FIXTURES.find(item => item.id === 'successor_a_realistic');
if (!fixture) throw new Error('fixture successor_a_realistic ausente');

const git = (args: readonly string[]): string =>
  execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).trim();
const baseSha = git(['rev-parse', 'HEAD']);
const attemptId = `repair-live-${randomUUID()}`;
const branch = `anima-work/${attemptId}`;
const coderObservations: ObservedCoderInput[] = [];
const gateObservations: ObservedGateInput[] = [];
const invocations: Array<{
  readonly phase: 'initial' | 'repair';
  readonly feedbackKind: 'gate-failure' | 'no-change' | undefined;
  readonly result: CoderEditResult | null;
  readonly error: string | null;
}> = [];

const inner = new OllamaCoderBackend({ model: MODEL, url: URL, maxReadRounds: 6 });
const observedBackend: CoderBackend = {
  id: inner.id,
  async edit(request: CoderEditRequest, workspace: CoderWorkspace, signal: AbortSignal) {
    const phase = request.hostValidationFeedback ? 'repair' : 'initial';
    try {
      let result: CoderEditResult;
      if (phase === 'initial') {
        const sourcePath = 'packages/core/src/work-orchestration/work-routing.ts';
        const testPath = 'packages/core/src/work-orchestration/work-routing.test.ts';
        const source = await workspace.readFile(sourcePath);
        const test = await workspace.readFile(testPath);
        if (source === null || test === null) throw new Error('fixture inicial não encontrou os arquivos existentes');
        const brokenHelper = `\n\nexport interface EquivalentWorkRoute {\n  readonly routeId: string;\n  readonly locality?: 'local' | 'remote';\n  readonly sufficient: boolean;\n}\n\nexport function preferLocalEquivalentRoute(\n  routes: readonly EquivalentWorkRoute[],\n): EquivalentWorkRoute | null {\n  const localRoute = routes.find(route => route.locality === 'local' && route.sufficient);\n  return localRoute ?? routes.find(route => route.sufficient) ?? null;\n}\n`;
        const focusedTests = `\n\ndescribe('preferLocalEquivalentRoute', () => {\n  it('prefere deterministicamente a rota local suficiente', () => {\n    expect(preferLocalEquivalentRoute([\n      { routeId: 'remote-first', locality: 'remote', sufficient: true },\n      { routeId: 'local-second', locality: 'local', sufficient: true },\n    ])).toEqual({ routeId: 'local-second', locality: 'local', sufficient: true });\n  });\n\n  it('falha fechado quando a localidade é desconhecida', () => {\n    expect(preferLocalEquivalentRoute([\n      { routeId: 'unknown', sufficient: true },\n    ])).toBeNull();\n  });\n});\n`;
        const updatedTest = test.replace(
          '  requiredEffortFor,',
          '  preferLocalEquivalentRoute,\n  requiredEffortFor,',
        );
        if (updatedTest === test) throw new Error('fixture inicial não encontrou a âncora de import');
        if (!await workspace.writeFile(sourcePath, `${source}${brokenHelper}`)) throw new Error('fixture inicial recusada no source');
        if (!await workspace.writeFile(testPath, `${updatedTest}${focusedTests}`)) throw new Error('fixture inicial recusada no teste');
        result = {
          summary: 'Patch inicial deliberadamente incompleto para provar o reparo orientado por gate.',
          touchedResources: [sourcePath, testPath],
        };
      } else {
        result = await inner.edit(request, workspace, signal);
      }
      invocations.push({ phase, feedbackKind: request.hostValidationFeedback?.kind, result, error: null });
      return result;
    } catch (error) {
      invocations.push({
        phase,
        feedbackKind: request.hostValidationFeedback?.kind,
        result: null,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
};

const request: WorkExecutorRequest = {
  attemptId,
  workItemId: 'fixture-successor-a-repair-live',
  approvedProposalVersion: 1,
  capability: 'programming',
  objective: [
    'Os dois caminhos do escopo já existem (exists=true): edite ambos com replace_exact ou append; nunca use create_file.',
    fixture.objective,
  ].join(' '),
  includedScope: fixture.includedScope,
  excludedScope: fixture.excludedScope,
  target: { kind: 'project', reference: 'anima' },
  permissions: ['workspace_read', 'workspace_write_isolated'],
  validationCriteria: [
    { label: 'Typecheck core', command: 'npm run typecheck --workspace=packages/core' },
    { label: 'Testes work-routing', command: 'npm test --workspace=packages/core -- --runInBand src/work-orchestration/work-routing.test.ts' },
  ],
  limits: { maxAttempts: 2, maxDurationMinutes: 5 },
  contextReferences: [],
};

const signals: WorkExecutorSignal[] = [];
for await (const signal of new WorktreeExecutorAdapter({
  targets: { resolve: reference => reference === 'anima' ? { repoRoot: ROOT, sha: baseSha } : null },
  backend: observedBackend,
  linkNodeModules: true,
  gateRetryLimit: 1,
  onCoderObserved: observation => coderObservations.push(observation),
  onGateObserved: observation => gateObservations.push(observation),
}).execute(request, new AbortController().signal)) {
  signals.push(signal);
}

const branchExists = (() => {
  try { git(['rev-parse', '--verify', branch]); return true; } catch { return false; }
})();
const finalFiles = new Map<string, string>();
if (branchExists) {
  for (const path of fixture.includedScope) {
    try { finalFiles.set(path, git(['show', `${branch}:${path}`])); } catch { /* arquivo ausente */ }
  }
}
const achieved = branchExists ? fixture.achieved(finalFiles) : false;
const terminal = signals.at(-1) ?? null;
const report = {
  schemaVersion: 1,
  startedFrom: baseSha,
  model: MODEL,
  ollamaUrl: URL,
  attemptId,
  branch,
  invocations,
  coderObservations,
  gateObservations,
  signals,
  terminalKind: terminal?.kind ?? null,
  branchExists,
  achieved,
};

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  out: OUT,
  attemptId,
  branch,
  invocations: invocations.map(item => item.phase),
  gates: gateObservations.map(item => ({ label: item.label, exitCode: item.exitCode })),
  terminalKind: report.terminalKind,
  achieved,
}, null, 2));
