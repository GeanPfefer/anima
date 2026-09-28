import { ANIMA_CAPABILITY_REGISTRY_V0 } from './capability-registry';
import type { CapabilityEvidenceObservation } from './capability-proof-engine';
import type { CapabilityMaturity } from './capability-map';
import {
  CAPABILITY_PROOF_RULES_V0,
  evaluateCapabilityProofs,
  type CapabilityProofEvaluation,
  type CapabilityProofRule,
} from './capability-proof-evaluation';
import { autonomyLevelRank, AUTONOMY_READINESS_RULES_V0 } from './autonomy-readiness';
import {
  AUTO_APPROVAL_DELEGATION_LEVEL,
  deriveAutoApprovalActionContext,
  enforceAutonomyReadinessForAutoApproval,
  type AutoApprovalCandidateFacts,
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
    allowedLocalCoderBackends: ['ollama'],
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

/** Estado real: registry + regras canônicas ⇒ produce-change proven (reprodução ≠ operacional). */
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

const enforce = (f: AutoApprovalCandidateFacts, proofEvaluations: readonly CapabilityProofEvaluation[] | null, proofRules?: readonly CapabilityProofRule[]) =>
  enforceAutonomyReadinessForAutoApproval({ facts: f, proofEvaluations, proofRules });

// ─── Testes ──────────────────────────────────────────────────────────────────

describe('Autonomy Readiness Enforcement V0 — authority não excede readiness', () => {
  it('estado real: produce-change proven/supervised ⇒ auto-aprovação negada', () => {
    const decision = enforce(facts(), CURRENT());
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.reason).toBe('autonomy_readiness_insufficient');
    expect(decision.readiness?.capabilityMaturity).toBe('proven');
    expect(decision.readiness?.readinessLevel).toBe('supervised');
    expect(decision.readiness?.authority.authorizedLevel).toBe('manual');
    expect(decision.detail).toContain('operational_criteria_pending');
  });

  it('sintético operacional + salvaguardas completas ⇒ permitido, com auditoria mínima', () => {
    const decision = enforce(facts(), synthetic(), SYNTHETIC_PROOF_RULES);
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) return;
    expect(decision.audit).toEqual({
      schema_version: 1,
      capability_id: 'agency.produce-change',
      readiness_rule_version: 'autonomy-readiness-v0',
      observed_level: 'mandated',
      required_level: 'mandated',
      capability_maturity: 'operational',
      proof_status: 'aligned',
      contributing_evidence: 3,
      contradicting_evidence: 0,
    });
    // Readiness nunca vira authority.
    expect(decision.readiness.grantsAuthority).toBe(false);
  });

  it('contexto derivado do item REAL (não da ação de referência)', () => {
    const derived = deriveAutoApprovalActionContext(facts());
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(derived.context.effect).toBe('isolated_mutation');
    expect(derived.context.paidCompute).toBe('none');
    expect(derived.context.safeguards).toEqual(expect.arrayContaining(['allowed_paths', 'gates', 'max_attempts', 'timeout', 'no_paid_compute']));
    // O envelope não restringe o comando dos gates: allowlist NÃO é declarada.
    expect(derived.context.safeguards).not.toContain('command_allowlist');
  });

  it.each([
    ['sem included_scope (allowed_paths)', facts({ scope: [] }), 'scope_not_bounded'],
    ['sem gates', facts({ spec: { validation_criteria: [] } }), 'gates'],
    ['sem timeout', facts({ spec: { limits: { max_attempts: 1 } } }), 'timeout'],
    ['sem max_attempts', facts({ spec: { limits: { max_duration_minutes: 10 } } }), 'max_attempts'],
    ['backend externo (compute pago)', facts({ spec: { coder_backend: 'openai' } }), 'paid_authority_missing'],
    ['impacto não-low', facts({ impactLevel: 'structural' }), 'impact_requires_human_approval'],
  ])('salvaguarda/risco ausente ⇒ negado mesmo com readiness sintética mandated (%s)', (_name, f, marker) => {
    const decision = enforce(f, synthetic(), SYNTHETIC_PROOF_RULES);
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.reason).toBe('autonomy_readiness_insufficient');
    expect(decision.detail).toContain(marker === 'gates' || marker === 'timeout' || marker === 'max_attempts' ? 'safeguard_missing' : marker);
  });

  it('histórico indisponível ⇒ negado', () => {
    const decision = enforce(facts(), null);
    expect(decision).toMatchObject({ allowed: false, reason: 'autonomy_readiness_history_unavailable' });
  });

  it('avaliação ausente ou inconsistente ⇒ negado', () => {
    expect(enforce(facts(), [])).toMatchObject({ allowed: false, reason: 'autonomy_readiness_evaluation_invalid' });
    // Operacional sintético julgado pelas regras CANÔNICAS: incoerente (régua crua não bypassa).
    const inconsistent = enforce(facts(), synthetic());
    expect(inconsistent).toMatchObject({ allowed: false, reason: 'autonomy_readiness_evaluation_invalid' });
  });

  it('capacidade divergente (declarado × derivado) ⇒ negado', () => {
    // Declarado proven, derivado operational (sintético): underclaimed ⇒ decisão humana pendente.
    const decision = enforce(facts(), synthetic('proven'), SYNTHETIC_PROOF_RULES);
    expect(decision).toMatchObject({ allowed: false, reason: 'autonomy_readiness_evaluation_invalid' });
  });

  it('readiness manual (sem evidência) ⇒ negado', () => {
    const decision = enforce(facts(), evaluateCapabilityProofs({ evidence: [] }));
    expect(decision.allowed).toBe(false);
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
    // Varre maturidades declaradas × evidência × remoção de cada salvaguarda
    // derivável. Sempre: allowed ⇔ readiness ≥ mandated, e a auditoria prova isso.
    const maturities: CapabilityMaturity[] = ['implemented', 'proven', 'operational', 'degraded'];
    const factVariants: AutoApprovalCandidateFacts[] = [
      facts(),
      facts({ scope: [] }),
      facts({ spec: { validation_criteria: [] } }),
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
    // Só a combinação sintética operacional + fatos completos libera.
    expect(allowedCount).toBe(1);
  });

  it('não altera as regras canônicas nem promove produce-change', () => {
    expect(CAPABILITY_PROOF_RULES_V0.find((rule) => rule.capabilityId === 'agency.produce-change')).toMatchObject({
      derivationCeiling: 'proven',
      reproductionSatisfiesOperational: false,
    });
    expect(ANIMA_CAPABILITY_REGISTRY_V0.find((capability) => capability.id === 'agency.produce-change')?.maturity).toBe('proven');
    expect(AUTONOMY_READINESS_RULES_V0.find((rule) => rule.capabilityId === 'agency.produce-change')?.levelCeiling).toBe('mandated');
  });
});
