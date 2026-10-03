import type { Json } from '@anima/types';
import type { Capability } from './capability-map';
import { ANIMA_CAPABILITY_REGISTRY_V0 } from './capability-registry';
import { assessCapabilityMaturity, type CapabilityEvidenceObservation } from './capability-proof-engine';
import { RECORDED_CAPABILITY_EVIDENCE_V0 } from './capability-proof-recorded';
import {
  CAPABILITY_PROOF_RULES_V0,
  evaluateCapabilityProof,
  evaluateCapabilityProofs,
  evaluateCapabilityProofsFromHistory,
  summarizeCapabilityProofStatus,
  type CapabilityProofRule,
} from './capability-proof-evaluation';
import {
  deriveCanonicalWorkCapabilityEvidenceFromEvents,
  deriveExternalProviderEvidenceFromEvents,
} from './capability-proof-work-evidence';
import type { WorkEvent } from './work-orchestration/types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const WORK_ITEM = 'work-1';

function coderEvent(over: {
  attemptId?: string;
  id?: string;
  backendId?: string;
  outcome?: 'succeeded' | 'failed' | 'cancelled';
  usage?: boolean;
  callCount?: number;
  observedAt?: string;
} = {}): WorkEvent {
  const attemptId = over.attemptId ?? 'attempt-1';
  const observedAt = over.observedAt ?? '2026-09-20T10:00:00.000Z';
  const evidence: Record<string, unknown> = {
    schemaVersion: 1,
    workItemId: WORK_ITEM,
    attemptId,
    approvedProposalVersion: 1,
    backendId: over.backendId ?? 'openai:gpt-5.6-sol',
    durationMs: 1000,
    outcome: over.outcome ?? 'succeeded',
    observedAt,
  };
  if (over.usage ?? true) {
    evidence.providerUsage = { schemaVersion: 1, inputTokens: 100, outputTokens: 10, totalTokens: 110 };
  }
  if (over.callCount !== undefined) evidence.providerCallCount = over.callCount;

  return {
    id: over.id ?? `ev-coder-${attemptId}`,
    workItemId: WORK_ITEM,
    type: 'host_observed_coder_evidence_recorded',
    author: 'system',
    proposalVersion: 1,
    payload: {
      schema_version: 1,
      data: {
        work_item_id: WORK_ITEM,
        attempt_id: attemptId,
        approved_proposal_version: 1,
        origin: 'host',
        evidence: evidence as unknown as Json,
      },
    } as unknown as Json,
    occurredAt: new Date(observedAt),
  };
}

function cap(id: string, maturity: Capability['maturity']): Capability {
  return { id, name: id, description: id, domain: 'agency', maturity, dependsOn: [] };
}

function obs(over: Partial<CapabilityEvidenceObservation> & { id: string }): CapabilityEvidenceObservation {
  return {
    capabilityId: 'x.cap',
    evidenceClass: 'verified_execution',
    outcome: 'positive',
    observedAt: '2026-09-20T10:00:00Z',
    proofRefs: [{ kind: 'event', ref: over.id }],
    ...over,
  };
}

const RULE: CapabilityProofRule = {
  capabilityId: 'x.cap',
  sources: ['canonical_event_log'],
  evidence: 'teste',
  criteria: { proven: 'P', operational: 'O', autonomous: 'A' },
  derivationCeiling: 'operational',
  reproductionSatisfiesOperational: true,
};

const RECORDED_RULE: CapabilityProofRule = {
  ...RULE,
  sources: ['recorded_proof'],
  derivationCeiling: 'proven',
};

// ─── compute.external-provider ───────────────────────────────────────────────

describe('compute.external-provider — adapter canônico', () => {
  test('coder OpenAI concluído com uso reportado pelo provider → execução verificada positiva', () => {
    const [evidence] = deriveExternalProviderEvidenceFromEvents([coderEvent()]);

    expect(evidence).toMatchObject({
      capabilityId: 'compute.external-provider',
      evidenceClass: 'verified_execution',
      outcome: 'positive',
      occasionId: 'attempt-1',
      source: 'canonical_event_log',
      freshness: 'perishable',
    });
  });

  test('provider alcançado mas coder falhou → inconclusivo (transporte, não conclusão)', () => {
    const evidence = deriveExternalProviderEvidenceFromEvents([coderEvent({ outcome: 'failed' })]);
    expect(evidence.map((entry) => entry.outcome)).toEqual(['inconclusive']);
  });

  test('backend externo sem uso reportado → inconclusivo (fail-closed)', () => {
    const evidence = deriveExternalProviderEvidenceFromEvents([coderEvent({ usage: false })]);
    expect(evidence.map((entry) => entry.outcome)).toEqual(['inconclusive']);

    const withCount = deriveExternalProviderEvidenceFromEvents([coderEvent({ usage: false, callCount: 2 })]);
    expect(withCount.map((entry) => entry.outcome)).toEqual(['positive']);
  });

  test('provider local ou identidade sem prefixo estruturado não conta', () => {
    expect(
      deriveExternalProviderEvidenceFromEvents([
        coderEvent({ backendId: 'ollama:qwen3-coder', attemptId: 'a' }),
        coderEvent({ backendId: 'gpt-coder', attemptId: 'b' }),
        coderEvent({ backendId: 'openaix:model', attemptId: 'c' }),
      ]),
    ).toEqual([]);
  });

  test('uma ocasião por attempt: a evidência mais recente da attempt prevalece', () => {
    const evidence = deriveExternalProviderEvidenceFromEvents([
      coderEvent({ id: 'e1', outcome: 'failed' }),
      coderEvent({ id: 'e2', outcome: 'succeeded' }),
    ]);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.outcome).toBe('positive');
  });

  test('entra no adapter canônico; 2 attempts = reprodução observada, mas fica comprovada (V0.1)', () => {
    const events = [
      coderEvent({ attemptId: 'a1', observedAt: '2026-09-20T10:00:00.000Z' }),
      coderEvent({ attemptId: 'a2', observedAt: '2026-09-21T10:00:00.000Z' }),
    ];
    expect(
      deriveCanonicalWorkCapabilityEvidenceFromEvents(events).filter(
        (entry) => entry.capabilityId === 'compute.external-provider',
      ),
    ).toHaveLength(2);

    const evaluation = evaluateCapabilityProofsFromHistory({ events }).find(
      (entry) => entry.capabilityId === 'compute.external-provider',
    )!;
    expect(evaluation.derivedMaturity).toBe('proven');
    expect(evaluation.declaredMaturity).toBe('proven');
    expect(evaluation.status).toBe('aligned');
    expect(evaluation.reproduction).toEqual({ occasions: 2, satisfiesOperational: false });
    expect(evaluation.maturitySource).toBe('derived');
  });
});

// ─── Semântica de avaliação ──────────────────────────────────────────────────

describe('evaluateCapabilityProofs — declarado × derivado', () => {
  test('implementação sozinha não promove a comprovada', () => {
    const [evaluation] = evaluateCapabilityProofs({
      capabilities: [cap('x.cap', 'proven')],
      rules: [RULE],
      evidence: [obs({ id: 'i', evidenceClass: 'implementation' })],
    });
    expect(evaluation!.derivedMaturity).toBe('implemented');
    expect(evaluation!.status).toBe('overclaimed');
    expect(evaluation!.gaps[0]).toMatch(/revisar a declaração/);
  });

  test('prova de teste contribui (implementada) sem implicar operacional', () => {
    const [evaluation] = evaluateCapabilityProofs({
      capabilities: [cap('x.cap', 'implemented')],
      rules: [RECORDED_RULE],
      evidence: [
        obs({ id: 't1', evidenceClass: 'implementation', source: 'recorded_proof' }),
        obs({ id: 't2', evidenceClass: 'implementation', source: 'recorded_proof' }),
      ],
    });
    expect(evaluation!.derivedMaturity).toBe('implemented');
    expect(evaluation!.status).toBe('aligned');
    expect(evaluation!.maturitySource).toBe('hybrid');
  });

  test('prova governada viva promove conforme a régua (1 ocasião ⇒ comprovada, 2 ⇒ operacional)', () => {
    const one = evaluateCapabilityProofs({
      capabilities: [cap('x.cap', 'implemented')],
      rules: [RULE],
      evidence: [obs({ id: 'v1', occasionId: 'o1' })],
    })[0]!;
    expect(one.derivedMaturity).toBe('proven');
    expect(one.status).toBe('underclaimed');

    const two = evaluateCapabilityProofs({
      capabilities: [cap('x.cap', 'operational')],
      rules: [RULE],
      evidence: [obs({ id: 'v1', occasionId: 'o1' }), obs({ id: 'v2', occasionId: 'o2', observedAt: '2026-09-21T10:00:00Z' })],
    })[0]!;
    expect(two.derivedMaturity).toBe('operational');
    expect(two.status).toBe('aligned');
    expect(two.maturitySource).toBe('derived');
    expect(two.gaps.join(' ')).toMatch(/fora do alcance da derivação atual/);
  });

  test('prova controlada registrada nunca reproduz para operacional', () => {
    const [evaluation] = evaluateCapabilityProofs({
      capabilities: [cap('x.cap', 'proven')],
      rules: [RECORDED_RULE],
      evidence: [
        obs({ id: 'r1', occasionId: 'o1', source: 'recorded_proof' }),
        obs({ id: 'r2', occasionId: 'o2', source: 'recorded_proof', observedAt: '2026-09-21T10:00:00Z' }),
      ],
    });
    expect(evaluation!.derivedMaturity).toBe('proven');
    expect(evaluation!.status).toBe('aligned');
  });

  test('falha preservada: só inconclusivo ⇒ evidência insuficiente, sem superpromover nem rebaixar', () => {
    const [evaluation] = evaluateCapabilityProofs({
      capabilities: [cap('x.cap', 'operational')],
      rules: [RULE],
      evidence: [obs({ id: 'f', outcome: 'inconclusive', occasionId: 'o1' })],
    });
    expect(evaluation!.status).toBe('insufficient_evidence');
    expect(evaluation!.derivedMaturity).toBeNull();
    expect(evaluation!.evidence).toHaveLength(1);
    expect(evaluation!.summary).toEqual({ contributing: 0, inconclusive: 1, assistedProcedures: 0, contradicting: 0 });
  });

  test('falha ao lado de sucesso não infla nem apaga a prova', () => {
    const [evaluation] = evaluateCapabilityProofs({
      capabilities: [cap('x.cap', 'proven')],
      rules: [RULE],
      evidence: [
        obs({ id: 'ok', occasionId: 'o1' }),
        obs({ id: 'fail', outcome: 'inconclusive', occasionId: 'o2', observedAt: '2026-09-21T10:00:00Z' }),
      ],
    });
    expect(evaluation!.derivedMaturity).toBe('proven');
    expect(evaluation!.summary.inconclusive).toBe(1);
  });

  test('regressão (negativa após positiva) ⇒ regredida e sobredeclarada', () => {
    const [evaluation] = evaluateCapabilityProofs({
      capabilities: [cap('x.cap', 'operational')],
      rules: [RULE],
      evidence: [
        obs({ id: 'ok', occasionId: 'o1' }),
        obs({ id: 'neg', outcome: 'negative', occasionId: 'o2', observedAt: '2026-09-21T10:00:00Z' }),
      ],
    });
    expect(evaluation!.derivedMaturity).toBe('degraded');
    expect(evaluation!.status).toBe('overclaimed');
    expect(evaluation!.summary.contradicting).toBe(1);
  });

  test('procedimento assistido é preservado mas não promove a capacidade', () => {
    const [evaluation] = evaluateCapabilityProofs({
      capabilities: [cap('x.cap', 'projected')],
      rules: [RECORDED_RULE],
      evidence: [obs({ id: 'p', evidenceClass: 'assisted_procedure', source: 'recorded_proof' })],
    });
    expect(evaluation!.status).toBe('insufficient_evidence');
    expect(evaluation!.summary.assistedProcedures).toBe(1);
    expect(evaluation!.explanation).toMatch(/procedimento/);
  });

  test('capacidade sem regra ⇒ not_evaluated e maturidade manual, mesmo com evidência', () => {
    const [evaluation] = evaluateCapabilityProofs({
      capabilities: [cap('x.cap', 'operational')],
      rules: [],
      evidence: [obs({ id: 'v', occasionId: 'o1' })],
    });
    expect(evaluation!.status).toBe('not_evaluated');
    expect(evaluation!.maturitySource).toBe('manual');
    expect(evaluation!.derivedMaturity).toBeNull();
  });

  test('evidência de fonte que a regra não aceita não conclui maturidade', () => {
    const [evaluation] = evaluateCapabilityProofs({
      capabilities: [cap('x.cap', 'implemented')],
      rules: [RULE],
      evidence: [obs({ id: 'r', source: 'recorded_proof', occasionId: 'o1' })],
    });
    expect(evaluation!.derivedMaturity).toBeNull();
  });

  test('fonte indisponível ⇒ not_evaluated com lacuna explícita (nunca rebaixa)', () => {
    const [evaluation] = evaluateCapabilityProofs({
      capabilities: [cap('x.cap', 'operational')],
      rules: [RULE],
      evidence: [],
      unavailableSources: ['canonical_event_log'],
    });
    expect(evaluation!.status).toBe('not_evaluated');
    expect(evaluation!.gaps).toEqual(['Fonte indisponível: event log canônico.']);
  });

  test('múltiplas fontes contribuindo ⇒ hybrid', () => {
    const [evaluation] = evaluateCapabilityProofs({
      capabilities: [cap('x.cap', 'proven')],
      rules: [{ ...RULE, sources: ['canonical_event_log', 'recorded_proof'] }],
      evidence: [
        obs({ id: 'c', occasionId: 'o1' }),
        obs({ id: 'r', source: 'recorded_proof', occasionId: 'o2' }),
      ],
    });
    expect(evaluation!.maturitySource).toBe('hybrid');
    // A prova registrada não conta como 2ª ocasião de uso real.
    expect(evaluation!.derivedMaturity).toBe('proven');
  });

  test('degrau terminal: sem gap além do terminal', () => {
    const [evaluation] = evaluateCapabilityProofs({
      capabilities: [cap('x.cap', 'operational')],
      rules: [{ ...RULE, terminalMaturity: 'operational' }],
      evidence: [obs({ id: 'v1', occasionId: 'o1' }), obs({ id: 'v2', occasionId: 'o2' })],
    });
    expect(evaluation!.derivedMaturity).toBe('operational');
    expect(evaluation!.gaps).toEqual([]);
  });

  test('determinística para evidência fora de ordem e preserva a ordem do registry', () => {
    const capabilities = [cap('b.cap', 'implemented'), cap('x.cap', 'implemented')];
    const evidence = [
      obs({ id: 'v2', occasionId: 'o2', observedAt: '2026-09-22T10:00:00Z' }),
      obs({ id: 'v1', occasionId: 'o1' }),
    ];
    const a = evaluateCapabilityProofs({ capabilities, rules: [RULE], evidence });
    const b = evaluateCapabilityProofs({ capabilities, rules: [RULE], evidence: [...evidence].reverse() });
    expect(a).toEqual(b);
    expect(a.map((entry) => entry.capabilityId)).toEqual(['b.cap', 'x.cap']);
    expect(a[1]!.evidence.map((entry) => entry.id)).toEqual(['v1', 'v2']);
  });

  test('evaluateCapabilityProof: uma capacidade; desconhecida ⇒ null', () => {
    const input = { capabilities: [cap('x.cap', 'implemented')], rules: [RULE], evidence: [] };
    expect(evaluateCapabilityProof('x.cap', input)?.status).toBe('insufficient_evidence');
    expect(evaluateCapabilityProof('nope', input)).toBeNull();
  });

  test('o registry nunca é mutado', () => {
    const capabilities = [cap('x.cap', 'proven')];
    const snapshot = JSON.stringify(capabilities);
    evaluateCapabilityProofs({ capabilities, rules: [RULE], evidence: [obs({ id: 'v1', occasionId: 'o1' }), obs({ id: 'v2', occasionId: 'o2' })] });
    expect(JSON.stringify(capabilities)).toBe(snapshot);
  });
});

// ─── Catálogo registrado e regras reais ──────────────────────────────────────

describe('catálogo de evidência registrada V0', () => {
  const ids = new Set(ANIMA_CAPABILITY_REGISTRY_V0.map((capability) => capability.id));

  test('cada entrada é prova registrada, válida e ancorada num registro real', () => {
    const seen = new Set<string>();
    for (const entry of RECORDED_CAPABILITY_EVIDENCE_V0) {
      expect(seen.has(entry.id)).toBe(false);
      seen.add(entry.id);
      expect(ids.has(entry.capabilityId)).toBe(true);
      expect(entry.source).toBe('recorded_proof');
      expect(Number.isFinite(Date.parse(entry.observedAt))).toBe(true);
      // Prova controlada nunca afirma reprodução nem autonomia.
      expect(['implementation', 'verified_execution', 'assisted_procedure']).toContain(entry.evidenceClass);
      expect(entry.proofRefs.some((ref) => ref.kind === 'record' && ref.ref.startsWith('docs/registros/'))).toBe(true);
    }
  });
});

describe('regras V0 sobre o registry real', () => {
  test('regras únicas e apontando para capacidades existentes', () => {
    const ids = new Set(ANIMA_CAPABILITY_REGISTRY_V0.map((capability) => capability.id));
    const ruled = CAPABILITY_PROOF_RULES_V0.map((rule) => rule.capabilityId);
    expect(new Set(ruled).size).toBe(ruled.length);
    for (const id of ruled) expect(ids.has(id)).toBe(true);
  });

  test('sem histórico canônico lido: provas registradas avaliadas, pilotos canônicos not_evaluated', () => {
    const evaluations = evaluateCapabilityProofsFromHistory({ events: null });
    const byId = new Map(evaluations.map((entry) => [entry.capabilityId, entry]));

    for (const id of ['research.web.search', 'research.web.open', 'research.web.extract']) {
      expect(byId.get(id)).toMatchObject({ status: 'aligned', derivedMaturity: 'proven', maturitySource: 'hybrid' });
    }
    expect(byId.get('compute.paid-settlement')).toMatchObject({ status: 'aligned', derivedMaturity: 'implemented' });
    expect(byId.get('compute.paid-settlement')!.gaps[0]).toMatch(/prova viva paga/i);
    expect(byId.get('agency.run-tests')!.status).toBe('not_evaluated');
    expect(byId.get('agency.run-tests')!.gaps[0]).toMatch(/Fonte indisponível/);
    expect(byId.get('understanding.entities')!.status).toBe('not_evaluated');
    expect(byId.get('understanding.entities')!.rule).toBeNull();
  });

  test('durabilidade: dimensões preservadas, capacidade sem prova — nada vira mega-capability', () => {
    const durability = evaluateCapabilityProofsFromHistory({ events: [] }).find(
      (entry) => entry.capabilityId === 'memory.durability',
    )!;
    expect(durability.declaredMaturity).toBe('projected');
    expect(durability.status).toBe('insufficient_evidence');
    expect(durability.derivedMaturity).toBeNull();
    expect(durability.summary.assistedProcedures).toBe(3);
    expect(durability.summary.inconclusive).toBe(2);
    expect(durability.gaps[0]).toMatch(/Durable State/);
  });

  test('histórico vazio lido: piloto canônico com regra ⇒ insuficiente (não rebaixa)', () => {
    const runTests = evaluateCapabilityProofsFromHistory({ events: [] }).find(
      (entry) => entry.capabilityId === 'agency.run-tests',
    )!;
    expect(runTests.status).toBe('insufficient_evidence');
    expect(runTests.declaredMaturity).toBe('operational');
  });

  test('contagem factual por status cobre todas as capacidades', () => {
    const evaluations = evaluateCapabilityProofsFromHistory({ events: [] });
    const counts = summarizeCapabilityProofStatus(evaluations);
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    expect(total).toBe(ANIMA_CAPABILITY_REGISTRY_V0.length);
    expect(counts.not_evaluated).toBe(ANIMA_CAPABILITY_REGISTRY_V0.length - CAPABILITY_PROOF_RULES_V0.length);
  });
});

// ─── V0.1: reprodução ≠ satisfação operacional ───────────────────────────────

describe('V0.1 — reprodução observada ≠ satisfação operacional', () => {
  const twoOccasions = (capabilityId: string, source?: 'recorded_proof'): CapabilityEvidenceObservation[] =>
    ['o1', 'o2'].map((occasion, i) =>
      obs({
        id: `${capabilityId}:${occasion}`,
        capabilityId,
        occasionId: occasion,
        observedAt: `2026-09-2${i}T10:00:00Z`,
        ...(source ? { source } : {}),
      }),
    );

  const realEvaluation = (capabilityId: string, evidence: readonly CapabilityEvidenceObservation[]) =>
    evaluateCapabilityProof(capabilityId, { evidence })!;

  test('1. duas ocasiões + reproductionSatisfiesOperational=true ⇒ operacional', () => {
    const [evaluation] = evaluateCapabilityProofs({
      capabilities: [cap('x.cap', 'operational')],
      rules: [{ ...RULE, reproductionSatisfiesOperational: true }],
      evidence: twoOccasions('x.cap'),
    });
    expect(evaluation!.derivedMaturity).toBe('operational');
    expect(evaluation!.reproduction).toEqual({ occasions: 2, satisfiesOperational: true });
  });

  test('2. duas ocasiões + reproductionSatisfiesOperational=false ⇒ comprovada', () => {
    const [evaluation] = evaluateCapabilityProofs({
      capabilities: [cap('x.cap', 'proven')],
      rules: [{ ...RULE, reproductionSatisfiesOperational: false }],
      evidence: twoOccasions('x.cap'),
    });
    expect(evaluation!.derivedMaturity).toBe('proven');
    expect(evaluation!.status).toBe('aligned');
  });

  test('3. a reprodução continua visível quando a maturidade é limitada', () => {
    const [evaluation] = evaluateCapabilityProofs({
      capabilities: [cap('x.cap', 'proven')],
      rules: [{ ...RULE, reproductionSatisfiesOperational: false }],
      evidence: twoOccasions('x.cap'),
    });
    expect(evaluation!.reproduction).toEqual({ occasions: 2, satisfiesOperational: false });
    expect(evaluation!.assessment!.assessment.reproducedOccasions).toBe(2);
    expect(evaluation!.assessment!.assessment.limitedFrom).toBe('operational');
    expect(evaluation!.evidence).toHaveLength(2);
    expect(evaluation!.gaps[0]).toMatch(/Reprodução observada em 2 ocasiões.*reprodução ≠ satisfação operacional/);
    expect(evaluation!.explanation).toMatch(/reprodução observada em 2 ocasiões.*pendentes/);
  });

  test('4. derivationCeiling limita programaticamente (engine e avaliação)', () => {
    const [evaluation] = evaluateCapabilityProofs({
      capabilities: [cap('x.cap', 'implemented')],
      rules: [{ ...RULE, derivationCeiling: 'implemented' }],
      evidence: twoOccasions('x.cap'),
    });
    expect(evaluation!.derivedMaturity).toBe('implemented');
    expect(evaluation!.assessment!.assessment.basis).toBe('implementation');
    expect(evaluation!.assessment!.assessment.limitedFrom).toBe('operational');

    const direct = assessCapabilityMaturity({
      capabilityId: 'x.cap',
      definitionMaturity: 'implemented',
      maturityCeiling: 'proven',
      evidence: [obs({ id: 'auto', evidenceClass: 'autonomous_operation' })],
    });
    expect(direct.maturity).toBe('proven');
    expect(direct.limitedFrom).toBe('autonomous');
  });

  test('4b. regressão nunca é limitada pelo teto', () => {
    const direct = assessCapabilityMaturity({
      capabilityId: 'x.cap',
      definitionMaturity: 'implemented',
      maturityCeiling: 'proven',
      evidence: [
        obs({ id: 'ok', occasionId: 'o1' }),
        obs({ id: 'neg', outcome: 'negative', occasionId: 'o2', observedAt: '2026-09-21T10:00:00Z' }),
      ],
    });
    expect(direct.maturity).toBe('degraded');
  });

  test('5. agency.run-tests continua operacional', () => {
    const evaluation = realEvaluation('agency.run-tests', twoOccasions('agency.run-tests'));
    expect(evaluation.derivedMaturity).toBe('operational');
    expect(evaluation.status).toBe('aligned');
  });

  test('5b. agency.edit-file (capacidade estreita) também aceita reprodução', () => {
    const evaluation = realEvaluation('agency.edit-file', twoOccasions('agency.edit-file'));
    expect(evaluation.derivedMaturity).toBe('operational');
    expect(evaluation.status).toBe('aligned');
  });

  test.each([
    ['6', 'agency.produce-change'],
    ['7', 'agency.verify-change'],
    ['8', 'governance.verifier'],
    ['9', 'compute.external-provider'],
    ['9b', 'agency.supervised-self-development'],
  ])('%s. %s fica comprovada com reprodução observada (alinhada, não subdeclarada)', (_n, capabilityId) => {
    const evaluation = realEvaluation(capabilityId, twoOccasions(capabilityId));
    expect(evaluation.derivedMaturity).toBe('proven');
    expect(evaluation.status).toBe('aligned');
    expect(evaluation.reproduction).toEqual({ occasions: 2, satisfiesOperational: false });
  });

  test('10. prova registrada continua sem contar como reprodução', () => {
    const [evaluation] = evaluateCapabilityProofs({
      capabilities: [cap('x.cap', 'proven')],
      rules: [{ ...RECORDED_RULE, reproductionSatisfiesOperational: true, derivationCeiling: 'operational' }],
      evidence: twoOccasions('x.cap', 'recorded_proof'),
    });
    expect(evaluation!.derivedMaturity).toBe('proven');
    expect(evaluation!.reproduction).toBeNull();
  });

  test('11. procedimento assistido continua sem promover', () => {
    const [evaluation] = evaluateCapabilityProofs({
      capabilities: [cap('x.cap', 'projected')],
      rules: [{ ...RECORDED_RULE, reproductionSatisfiesOperational: true }],
      evidence: ['p1', 'p2'].map((id) =>
        obs({ id, evidenceClass: 'assisted_procedure', source: 'recorded_proof', occasionId: id }),
      ),
    });
    expect(evaluation!.status).toBe('insufficient_evidence');
    expect(evaluation!.derivedMaturity).toBeNull();
  });

  test('12. autônoma continua impossível sem autonomous_operation', () => {
    const [evaluation] = evaluateCapabilityProofs({
      capabilities: [cap('x.cap', 'operational')],
      rules: [{ ...RULE, derivationCeiling: 'autonomous', reproductionSatisfiesOperational: true }],
      evidence: ['o1', 'o2', 'o3', 'o4'].map((occasion) => obs({ id: occasion, occasionId: occasion })),
    });
    expect(evaluation!.derivedMaturity).toBe('operational');
  });

  test('provas registradas reais inalteradas: research proven, settlement implemented, durabilidade sem promoção', () => {
    const byId = new Map(
      evaluateCapabilityProofsFromHistory({ events: [] }).map((entry) => [entry.capabilityId, entry]),
    );
    for (const id of ['research.web.search', 'research.web.open', 'research.web.extract']) {
      expect(byId.get(id)!.derivedMaturity).toBe('proven');
    }
    expect(byId.get('compute.paid-settlement')!.derivedMaturity).toBe('implemented');
    expect(byId.get('memory.durability')!.status).toBe('insufficient_evidence');
  });

  test('toda regra declara explicitamente reproductionSatisfiesOperational', () => {
    for (const rule of CAPABILITY_PROOF_RULES_V0) {
      expect(typeof rule.reproductionSatisfiesOperational).toBe('boolean');
    }
    const accepting = CAPABILITY_PROOF_RULES_V0.filter((rule) => rule.reproductionSatisfiesOperational)
      .map((rule) => rule.capabilityId)
      .sort();
    expect(accepting).toEqual(['agency.edit-file', 'agency.run-tests']);
  });
});

test('Codex sem regra mantém declared projected; prova técnica em history não vira execução governada', () => {
  const evaluation = evaluateCapabilityProofsFromHistory({ events: [], capabilities: ANIMA_CAPABILITY_REGISTRY_V0 }).find((entry) => entry.capabilityId === 'agency.codex-cli')!;
  expect(evaluation.status).toBe('not_evaluated');
  expect(evaluation.declaredMaturity).toBe('projected');
  expect(evaluation.derivedMaturity).toBeNull();
  expect(evaluation.assessment).toBeNull();
  expect(evaluation.evidence).toEqual([]);
});

test('Claude técnico sem regra permanece não avaliado pelo Proof Engine', () => {
  const evaluation = evaluateCapabilityProofsFromHistory({ events: [], capabilities: ANIMA_CAPABILITY_REGISTRY_V0 }).find((entry) => entry.capabilityId === 'agency.claude-code')!;
  expect(evaluation.status).toBe('not_evaluated');
  expect(evaluation.derivedMaturity).toBeNull();
});

 test('baseline completo e continuidade técnica não concedem maturidade derivada', () => {
 const evaluations = evaluateCapabilityProofsFromHistory({ events: [], capabilities: ANIMA_CAPABILITY_REGISTRY_V0 });
 for (const id of ['memory.cross-harness', 'agency.akita-baseline-v1', 'agency.continuous-self-development']) {
 const evaluation = evaluations.find(entry => entry.capabilityId === id)!;
 expect(evaluation.status).toBe('not_evaluated');
 }
 });
