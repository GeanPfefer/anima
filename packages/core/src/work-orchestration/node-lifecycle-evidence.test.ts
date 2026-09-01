import {
  NODE_LIFECYCLE_EVIDENCE_EVENT_TYPE,
  buildNodeLifecycleEvidence,
  parseNodeLifecycleEvidence,
  projectNodeLifecycleEvidence,
  type BuildNodeLifecycleEvidenceInput,
} from './node-lifecycle-evidence';
import type { Json } from '@anima/types';

const input = (overrides: Partial<BuildNodeLifecycleEvidenceInput> = {}): BuildNodeLifecycleEvidenceInput => ({
  nodeId: 'gpu-a',
  providerId: 'local-process',
  leaseId: 'lease-1',
  workItemId: 'item-1',
  attemptId: 'att-1',
  billingMode: 'owned',
  transition: { from: 'provisioning', to: 'ready', event: 'health_confirmed' },
  healthy: true,
  activeDurationMs: 4200,
  observedAt: '2026-08-30T12:00:00.000Z',
  ...overrides,
});

describe('buildNodeLifecycleEvidence — fail-closed', () => {
  test('fatos válidos constroem a evidência', () => {
    const built = buildNodeLifecycleEvidence(input());
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.value).toMatchObject({ schemaVersion: 1, nodeId: 'gpu-a', transition: { to: 'ready' }, authorizationRef: null, estimatedCost: null, providerRef: null });
  });

  test('providerRef opcional: presente (string), ausente (null) e roundtrip', () => {
    const withRef = buildNodeLifecycleEvidence(input({ providerRef: 'pod-99' }));
    expect(withRef.ok).toBe(true);
    if (withRef.ok) {
      expect(withRef.value.providerRef).toBe('pod-99');
      expect(parseNodeLifecycleEvidence(withRef.value as unknown as Json)?.providerRef).toBe('pod-99');
    }
    expect(buildNodeLifecycleEvidence(input({ providerRef: null })).ok).toBe(true);
    // ausente → null
    const { providerRef: _omit, ...noRef } = input();
    const built = buildNodeLifecycleEvidence(noRef as BuildNodeLifecycleEvidenceInput);
    if (built.ok) expect(built.value.providerRef).toBeNull();
  });

  test('providerRef malformado é rejeitado (vazio, ou dado sensível)', () => {
    expect(buildNodeLifecycleEvidence(input({ providerRef: '   ' })).ok).toBe(false);
    const sensitive = buildNodeLifecycleEvidence(input({ providerRef: 'api_key=abc123' }));
    expect(sensitive.ok).toBe(false);
    if (!sensitive.ok) expect(sensitive.defect).toBe('sensitive_data');
  });

  test('transição fora do vocabulário do ciclo de vida é recusada', () => {
    const built = buildNodeLifecycleEvidence(input({ transition: { from: 'ready', to: 'flying' as never, event: 'health_confirmed' } }));
    expect(built).toMatchObject({ ok: false, defect: 'invalid_transition' });
  });

  test('duração ativa negativa/não-inteira é recusada', () => {
    expect(buildNodeLifecycleEvidence(input({ activeDurationMs: -1 }))).toMatchObject({ ok: false, defect: 'invalid_duration' });
    expect(buildNodeLifecycleEvidence(input({ activeDurationMs: 1.5 }))).toMatchObject({ ok: false, defect: 'invalid_duration' });
  });

  test('node pago SEM authorizationRef é recusado', () => {
    expect(buildNodeLifecycleEvidence(input({ billingMode: 'paid' }))).toMatchObject({ ok: false, defect: 'invalid_authorization' });
    expect(buildNodeLifecycleEvidence(input({ billingMode: 'paid', authorizationRef: 'auth-1' })).ok).toBe(true);
  });

  test('custo estimado é carregado quando presente', () => {
    const built = buildNodeLifecycleEvidence(input({ billingMode: 'paid', authorizationRef: 'auth-1', estimatedCost: { currency: 'USD', amount: 0.5 } }));
    expect(built.ok && built.value.estimatedCost).toEqual({ currency: 'USD', amount: 0.5 });
  });

  test('id com credencial/caminho absoluto é recusado (sensitive_data)', () => {
    expect(buildNodeLifecycleEvidence(input({ providerId: 'api_key=sk-live-abc' }))).toMatchObject({ ok: false, defect: 'sensitive_data' });
  });

  test('observedAt inválido é recusado', () => {
    expect(buildNodeLifecycleEvidence(input({ observedAt: 'ontem' }))).toMatchObject({ ok: false, defect: 'invalid_timestamp' });
  });
});

describe('parseNodeLifecycleEvidence — mesma régua do build', () => {
  test('round-trip do JSON persistido', () => {
    const built = buildNodeLifecycleEvidence(input({ billingMode: 'paid', authorizationRef: 'auth-1' }));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const parsed = parseNodeLifecycleEvidence(built.value as unknown as Json);
    expect(parsed).toEqual(built.value);
  });

  test('JSON malformado → null', () => {
    expect(parseNodeLifecycleEvidence({ schemaVersion: 1, nodeId: 'x' } as Json)).toBeNull();
    expect(parseNodeLifecycleEvidence(null as unknown as Json)).toBeNull();
  });
});

describe('projectNodeLifecycleEvidence — projeta do log com correlação coerente', () => {
  const evidenceJson = (() => {
    const built = buildNodeLifecycleEvidence(input());
    if (!built.ok) throw new Error('fixture inválida');
    return built.value as unknown as Json;
  })();

  test('evento com envelope coerente é projetado', () => {
    const events = [{
      type: NODE_LIFECYCLE_EVIDENCE_EVENT_TYPE,
      payload: { data: { work_item_id: 'item-1', attempt_id: 'att-1', evidence: evidenceJson } } as Json,
    }];
    const projected = projectNodeLifecycleEvidence(events);
    expect(projected).toHaveLength(1);
    expect(projected[0]).toMatchObject({ nodeId: 'gpu-a', transition: { to: 'ready' } });
  });

  test('correlação incoerente é descartada', () => {
    const events = [{
      type: NODE_LIFECYCLE_EVIDENCE_EVENT_TYPE,
      payload: { data: { work_item_id: 'OUTRO', attempt_id: 'att-1', evidence: evidenceJson } } as Json,
    }];
    expect(projectNodeLifecycleEvidence(events)).toHaveLength(0);
  });

  test('eventos de outro tipo são ignorados', () => {
    expect(projectNodeLifecycleEvidence([{ type: 'work_approved', payload: {} as Json }])).toHaveLength(0);
  });
});


describe('provider identity evidence', () => {
  test('provider_identified carrega providerRef sem fabricar ready', () => {
    const built = buildNodeLifecycleEvidence(input({
      providerRef: 'pod-created-123',
      transition: {
        from: 'provisioning',
        to: 'provisioning',
        event: 'provider_identified',
      },
      healthy: false,
    }));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value).toMatchObject({
      providerRef: 'pod-created-123',
      healthy: false,
      transition: {
        from: 'provisioning',
        to: 'provisioning',
        event: 'provider_identified',
      },
    });
  });
});
