/** @jest-environment node */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, existsSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCoderTaskSpec, validateWorkExecutorTranscript, type WorkCapability, type WorkExecutorRequest, type WorkExecutorSignal } from '@anima/core';
import { ScriptedCoderBackend } from './coder-backend';
import { observeAndPersistHostGitEvidence } from './host-evidence';
import { WorktreeExecutorAdapter } from './worktree-executor';
import { EXTERNAL_TARGET_ENV, captureExternalTargetSpec, defaultExternalTargetDeps, verifyExternalTargetForContract } from './external-target-resolver';
import { readExecutionContract } from './executor-selection';

// Cadeia completa sobre repositórios 100% descartáveis: autorização (captura de identidade) →
// verificação pré-claim → worktree isolada → gate real → Git observado → reverificação final.
jest.setTimeout(60_000);

const sandboxes: string[] = [];
afterAll(() => { for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true }); });
const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', windowsHide: true }).trim();
function makeRepo(name: string, files: Record<string, string>): { root: string; rootSha: string; headSha: string } {
  const base = mkdtempSync(join(tmpdir(), 't1-e2e-')); sandboxes.push(base);
  mkdirSync(join(base, name));
  const root = realpathSync.native(join(base, name));
  git(root, 'init', '-q', '-b', 'main');
  for (const [path, content] of Object.entries(files)) { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), content); }
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'inicial');
  return { root, rootSha: git(root, 'rev-list', '--max-parents=0', 'HEAD'), headSha: git(root, 'rev-parse', 'HEAD') };
}

const taskSpecFor = (base: Omit<WorkExecutorRequest, 'taskSpec'>) => buildCoderTaskSpec({
  workItemId: base.workItemId, approvedProposalVersion: base.approvedProposalVersion,
  proposal: { summary: base.objective, objective: base.objective, includedScope: base.includedScope, excludedScope: base.excludedScope, expectedEffects: [], risks: [] },
  spec: { validationCriteria: base.validationCriteria }, verifierRequirement: 'advisory', contextReferences: base.contextReferences,
});
const requestFor = (reference: string): WorkExecutorRequest => {
  const base: Omit<WorkExecutorRequest, 'taskSpec'> = {
    attemptId: `att-${Date.now()}`, workItemId: 'item-ext', approvedProposalVersion: 1, capability: 'programming' as WorkCapability,
    objective: 'Adicionar um módulo ao projeto externo', includedScope: ['src/added.ts'], excludedScope: ['src/other.ts'],
    target: { kind: 'project', reference }, permissions: ['workspace_read', 'workspace_write_isolated'],
    validationCriteria: [{ label: 'testes', command: 'npm test' }], limits: { maxDurationMinutes: 2 }, contextReferences: [],
  };
  return { ...base, taskSpec: taskSpecFor(base) };
};
async function collect(adapter: WorktreeExecutorAdapter, req: WorkExecutorRequest): Promise<WorkExecutorSignal[]> {
  const out: WorkExecutorSignal[] = [];
  for await (const s of adapter.execute(req, new AbortController().signal)) out.push(s);
  return out;
}

test('target externo: identidade preservada da autorização ao Git observado, sem tocar o repositório do Anima', async () => {
  const ext = makeRepo('shop', {
    'package.json': JSON.stringify({ name: 'shop', private: true, version: '0.0.0', scripts: { test: 'node -e "process.exit(0)"' } }),
    'src/existing.ts': 'export const one = 1;\n',
  });
  const anima = makeRepo('fake-anima', { 'README.md': 'anima\n', 'package.json': '{}', 'apps/web/package.json': '{}' }); // marcadores reais do monorepo: prova PADRÃO da raiz do Anima
  const deps = { ...defaultExternalTargetDeps, animaRoot: () => anima.root };
  const env = { [EXTERNAL_TARGET_ENV]: JSON.stringify({ reference: 'ext:shop', repoRoot: ext.root, rootCommitSha: ext.rootSha }) };

  // 1) autorização: a identidade canônica vai para execution_spec.target
  const captured = await captureExternalTargetSpec(env, { deps });
  if (!captured.ok) throw new Error(captured.code);
  const contract = readExecutionContract({ execution_spec: { executor: 'worktree', coder_backend: 'ollama', model: 'm', base_sha: captured.target.identity.baseSha, target: captured.specTarget } });

  // 2) pré-claim: identidade autorizada × repositório vivo
  const verified = await verifyExternalTargetForContract(contract, env, deps);
  if (!verified.ok) throw new Error(verified.code);
  expect(verified.repoRoot).toBe(ext.root);

  // 3) execução: worktree isolada SOMENTE da referência verificada, sobre o SHA-base autorizado
  const adapter = new WorktreeExecutorAdapter({
    targets: { resolve: ref => ref === verified.reference ? { repoRoot: verified.repoRoot, sha: verified.identity.baseSha } : null },
    backend: new ScriptedCoderBackend([{ path: 'src/added.ts', content: 'export const two = 2;\n' }]),
    emitCheckpoint: true,
  });
  const req = requestFor('ext:shop');
  const signals = await collect(adapter, req);
  expect(validateWorkExecutorTranscript(signals)).toBeNull();
  const result = signals.at(-1)!;
  expect(result.kind).toBe('result');
  if (result.kind !== 'result') return;
  expect(result.validations).toEqual([{ label: 'testes', outcome: 'passed' }]); // gate real preservado
  const handoff = result.worktreeHandoff!;
  expect(handoff).toMatchObject({ baseSha: ext.headSha, branch: `anima-work/${req.attemptId}`, status: 'succeeded' });
  expect(handoff.changedFiles).toContain('src/added.ts');

  // 4) isolamento: o repositório externo ficou intacto e o Anima nunca foi tocado
  expect(git(ext.root, 'status', '--porcelain')).toBe('');
  expect(existsSync(join(ext.root, 'src', 'added.ts'))).toBe(false);
  expect(git(ext.root, 'branch', '--list', `anima-work/${req.attemptId}`)).toContain(req.attemptId);
  expect(git(anima.root, 'branch', '--list', 'anima-work/*')).toBe('');
  expect(readdirSync(anima.root).filter(f => f !== '.git').sort()).toEqual(['README.md', 'apps', 'package.json']);

  // 5) Git observado no MESMO repositório verificado (evidência de primeira parte)
  const recorded: Array<{ observedCommitSha: string; observedChangedFiles: readonly string[]; baseSha: string }> = [];
  const outcome = await observeAndPersistHostGitEvidence(
    { repoRoot: verified.repoRoot, baseSha: verified.identity.baseSha, branch: `anima-work/${req.attemptId}`, workItemId: req.workItemId, attemptId: req.attemptId, approvedProposalVersion: 1 },
    { record: async evidence => { recorded.push(evidence as never); return { ok: true as const, action: 'recorded' as const }; } },
  );
  expect(outcome.ok).toBe(true);
  expect(recorded[0]).toMatchObject({ observedCommitSha: handoff.commitSha, baseSha: ext.headSha });
  expect(recorded[0]!.observedChangedFiles).toContain('src/added.ts');

  // 6) reverificação pós-volta: a identidade continua a autorizada
  expect(await verifyExternalTargetForContract(contract, env, deps)).toMatchObject({ ok: true, repoRoot: ext.root });

  // 7) referência não verificada não resolve nenhum repositório
  const unknown = await collect(adapter, requestFor('ext:other'));
  expect(unknown.at(-1)?.kind).toBe('error');
});
