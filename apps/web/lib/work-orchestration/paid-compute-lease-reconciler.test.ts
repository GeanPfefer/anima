/** @jest-environment node */
import {
  buildNodeLifecycleEvidence,
  projectReconcilableLeases,
  type NodeLifecycleEvidenceEventLike,
  type NodeLifecycleEvidenceV1,
  type NodeLifecycleEvent,
  type NodeLifecycleState,
  type NodeProvisioner,
  type NodeProvisionRequest,
  type ProvisionedNodeHandle,
} from '@anima/core';
import { reconcilePaidComputeLeases, type ReconcilerLease } from './paid-compute-lease-reconciler';
import { RunPodNodeProvisioner, type HttpClient, type HttpRequestInput, type HttpResponse, type RunPodProvisionerConfig } from './runpod-node-provisioner';

// ---------- persistência durável in-memory (modela o log append-only + dedup semântico da RPC) ----------

const semanticKey = (e: NodeLifecycleEvidenceV1): string =>
  `${e.workItemId}|${e.nodeId}|${e.leaseId}|${e.attemptId}|${e.transition.from}|${e.transition.to}|${e.transition.event}`;

function durableStore() {
  const events: NodeLifecycleEvidenceEventLike[] = [];
  const record = async (evidence: NodeLifecycleEvidenceV1): Promise<{ ok: boolean }> => {
    if (events.some(ev => {
      const data = (ev.payload as { data?: { evidence?: unknown } }).data;
      return data && semanticKey(data.evidence as NodeLifecycleEvidenceV1) === semanticKey(evidence);
    })) return { ok: true }; // replay idempotente (mesma transição já registrada)
    events.push({ type: 'host_observed_node_lifecycle_recorded', payload: { data: { work_item_id: evidence.workItemId, attempt_id: evidence.attemptId, evidence: evidence as unknown as import('@anima/types').Json } } });
    return { ok: true };
  };
  return { events, record };
}

const persist = (from: NodeLifecycleState, to: NodeLifecycleState, event: NodeLifecycleEvent, over: Partial<Parameters<typeof buildNodeLifecycleEvidence>[0]> = {}): NodeLifecycleEvidenceV1 => {
  const built = buildNodeLifecycleEvidence({
    nodeId: 'burst-1', providerId: 'runpod', leaseId: 'lease-1', workItemId: 'item-1', attemptId: null,
    billingMode: 'paid', transition: { from, to, event }, healthy: to === 'ready', activeDurationMs: 0,
    authorizationRef: 'auth-1', observedAt: new Date().toISOString(), ...over,
  });
  if (!built.ok) throw new Error(built.defect);
  return built.value;
};

// ---------- fake provider stateful (SOBREVIVE ao crash do runtime, como a cloud real) ----------

const API_KEY = 'rp_secret_reconcile_key';
function statefulRunpod() {
  const pods = new Map<string, { id: string; name: string; desiredStatus: string }>();
  let seq = 0;
  const calls: string[] = [];
  const client: HttpClient = {
    async send({ method, url, body }: HttpRequestInput): Promise<HttpResponse> {
      calls.push(`${method} ${url.replace(/^https?:\/\/[^/]+/, '')}`);
      const json = (status: number, value: unknown): HttpResponse => ({ status, body: JSON.stringify(value) });
      if (method === 'GET' && url.endsWith('/pods')) return json(200, [...pods.values()].filter(p => p.desiredStatus !== 'TERMINATED'));
      if (method === 'POST' && url.endsWith('/pods')) {
        const name = (JSON.parse(body ?? '{}') as { name?: string }).name ?? '';
        const id = `pod-${++seq}`; pods.set(id, { id, name, desiredStatus: 'RUNNING' });
        return json(201, { id, name, desiredStatus: 'RUNNING', publicIp: '10.0.0.1', portMappings: { '11434': 20000 }, costPerHr: 0.5 });
      }
      const m = /\/pods\/([^/]+)(\/stop)?$/.exec(url);
      if (m && !m[2] && method === 'GET') { const p = pods.get(m[1]!); return p ? json(200, { ...p, publicIp: '10.0.0.1', portMappings: { '11434': 20000 } }) : json(404, {}); }
      if (m && m[2] === '/stop' && method === 'POST') { const p = pods.get(m[1]!); if (p) p.desiredStatus = 'EXITED'; return json(p ? 200 : 404, {}); }
      if (m && !m[2] && method === 'DELETE') { const had = pods.delete(m[1]!); return json(had ? 200 : 404, {}); }
      return json(404, {});
    },
  };
  const config: RunPodProvisionerConfig = {
    apiBase: 'https://runpod.fake/v1', apiKey: API_KEY, imageName: 'ollama/ollama', gpuTypeIds: ['A40'],
    gpuCount: 1, cloudType: 'SECURE', containerDiskInGb: 50, volumeInGb: 0, networkVolumeId: null,
    inferencePort: 11434, healthPath: '/', podEnv: {},
  };
  const newProvisioner = () => new RunPodNodeProvisioner(config, client, { pollIntervalMs: 1, sleep: async () => undefined });
  return { pods, calls, client, config, newProvisioner };
}

const request: NodeProvisionRequest = {
  nodeId: 'burst-1', providerId: 'runpod', model: 'qwen3-coder:latest', resourceClass: 'gpu-a40',
  lease: { schemaVersion: 1, nodeId: 'burst-1', providerId: 'runpod', billingMode: 'paid', workItemId: 'item-1', attemptId: 'a1', maxActiveDurationMs: 600000, idleTimeoutMs: 60000, leaseExpiresAt: '2030-01-01T00:00:00Z', authorizationRef: 'auth-1', priceHint: null } as NodeProvisionRequest['lease'],
};

const leasesFrom = (events: readonly NodeLifecycleEvidenceEventLike[]): ReconcilerLease[] =>
  projectReconcilableLeases(events).map(l => ({ ...l, proposalVersion: 1 }));
const observedLeases = (leases: readonly ReconcilerLease[]) => ({ ok: true as const, leases });

// ============================================================
describe('reconcilePaidComputeLeases — unidade (fake provisioner)', () => {
  const fakeProvisioner = (locateResult: Awaited<ReturnType<NonNullable<NodeProvisioner['locate']>>>, spies: { stop: number; destroy: number } = { stop: 0, destroy: 0 }): NodeProvisioner => ({
    providerId: 'runpod',
    provision: async () => ({ ok: false, reason: 'n/a' }),
    inspect: async h => ({ nodeId: h.nodeId, reachable: false, healthy: false }),
    stop: async () => { spies.stop += 1; return { ok: true }; },
    destroy: async () => { spies.destroy += 1; return { ok: true }; },
    locate: async () => locateResult,
  });
  const lease: ReconcilerLease = { nodeId: 'burst-1', providerId: 'runpod', leaseId: 'lease-1', providerRef: null, workItemId: 'item-1', attemptId: null, billingMode: 'paid', authorizationRef: 'auth-1', latestState: 'ready', latestObservedAt: '', proposalVersion: 1 };
  const handle: ProvisionedNodeHandle = { nodeId: 'burst-1', providerId: 'runpod', endpoint: 'http://x', providerRef: 'pod-1' };

  test('falha ao observar leases fica explícita e não fabrica lista vazia observada', async () => {
    const report = await reconcilePaidComputeLeases({
      resolveProvisioner: () => { throw new Error('não deve resolver provider'); },
      readLeases: async () => ({ ok: false, reason: 'paid_lease_observation_unavailable' }),
      readAuthorityValid: async () => false,
      recordEvidence: async () => ({ ok: true }),
    });
    expect(report).toEqual({ results: [], tornDown: 0, retriable: 0, leftAwaiting: 0, observation: 'unavailable' });
  });

  test('órfão de pé + autoridade esgotada → teardown (stop+destroy) e confirma offline', async () => {
    const spies = { stop: 0, destroy: 0 };
    const store = durableStore();
    const report = await reconcilePaidComputeLeases({
      resolveProvisioner: () => fakeProvisioner({ ok: true, found: true, handle }, spies),
      readLeases: async () => observedLeases([lease]),
      readAuthorityValid: async () => false, // autoridade esgotada
      recordEvidence: async e => store.record(e),
    });
    expect(report.tornDown).toBe(1);
    expect(spies).toEqual({ stop: 1, destroy: 1 });
    // evidência append-only de shutdown_requested + shutdown_confirmed (→ offline)
    expect(store.events).toHaveLength(2);
    expect(leasesFrom(store.events)).toHaveLength(0); // não é mais candidata (offline)
  });

  test('provider ausente → confirm_offline sem chamar stop', async () => {
    const spies = { stop: 0, destroy: 0 };
    const store = durableStore();
    const report = await reconcilePaidComputeLeases({
      resolveProvisioner: () => fakeProvisioner({ ok: true, found: false }, spies),
      readLeases: async () => observedLeases([lease]), readAuthorityValid: async () => false, recordEvidence: async e => store.record(e),
    });
    expect(report.results[0]!.outcome).toBe('confirmed_offline');
    expect(spies.stop).toBe(0);
  });

  test('provider ausente MAS com providerRef persistido → stop/destroy direto por id (defesa em profundidade)', async () => {
    const spies = { stop: 0, destroy: 0 };
    const store = durableStore();
    const report = await reconcilePaidComputeLeases({
      resolveProvisioner: () => fakeProvisioner({ ok: true, found: false }, spies),
      readLeases: async () => observedLeases([{ ...lease, providerRef: 'pod-77' }]),
      readAuthorityValid: async () => false, recordEvidence: async e => store.record(e),
    });
    expect(report.results[0]!.outcome).toBe('confirmed_offline');
    expect(spies).toEqual({ stop: 1, destroy: 1 }); // encerra o pod por id mesmo não achado por nome
  });

  test('confirm_offline com providerRef: stop por id FALHA (não-404) → teardown_failed, NÃO fabrica offline', async () => {
    const store = durableStore();
    const provisioner: NodeProvisioner = {
      providerId: 'runpod',
      provision: async () => ({ ok: false, reason: 'n/a' }),
      inspect: async h => ({ nodeId: h.nodeId, reachable: false, healthy: false }),
      stop: async () => ({ ok: false, reason: 'provider_unreachable' }), // teardown por id falha
      destroy: async () => ({ ok: true }),
      locate: async () => ({ ok: true, found: false }), // nome não achou → confirm_offline
    };
    const report = await reconcilePaidComputeLeases({
      resolveProvisioner: () => provisioner,
      readLeases: async () => observedLeases([{ ...lease, providerRef: 'pod-live' }]),
      readAuthorityValid: async () => false, recordEvidence: async e => store.record(e),
    });
    expect(report.results[0]!.outcome).toBe('teardown_failed'); // não afirma offline sobre recurso possivelmente vivo
    expect(store.events).toHaveLength(0); // nenhuma evidência de shutdown_confirmed fabricada
  });

  test('provider inalcançável → retry_later, NÃO abandona nem fabrica teardown', async () => {
    const store = durableStore();
    const report = await reconcilePaidComputeLeases({
      resolveProvisioner: () => fakeProvisioner({ ok: false, reason: 'ECONNREFUSED' }),
      readLeases: async () => observedLeases([lease]), readAuthorityValid: async () => false, recordEvidence: async e => store.record(e),
    });
    expect(report.results[0]!.outcome).toBe('retry_later');
    expect(store.events).toHaveLength(0);
  });

  test('provider volta após indisponibilidade: próximo ciclo converge sem loop dentro do ciclo', async () => {
    const store = durableStore(); let locateCalls = 0; const spies = { stop: 0, destroy: 0 };
    const provisioner = fakeProvisioner({ ok: true, found: true, handle }, spies);
    provisioner.locate = async () => {
      locateCalls += 1;
      return locateCalls === 1 ? { ok: false, reason: 'provider_unreachable' } : { ok: true, found: true, handle };
    };
    const deps = {
      resolveProvisioner: () => provisioner,
      readLeases: async () => observedLeases([lease]),
      readAuthorityValid: async () => false,
      recordEvidence: async (e: NodeLifecycleEvidenceV1) => store.record(e),
    };
    expect((await reconcilePaidComputeLeases(deps)).results[0]?.outcome).toBe('retry_later');
    expect(locateCalls).toBe(1); expect(spies).toEqual({ stop: 0, destroy: 0 });
    expect((await reconcilePaidComputeLeases(deps)).results[0]?.outcome).toBe('torn_down');
    expect(locateCalls).toBe(2); expect(spies).toEqual({ stop: 1, destroy: 1 });
  });

  test('destroy falho no recurso localizado não confirma offline', async () => {
    const store = durableStore();
    const provisioner = fakeProvisioner({ ok: true, found: true, handle });
    provisioner.destroy = async () => ({ ok: false, reason: 'provider_unreachable' });
    const report = await reconcilePaidComputeLeases({
      resolveProvisioner: () => provisioner,
      readLeases: async () => observedLeases([lease]), readAuthorityValid: async () => false, recordEvidence: async e => store.record(e),
    });
    expect(report.results[0]).toMatchObject({ outcome: 'teardown_failed', detail: 'destroy: provider_unreachable' });
    expect(store.events).toHaveLength(1);
    expect(leasesFrom(store.events)[0]?.latestState).toBe('shutting_down');
  });

  test('teardown travado é bounded e permanece reconciliável', async () => {
    const store = durableStore();
    const cleanupSignals: AbortSignal[] = [];
    const provisioner = fakeProvisioner({ ok: true, found: true, handle });
    provisioner.stop = async (_h, signal) => { cleanupSignals.push(signal); return await new Promise(() => undefined); };
    const report = await reconcilePaidComputeLeases({
      resolveProvisioner: () => provisioner, cleanupTimeoutMs: 15,
      readLeases: async () => observedLeases([lease]), readAuthorityValid: async () => false, recordEvidence: async e => store.record(e),
    });
    expect(report.results[0]).toMatchObject({ outcome: 'teardown_failed', detail: 'timeout: node_teardown_timeout' });
    expect(cleanupSignals).toHaveLength(1);
    expect(cleanupSignals[0]!.aborted).toBe(true);
    expect(store.events).toHaveLength(1);
  });

  test('dentro da autoridade + de pé → await (não mata recurso possivelmente em uso)', async () => {
    const report = await reconcilePaidComputeLeases({
      resolveProvisioner: () => fakeProvisioner({ ok: true, found: true, handle }),
      readLeases: async () => observedLeases([lease]), readAuthorityValid: async () => true, recordEvidence: async () => ({ ok: true }),
    });
    expect(report.results[0]!.outcome).toBe('awaited');
  });

  test('sem provisioner/locate para o provider → reconciler_unavailable (não abandona silenciosamente)', async () => {
    const report = await reconcilePaidComputeLeases({
      resolveProvisioner: () => null,
      readLeases: async () => observedLeases([lease]), readAuthorityValid: async () => false, recordEvidence: async () => ({ ok: true }),
    });
    expect(report.results[0]!.outcome).toBe('reconciler_unavailable');
  });
});

// ============================================================
describe('PROVA de crash/recovery (Milestone H) — sem cloud, provider fake stateful', () => {
  test('processo morre após provisionar → novo reconciler descobre o órfão e o desliga; replay não recria', async () => {
    const provider = statefulRunpod();
    const store = durableStore();

    // --- Fase 1: volta viva provisiona um pod PAGO e persiste evidência; então CRASH ---
    const live = provider.newProvisioner();
    await store.record(persist('offline', 'provisioning', 'provision_requested'));
    const provisioned = await live.provision(request, new AbortController().signal);
    expect(provisioned.ok).toBe(true);
    if (!provisioned.ok) return;
    await store.record(persist('provisioning', 'ready', 'health_confirmed'));
    // CRASH: descartamos o runtime (a instância `live` e o handle em memória) SEM teardown.
    // O pod continua de pé no provider (faturando) — o clássico "recurso esquecido".
    expect(provider.pods.size).toBe(1);
    expect([...provider.pods.values()][0]!.desiredStatus).toBe('RUNNING');

    // --- Fase 2: runtime recriado; reconciler carrega estado durável e reconcilia ---
    const orphans = leasesFrom(store.events);
    expect(orphans).toHaveLength(1);
    expect(orphans[0]!.latestState).toBe('ready');

    const report = await reconcilePaidComputeLeases({
      resolveProvisioner: (pid) => (pid === 'runpod' ? provider.newProvisioner() : null),
      readLeases: async () => observedLeases(leasesFrom(store.events)),
      readAuthorityValid: async () => false, // autoridade esgotada → deve desligar
      recordEvidence: async e => store.record(e),
    });

    expect(report.tornDown).toBe(1);
    // O recurso pago foi efetivamente destruído no provider — não ficou órfão faturando.
    expect(provider.pods.size).toBe(0);
    // Evidência prova o lifecycle terminal observado.
    const finalStates = projectReconcilableLeases(store.events);
    expect(finalStates).toHaveLength(0); // convergiu para offline

    // --- Replay/idempotência: um segundo reconciler NÃO recria nem re-derruba nada ---
    const provisionCallsBefore = provider.calls.filter(c => c === 'POST /pods').length;
    const replay = await reconcilePaidComputeLeases({
      resolveProvisioner: () => provider.newProvisioner(),
      readLeases: async () => observedLeases(leasesFrom(store.events)), readAuthorityValid: async () => false, recordEvidence: async e => store.record(e),
    });
    expect(replay.results).toHaveLength(0); // nada a reconciliar (lease offline)
    expect(provider.pods.size).toBe(0);
    expect(provider.calls.filter(c => c === 'POST /pods').length).toBe(provisionCallsBefore); // nenhum recurso novo

    // --- Nenhum segredo entrou na evidência durável ---
    expect(JSON.stringify(store.events)).not.toContain(API_KEY);
  });

  test('crash APÓS enviar stop mas ANTES de confirmar → reconciler converge para offline (não ressuscita)', async () => {
    const provider = statefulRunpod();
    const store = durableStore();
    const live = provider.newProvisioner();
    await store.record(persist('offline', 'provisioning', 'provision_requested'));
    await live.provision(request, new AbortController().signal);
    await store.record(persist('provisioning', 'ready', 'health_confirmed'));
    // Teardown parcial: stop foi solicitado/persistido e o recurso já saiu, mas o processo
    // morreu ANTES de registrar shutdown_confirmed.
    await store.record(persist('ready', 'shutting_down', 'shutdown_requested'));
    for (const p of provider.pods.values()) provider.pods.delete(p.id); // provider já removeu o pod

    const report = await reconcilePaidComputeLeases({
      resolveProvisioner: () => provider.newProvisioner(),
      readLeases: async () => observedLeases(leasesFrom(store.events)), readAuthorityValid: async () => false, recordEvidence: async e => store.record(e),
    });
    expect(report.results[0]!.outcome).toBe('confirmed_offline'); // ausente → confirma, não ressuscita
    expect(projectReconcilableLeases(store.events)).toHaveLength(0);
    const replay = await reconcilePaidComputeLeases({
      resolveProvisioner: () => provider.newProvisioner(),
      readLeases: async () => observedLeases(leasesFrom(store.events)),
      readAuthorityValid: async () => false, recordEvidence: async e => store.record(e),
    });
    expect(replay.results).toHaveLength(0);
  });
});
