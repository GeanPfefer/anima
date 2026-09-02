import { buildHostObservedCoderEvidence, selectGovernedCoderModel, type CoderCapacityPolicy } from '.';

const policy = (over: Partial<CoderCapacityPolicy> = {}): CoderCapacityPolicy => ({
  capacityGb: 16,
  allowlist: [
    { model: 'qwen3-coder:latest', requiresGb: 18 },
    { model: 'qwen2.5-coder:14b', requiresGb: 10 },
    { model: 'qwen2.5-coder:7b', requiresGb: 5 },
  ],
  ...over,
});

describe('seleção governada de modelo de coder', () => {
  test('preferido cabe → usa o preferido sem downgrade', () => {
    const r = selectGovernedCoderModel('qwen2.5-coder:14b', policy());
    expect(r).toEqual({ ok: true, evidence: { schemaVersion: 1, preferred: 'qwen2.5-coder:14b', selected: 'qwen2.5-coder:14b', downgraded: false, reason: 'preferred_fits', capacityGb: 16, requiresGb: 10 } });
  });

  test('preferido NÃO cabe + fallback compatível → usa o MAIOR que cabe (downgrade observável)', () => {
    const r = selectGovernedCoderModel('qwen3-coder:latest', policy());
    expect(r).toMatchObject({ ok: true, evidence: { preferred: 'qwen3-coder:latest', selected: 'qwen2.5-coder:14b', downgraded: true, reason: 'preferred_exceeds_capacity', capacityGb: 16, requiresGb: 10 } });
  });

  test('nenhum modelo compatível → fail-closed', () => {
    const r = selectGovernedCoderModel('qwen3-coder:latest', { capacityGb: 4, allowlist: [{ model: 'qwen3-coder:latest', requiresGb: 18 }, { model: 'qwen2.5-coder:14b', requiresGb: 10 }] });
    expect(r).toEqual({ ok: false, reason: 'no_compatible_model', preferred: 'qwen3-coder:latest', capacityGb: 4 });
  });

  test('preferido FORA da allowlist → fail-closed (não roda modelo não permitido)', () => {
    const r = selectGovernedCoderModel('llama3.1:8b', policy());
    expect(r).toEqual({ ok: false, reason: 'preferred_not_allowlisted', preferred: 'llama3.1:8b', capacityGb: 16 });
  });

  test('allowlist vazia ou capacidade inválida → fail-closed', () => {
    expect(selectGovernedCoderModel('x', { capacityGb: 16, allowlist: [] })).toMatchObject({ ok: false, reason: 'empty_allowlist' });
    expect(selectGovernedCoderModel('x', { capacityGb: 0, allowlist: [{ model: 'x', requiresGb: 1 }] })).toMatchObject({ ok: false, reason: 'invalid_capacity' });
    expect(selectGovernedCoderModel('x', { capacityGb: Number.NaN, allowlist: [{ model: 'x', requiresGb: 1 }] })).toMatchObject({ ok: false, reason: 'invalid_capacity' });
  });

  test('candidatos malformados são ignorados; empate de requiresGb desempata por ordem de declaração', () => {
    const r = selectGovernedCoderModel('big', {
      capacityGb: 12,
      allowlist: [
        { model: 'big', requiresGb: 20 },
        { model: 'a', requiresGb: 10 },
        { model: 'ruim', requiresGb: -1 },
        { model: 'b', requiresGb: 10 },
      ],
    });
    expect(r).toMatchObject({ ok: true, evidence: { selected: 'a', downgraded: true } });
  });

  test('o downgrade fica OBSERVÁVEL na evidência host-observed do coder', () => {
    const selection = selectGovernedCoderModel('qwen3-coder:latest', policy());
    expect(selection.ok).toBe(true);
    if (!selection.ok) return;
    const built = buildHostObservedCoderEvidence({
      workItemId: 'w', attemptId: 'a', approvedProposalVersion: 1,
      backendId: 'ollama:qwen2.5-coder:14b', durationMs: 100, outcome: 'succeeded',
      placement: 'local', nodeId: null, model: 'qwen2.5-coder:14b',
      modelSelection: selection.evidence, observedAt: '2026-09-02T12:00:00.000Z',
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.modelSelection).toMatchObject({ preferred: 'qwen3-coder:latest', selected: 'qwen2.5-coder:14b', downgraded: true });
  });

  test('evidência de seleção malformada é recusada fechado', () => {
    const built = buildHostObservedCoderEvidence({
      workItemId: 'w', attemptId: 'a', approvedProposalVersion: 1,
      backendId: 'ollama:x', durationMs: 100, outcome: 'succeeded',
      modelSelection: { schemaVersion: 1, preferred: '', selected: 'x', downgraded: true, reason: 'preferred_exceeds_capacity', capacityGb: 16, requiresGb: 10 } as never,
      observedAt: '2026-09-02T12:00:00.000Z',
    });
    expect(built).toMatchObject({ ok: false, defect: 'invalid_model_selection' });
  });
});
