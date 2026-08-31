/** @jest-environment node */
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildNodeLifecycleEvidence,
  decideCoderProvisioning,
  estimateLeaseCost,
  evaluateLeaseStatus,
  evaluatePaidComputeAuthorization,
  transitionNodeLifecycle,
  type NodeLeaseV0,
  type NodeLifecycleEvent,
  type NodeLifecycleEvidenceV1,
  type NodeLifecycleState,
  type NodeProvisionRequest,
  type WorkExecutorRequest,
  type WorkExecutorSignal,
} from '@anima/core';
import { runProcess } from './worktree';
import { OllamaCoderBackend } from './ollama-coder';
import { WorktreeExecutorAdapter, type WorktreeTargetResolver } from './worktree-executor';
import { decideCoderPlacement, type CoderInferenceNodeV0 } from './coder-placement';
import { LocalProcessNodeProvisioner } from './local-process-node-provisioner';

jest.setTimeout(45_000);

const git = (repo: string, args: readonly string[]) => runProcess('git', ['-C', repo, ...args], { cwd: repo, timeoutMs: 30_000 });
const FIXTURE = join(__dirname, '__fixtures__', 'fake-inference-node.cjs');
const MODEL = 'qwen3-coder:latest';

/** Aplica uma transição que se ESPERA legal e devolve o novo estado; falha o teste se ilegal. */
const advance = (from: NodeLifecycleState, event: NodeLifecycleEvent): NodeLifecycleState => {
  const result = transitionNodeLifecycle(from, event);
  if (!result.ok) throw new Error(`transição ilegal inesperada: ${event} de ${from}`);
  return result.to;
};

async function makeNpmRepo(): Promise<{ repo: string; sha: string; resolver: WorktreeTargetResolver; cleanup: () => Promise<void> }> {
  const repo = await mkdtemp(join(tmpdir(), 'anima-prov-'));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.name', 'test']);
  await git(repo, ['config', 'user.email', 'test@anima.local']);
  await git(repo, ['config', 'commit.gpgsign', 'false']);
  await writeFile(join(repo, 'package.json'), JSON.stringify({
    name: 'fixture', version: '0.0.0', private: true,
    scripts: { test: 'node -e "process.exit(0)"' },
  }, null, 2));
  await mkdir(join(repo, 'src'), { recursive: true });
  await writeFile(join(repo, 'src', 'existing.ts'), 'export const one = 1;\n');
  await writeFile(join(repo, '.gitignore'), 'node_modules/\n');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'inicial']);
  const sha = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  return { repo, sha, resolver: { resolve: reference => reference === 'anima' ? { repoRoot: repo, sha } : null }, cleanup: () => rm(repo, { recursive: true, force: true }) };
}

let counter = 0;
const request = (overrides: Partial<WorkExecutorRequest> = {}): WorkExecutorRequest => ({
  attemptId: `att-${Date.now()}-${counter++}`,
  workItemId: 'item-1', approvedProposalVersion: 1, capability: 'programming',
  objective: 'Adicionar uma função pura', includedScope: ['src/added.ts'], excludedScope: ['src/other.ts'],
  target: { kind: 'project', reference: 'anima' }, permissions: ['workspace_read', 'workspace_write_isolated'],
  validationCriteria: [{ label: 'testes', command: 'npm test' }], limits: { maxDurationMinutes: 1 }, contextReferences: [],
  ...overrides,
});

const provisionRequest = (nodeId: string, lease: NodeLeaseV0): NodeProvisionRequest =>
  ({ nodeId, providerId: 'local-process', model: MODEL, resourceClass: 'local-cpu', lease });

const ownedLease = (nodeId: string, expiresAt: string): NodeLeaseV0 => ({
  schemaVersion: 1, nodeId, providerId: 'local-process', billingMode: 'owned', workItemId: 'item-1', attemptId: 'att-lease',
  maxActiveDurationMs: 30 * 60_000, idleTimeoutMs: 5 * 60_000, leaseExpiresAt: expiresAt, authorizationRef: null,
  priceHint: { currency: 'USD', perHour: 0 },
});

const notRequired = { authorized: true, requiresPayment: false, reason: 'paid_not_required' } as const;

async function collect(adapter: WorktreeExecutorAdapter, req: WorkExecutorRequest, signal: AbortSignal): Promise<WorkExecutorSignal[]> {
  const signals: WorkExecutorSignal[] = [];
  for await (const value of adapter.execute(req, signal)) signals.push(value);
  return signals;
}

describe('Provisionamento On-Demand V1 — prova controlada sem cloud paga', () => {
  let ctx: Awaited<ReturnType<typeof makeNpmRepo>>;
  beforeAll(async () => { ctx = await makeNpmRepo(); });
  afterAll(async () => { await ctx.cleanup(); });

  test('lifecycle governado completo: offline → provision → ready → coder na Goma → idle → stop → offline', async () => {
    const provisioner = new LocalProcessNodeProvisioner({ command: process.execPath, args: [FIXTURE] });
    const signal = new AbortController().signal;
    const evidence: NodeLifecycleEvidenceV1[] = [];
    const nodeId = 'goma-burst-1';
    let state: NodeLifecycleState = 'offline';
    const activeSince = new Date();
    const recordEvidence = (from: NodeLifecycleState, to: NodeLifecycleState, event: NodeLifecycleEvent, healthy: boolean, durationMs: number): void => {
      const built = buildNodeLifecycleEvidence({
        nodeId, providerId: 'local-process', leaseId: 'lease-att-lease', workItemId: 'item-1', attemptId: 'att-lease', billingMode: 'owned',
        transition: { from, to, event }, healthy, activeDurationMs: durationMs, observedAt: new Date().toISOString(),
      });
      expect(built.ok).toBe(true);
      if (built.ok) evidence.push(built.value);
    };

    try {
      const lease = ownedLease(nodeId, new Date(Date.now() + 60 * 60_000).toISOString());

      // 1. Node owned não exige autorização financeira (necessidade sem gasto).
      const auth = evaluatePaidComputeAuthorization(
        { billingMode: 'owned', providerId: 'local-process', nodeId, resourceClass: 'local-cpu', workItemId: 'item-1', requestedDurationMs: 60_000 },
        null, new Date(),
      );
      expect(auth).toMatchObject({ authorized: true, requiresPayment: false });

      // 2. Placement decidiu remote (não modelado aqui); provisioning decide provisionar.
      expect(decideCoderProvisioning({ lifecycleState: state, billingMode: 'owned', authorization: auth })).toEqual({ action: 'provision' });
      state = advance(state, 'provision_requested');
      expect(state).toBe('provisioning');

      // 3. Provisiona um PROCESSO REAL e health-checka por fora (Goma é a fonte da saúde).
      const outcome = await provisioner.provision(provisionRequest(nodeId, lease), signal);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      const handle = outcome.handle;
      expect(handle.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

      const health = await provisioner.inspect(handle, signal);
      expect(health).toMatchObject({ reachable: true, healthy: true });
      state = advance(state, 'health_confirmed');
      expect(state).toBe('ready');
      recordEvidence('provisioning', 'ready', 'health_confirmed', true, Date.now() - activeSince.getTime());

      // 4. Agora saudável, o placement REAL confirma remote contra o node pronto.
      const readyNode: CoderInferenceNodeV0 = {
        id: nodeId, endpoint: handle.endpoint, locality: 'remote', enabled: true, healthy: true,
        capabilities: ['coder_inference'], models: [MODEL], resourceClass: 'local-cpu', billingMode: 'owned',
      };
      const placement = decideCoderPlacement({ pressure: 'high', model: MODEL, nodes: [readyNode], paidComputeAuthorized: false });
      expect(placement).toMatchObject({ placement: 'remote', node: { id: nodeId } });

      // 5. Reserva e roda o coder REAL contra o endpoint remoto; a Goma mantém worktree/git/gate.
      state = advance(state, 'reserved');
      expect(state).toBe('busy');
      const backend = new OllamaCoderBackend({
        model: MODEL, url: handle.endpoint, backendId: `ollama:remote/${nodeId}:${MODEL}`, locality: 'remote', nodeId, timeoutMs: 5_000,
      });
      const req = request();
      const signals = await collect(new WorktreeExecutorAdapter({ targets: ctx.resolver, backend, emitCheckpoint: true }), req, signal);
      const terminal = signals.at(-1)!;
      expect(terminal.kind).toBe('result');
      // A operação remota foi aplicada LOCALMENTE (Git na Goma), original intocado.
      const branch = `anima-work/${req.attemptId}`;
      expect((await git(ctx.repo, ['show', `${branch}:src/added.ts`])).stdout).toContain('export const two = 2');
      await expect(stat(join(ctx.repo, 'src', 'added.ts'))).rejects.toBeTruthy();
      await git(ctx.repo, ['branch', '-D', branch]).catch(() => undefined);

      // 6. Libera → idle; lease ainda ativo.
      state = advance(state, 'released');
      expect(state).toBe('idle');
      const leaseStatus = evaluateLeaseStatus({ lease, now: new Date(), activeSince, idleSince: new Date() });
      expect(leaseStatus.status).toBe('active');

      // 7. Desliga o processo real; endpoint fica inalcançável.
      state = advance(state, 'shutdown_requested');
      expect(state).toBe('shutting_down');
      const stopped = await provisioner.stop(handle, signal);
      expect(stopped.ok).toBe(true);
      state = advance(state, 'shutdown_confirmed');
      expect(state).toBe('offline');
      recordEvidence('shutting_down', 'offline', 'shutdown_confirmed', false, Date.now() - activeSince.getTime());
      const afterStop = await provisioner.inspect(handle, signal);
      expect(afterStop.reachable).toBe(false);

      // 8. Evidência host-observed preservada para as transições-chave.
      expect(evidence.map(e => e.transition.to)).toEqual(['ready', 'offline']);
      expect(estimateLeaseCost(lease.priceHint, leaseStatus.status === 'active' ? leaseStatus.activeDurationMs : 0)).toEqual({ currency: 'USD', amount: 0 });
    } finally {
      await provisioner.disposeAll();
    }
  });

  test('recovery: provisão que nunca sobe vira provision_failed e NÃO auto-retry (sem laço de gasto)', async () => {
    const provisioner = new LocalProcessNodeProvisioner({ command: process.execPath, args: ['-e', 'process.exit(1)'] }, { startTimeoutMs: 3_000 });
    try {
      const outcome = await provisioner.provision(provisionRequest('dead-node', ownedLease('dead-node', new Date(Date.now() + 60_000).toISOString())), new AbortController().signal);
      expect(outcome.ok).toBe(false);
      const state = advance('provisioning', 'provision_failed');
      expect(state).toBe('provision_failed');
      const decision = decideCoderProvisioning({ lifecycleState: state, billingMode: 'owned', authorization: notRequired });
      expect(decision).toEqual({ action: 'defer', reason: 'node_unhealthy' });
    } finally {
      await provisioner.disposeAll();
    }
  });

  test('recovery: endpoint sobe mas health falha → health_failed; teardown ainda é possível', async () => {
    const provisioner = new LocalProcessNodeProvisioner({ command: process.execPath, args: [FIXTURE], env: { FAKE_NODE_UNHEALTHY: '1' } });
    const signal = new AbortController().signal;
    try {
      const outcome = await provisioner.provision(provisionRequest('sick-node', ownedLease('sick-node', new Date(Date.now() + 60_000).toISOString())), signal);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      const health = await provisioner.inspect(outcome.handle, signal);
      expect(health).toMatchObject({ reachable: true, healthy: false });
      const state = advance('provisioning', 'health_lost');
      expect(state).toBe('health_failed');
      // Um node doente ainda deve poder ser desligado (pode custar).
      expect(transitionNodeLifecycle(state, 'shutdown_requested')).toMatchObject({ ok: true, to: 'shutting_down' });
      expect((await provisioner.stop(outcome.handle, signal)).ok).toBe(true);
    } finally {
      await provisioner.disposeAll();
    }
  });

  test('recovery: stop que falha vira shutdown_failed (node pode seguir custando)', async () => {
    const provisioner = new LocalProcessNodeProvisioner({ command: process.execPath, args: [FIXTURE] }, { failStop: true });
    const signal = new AbortController().signal;
    try {
      const outcome = await provisioner.provision(provisionRequest('stuck-node', ownedLease('stuck-node', new Date(Date.now() + 60_000).toISOString())), signal);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      const stopped = await provisioner.stop(outcome.handle, signal);
      expect(stopped.ok).toBe(false);
      const state = advance('shutting_down', 'shutdown_failed');
      expect(state).toBe('shutdown_failed');
      // Retry idempotente do teardown continua disponível.
      expect(transitionNodeLifecycle(state, 'shutdown_requested')).toMatchObject({ ok: true, to: 'shutting_down' });
    } finally {
      // O processo real (que o failStop deixou vivo de propósito) é encerrado aqui.
      await provisioner.disposeAll();
    }
  });

  test('idempotência: dois polls sobre um node subindo NÃO disparam segunda provisão', () => {
    // Primeiro poll: offline → provision.
    expect(decideCoderProvisioning({ lifecycleState: 'offline', billingMode: 'owned', authorization: notRequired })).toEqual({ action: 'provision' });
    // Após provision_requested o estado é provisioning; um segundo poll aguarda, não provisiona.
    expect(decideCoderProvisioning({ lifecycleState: 'provisioning', billingMode: 'owned', authorization: notRequired })).toEqual({ action: 'await_provisioning' });
    // A transição idempotente confirma: provision_requested sobre provisioning é no-op.
    expect(transitionNodeLifecycle('provisioning', 'provision_requested')).toMatchObject({ ok: true, kind: 'noop', to: 'provisioning' });
  });

  test('lease expirado força o desligamento determinístico do node', () => {
    const lease = ownedLease('idle-node', new Date(Date.now() + 60 * 60_000).toISOString());
    const expired = evaluateLeaseStatus({
      lease, now: new Date(), activeSince: new Date(Date.now() - 40 * 60_000), idleSince: new Date(Date.now() - 10 * 60_000),
    });
    expect(expired.status).toBe('expired');
    // Um lease expirado leva a pedir shutdown de um node idle.
    expect(transitionNodeLifecycle('idle', 'shutdown_requested')).toMatchObject({ ok: true, to: 'shutting_down' });
  });
});
