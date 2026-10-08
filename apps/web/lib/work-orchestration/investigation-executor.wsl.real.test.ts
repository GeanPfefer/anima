/** @jest-environment node */
// PROVA OPERACIONAL DESCARTÁVEL (opt-in): executa o adaptador REAL (runProcess + wsl.exe + Codex Linux por
// assinatura) sobre um repositório Git temporário. Não toca a fila governada, o banco, o Resident Host nem o repo ANIMA.
//   ANIMA_WSL_REAL_PROOF=1 npx jest lib/work-orchestration/investigation-executor.wsl.real.test.ts
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { buildCoderTaskSpec, type WorkExecutorRequest, type WorkExecutorSignal } from '@anima/core';
import { InvestigationExecutorAdapter } from './investigation-executor';
import { runProcess } from './worktree';

jest.setTimeout(8 * 60_000);
const enabled = process.env.ANIMA_WSL_REAL_PROOF === '1' && process.platform === 'win32';
const describeReal = enabled ? describe : describe.skip;
const CLI = process.env.ANIMA_CODEX_WSL_CLI_PATH ?? '/home/geanteco/.nvm/versions/node/v22.23.3/bin/codex';
const environmentSource: Record<string, string | undefined> = {
  ...process.env, ANIMA_INVESTIGATION_CODEX_TRANSPORT: 'wsl', ANIMA_CODEX_WSL_DISTRO: process.env.ANIMA_CODEX_WSL_DISTRO ?? 'Ubuntu-24.04',
  ANIMA_CODEX_WSL_USER: process.env.ANIMA_CODEX_WSL_USER ?? 'geanteco', ANIMA_CODEX_WSL_CLI_PATH: CLI,
};
const git = async (repo: string, args: readonly string[]) => {
  const result = await runProcess('git', ['-C', repo, ...args], { cwd: repo, timeoutMs: 15_000 });
  if (result.exitCode !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};
const WSL_EXE = `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\wsl.exe`;
const wsl = (args: readonly string[]) => runProcess(WSL_EXE,
  ['-d', environmentSource.ANIMA_CODEX_WSL_DISTRO!, '-u', environmentSource.ANIMA_CODEX_WSL_USER!, '--exec', ...args], { cwd: tmpdir(), timeoutMs: 30_000 });

describeReal('REAL adapter proof: investigation-v1 over WSL Codex', () => {
  let repo: string, sha: string;
  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'anima-wsl-real-proof-'));
    await git(repo, ['init', '-b', 'main']);
    await git(repo, ['config', 'user.name', 'fixture']); await git(repo, ['config', 'user.email', 'fixture@test.invalid']); await git(repo, ['config', 'commit.gpgsign', 'false']);
    await writeFile(join(repo, 'greeting.txt'), 'alpha\nbeta\ngamma\n');
    await git(repo, ['add', '.']); await git(repo, ['commit', '-m', 'fixture']); sha = await git(repo, ['rev-parse', 'HEAD']);
  });
  afterAll(async () => { if (repo) await rm(repo, { recursive: true, force: true }); });
  const objective = 'Which word is on the second line of greeting.txt? Answer with one finding citing greeting.txt@commit with lines 2-2.';
  const request = (minutes: number): WorkExecutorRequest => ({ workItemId: 'real-1', attemptId: `real-attempt-${minutes}`, approvedProposalVersion: 1, capability: 'research', effectClass: 'read_only',
    objective, includedScope: ['greeting.txt'], excludedScope: ['secrets'], permissions: ['workspace_read'], target: { kind: 'project', reference: 'fixture' },
    validationCriteria: [{ label: 'citation resolves' }], limits: { maxDurationMinutes: minutes }, contextReferences: [],
    taskSpec: buildCoderTaskSpec({ workItemId: 'real-1', approvedProposalVersion: 1, proposal: { summary: 'Investigate', objective, includedScope: ['greeting.txt'], excludedScope: ['secrets'], expectedEffects: [], risks: [] }, spec: { validationCriteria: [{ label: 'citation resolves' }] }, verifierRequirement: 'advisory', contextReferences: [] }) });
  const adapter = () => new InvestigationExecutorAdapter({ targets: { resolve: () => ({ repoRoot: repo, baseSha: sha }) }, environmentSource });
  const run = async (req: WorkExecutorRequest, signal: AbortSignal) => { const out: WorkExecutorSignal[] = []; for await (const s of adapter().execute(req, signal)) out.push(s); return out; };
  const worktrees = async () => (await git(repo, ['worktree', 'list', '--porcelain'])).split('\n').filter(l => l.startsWith('worktree ')).length;

  test('real Codex via wsl.exe produces a host-verified result; snapshot is disposed', async () => {
    const out = await run(request(5), new AbortController().signal);
    // Registro humano-legível (sem saída bruta do modelo além do resumo já normalizado pelo host).
    console.log('REAL_PROOF_SIGNAL', JSON.stringify({ kind: out[0]?.kind, ...(out[0]?.kind === 'error' ? { code: (out[0] as { code?: string }).code, message: (out[0] as { message?: string }).message, investigationFailure: (out[0] as { investigationFailure?: unknown }).investigationFailure } : {}) }));
    expect(out[0]?.kind).toBe('result');
    const result = out[0] as unknown as { investigation: { outcome: string; findings: { evidence: { path?: string; lines?: unknown }[] }[]; hostVerification: Record<string, unknown> }; summary: string };
    console.log('REAL_PROOF_RESULT', JSON.stringify({ outcome: result.investigation.outcome, findings: result.investigation.findings.length, hostVerification: { ...result.investigation.hostVerification, baseSha: '<sha>', snapshotHead: '<sha>' } }));
    expect(result.investigation.hostVerification).toMatchObject({ snapshotClean: true, snapshotDetached: true, baseSha: sha, snapshotHead: sha });
    expect(await worktrees()).toBe(1);
  });

  test('real cancellation terminates Codex inside WSL and disposes the snapshot', async () => {
    const controller = new AbortController();
    const pending = run(request(6), controller.signal);
    // Espera o Codex Linux aparecer (marcador: diretório temporário do adaptador na linha de comando).
    let seen = false;
    for (let i = 0; i < 60 && !seen; i++) {
      await new Promise(r => setTimeout(r, 1000));
      seen = (await wsl(['pgrep', '-f', 'anima-investigation-'])).stdout.trim() !== '';
    }
    expect(seen).toBe(true);
    controller.abort();
    const out = await pending;
    expect(out[0]).toMatchObject({ kind: 'cancelled', acknowledged: true });
    await new Promise(r => setTimeout(r, 3000));
    const leftovers = await wsl(['pgrep', '-af', 'anima-investigation-']);
    console.log('REAL_PROOF_LEFTOVER_PROCESSES', JSON.stringify(leftovers.stdout.trim()));
    expect(leftovers.stdout.trim()).toBe('');
    expect(await worktrees()).toBe(1);
    expect(basename(repo)).toContain('anima-wsl-real-proof-');
  });

  test('failure path: timeout kills the wsl.exe tree and leaves no Linux process', async () => {
    const marker = `anima-timeout-probe-${Date.now()}`;
    const started = await runProcess(WSL_EXE,
      ['-d', environmentSource.ANIMA_CODEX_WSL_DISTRO!, '-u', environmentSource.ANIMA_CODEX_WSL_USER!, '--exec', '/usr/bin/node', '-e', `require('child_process').spawn('sleep',['${marker.length + 600}'],{stdio:'ignore'});setInterval(()=>{},1000)//${marker}`],
      { cwd: tmpdir(), timeoutMs: 4000 });
    expect(started.timedOut).toBe(true);
    await new Promise(r => setTimeout(r, 3000));
    expect((await wsl(['pgrep', '-f', marker])).stdout.trim()).toBe('');
    expect((await wsl(['pgrep', '-f', `sleep ${marker.length + 600}`])).stdout.trim()).toBe('');
  });

  test('failure path: unknown distro fails closed in the preflight with no snapshot, temp dir or process left', async () => {
    const before = (await import('node:fs')).readdirSync(tmpdir()).filter(n => n.startsWith('anima-investigation-')).length;
    const bad = new InvestigationExecutorAdapter({ targets: { resolve: () => ({ repoRoot: repo, baseSha: sha }) }, environmentSource: { ...environmentSource, ANIMA_CODEX_WSL_DISTRO: 'Distro-Inexistente' } });
    const out: WorkExecutorSignal[] = [];
    for await (const s of bad.execute(request(2), new AbortController().signal)) out.push(s);
    expect(out[0]).toMatchObject({ kind: 'error', retryable: false });
    expect((await import('node:fs')).readdirSync(tmpdir()).filter(n => n.startsWith('anima-investigation-')).length).toBe(before);
    expect(await worktrees()).toBe(1);
  });
});
