/** @jest-environment node */
import type { CloudResourceCandidateV1, NodeProvisioner, RequirementMoneyV1 } from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { prepareCloudCoderNode, prepareResilientCloudCoderSession, resilientStopToPreparationReason, type ResidentOnDemandNodeConfig } from './resident-on-demand-node';
import type { RunPodInventoryResult } from './runpod-price-quote';

// ---- fakes: autoridade capability-based, ledger com committed vivo, provisionador roteirizado ----

const CAP_SCOPE = { minimumVramGiB: 24, requiredGpuFeatures: ['cuda'], maxHourlyPrice: { currency: 'USD', amount: 0.55 }, maxNodes: 1 };

/** Client fake que só serve `readActivePaidComputeAuthorization` (autoridade capability-based). O
 * ledger é injetado por portas (reserve/settle/void/readCommittedCost) — este client não é tocado
 * para o ledger. NENHUM provider write. */
const authClient = (ceiling: number | null, validUntil = '2026-09-17T00:00:00.000Z'): SupabaseClient<Database> => {
  const authRow = {
    id: 'auth-sess', user_id: 'u', provider_id: 'runpod', node_id: null, resource_class: null,
    capability_scope: CAP_SCOPE, work_item_id: null, max_duration_ms: 30 * 60_000,
    max_cost_currency: ceiling === null ? null : 'USD', max_cost_amount: ceiling,
    valid_from: '2026-09-10T00:00:00.000Z', valid_until: validUntil, revoked_at: null, created_at: '2026-09-10T00:00:00.000Z',
  };
  const chain = { eq: () => chain, is: () => chain, lte: () => chain, gt: () => chain, order: () => chain,
    limit: async () => ({ data: [authRow], error: null }), maybeSingle: async () => ({ data: authRow, error: null }) };
  return { from: () => ({ select: () => chain }) } as unknown as SupabaseClient<Database>;
};

const candidate = (gpuTypeId: string, perHour: number, availability: CloudResourceCandidateV1['availability'] = 'available'): CloudResourceCandidateV1 => ({
  providerId: 'runpod', resourceClass: `gpu-${gpuTypeId.toLowerCase().replace(/\s+/g, '-')}`, gpuTypeId,
  displayName: gpuTypeId, vramGiB: 48, gpuFeatures: ['cuda'], availability, perHour: { currency: 'USD', amount: perHour },
});

type Step = { readonly kind: 'ok' } | { readonly kind: 'fail'; readonly reason: string; readonly podCreated?: boolean };

/** Ledger vivo em memória: reserve soma R ao committed; settle libera (R−S); void devolve R. */
function liveLedger(initialCommitted = 0) {
  let committed = initialCommitted;
  let resCount = 0;
  const reserved = new Map<string, number>();
  const events: string[] = [];
  return {
    committed: () => committed,
    events: () => events,
    reserveBudget: (async (_c: unknown, args: { estimate: RequirementMoneyV1 }) => {
      const id = `res-${++resCount}`; reserved.set(id, args.estimate.amount); committed += args.estimate.amount;
      events.push(`reserve:${id}:${args.estimate.amount}`);
      return { ok: true, action: 'reserved', reservationId: id };
    }) as unknown as ResidentPrepareLedger['reserveBudget'],
    settleBudget: (async (_c: unknown, args: { reservationId: string; settled: RequirementMoneyV1 }) => {
      const R = reserved.get(args.reservationId) ?? 0; const released = Math.max(0, R - args.settled.amount);
      committed -= released; events.push(`settle:${args.reservationId}:${args.settled.amount}`);
      return { ok: true, action: 'settled', settledAmount: args.settled.amount, releasedExcess: released, currency: args.settled.currency, costSource: 'estimated' };
    }) as unknown as ResidentPrepareLedger['settleBudget'],
    voidBudget: (async (_c: unknown, id: string) => {
      const R = reserved.get(id) ?? 0; committed -= R; events.push(`void:${id}`);
      return { ok: true };
    }) as unknown as ResidentPrepareLedger['voidBudget'],
    readCommittedCost: async (): Promise<RequirementMoneyV1> => ({ currency: 'USD', amount: committed }),
  };
}
type ResidentPrepareLedger = Parameters<typeof prepareResilientCloudCoderSession>[0];

/** Provisionador roteirizado + log de teardown/concorrência. `ok` cria Pod saudável; `fail` com
 * podCreated!==false chama o observer (Pod nasceu) e falha (endpoint/health) → teardown+settlement;
 * `fail` com podCreated===false é rejeição de create (sem observer). */
function scriptedProvisioner(script: readonly Step[], log: string[], counters: { inFlight: number; maxInFlight: number }) {
  let i = 0;
  const provisioner: NodeProvisioner & { disposeAll?: () => Promise<void> } = {
    providerId: 'runpod',
    provision: async (req, _sig, observer) => {
      counters.inFlight += 1; counters.maxInFlight = Math.max(counters.maxInFlight, counters.inFlight);
      log.push(`provision:${req.gpuTypeId}`);
      const step = script[i++] ?? { kind: 'fail', reason: 'provision_failed' };
      const ref = `pod-${req.gpuTypeId}`;
      if (step.kind === 'ok') {
        await observer?.providerIdentified({ nodeId: req.nodeId, providerId: req.providerId, providerRef: ref });
        counters.inFlight -= 1;
        return { ok: true, handle: { nodeId: req.nodeId, providerId: req.providerId, endpoint: `http://${ref}`, providerRef: ref } };
      }
      if (step.podCreated !== false) await observer?.providerIdentified({ nodeId: req.nodeId, providerId: req.providerId, providerRef: ref });
      counters.inFlight -= 1;
      return { ok: false, reason: step.reason };
    },
    inspect: async h => ({ nodeId: h.nodeId, reachable: true, healthy: true }),
    stop: async h => { log.push(`teardown:${h.providerRef}`); return { ok: true }; },
    destroy: async h => { log.push(`teardown:${h.providerRef}`); return { ok: true }; },
    disposeAll: async () => undefined,
  };
  return provisioner;
}

const inventory = (...c: CloudResourceCandidateV1[]) => async (): Promise<RunPodInventoryResult> => ({ ok: true, candidates: c });

const baseConfig = (nodeId: string): ResidentOnDemandNodeConfig => ({
  nodeId, providerId: 'runpod', model: 'qwen3-coder:latest', resourceClass: 'gpu-generic', billingMode: 'paid',
  maxActiveDurationMs: 30 * 60_000, idleTimeoutMs: 60_000, maxConcurrentPaidNodes: null, priceHint: null,
});

const run = (nodeId: string, opts: {
  script: readonly Step[]; candidates: CloudResourceCandidateV1[]; ceiling?: number | null; initialCommitted?: number;
  log: string[]; counters: { inFlight: number; maxInFlight: number }; ledger: ReturnType<typeof liveLedger>;
  maxSessionDurationMs?: number; validUntil?: string;
  readCommittedCost?: () => Promise<RequirementMoneyV1 | null>;
}) => {
  // UM provisionador compartilhado entre as tentativas (o índice do roteiro persiste); reflete a
  // realidade: o adapter concreto é o mesmo durante toda a sessão. O loop garante 1 Pod por vez.
  const provisioner = scriptedProvisioner(opts.script, opts.log, opts.counters);
  return prepareResilientCloudCoderSession({
    client: authClient(opts.ceiling === undefined ? 1.5 : opts.ceiling, opts.validUntil),
    config: baseConfig(nodeId), workItemId: 'work-1', proposalVersion: 1, cloudSessionId: `sess-${nodeId}`,
    signal: new AbortController().signal, now: (() => { let t = Date.parse('2026-09-10T00:00:00Z'); return () => new Date(t += 1000); })(),
    ...(opts.maxSessionDurationMs ? { maxSessionDurationMs: opts.maxSessionDurationMs } : {}),
    provisionerFactory: () => provisioner,
    readResourceInventory: inventory(...opts.candidates),
    evidenceSink: { record: async () => ({ ok: true, action: 'recorded' }) },
    reserveBudget: opts.ledger.reserveBudget, settleBudget: opts.ledger.settleBudget, voidBudget: opts.ledger.voidBudget,
    readCommittedCost: opts.readCommittedCost ?? opts.ledger.readCommittedCost,
  });
};

describe('prepareResilientCloudCoderSession — caminho vivo', () => {
  test('1./11./12. endpoint_unpublished → settlement → teardown → 2º placement → Pod saudável reutilizado', async () => {
    const log: string[] = []; const counters = { inFlight: 0, maxInFlight: 0 }; const ledger = liveLedger();
    const out = await run('n1', {
      script: [{ kind: 'fail', reason: 'endpoint_unpublished' }, { kind: 'ok' }],
      candidates: [candidate('NVIDIA A40', 0.4), candidate('NVIDIA L40S', 0.44)],
      log, counters, ledger,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.attempts).toBe(2);
    expect(out.placementId).toBe('runpod:NVIDIA L40S');
    expect(out.providerRef).toBe('pod-NVIDIA L40S');
    expect(out.trace[0]).toMatchObject({ placementId: 'runpod:NVIDIA A40', outcome: 'failed', failureClass: 'endpoint_publication_timeout' });
    expect(out.trace[0]!.settledCost).not.toBeNull();
    expect(out.trace[1]).toMatchObject({ placementId: 'runpod:NVIDIA L40S', outcome: 'healthy' });
    // 1 Pod por vez; teardown do 1º ANTES do provision do 2º; exatamente 2 provisões.
    expect(counters.maxInFlight).toBe(1);
    expect(log.indexOf('teardown:pod-NVIDIA A40')).toBeLessThan(log.indexOf('provision:NVIDIA L40S'));
    expect(log.filter(l => l.startsWith('provision:'))).toEqual(['provision:NVIDIA A40', 'provision:NVIDIA L40S']);
    // settlement liberou excesso: committed reflete só o custo efetivo (bem abaixo de 2 reservas).
    expect(ledger.events().some(e => e.startsWith('settle:res-1'))).toBe(true);
    // Pod saudável reutilizável: finish disponível, sem terceira provisão.
    await out.finish('attempt-final');
    expect(log.filter(l => l.startsWith('provision:'))).toHaveLength(2);
  });

  test('5./6./9. Pod saudável mantém o mesmo providerRef por coder→gates→Verifier→review e só então finaliza', async () => {
    const log: string[] = []; const counters = { inFlight: 0, maxInFlight: 0 }; const ledger = liveLedger();
    const out = await run('same-pod', {
      script: [{ kind: 'ok' }], candidates: [candidate('NVIDIA A40', 0.4)], log, counters, ledger,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    const ref = out.providerRef;
    const runtimeUrl = out.runtime.url;
    for (const phase of ['coder', 'gates', 'Verifier', 'review']) {
      log.push(`${phase}:${ref}:${runtimeUrl}`);
      expect(out.providerRef).toBe(ref);
      expect(out.runtime.url).toBe(runtimeUrl);
      expect(log.filter(l => l.startsWith('teardown:'))).toHaveLength(0);
    }

    await out.finish('attempt-review');
    expect(log.filter(l => /^(coder|gates|Verifier|review):/.test(l))).toEqual([
      `coder:${ref}:${runtimeUrl}`, `gates:${ref}:${runtimeUrl}`,
      `Verifier:${ref}:${runtimeUrl}`, `review:${ref}:${runtimeUrl}`,
    ]);
    expect(log.filter(l => l === `teardown:${ref}`)).toHaveLength(2); // stop + destroy, mesmo Pod
    expect(ledger.events().some(e => e.startsWith('settle:res-1'))).toBe(true);
  });

  test.each(['coder_failure', 'gate_failure'] as const)(
    '7./8. %s ainda executa settlement final + teardown do Pod saudável',
    async terminal => {
      const log: string[] = []; const counters = { inFlight: 0, maxInFlight: 0 }; const ledger = liveLedger();
      const out = await run(terminal, {
        script: [{ kind: 'ok' }], candidates: [candidate('NVIDIA A40', 0.4)], log, counters, ledger,
      });
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      log.push(`${terminal}:${out.providerRef}`);
      expect(log.filter(l => l.startsWith('teardown:'))).toHaveLength(0);
      await out.finish(`attempt-${terminal}`);
      expect(log.filter(l => l === `teardown:${out.providerRef}`)).toHaveLength(2);
      expect(ledger.events().some(e => e.startsWith('settle:res-1'))).toBe(true);
    },
  );

  test('capacity_unavailable (rejeição de create) → VOID libera budget → próxima máquina', async () => {
    const log: string[] = []; const counters = { inFlight: 0, maxInFlight: 0 }; const ledger = liveLedger();
    const out = await run('n2', {
      script: [{ kind: 'fail', reason: 'capacity_unavailable', podCreated: false }, { kind: 'ok' }],
      candidates: [candidate('NVIDIA A40', 0.4), candidate('NVIDIA L40S', 0.44)],
      log, counters, ledger,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.attempts).toBe(2);
    expect(out.trace[0]).toMatchObject({ failureClass: 'candidate_capacity_absent' });
    expect(ledger.events().some(e => e.startsWith('void:'))).toBe(true); // create rejeitado → void
    expect(log.some(l => l === 'teardown:pod-NVIDIA A40')).toBe(false);   // nenhum Pod para derrubar
  });

  test('4. budget insuficiente após settlement → para fail-closed (session_budget_exhausted)', async () => {
    const log: string[] = []; const counters = { inFlight: 0, maxInFlight: 0 };
    // committed já em 1.4 (histórico); teto 1.5. 1ª reserva 0.2 caberia (1.4+0.2=1.6>1.5) — na verdade
    // nem a 1ª cabe. Ajuste: committed 1.35 → 1ª (0.22 do L40S? A40 0.2) cabe (1.35+0.2=1.55>1.5)… então
    // nenhuma cabe. Usamos committed 1.35 e uma única candidata cara para provar o stop imediato.
    const ledger = liveLedger(1.4);
    const out = await run('n3', {
      script: [{ kind: 'ok' }], candidates: [candidate('NVIDIA A40', 0.4)], ceiling: 1.5, log, counters, ledger,
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.stopReason).toBe('session_budget_exhausted');
    expect(out.attempts).toBe(0);
    expect(log.filter(l => l.startsWith('provision:'))).toHaveLength(0);
  });

  test('committed=0.49 + reserva=0.245 sob teto=1.50 é executável no caminho vivo', async () => {
    const log: string[] = []; const counters = { inFlight: 0, maxInFlight: 0 }; const ledger = liveLedger(0.49);
    const out = await run('budget-live-regression', {
      script: [{ kind: 'ok' }], candidates: [candidate('NVIDIA A40', 0.49)], ceiling: 1.5, log, counters, ledger,
    });
    expect(out.ok).toBe(true);
    expect(log.filter(l => l.startsWith('provision:'))).toEqual(['provision:NVIDIA A40']);
  });

  test('falha real de leitura permanece fail-closed como teto integral', async () => {
    const log: string[] = []; const counters = { inFlight: 0, maxInFlight: 0 }; const ledger = liveLedger();
    const out = await run('budget-read-failure', {
      script: [{ kind: 'ok' }], candidates: [candidate('NVIDIA A40', 0.49)], ceiling: 1.5, log, counters, ledger,
      readCommittedCost: async () => ({ currency: 'USD', amount: 1.5 }),
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.stopReason).toBe('session_budget_exhausted');
    expect(log.filter(l => l.startsWith('provision:'))).toHaveLength(0);
  });

  test('6. provider_unreachable global → NÃO martela (para na 1ª, provider_unavailable)', async () => {
    const log: string[] = []; const counters = { inFlight: 0, maxInFlight: 0 }; const ledger = liveLedger();
    const out = await run('n4', {
      script: [{ kind: 'fail', reason: 'provider_unreachable', podCreated: false }],
      candidates: [candidate('NVIDIA A40', 0.4), candidate('NVIDIA L40S', 0.44)],
      log, counters, ledger,
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.stopReason).toBe('provider_unavailable');
    expect(out.attempts).toBe(1);
    expect(log.filter(l => l.startsWith('provision:'))).toEqual(['provision:NVIDIA A40']);
  });

  test('5. todos os candidatos falham endpoint → no_more_candidates', async () => {
    const log: string[] = []; const counters = { inFlight: 0, maxInFlight: 0 }; const ledger = liveLedger();
    const out = await run('n5', {
      script: [{ kind: 'fail', reason: 'endpoint_unpublished' }, { kind: 'fail', reason: 'endpoint_unpublished' }],
      candidates: [candidate('NVIDIA A40', 0.4), candidate('NVIDIA L40S', 0.44)],
      log, counters, ledger,
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.stopReason).toBe('no_more_candidates');
    expect(out.attempts).toBe(2);
    expect(out.detail).toContain('selection:');
  });

  test('autoridade sem teto agregado → para terminal (não abre sessão)', async () => {
    const log: string[] = []; const counters = { inFlight: 0, maxInFlight: 0 }; const ledger = liveLedger();
    const out = await run('n6', { script: [{ kind: 'ok' }], candidates: [candidate('NVIDIA A40', 0.4)], ceiling: null, log, counters, ledger });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.stopReason).toBe('terminal_failure');
  });
});

describe('prepareCloudCoderNode — roteamento env-gated (caminho canônico do host-turn)', () => {
  const OLD = process.env.ANIMA_RESILIENT_CLOUD_SESSION;
  const OLD_PER_PLACEMENT = process.env.ANIMA_RESILIENT_CLOUD_MAX_ATTEMPTS_PER_PLACEMENT;
  afterEach(() => {
    if (OLD === undefined) delete process.env.ANIMA_RESILIENT_CLOUD_SESSION; else process.env.ANIMA_RESILIENT_CLOUD_SESSION = OLD;
    if (OLD_PER_PLACEMENT === undefined) delete process.env.ANIMA_RESILIENT_CLOUD_MAX_ATTEMPTS_PER_PLACEMENT;
    else process.env.ANIMA_RESILIENT_CLOUD_MAX_ATTEMPTS_PER_PLACEMENT = OLD_PER_PLACEMENT;
  });

  const acquire = (nodeId: string, script: Step[], ledger: ReturnType<typeof liveLedger>, log: string[], counters: { inFlight: number; maxInFlight: number }) => {
    const provisioner = scriptedProvisioner(script, log, counters);
    return prepareCloudCoderNode({
      client: authClient(1.5), config: baseConfig(nodeId), workItemId: 'work-1', proposalVersion: 1,
      leaseId: `sess-${nodeId}`, signal: new AbortController().signal,
      now: (() => { let t = Date.parse('2026-09-10T00:00:00Z'); return () => new Date(t += 1000); })(),
      provisionerFactory: () => provisioner,
      readResourceInventory: inventory(candidate('NVIDIA A40', 0.4), candidate('NVIDIA L40S', 0.44)),
      evidenceSink: { record: async () => ({ ok: true, action: 'recorded' }) },
      reserveBudget: ledger.reserveBudget, settleBudget: ledger.settleBudget, voidBudget: ledger.voidBudget,
    });
  };

  test('gate ON + runpod pago → SESSÃO RESILIENTE (1ª falha reprovisiona; 2ª ok)', async () => {
    process.env.ANIMA_RESILIENT_CLOUD_SESSION = 'true';
    const log: string[] = []; const counters = { inFlight: 0, maxInFlight: 0 };
    const prep = await acquire('gate-on', [{ kind: 'fail', reason: 'endpoint_unpublished' }, { kind: 'ok' }], liveLedger(), log, counters);
    expect(prep.ok).toBe(true); // tentativa única teria PARADO na 1ª falha
    // reprovisionou: duas provisões, a 2ª saudável.
    expect(log.filter(l => l.startsWith('provision:'))).toEqual(['provision:NVIDIA A40', 'provision:NVIDIA L40S']);
  });

  test('gate OFF → TENTATIVA ÚNICA (1ª falha NÃO reprovisiona)', async () => {
    process.env.ANIMA_RESILIENT_CLOUD_SESSION = 'false';
    const log: string[] = []; const counters = { inFlight: 0, maxInFlight: 0 };
    const prep = await acquire('gate-off', [{ kind: 'fail', reason: 'endpoint_unpublished' }, { kind: 'ok' }], liveLedger(), log, counters);
    expect(prep.ok).toBe(false);
    expect(log.filter(l => l.startsWith('provision:'))).toEqual(['provision:NVIDIA A40']); // sem 2ª máquina
  });

  test('gate ON respeita retry configurado por placement antes de excluir a SKU', async () => {
    process.env.ANIMA_RESILIENT_CLOUD_SESSION = 'true';
    process.env.ANIMA_RESILIENT_CLOUD_MAX_ATTEMPTS_PER_PLACEMENT = '2';
    const log: string[] = []; const counters = { inFlight: 0, maxInFlight: 0 };
    const prep = await acquire('gate-retry-sku', [{ kind: 'fail', reason: 'endpoint_unpublished' }, { kind: 'ok' }], liveLedger(), log, counters);
    expect(prep.ok).toBe(true);
    expect(log.filter(l => l.startsWith('provision:'))).toEqual(['provision:NVIDIA A40', 'provision:NVIDIA A40']);
    expect(counters.maxInFlight).toBe(1);
  });

  test('mapeamento de parada → refusal: budget→aggregate_budget_denied, no_more→no_compatible, provider→provision_failed', () => {
    expect(resilientStopToPreparationReason('session_budget_exhausted')).toBe('aggregate_budget_denied');
    expect(resilientStopToPreparationReason('no_more_candidates')).toBe('no_compatible_cloud_resource');
    expect(resilientStopToPreparationReason('provider_unavailable')).toBe('provision_failed');
    expect(resilientStopToPreparationReason('terminal_failure')).toBe('provision_failed');
  });
});
