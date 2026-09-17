/** @jest-environment node */
import { deriveCloudSessionEnvelope, type CloudSessionEnvelopeV1, type RequirementMoneyV1 } from '@anima/core';
import {
  runResilientCloudSession,
  type CloudSessionCandidateSelectionResult,
  type CloudSessionProvisionResult,
  type ResilientCloudSessionPorts,
} from './resilient-cloud-session';

type Runtime = { readonly id: string };

const envelope = (over: Partial<CloudSessionEnvelopeV1> = {}): CloudSessionEnvelopeV1 => ({
  ...deriveCloudSessionEnvelope({ cloudSessionId: 'sess-1', maxTotalCost: { currency: 'USD', amount: 1.5 }, maxSessionDurationMs: 60 * 60_000 })!,
  ...over,
});

const usd = (amount: number): RequirementMoneyV1 => ({ currency: 'USD', amount });

/**
 * Harness de portas com fakes determinísticos. Modela um ledger cujo `committed` reflete os
 * settlements, um matcher sobre um inventário fixo (menos placements excluídos), e um provisioner
 * roteirizado. Registra um LOG de eventos (provision/settle/teardown) para provar ordenação e
 * concorrência. NENHUM efeito real: zero provider write.
 */
function harness(opts: {
  readonly inventory: readonly { placementId: string; estimatedCost: RequirementMoneyV1 | null }[];
  /** Roteiro de provisão por placementId (na ordem de tentativa). */
  readonly script: readonly (
    | { readonly kind: 'ok' }
    | { readonly kind: 'fail'; readonly reason: string; readonly settledCost?: RequirementMoneyV1 | null }
  )[];
  readonly initialCommitted?: RequirementMoneyV1 | null;
  /** Blocker de seleção quando não há mais candidatos (default: sem candidato). */
  readonly selectionBlockerWhenExhausted?: { blocker: string; detail: string };
}) {
  const log: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let committed = opts.initialCommitted ?? usd(0);
  let scriptIdx = 0;

  const ports: ResilientCloudSessionPorts<Runtime> = {
    async readCommittedCost() { return committed; },
    now: (() => { let t = 0; return () => (t += 1000); })(),
    async selectNextCandidate(excluded): Promise<CloudSessionCandidateSelectionResult> {
      const found = opts.inventory.find(c => !excluded.has(c.placementId));
      if (found) return { ok: true, placementId: found.placementId, estimatedCost: found.estimatedCost };
      const b = opts.selectionBlockerWhenExhausted ?? { blocker: 'no_compatible_cloud_resource', detail: 'todos os candidatos foram excluídos' };
      return { ok: false, blocker: b.blocker, detail: b.detail };
    },
    async attemptProvision(candidate): Promise<CloudSessionProvisionResult<Runtime>> {
      inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
      log.push(`provision:${candidate.placementId}`);
      const step = opts.script[scriptIdx++] ?? { kind: 'fail', reason: 'provision_failed' };
      if (step.kind === 'ok') {
        // Pod saudável fica DE PÉ (não faz teardown aqui) — devolvido ao caller.
        inFlight -= 1;
        return { ok: true, runtime: { id: candidate.placementId }, providerRef: `ref-${candidate.placementId}`, finish: async () => { log.push(`finish:${candidate.placementId}`); } };
      }
      // Falha: LIQUIDA e faz TEARDOWN antes de retornar (contrato). O settlement baixa o committed.
      if (step.settledCost) { committed = usd((committed?.amount ?? 0) + step.settledCost.amount); log.push(`settle:${candidate.placementId}:${step.settledCost.amount}`); }
      log.push(`teardown:${candidate.placementId}`);
      inFlight -= 1;
      return { ok: false, reason: step.reason, providerRef: `ref-${candidate.placementId}`, settledCost: step.settledCost ?? null };
    },
  };
  return { ports, log: () => log, maxInFlight: () => maxInFlight };
}

const signal = () => new AbortController().signal;

describe('runResilientCloudSession', () => {
  test('1. primeira máquina publica endpoint → zero reprovisionamento', async () => {
    const h = harness({ inventory: [{ placementId: 'runpod:A40', estimatedCost: usd(0.245) }], script: [{ kind: 'ok' }] });
    const out = await runResilientCloudSession({ envelope: envelope(), ports: h.ports, signal: signal() });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.attempts).toBe(1);
    expect(out.placementId).toBe('runpod:A40');
    expect(out.trace).toEqual([{ attempt: 1, placementId: 'runpod:A40', providerRef: 'ref-runpod:A40', outcome: 'healthy', failureReason: null, failureClass: null, settledCost: null }]);
  });

  test('2. endpoint_unpublished na 1ª → teardown → 2º candidato → continua a MESMA sessão', async () => {
    const h = harness({
      inventory: [{ placementId: 'runpod:A40', estimatedCost: usd(0.245) }, { placementId: 'runpod:L40S', estimatedCost: usd(0.245) }],
      script: [{ kind: 'fail', reason: 'endpoint_unpublished', settledCost: usd(0.0825) }, { kind: 'ok' }],
    });
    const out = await runResilientCloudSession({ envelope: envelope(), ports: h.ports, signal: signal() });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.attempts).toBe(2);
    expect(out.placementId).toBe('runpod:L40S');
    expect(out.trace[0]).toMatchObject({ placementId: 'runpod:A40', outcome: 'failed', failureClass: 'endpoint_publication_timeout', settledCost: { amount: 0.0825 } });
    expect(out.trace[1]).toMatchObject({ placementId: 'runpod:L40S', outcome: 'healthy' });
  });

  test('2b. tunnel_unavailable na 1ª (mapping oscilou/túnel não subiu) → NÃO halt global → teardown → rotaciona p/ próximo candidato (barreira viva 2026-09-10, 2º A40)', async () => {
    const h = harness({
      inventory: [{ placementId: 'runpod:A40', estimatedCost: usd(0.245) }, { placementId: 'runpod:RTX_A6000', estimatedCost: usd(0.265) }],
      script: [{ kind: 'fail', reason: 'tunnel_unavailable', settledCost: usd(0.0445) }, { kind: 'ok' }],
    });
    const out = await runResilientCloudSession({ envelope: envelope(), ports: h.ports, signal: signal() });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.attempts).toBe(2); // rotacionou em vez de dar HALT após a 1ª
    expect(out.placementId).toBe('runpod:RTX_A6000');
    expect(out.trace[0]).toMatchObject({ placementId: 'runpod:A40', outcome: 'failed', failureClass: 'placement_unhealthy', settledCost: { amount: 0.0445 } });
    expect(out.trace[1]).toMatchObject({ placementId: 'runpod:RTX_A6000', outcome: 'healthy' });
  });

  test('3./11. exatamente 1 Pod simultâneo e TEARDOWN antes do reprovisionamento', async () => {
    const h = harness({
      inventory: [{ placementId: 'p1', estimatedCost: usd(0.2) }, { placementId: 'p2', estimatedCost: usd(0.2) }],
      script: [{ kind: 'fail', reason: 'health_failed' }, { kind: 'ok' }],
    });
    const out = await runResilientCloudSession({ envelope: envelope(), ports: h.ports, signal: signal() });
    expect(out.ok).toBe(true);
    expect(h.maxInFlight()).toBe(1); // nunca dois Pods ao mesmo tempo
    // teardown de p1 acontece ANTES do provision de p2.
    const log = h.log();
    expect(log.indexOf('teardown:p1')).toBeLessThan(log.indexOf('provision:p2'));
  });

  test('4. próximo candidato não cabe no budget restante → para fail-closed (session_budget_exhausted)', async () => {
    const h = harness({
      inventory: [{ placementId: 'p1', estimatedCost: usd(0.245) }, { placementId: 'p2', estimatedCost: usd(0.245) }],
      // 1ª falha SEM liberar excesso (settled = reserva inteira): committed sobe para 0.245.
      script: [{ kind: 'fail', reason: 'endpoint_unpublished', settledCost: usd(0.245) }],
      initialCommitted: usd(0),
    });
    const out = await runResilientCloudSession({ envelope: envelope({ maxTotalCost: usd(0.3) }), ports: h.ports, signal: signal() });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.stopReason).toBe('session_budget_exhausted');
    expect(out.attempts).toBe(1); // não tentou o 2º: não havia budget
  });

  test('5. todos os candidatos falham → terminal preciso (no_more_candidates + blocker de seleção)', async () => {
    const h = harness({
      inventory: [{ placementId: 'p1', estimatedCost: usd(0.1) }, { placementId: 'p2', estimatedCost: usd(0.1) }],
      script: [{ kind: 'fail', reason: 'endpoint_unpublished', settledCost: usd(0.02) }, { kind: 'fail', reason: 'capacity_unavailable', settledCost: usd(0.02) }],
      selectionBlockerWhenExhausted: { blocker: 'no_compatible_cloud_resource', detail: 'inventário esgotado' },
    });
    const out = await runResilientCloudSession({ envelope: envelope(), ports: h.ports, signal: signal() });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.stopReason).toBe('no_more_candidates');
    expect(out.detail).toContain('selection:no_compatible_cloud_resource');
    expect(out.attempts).toBe(2);
  });

  test('6. provider global indisponível → NÃO martela (para na 1ª, provider_unavailable)', async () => {
    const h = harness({
      inventory: [{ placementId: 'p1', estimatedCost: usd(0.1) }, { placementId: 'p2', estimatedCost: usd(0.1) }, { placementId: 'p3', estimatedCost: usd(0.1) }],
      script: [{ kind: 'fail', reason: 'provider_unreachable' }],
    });
    const out = await runResilientCloudSession({ envelope: envelope(), ports: h.ports, signal: signal() });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.stopReason).toBe('provider_unavailable');
    expect(out.attempts).toBe(1); // não criou mais Pods apesar de haver candidatos
    // placement NÃO foi excluído (provider fora não é culpa da máquina), mas a sessão parou.
    expect(h.log().filter(l => l.startsWith('provision:'))).toEqual(['provision:p1']);
  });

  test('7. settlement libera o excesso e reabre budget para a próxima máquina', async () => {
    // teto 0.3; cada reserva 0.245. Sem settlement, a 2ª não caberia (0.245+0.245>0.3). Com o
    // settlement da 1ª liberando o excesso (committed 0.245 → 0.082), a 2ª cabe (0.082+0.245≤0.3? não).
    // Ajuste realista: teto 0.35 → 0.082+0.245=0.327 ≤ 0.35 cabe SÓ por causa do settlement.
    const h = harness({
      inventory: [{ placementId: 'p1', estimatedCost: usd(0.245) }, { placementId: 'p2', estimatedCost: usd(0.245) }],
      script: [{ kind: 'fail', reason: 'endpoint_unpublished', settledCost: usd(0.082) }, { kind: 'ok' }],
    });
    const out = await runResilientCloudSession({ envelope: envelope({ maxTotalCost: usd(0.35) }), ports: h.ports, signal: signal() });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.attempts).toBe(2);
    expect(out.placementId).toBe('p2');
  });

  test('14. maxAttemptsPerPlacement=2 re-tenta a MESMA SKU (outra máquina) antes de excluí-la', async () => {
    // RunPod REST v1 não expõe id de máquina pré-create: a identidade mais fina é a SKU (gpuTypeId).
    // Com orçamento 2 por placement, p1 falha, é RE-tentada (create pode cair em outra máquina),
    // falha de novo, então é excluída e a sessão vai para p2.
    const h = harness({
      inventory: [{ placementId: 'p1', estimatedCost: usd(0.2) }, { placementId: 'p2', estimatedCost: usd(0.2) }],
      script: [{ kind: 'fail', reason: 'endpoint_unpublished' }, { kind: 'fail', reason: 'endpoint_unpublished' }, { kind: 'ok' }],
    });
    const out = await runResilientCloudSession({ envelope: envelope({ maxAttemptsPerPlacement: 2 }), ports: h.ports, signal: signal() });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.attempts).toBe(3);
    expect(out.placementId).toBe('p2');
    const provisions = h.log().filter(l => l.startsWith('provision:'));
    expect(provisions).toEqual(['provision:p1', 'provision:p1', 'provision:p2']); // p1 re-tentada 1×
  });

  test('12. Pod saudável é REUTILIZADO: finish disponível e nenhuma reprovisão após sucesso', async () => {
    const h = harness({ inventory: [{ placementId: 'p1', estimatedCost: usd(0.2) }], script: [{ kind: 'ok' }] });
    const out = await runResilientCloudSession({ envelope: envelope(), ports: h.ports, signal: signal() });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    await out.finish('attempt-1');
    // Só houve UMA provisão; o mesmo Pod é usado até o pipeline seguinte.
    expect(h.log().filter(l => l.startsWith('provision:'))).toEqual(['provision:p1']);
    expect(h.log()).toContain('finish:p1');
  });

  test('falha terminal (auth_invalid) → para imediatamente sem reprovisionar', async () => {
    const h = harness({
      inventory: [{ placementId: 'p1', estimatedCost: usd(0.1) }, { placementId: 'p2', estimatedCost: usd(0.1) }],
      script: [{ kind: 'fail', reason: 'auth_invalid' }],
    });
    const out = await runResilientCloudSession({ envelope: envelope(), ports: h.ports, signal: signal() });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.stopReason).toBe('terminal_failure');
    expect(out.detail).toBe('auth_invalid');
    expect(out.attempts).toBe(1);
  });

  test('deadline da sessão vencido antes de qualquer tentativa → session_deadline_reached', async () => {
    const h = harness({ inventory: [{ placementId: 'p1', estimatedCost: usd(0.1) }], script: [{ kind: 'ok' }] });
    const out = await runResilientCloudSession({ envelope: envelope({ maxSessionDurationMs: 1 }), ports: h.ports, signal: signal() });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.stopReason).toBe('session_deadline_reached');
    expect(out.attempts).toBe(0);
  });
});
