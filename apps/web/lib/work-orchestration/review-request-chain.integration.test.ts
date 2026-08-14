/** @jest-environment node */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { BranchPublicationReceipt, ProtectedIntegrationRequest } from '@anima/core';
import { GitBranchPublicationProvider } from './git-branch-publication';
import { GitHubReviewRequestProvider } from './github-review-request';
import { createAndPersistReviewRequest, type PersistReviewReceipt } from './review-request-operation';

// Prova E2E da CADEIA COMPOSTA com transportes REAIS: exatamente o grafo de
// objetos que a rota constrói — GitHubReviewRequestProvider envolvendo o
// GitBranchPublicationProvider real. O branch é publicado por `git push` real
// contra um remote bare LOCAL; o review request é criado por `POST /pulls` real
// (fetch global) contra um servidor HTTP LOCAL que emula o GitHub. Nenhuma rede
// externa, nenhum efeito contra origin/GitHub — a fronteira humana permanece
// intacta. A prova de provider isolada usa branch provider mockado; aqui os DOIS
// transportes reais operam juntos, reconciliados e idempotentes.

const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
const toFwd = (p: string): string => p.split('\\').join('/');
const PULLS = /^\/repos\/[^/]+\/[^/]+\/pulls$/;

interface Pull { number: number; html_url: string; state: string; head: { ref: string; sha: string }; base: { ref: string } }
let server: Server, baseUrl = '';
let recorded: Array<{ method: string; auth: string | undefined }> = [];
let prs: Pull[] = [], nextNumber = 100, headSha = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ''; req.on('data', c => (raw += c)); req.on('end', () => {
      const url = new URL(req.url!, 'http://local'); const body = raw ? JSON.parse(raw) as { head: string; base: string } : undefined;
      recorded.push({ method: req.method!, auth: req.headers['authorization'] });
      if (req.method === 'GET' && PULLS.test(url.pathname)) {
        const head = url.searchParams.get('head'); const branch = head ? head.split(':').slice(1).join(':') : null;
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(prs.filter(p => p.head.ref === branch))); return;
      }
      if (req.method === 'POST' && PULLS.test(url.pathname)) {
        const number = nextNumber++; const pr: Pull = { number, html_url: `https://github.com/acme/widgets/pull/${number}`, state: 'open', head: { ref: body!.head, sha: headSha }, base: { ref: body!.base } };
        prs.push(pr); res.writeHead(201, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(pr)); return;
      }
      res.writeHead(404); res.end('{}');
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });

interface Ctx { root: string; provider: GitHubReviewRequestProvider; request: ProtectedIntegrationRequest }
let ctx: Ctx;

beforeEach(() => {
  recorded = []; prs = []; nextNumber = 100;
  const root = mkdtempSync(join(tmpdir(), 'anima-rr-chain-'));
  // Cauda fixa e segura (acme/widgets): o parse owner/repo do provider não depende
  // do sufixo aleatório do tmpdir e a URL /repos/acme/widgets/pulls é estável.
  const remote = join(root, 'acme', 'widgets.git'), repo = join(root, 'repo');
  mkdirSync(join(root, 'acme'), { recursive: true });
  const remoteFwd = toFwd(remote);
  execFileSync('git', ['init', '--bare', remoteFwd]);
  execFileSync('git', ['init', '-b', 'main', repo]);
  git(repo, 'config', 'user.name', 'Anima Test'); git(repo, 'config', 'user.email', 'anima@test.invalid');
  writeFileSync(join(repo, 'base.txt'), 'base\n'); git(repo, 'add', 'base.txt'); git(repo, 'commit', '-m', 'base');
  const baseSha = git(repo, 'rev-parse', 'HEAD'); git(repo, 'remote', 'add', 'origin', remoteFwd); git(repo, 'push', 'origin', 'main');
  git(repo, 'checkout', '-b', 'anima-work/attempt-real'); writeFileSync(join(repo, 'work.txt'), 'work\n'); git(repo, 'add', 'work.txt'); git(repo, 'commit', '-m', 'work');
  const commitSha = git(repo, 'rev-parse', 'HEAD'); headSha = commitSha;
  const request: ProtectedIntegrationRequest = { protocolVersion: 1, idempotencyKey: `integration-publication:auth:${commitSha}`, authorizationDecisionId: 'auth', acceptedResultEventId: 'result', correlation: { workItemId: 'work', attemptId: 'attempt-real', approvedProposalVersion: 1 }, target: { providerId: 'git-branch-publication-v1', repositoryId: remoteFwd, remoteName: 'origin', baseBranch: 'main' }, baseSha, localBranch: 'anima-work/attempt-real', remoteBranch: 'anima-work/attempt-real', commitSha };
  const provider = new GitHubReviewRequestProvider(new GitBranchPublicationProvider(repo), { apiBaseUrl: baseUrl, token: 'tok' });
  ctx = { root, provider, request };
});
afterEach(() => { rmSync(ctx.root, { recursive: true, force: true }); });

const recordingPersist = (): PersistReviewReceipt => {
  let calls = 0;
  return async () => { calls += 1; return { action: calls === 1 ? 'recorded' : 'replayed', eventSeq: calls }; };
};

test('push real então POST real pela composição, reconciliado e idempotente', async () => {
  const { provider, request, root } = ctx;
  // 1) Branch por push REAL contra o bare local.
  const branchReceipt = await provider.publishBranch(request);
  expect(branchReceipt.disposition).toBe('created');
  expect(git(join(root, 'repo'), 'ls-remote', '--heads', 'origin', 'refs/heads/anima-work/attempt-real').split(/\s+/)[0]).toBe(request.commitSha);

  // 2) Review request por POST REAL, através da operação (máquina de estados + persistência).
  const first = await createAndPersistReviewRequest(request, branchReceipt, provider, recordingPersist());
  expect(first.state.status).toBe('review_request_created');
  expect(first.receipt).toMatchObject({ disposition: 'created', state: 'open', sourceCommitSha: request.commitSha, baseBranch: 'main', sourceBranch: 'anima-work/attempt-real' });
  expect(first.receipt.reviewReference).toMatch(/\/pull\/100$/);
  expect(first.persistence.action).toBe('recorded');
  const postsAfterFirst = recorded.filter(r => r.method === 'POST').length;
  expect(postsAfterFirst).toBe(1);
  expect(recorded.every(r => r.auth === 'Bearer tok')).toBe(true);

  // 3) Replay idempotente: reconcilia o PR existente por transporte real, sem 2º POST.
  const again = await createAndPersistReviewRequest(request, branchReceipt, provider, recordingPersist());
  expect(again.receipt.disposition).toBe('already_existed');
  expect(again.receipt.reviewReference).toMatch(/\/pull\/100$/);
  expect(recorded.filter(r => r.method === 'POST').length).toBe(1); // nenhum POST novo

  // 4) Republicar a branch é idempotente: nenhum segundo push, mesmo commit no remote.
  await expect(provider.publishBranch(request)).resolves.toMatchObject({ disposition: 'already_existed', commitSha: request.commitSha });
}, 30_000);

test('crash após criar o PR: retry reconcilia pelo transporte real sem segundo POST', async () => {
  const { provider, request } = ctx;
  const branchReceipt: BranchPublicationReceipt = await provider.publishBranch(request);

  // Persistência falha DEPOIS do efeito externo (PR já criado). O estado interno
  // não mente: nada é registrado; o retry reconcilia pela releitura real.
  let attempts = 0;
  const flakyPersist: PersistReviewReceipt = async () => { attempts += 1; if (attempts === 1) throw new Error('db unavailable'); return { action: 'recorded', eventSeq: 7 }; };
  await expect(createAndPersistReviewRequest(request, branchReceipt, provider, flakyPersist)).rejects.toThrow('db unavailable');
  const postsAfterCrash = recorded.filter(r => r.method === 'POST').length;
  expect(postsAfterCrash).toBe(1); // o PR foi criado uma vez

  const recovered = await createAndPersistReviewRequest(request, branchReceipt, provider, flakyPersist);
  expect(recovered.receipt.disposition).toBe('already_existed');
  expect(recovered.persistence.action).toBe('recorded');
  expect(recorded.filter(r => r.method === 'POST').length).toBe(1); // nenhum PR duplicado
}, 30_000);
