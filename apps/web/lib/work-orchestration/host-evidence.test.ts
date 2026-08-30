/** @jest-environment node */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runProcess } from './worktree';
import {
  hostEvidenceSinkFor,
  observeAndPersistHostGitEvidence,
  observeHostGitEvidence,
  type GitRunner,
  type HostEvidenceSink,
} from './host-evidence';

jest.setTimeout(30_000);

const git = (repo: string, args: readonly string[]) => runProcess('git', ['-C', repo, ...args], { cwd: repo, timeoutMs: 30_000 });

async function makeRepo(): Promise<{ repo: string; baseSha: string; cleanup: () => Promise<void> }> {
  const repo = await mkdtemp(join(tmpdir(), 'anima-hostev-'));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.name', 'test']);
  await git(repo, ['config', 'user.email', 'test@anima.local']);
  await git(repo, ['config', 'commit.gpgsign', 'false']);
  await mkdir(join(repo, 'src'), { recursive: true });
  await writeFile(join(repo, 'src', 'a.ts'), 'export const one = 1;\n');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'base']);
  const head = await git(repo, ['rev-parse', 'HEAD']);
  return { repo, baseSha: head.stdout.trim(), cleanup: () => rm(repo, { recursive: true, force: true }) };
}

// Cria a branch descartável a partir da base e commita uma alteração nela,
// exatamente como o WorktreeExecutorAdapter deixa o repositório ao terminar.
async function commitOnBranch(repo: string, baseSha: string, branch: string, path: string, content: string): Promise<void> {
  await git(repo, ['branch', branch, baseSha]);
  await git(repo, ['checkout', branch]);
  await mkdir(join(repo, path, '..'), { recursive: true }).catch(() => {});
  await writeFile(join(repo, path), content);
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'mudança']);
  await git(repo, ['checkout', 'main']);
}

describe('observeHostGitEvidence — observação independente do git', () => {
  let ctx: Awaited<ReturnType<typeof makeRepo>>;
  beforeEach(async () => { ctx = await makeRepo(); });
  afterEach(async () => { await ctx.cleanup(); });

  test('observa arquivos alterados e commit reais da branch persistida', async () => {
    await commitOnBranch(ctx.repo, ctx.baseSha, 'anima-work/attempt-1', 'src/b.ts', 'export const two = 2;\n');
    const result = await observeHostGitEvidence({
      repoRoot: ctx.repo, baseSha: ctx.baseSha, branch: 'anima-work/attempt-1',
      workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.observedChangedFiles).toEqual(['src/b.ts']);
    expect(result.value.observedChangedFilesSinceStart).toEqual(['src/b.ts']);
    expect(result.value.observedCommitSha).not.toBe(ctx.baseSha);
    expect(result.value.observedDiffSummary.filesChanged).toBe(1);
    expect(result.value.coverage).toEqual({ git: true, gates: false });
  });

  test('resume preserva proveniência contra a base e separa o delta desde o checkpoint', async () => {
    await commitOnBranch(ctx.repo, ctx.baseSha, 'anima-work/resume', 'src/implementation.ts', 'export const inherited = true;\n');
    const checkpoint = (await git(ctx.repo, ['rev-parse', 'anima-work/resume'])).stdout.trim();
    await git(ctx.repo, ['checkout', 'anima-work/resume']);
    await writeFile(join(ctx.repo, 'src', 'test.ts'), 'export const test = true;\n');
    await git(ctx.repo, ['add', '-A']);
    await git(ctx.repo, ['commit', '-m', 'attempt']);
    await git(ctx.repo, ['checkout', 'main']);

    const result = await observeHostGitEvidence({
      repoRoot: ctx.repo, baseSha: ctx.baseSha, startSha: checkpoint, branch: 'anima-work/resume',
      workItemId: 'work-1', attemptId: 'resume', approvedProposalVersion: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.observedChangedFiles).toEqual(['src/implementation.ts', 'src/test.ts']);
    expect(result.value.observedChangedFilesSinceStart).toEqual(['src/test.ts']);
  });

  test('a observação reflete a VERDADE do git, não um relato: pega um arquivo real fora do que se alegaria', async () => {
    // O branch contém DUAS mudanças reais. Nenhum "relato" pode reduzir isto.
    await commitOnBranch(ctx.repo, ctx.baseSha, 'anima-work/attempt-2', 'src/evil.ts', 'x\n');
    await git(ctx.repo, ['checkout', 'anima-work/attempt-2']);
    await writeFile(join(ctx.repo, 'src', 'c.ts'), 'y\n');
    await git(ctx.repo, ['add', '-A']);
    await git(ctx.repo, ['commit', '-m', 'segunda']);
    await git(ctx.repo, ['checkout', 'main']);
    const result = await observeHostGitEvidence({
      repoRoot: ctx.repo, baseSha: ctx.baseSha, branch: 'anima-work/attempt-2',
      workItemId: 'work-1', attemptId: 'attempt-2', approvedProposalVersion: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.value.observedChangedFiles].sort()).toEqual(['src/c.ts', 'src/evil.ts']);
  });

  test('branch inexistente ⇒ erro tipado (invalid_git_reference)', async () => {
    const result = await observeHostGitEvidence({
      repoRoot: ctx.repo, baseSha: ctx.baseSha, branch: 'anima-work/ausente',
      workItemId: 'work-1', attemptId: 'x', approvedProposalVersion: 2,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.defect).toBe('invalid_git_reference');
  });

  test('branch sem commit novo (== base) ⇒ falha (base == commit)', async () => {
    await git(ctx.repo, ['branch', 'anima-work/vazia', ctx.baseSha]);
    const result = await observeHostGitEvidence({
      repoRoot: ctx.repo, baseSha: ctx.baseSha, branch: 'anima-work/vazia',
      workItemId: 'work-1', attemptId: 'x', approvedProposalVersion: 2,
    });
    expect(result.ok).toBe(false);
  });

  test('não escreve no repositório (só lê): nenhum comando de mutação é emitido', async () => {
    const emitted: string[][] = [];
    const spy: GitRunner = async (args) => { emitted.push([...args]); return { exitCode: 0, stdout: args[0] === 'rev-parse' ? 'b'.repeat(40) : 'src/a.ts' }; };
    await observeHostGitEvidence(
      { repoRoot: '/x', baseSha: 'a'.repeat(40), branch: 'anima-work/x', workItemId: 'w', attemptId: 'a', approvedProposalVersion: 1 },
      spy, () => new Date('2026-08-14T00:00:00Z'),
    );
    const mutating = emitted.filter(a => ['commit', 'push', 'add', 'checkout', 'reset', 'clean', 'branch', 'merge'].includes(a[0]!));
    expect(mutating).toEqual([]);
  });
});

describe('observeAndPersistHostGitEvidence — composição observe + persist (fail-open)', () => {
  let ctx: Awaited<ReturnType<typeof makeRepo>>;
  beforeEach(async () => { ctx = await makeRepo(); });
  afterEach(async () => { await ctx.cleanup(); });

  // Sink de captura: registra o que o host tentou persistir.
  const capturingSink = () => {
    const calls: HostEvidenceParam[] = [];
    const sink: HostEvidenceSink = { record: async (evidence) => { calls.push(evidence); return { ok: true, action: 'recorded' }; } };
    return { sink, calls };
  };
  type HostEvidenceParam = Parameters<HostEvidenceSink['record']>[0];

  test('observa git real e persiste; os fatos vêm do git, não de um relato do executor', async () => {
    // A branch contém DUAS mudanças reais; nenhum relato as reduziria.
    await commitOnBranch(ctx.repo, ctx.baseSha, 'anima-work/attempt-1', 'src/evil.ts', 'x\n');
    await git(ctx.repo, ['checkout', 'anima-work/attempt-1']);
    await writeFile(join(ctx.repo, 'src', 'c.ts'), 'y\n');
    await git(ctx.repo, ['add', '-A']);
    await git(ctx.repo, ['commit', '-m', 'segunda']);
    await git(ctx.repo, ['checkout', 'main']);

    const { sink, calls } = capturingSink();
    const outcome = await observeAndPersistHostGitEvidence(
      { repoRoot: ctx.repo, baseSha: ctx.baseSha, branch: 'anima-work/attempt-1', workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 2 },
      sink,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.action).toBe('recorded');
    expect(calls).toHaveLength(1);
    expect([...calls[0]!.observedChangedFiles].sort()).toEqual(['src/c.ts', 'src/evil.ts']);
    // A correlação da evidência (autoridade dos parâmetros da RPC) vem da observação.
    expect(calls[0]).toMatchObject({ workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 2 });
    expect(calls[0]!.coverage).toEqual({ git: true, gates: false });
  });

  test('fail-open: branch ausente ⇒ stage observe e o sink NUNCA é chamado', async () => {
    const { sink, calls } = capturingSink();
    const outcome = await observeAndPersistHostGitEvidence(
      { repoRoot: ctx.repo, baseSha: ctx.baseSha, branch: 'anima-work/ausente', workItemId: 'w', attemptId: 'a', approvedProposalVersion: 1 },
      sink,
    );
    expect(outcome).toMatchObject({ ok: false, stage: 'observe' });
    expect(calls).toHaveLength(0);
  });

  test('fail-open: sink recusa ⇒ stage persist, sem lançar', async () => {
    await commitOnBranch(ctx.repo, ctx.baseSha, 'anima-work/attempt-2', 'src/b.ts', 'z\n');
    const refusing: HostEvidenceSink = { record: async () => ({ ok: false, message: 'rpc recusou' }) };
    const outcome = await observeAndPersistHostGitEvidence(
      { repoRoot: ctx.repo, baseSha: ctx.baseSha, branch: 'anima-work/attempt-2', workItemId: 'w', attemptId: 'attempt-2', approvedProposalVersion: 1 },
      refusing,
    );
    expect(outcome).toMatchObject({ ok: false, stage: 'persist', reason: 'rpc recusou' });
  });

  test('fail-open: sink que LANÇA é capturado (nunca quebra a volta)', async () => {
    await commitOnBranch(ctx.repo, ctx.baseSha, 'anima-work/attempt-3', 'src/b.ts', 'z\n');
    const throwing: HostEvidenceSink = { record: async () => { throw new Error('boom'); } };
    const outcome = await observeAndPersistHostGitEvidence(
      { repoRoot: ctx.repo, baseSha: ctx.baseSha, branch: 'anima-work/attempt-3', workItemId: 'w', attemptId: 'attempt-3', approvedProposalVersion: 1 },
      throwing,
    );
    expect(outcome).toMatchObject({ ok: false, stage: 'persist', reason: 'boom' });
  });
});

describe('hostEvidenceSinkFor — tradução para a RPC record_host_observed_evidence', () => {
  let ctx: Awaited<ReturnType<typeof makeRepo>>;
  beforeEach(async () => { ctx = await makeRepo(); });
  afterEach(async () => { await ctx.cleanup(); });

  const evidenceFromRepo = async () => {
    await commitOnBranch(ctx.repo, ctx.baseSha, 'anima-work/attempt-1', 'src/b.ts', 'export const two = 2;\n');
    const observed = await observeHostGitEvidence({ repoRoot: ctx.repo, baseSha: ctx.baseSha, branch: 'anima-work/attempt-1', workItemId: 'work-9', attemptId: 'attempt-9', approvedProposalVersion: 4 });
    if (!observed.ok) throw new Error(observed.explanation);
    return observed.value;
  };

  test('deriva os parâmetros da RPC da PRÓPRIA evidência e mapeia recorded/replayed', async () => {
    const evidence = await evidenceFromRepo();
    let seen: Record<string, unknown> | null = null;
    const client = { rpc: async (_fn: string, args: Record<string, unknown>) => { seen = args; return { data: { action: 'replayed' }, error: null }; } } as unknown as SupabaseClient<Database>;
    const result = await hostEvidenceSinkFor(client).record(evidence);
    expect(result).toEqual({ ok: true, action: 'replayed' });
    // Autoridade dos parâmetros = a evidência observada; nunca um relato do executor.
    expect(seen).toEqual({ work_item_id: 'work-9', expected_proposal_version: 4, attempt_id: 'attempt-9', evidence });
  });

  test('erro da RPC vira ok:false message', async () => {
    const evidence = await evidenceFromRepo();
    const client = { rpc: async () => ({ data: null, error: { message: 'attempt not found' } }) } as unknown as SupabaseClient<Database>;
    const result = await hostEvidenceSinkFor(client).record(evidence);
    expect(result).toEqual({ ok: false, message: 'attempt not found' });
  });
});
