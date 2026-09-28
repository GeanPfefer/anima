import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Json } from '@anima/types';
import {
  buildWorktreeHandoff,
  integrationOperationKey,
  sameIntegrationEffect,
  type IntegrationEffectReceiptV1,
  type WorkEvent,
  type WorkItem,
} from '@anima/core';
import {
  authorizeIntegrationEffect,
  executeAuthorizedIntegration,
  GitIntegrationEffectProvider,
  type ExecuteIntegrationDeps,
  type IntegrationEffectConfig,
} from './integration-effect';
import { createTrustedSystemWriter, UNAVAILABLE_TRUSTED_SYSTEM_WRITER } from './trusted-system-writer';

// Repositórios TEMPORÁRIOS reais (git init). Nada toca o repositório do Anima.
const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();

interface Fixture {
  readonly root: string;
  readonly repo: string;
  readonly config: IntegrationEffectConfig;
  readonly base: string;
  readonly commit: string;
  readonly dev: string;
  events: WorkEvent[];
  item: WorkItem;
  persistCalls: number;
}

function commitFile(repo: string, file: string, content: string, message: string): string {
  writeFileSync(join(repo, file), content);
  git(repo, 'add', file);
  git(repo, 'commit', '-q', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
}

function setup(options: { readonly devDiverges?: 'conflict' | 'clean' } = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'anima-integration-effect-'));
  const repo = join(root, 'repo');
  const remote = join(root, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', remote]);
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git(repo, 'config', 'user.name', 'Anima Test');
  git(repo, 'config', 'user.email', 'anima@test.invalid');
  git(repo, 'remote', 'add', 'origin', remote);
  const base = commitFile(repo, 'shared.txt', 'base\n', 'base');
  git(repo, 'branch', 'dev', base);
  git(repo, 'checkout', '-q', '-b', 'anima-work/attempt-1', base);
  const commit = commitFile(repo, 'shared.txt', 'resultado\n', 'resultado');
  git(repo, 'checkout', '-q', 'dev');
  if (options.devDiverges === 'conflict') commitFile(repo, 'shared.txt', 'dev divergente\n', 'dev conflitante');
  if (options.devDiverges === 'clean') commitFile(repo, 'other.txt', 'outro\n', 'dev independente');
  const dev = git(repo, 'rev-parse', 'refs/heads/dev');
  // Nenhuma worktree com o alvo em checkout.
  git(repo, 'checkout', '-q', '--detach', 'main');
  const built = buildWorktreeHandoff({
    workItemId: 'work-1', attemptId: 'attempt-1', approvedProposalVersion: 1, executorId: 'worktree-v1', backendId: 'fake', model: null,
    baseSha: base, branch: 'anima-work/attempt-1', commitSha: commit, status: 'succeeded',
    changedFiles: ['shared.txt'], diffFiles: [{ path: 'shared.txt', insertions: 1, deletions: 1 }], gates: [{ label: 'g', command: 'npm test', exitCode: 0, outcome: 'passed' }],
  });
  if (!built.ok) throw new Error(built.explanation);
  const fixture: Fixture = {
    root, repo, base, commit, dev, persistCalls: 0,
    config: { repoRoot: repo, repositoryId: remote, remoteName: 'origin' },
    item: {
      id: 'work-1', userId: 'u', sourceMessageId: 'm', state: 'completed', impactLevel: 'low', capability: 'programming',
      originalRequest: 'x', intent: {} as WorkItem['intent'],
      proposal: { schemaVersion: 1, data: { summary: 's', objective: 'o', includedScope: [], excludedScope: [], expectedEffects: [], risks: [] } },
      proposalVersion: 1, createdAt: new Date(), updatedAt: new Date(),
    },
    events: [
      event('ev-result', 'result_submitted', 'executor', { attempt_id: 'attempt-1', summary: 'x', result_references: [], executor_signal: { worktreeHandoff: built.value } }),
      event('ev-accept', 'result_accepted', 'user', { accepted_result_event_id: 'ev-result' }),
    ],
  };
  return fixture;
}

function event(id: string, type: string, author: string, data: Record<string, unknown>): WorkEvent {
  return { id, workItemId: 'work-1', type: type as WorkEvent['type'], author: author as WorkEvent['author'], proposalVersion: 1, payload: { schema_version: 1, data } as unknown as Json, occurredAt: new Date() };
}

/** Espelho em memória de `authorize_integration_effect` (commit derivado do handoff). */
function authorize(f: Fixture, expectedTargetSha = git(f.repo, 'rev-parse', 'refs/heads/dev'), authorizationId = 'auth-1'): void {
  const parts = {
    authorizationId, acceptedResultEventId: 'ev-result', repositoryId: f.config.repositoryId,
    targetRef: 'refs/heads/dev', expectedTargetSha, resultCommitSha: f.commit, mode: 'merge_no_ff',
  };
  f.events.push(event(`ev-auth-${authorizationId}`, 'integration_effect_authorized', 'user', {
    authorization_id: authorizationId, operation_key: integrationOperationKey(parts), work_item_id: 'work-1', approved_proposal_version: 1,
    attempt_id: 'attempt-1', accepted_result_event_id: 'ev-result', result_commit_sha: f.commit, repository_id: parts.repositoryId,
    target_ref: parts.targetRef, expected_target_sha: expectedTargetSha, mode: parts.mode,
  }));
}

function deps(f: Fixture, over: Partial<ExecuteIntegrationDeps> & { failPersist?: boolean } = {}): ExecuteIntegrationDeps {
  return {
    getItem: async () => ({ ok: true, value: f.item }),
    listEvents: async () => ({ ok: true, value: [...f.events] }),
    config: f.config,
    provider: new GitIntegrationEffectProvider(f.repo),
    // Espelho em memória de `record_integration_completed`: idempotente por efeito; divergência = conflito.
    persist: async (auth, receipt) => {
      f.persistCalls += 1;
      if (over.failPersist) throw new Error('db down');
      const existing = f.events.find((e) => e.type === 'integration_completed');
      if (existing) {
        const prior = (existing.payload as unknown as { data: { receipt: IntegrationEffectReceiptV1 } }).data.receipt;
        if (sameIntegrationEffect(prior, receipt)) return { action: 'replayed', eventSeq: 1 };
        throw new Error('integration receipt conflict');
      }
      f.events.push(event('ev-integrated', 'integration_completed', 'system', { authorization_id: auth.authorizationId, receipt }));
      return { action: 'recorded', eventSeq: 1 };
    },
    ...over,
  };
}

const run = (f: Fixture, over: Parameters<typeof deps>[1] = {}, authorizationId = 'auth-1') =>
  executeAuthorizedIntegration({ workItemId: 'work-1', integrationAuthorizationId: authorizationId }, deps(f, over));

const devSha = (f: Fixture): string => git(f.repo, 'rev-parse', 'refs/heads/dev');
const mainSha = (f: Fixture): string => git(f.repo, 'rev-parse', 'refs/heads/main');
const receipts = (f: Fixture) => f.events.filter((e) => e.type === 'integration_completed');

let fixtures: Fixture[] = [];
const make = (options?: Parameters<typeof setup>[0]) => { const f = setup(options); fixtures.push(f); return f; };
afterEach(() => { for (const f of fixtures) rmSync(f.root, { recursive: true, force: true }); fixtures = []; });

describe('executeAuthorizedIntegration — repositório Git real (temporário)', () => {
  test('1/15. completed + aceito + autorizado + alvo intacto ⇒ merge --no-ff exato em dev; receipt = efeito observado', async () => {
    const f = make({ devDiverges: 'clean' });
    const main = mainSha(f);
    authorize(f);
    const outcome = await run(f);
    expect(outcome).toMatchObject({ status: 'integrated', disposition: 'effected' });
    const merge = devSha(f);
    expect(git(f.repo, 'rev-list', '--parents', '-n', '1', merge).split(' ').slice(1)).toEqual([f.dev, f.commit]);
    if (outcome.status === 'integrated') {
      expect(outcome.receipt).toMatchObject({ previousTargetSha: f.dev, resultingTargetSha: merge, mergeCommitSha: merge, mergeParents: [f.dev, f.commit], targetRef: 'refs/heads/dev', resultCommitSha: f.commit });
    }
    expect(receipts(f)).toHaveLength(1);
    // 12. main intocada.
    expect(mainSha(f)).toBe(main);
  }, 60_000);

  test('2/13. sem autorização de merge ⇒ zero Git', async () => {
    const f = make();
    const before = devSha(f);
    const provider = new GitIntegrationEffectProvider(f.repo);
    const spy = jest.spyOn(provider, 'readTarget');
    await expect(executeAuthorizedIntegration({ workItemId: 'work-1', integrationAuthorizationId: 'auth-1' }, deps(f, { provider }))).resolves.toEqual({ status: 'denied', reason: 'authorization_not_found' });
    expect(spy).not.toHaveBeenCalled();
    expect(devSha(f)).toBe(before);
  }, 60_000);

  test('5. alvo avançou depois da autorização ⇒ human_required/authorization_stale; nada muda', async () => {
    const f = make();
    authorize(f);
    git(f.repo, 'update-ref', 'refs/heads/dev', f.commit); // alguém moveu dev (aqui: fast-forward para o próprio commit)
    git(f.repo, 'update-ref', 'refs/heads/dev', commitOn(f, 'x.txt'));
    const moved = devSha(f);
    const outcome = await run(f);
    expect(outcome.status).toBe('human_required');
    expect(devSha(f)).toBe(moved);
    expect(receipts(f)).toHaveLength(0);
  }, 60_000);

  test('6. commit do resultado ausente ⇒ human_required, sem efeito', async () => {
    const f = make();
    authorize(f);
    git(f.repo, 'branch', '-D', 'anima-work/attempt-1');
    git(f.repo, 'reflog', 'expire', '--expire=now', '--all');
    git(f.repo, 'gc', '-q', '--prune=now');
    const before = devSha(f);
    await expect(run(f)).resolves.toEqual({ status: 'human_required', reason: 'result_commit_missing' });
    expect(devSha(f)).toBe(before);
  }, 60_000);

  test('7. conflito ⇒ human_required, alvo intacto, nenhum integration_completed', async () => {
    const f = make({ devDiverges: 'conflict' });
    authorize(f);
    const before = devSha(f);
    await expect(run(f)).resolves.toEqual({ status: 'human_required', reason: 'merge_conflict' });
    expect(devSha(f)).toBe(before);
    expect(receipts(f)).toHaveLength(0);
  }, 60_000);

  test('8/9. efeito Git feito + DB falha ⇒ reconciliation_required; replay reconcilia SEM repetir o merge', async () => {
    const f = make({ devDiverges: 'clean' });
    authorize(f);
    const first = await run(f, { failPersist: true });
    expect(first.status).toBe('reconciliation_required');
    const merge = devSha(f);
    expect(receipts(f)).toHaveLength(0);
    const second = await run(f);
    expect(second).toMatchObject({ status: 'integrated', disposition: 'reconciled' });
    expect(devSha(f)).toBe(merge); // nenhum segundo merge
    if (second.status === 'integrated') expect(second.receipt.mergeCommitSha).toBe(merge);
    expect(receipts(f)).toHaveLength(1);
  }, 60_000);

  test('10. chamada duplicada ⇒ um efeito e um receipt; replay idempotente comprovado pelo Git', async () => {
    const f = make({ devDiverges: 'clean' });
    authorize(f);
    await run(f);
    const merge = devSha(f);
    await expect(run(f)).resolves.toMatchObject({ status: 'integrated', disposition: 'already_persisted' });
    expect(devSha(f)).toBe(merge);
    expect(receipts(f)).toHaveLength(1);
  }, 60_000);

  test('21. concorrência ⇒ um executor avança dev; nenhum segundo merge', async () => {
    const f = make({ devDiverges: 'clean' });
    authorize(f);
    const outcomes = await Promise.all([run(f), run(f)]);
    const merge = devSha(f);
    expect(git(f.repo, 'rev-list', '--parents', '-n', '1', merge).split(' ').slice(1)).toEqual([f.dev, f.commit]);
    expect(outcomes.every((o) => o.status === 'integrated' || o.status === 'retryable')).toBe(true);
    expect(outcomes.some((o) => o.status === 'integrated')).toBe(true);
    expect(receipts(f)).toHaveLength(1);
    // O primeiro pai do merge é o SHA esperado: nenhum merge empilhado sobre outro.
    expect(git(f.repo, 'rev-list', '--count', `${f.dev}..${merge}`)).toBe('2');
  }, 60_000);

  test('17. alvo contém o commit sem receipt exato ⇒ ambíguo (não conclui sucesso)', async () => {
    const f = make();
    authorize(f);
    git(f.repo, 'update-ref', 'refs/heads/dev', f.commit); // fast-forward manual, sem merge autorizado
    await expect(run(f)).resolves.toEqual({ status: 'human_required', reason: 'ambiguous_target' });
    expect(receipts(f)).toHaveLength(0);
  }, 60_000);

  test('18. receipt persistido + alvo com drift ⇒ integrity_violation', async () => {
    const f = make({ devDiverges: 'clean' });
    authorize(f);
    await run(f);
    git(f.repo, 'update-ref', 'refs/heads/dev', f.dev); // dev voltou para antes do merge
    await expect(run(f)).resolves.toEqual({ status: 'integrity_violation', reason: 'receipt_not_proven_by_git' });
  }, 60_000);

  test('22. alvo é merge com pais inesperados ⇒ não integra', async () => {
    const f = make({ devDiverges: 'clean' });
    authorize(f);
    // Merge com pais invertidos [resultado, dev]: contém o commit mas não é o efeito autorizado.
    const tree = git(f.repo, 'merge-tree', '--write-tree', f.dev, f.commit).split(/\s+/)[0]!;
    const wrong = git(f.repo, 'commit-tree', tree, '-p', f.commit, '-p', f.dev, '-m', 'merge invertido');
    git(f.repo, 'update-ref', 'refs/heads/dev', wrong);
    await expect(run(f)).resolves.toEqual({ status: 'human_required', reason: 'ambiguous_target' });
    expect(receipts(f)).toHaveLength(0);
  }, 60_000);

  test('23. receipt persistido com chave de operação divergente ⇒ conflito', async () => {
    const f = make({ devDiverges: 'clean' });
    authorize(f);
    await run(f);
    const integrated = f.events.find((e) => e.type === 'integration_completed')!;
    const data = (integrated.payload as unknown as { data: { receipt: IntegrationEffectReceiptV1 } }).data;
    data.receipt = { ...data.receipt, operationKey: 'integration-effect:outra' };
    await expect(run(f)).resolves.toEqual({ status: 'integrity_violation', reason: 'receipt_conflict' });
  }, 60_000);

  test('19. branch de origem removida mas commit existe ⇒ integra pelo SHA exato', async () => {
    const f = make({ devDiverges: 'clean' });
    authorize(f);
    git(f.repo, 'tag', 'keep', f.commit); // mantém o objeto alcançável
    git(f.repo, 'branch', '-D', 'anima-work/attempt-1');
    await expect(run(f)).resolves.toMatchObject({ status: 'integrated', disposition: 'effected' });
  }, 60_000);

  test('20. falha de cleanup depois do receipt NÃO desfaz a integração', async () => {
    const f = make({ devDiverges: 'clean' });
    authorize(f);
    const outcome = await run(f, { cleanup: async () => { throw new Error('rm falhou'); } });
    expect(outcome).toMatchObject({ status: 'integrated', cleanup: 'failed' });
    expect(receipts(f)).toHaveLength(1);
  }, 60_000);

  test('alvo em checkout numa worktree ⇒ human_required (não move a árvore do operador)', async () => {
    const f = make({ devDiverges: 'clean' });
    authorize(f);
    git(f.repo, 'checkout', '-q', 'dev');
    const before = devSha(f);
    await expect(run(f)).resolves.toEqual({ status: 'human_required', reason: 'target_checked_out' });
    expect(devSha(f)).toBe(before);
  }, 60_000);

  test('11. repositório configurado diferente do remote real ⇒ negado', async () => {
    const f = make();
    authorize(f);
    git(f.repo, 'remote', 'set-url', 'origin', 'https://github.com/evil/other.git');
    await expect(run(f)).resolves.toEqual({ status: 'denied', reason: 'repository_mismatch' });
  }, 60_000);

  test('26. payload com alvo/fonte extras é ignorado: só identidades opacas entram', async () => {
    const f = make({ devDiverges: 'clean' });
    authorize(f);
    const main = mainSha(f);
    const injected = { workItemId: 'work-1', integrationAuthorizationId: 'auth-1', targetRef: 'refs/heads/main', sourceSha: f.base } as unknown as Parameters<typeof executeAuthorizedIntegration>[0];
    await expect(executeAuthorizedIntegration(injected, deps(f))).resolves.toMatchObject({ status: 'integrated' });
    expect(mainSha(f)).toBe(main);
  }, 60_000);

  test('autorização humana deriva tudo: resultado aceito, repositório, dev, SHA atual e modo', async () => {
    const f = make();
    const rpc = jest.fn(async (args: Record<string, unknown>) => ({ data: { action: 'recorded', operation_key: `k:${String(args.expected_target_sha)}` } as unknown as Json, error: null }));
    const outcome = await authorizeIntegrationEffect({ workItemId: 'work-1', authorizationId: 'auth-1' }, {
      getItem: async () => ({ ok: true, value: f.item }), listEvents: async () => ({ ok: true, value: f.events }),
      config: f.config, provider: new GitIntegrationEffectProvider(f.repo), rpc,
    });
    expect(outcome).toMatchObject({ ok: true, expectedTargetSha: devSha(f) });
    expect(rpc).toHaveBeenCalledWith({
      work_item_id: 'work-1', expected_proposal_version: 1, accepted_result_event_id: 'ev-result', authorization_id: 'auth-1',
      repository_id: f.config.repositoryId, target_ref: 'refs/heads/dev', expected_target_sha: devSha(f), mode: 'merge_no_ff',
    });
  }, 60_000);
});

function commitOn(f: Fixture, file: string): string {
  const tree = git(f.repo, 'rev-parse', `${devSha(f)}^{tree}`);
  void file;
  return git(f.repo, 'commit-tree', tree, '-p', devSha(f), '-m', 'avanço externo');
}

describe('Trusted System Writer V0 — receipt de integração só pelo writer de sistema', () => {
  test('19/20/24. executor Git legítimo → writer grava o receipt; sem writer ⇒ pendente e reconcilia depois', async () => {
    const f = make({ devDiverges: 'clean' });
    authorize(f);
    // Sem writer: o efeito Git acontece, mas o receipt NÃO é gravado (nunca pela sessão humana).
    const first = await run(f, { persist: UNAVAILABLE_TRUSTED_SYSTEM_WRITER.integrationReceipt });
    expect(first.status).toBe('reconciliation_required');
    const merge = devSha(f);
    expect(receipts(f)).toHaveLength(0);
    // Writer disponível (cliente fictício que registra a chamada): reconcilia sem novo merge.
    const rpc = jest.fn(async (name: string, args: { receipt: IntegrationEffectReceiptV1 }) => {
      f.events.push(event('ev-integrated', 'integration_completed', 'system', { authorization_id: 'auth-1', receipt: args.receipt }));
      return { data: { action: 'recorded', event_seq: 1 }, error: null };
    });
    const writer = createTrustedSystemWriter(async () => ({ accessToken: 'fake-writer-token' }), () => ({ rpc }) as never);
    const second = await run(f, { persist: writer.integrationReceipt });
    expect(second).toMatchObject({ status: 'integrated', disposition: 'reconciled' });
    expect(rpc).toHaveBeenCalledWith('record_integration_completed', expect.objectContaining({ authorization_id: 'auth-1' }));
    expect(devSha(f)).toBe(merge);
    // 23. main intacta.
    expect(git(f.repo, 'rev-parse', 'refs/heads/main')).not.toBe(merge);
    // Replay idempotente comprovado pelo Git.
    await expect(run(f, { persist: writer.integrationReceipt })).resolves.toMatchObject({ status: 'integrated', disposition: 'already_persisted' });
  }, 60_000);
});
