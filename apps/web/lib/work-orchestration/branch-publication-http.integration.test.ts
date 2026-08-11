import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildWorktreeHandoff, type WorkEvent } from '@anima/core';
import type { Json } from '@anima/types';
import { GitBranchPublicationProvider } from './git-branch-publication';
import type { PersistBranchReceipt } from './branch-publication-operation';
import { runAuthorizedBranchPublication } from './branch-publication-http';

const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
const WORK = 'work-int', ATTEMPT = 'attempt-real', AUTH = 'auth-int', RESULT = 'result-int', BRANCH = `anima-work/${ATTEMPT}`;
const event = (id: string, type: WorkEvent['type'], data: Record<string, unknown>, author: WorkEvent['author'] = 'user'): WorkEvent =>
  ({ id, workItemId: WORK, type, author, proposalVersion: 1, payload: { schema_version: 1, data } as unknown as Json, occurredAt: new Date() });

// Prova ponta-a-ponta do caminho FIADO (coordenador + provider Git real + tradução
// HTTP) contra um remote bare LOCAL — nunca origin/GitHub. A persistência é um
// registrador em memória que deduplica por idempotencyKey (como a RPC ratificada).
test('publica de verdade, é idempotente e nunca propaga tags — contra bare remote local', async () => {
  const root = mkdtempSync(join(tmpdir(), 'anima-branch-http-'));
  const remote = join(root, 'remote.git'), repo = join(root, 'repo');
  try {
    execFileSync('git', ['init', '--bare', remote]);
    execFileSync('git', ['init', '-b', 'main', repo]);
    git(repo, 'config', 'user.name', 'Anima Test'); git(repo, 'config', 'user.email', 'anima@test.invalid');
    // Config HOSTIL: followTags ligado. A invariante "sem tags" deve valer mesmo assim.
    git(repo, 'config', 'push.followTags', 'true');
    writeFileSync(join(repo, 'base.txt'), 'base\n'); git(repo, 'add', 'base.txt'); git(repo, 'commit', '-m', 'base');
    const baseSha = git(repo, 'rev-parse', 'HEAD'); git(repo, 'remote', 'add', 'origin', remote); git(repo, 'push', 'origin', 'main');
    git(repo, 'checkout', '-b', BRANCH); writeFileSync(join(repo, 'work.txt'), 'work\n'); git(repo, 'add', 'work.txt'); git(repo, 'commit', '-m', 'work');
    const commitSha = git(repo, 'rev-parse', 'HEAD');
    // Tag anotada apontando para o commit publicado — seria arrastada por followTags.
    git(repo, 'tag', '-a', 'v-int', '-m', 'tag');

    const handoff = buildWorktreeHandoff({ workItemId: WORK, attemptId: ATTEMPT, approvedProposalVersion: 1, executorId: 'worktree-v1', backendId: 'fake', model: null, baseSha, branch: BRANCH, commitSha, status: 'succeeded', changedFiles: ['work.txt'], diffFiles: [{ path: 'work.txt', insertions: 1, deletions: 0 }], gates: [{ label: 'test', command: 'npm test', exitCode: 0, outcome: 'passed' }] });
    if (!handoff.ok) throw new Error(handoff.explanation);
    const events: WorkEvent[] = [
      event(RESULT, 'result_submitted', { work_item_id: WORK, attempt_id: ATTEMPT, approved_proposal_version: 1, handoff_reference: 'worktree:int', executor_signal: { kind: 'result', worktreeHandoff: handoff.value } }, 'executor'),
      event('accept', 'result_accepted', { accepted_result_event_id: RESULT }),
      event('decision', 'integration_decided', { work_item_id: WORK, attempt_id: ATTEMPT, approved_proposal_version: 1, accepted_result_event_id: RESULT, decision: 'authorize', decision_id: AUTH }),
    ];
    const target = { providerId: 'git-branch-publication-v1', repositoryId: remote, remoteName: 'origin', baseBranch: 'main' };
    const provider = new GitBranchPublicationProvider(repo);
    const ledger = new Map<string, unknown>();
    const persist: PersistBranchReceipt = async (_request, receipt) => {
      const key = receipt.idempotencyKey;
      if (ledger.has(key)) return { action: 'replayed', eventSeq: 1 };
      ledger.set(key, receipt); return { action: 'recorded', eventSeq: ledger.size };
    };
    const input = { workItemId: WORK, target, provider, readEvents: async () => events, persist };

    const first = await runAuthorizedBranchPublication(input);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ ok: true, value: { status: 'published', publication: { commitSha, remoteBranch: BRANCH, disposition: 'created' }, persistence: { action: 'recorded' } } });
    // O remote recebeu exatamente o commit autorizado, na branch autorizada.
    expect(git(repo, 'ls-remote', '--heads', 'origin', `refs/heads/${BRANCH}`).split(/\s+/)[0]).toBe(commitSha);
    // Invariante "sem tags" comprovada COM efeito real: nenhuma tag no remote, apesar de push.followTags=true.
    expect(git(repo, 'ls-remote', '--tags', 'origin')).toBe('');
    // main do remote intacta.
    expect(git(repo, 'ls-remote', '--heads', 'origin', 'refs/heads/main').split(/\s+/)[0]).toBe(baseSha);

    // Retry idêntico reconcilia pelo fato, sem segundo efeito: disposition already_existed.
    const second = await runAuthorizedBranchPublication(input);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ ok: true, value: { status: 'published', publication: { disposition: 'already_existed' }, persistence: { action: 'replayed' } } });
    expect(ledger.size).toBe(1);
    expect(git(repo, 'ls-remote', '--tags', 'origin')).toBe('');
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 30_000);
