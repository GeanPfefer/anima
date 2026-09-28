import type { CapabilityEvidenceObservation } from './capability-proof-engine';
import { assessCapabilitiesFromEvidence } from './capability-proof-assessment';
import { ANIMA_CAPABILITY_REGISTRY_V0 } from './capability-registry';
import { evaluateCapabilityProofs, type CapabilityProofEvaluation } from './capability-proof-evaluation';
import {
  AUTONOMY_READINESS_INPUTS_V0,
  AUTONOMY_READINESS_RULES_V0,
  autonomyLevelRank,
  evaluateAutonomyReadiness,
  evaluateAutonomyReadinessFromHistory,
  evaluateReferenceAutonomyReadiness,
  referenceActionFor,
  type AutonomyActionContext,
  type AutonomySafeguard,
} from './autonomy-readiness';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function obs(
  capabilityId: string,
  id: string,
  over: Partial<CapabilityEvidenceObservation> = {},
): CapabilityEvidenceObservation {
  return {
    id,
    capabilityId,
    evidenceClass: 'verified_execution',
    outcome: 'positive',
    observedAt: '2026-09-20T10:00:00Z',
    proofRefs: [{ kind: 'event', ref: id }],
    occasionId: id,
    ...over,
  };
}

/** N ocasiões positivas independentes, em ordem temporal. */
function positives(capabilityId: string, n: number, startMinute = 0): CapabilityEvidenceObservation[] {
  return Array.from({ length: n }, (_, i) =>
    obs(capabilityId, `${capabilityId}-pos-${startMinute + i}`, {
      observedAt: `2026-09-20T10:${String(startMinute + i).padStart(2, '0')}:00Z`,
    }),
  );
}

function negative(capabilityId: string, minute: number): CapabilityEvidenceObservation {
  return obs(capabilityId, `${capabilityId}-neg-${minute}`, {
    outcome: 'negative',
    observedAt: `2026-09-20T10:${String(minute).padStart(2, '0')}:00Z`,
  });
}

const COVERED = AUTONOMY_READINESS_RULES_V0.map((rule) => rule.capabilityId);

/** Histórico "saudável": 3 ocasiões positivas para cada capacidade coberta. */
function healthyEvaluations(extra: CapabilityEvidenceObservation[] = []): readonly CapabilityProofEvaluation[] {
  return evaluateCapabilityProofs({
    evidence: [...COVERED.flatMap((id) => positives(id, 3)), ...extra],
  });
}

function readiness(
  capabilityId: string,
  evaluations: readonly CapabilityProofEvaluation[] = healthyEvaluations(),
  actionContext: AutonomyActionContext = referenceActionFor(capabilityId),
) {
  return evaluateAutonomyReadiness({ capabilityId, actionContext, proofEvaluations: evaluations });
}

function without(context: AutonomyActionContext, ...drop: AutonomySafeguard[]): AutonomyActionContext {
  return { ...context, safeguards: context.safeguards.filter((safeguard) => !drop.includes(safeguard)) };
}

const codes = (result: ReturnType<typeof readiness>) => result.blockers.map((blocker) => blocker.code);

// ─── Testes ──────────────────────────────────────────────────────────────────

describe('Autonomy Readiness V0', () => {
  it('1. capacidade operacional NÃO implica readiness autônoma', () => {
    const result = readiness('agency.run-tests');
    expect(result.capabilityMaturity).toBe('operational');
    expect(result.readinessLevel).toBe('mandated');
    expect(result.eligibleLevels).not.toContain('autonomous');
    expect(codes(result)).toEqual(
      expect.arrayContaining(['autonomous_operation_evidence_unavailable', 'network_boundary_unproven']),
    );

    // Mesmo sem teto estrutural na regra, operacional para em `mandated`.
    const rule = { ...AUTONOMY_READINESS_RULES_V0[0]!, levelCeiling: 'autonomous' as const, ceilingBlockers: [] };
    const uncapped = evaluateAutonomyReadiness({
      capabilityId: 'agency.run-tests',
      actionContext: rule.referenceAction,
      proofEvaluations: healthyEvaluations(),
      rules: [rule],
    });
    expect(uncapped.readinessLevel).toBe('mandated');
    expect(codes(uncapped)).toContain('autonomous_operation_evidence_unavailable');
  });

  it('2. comprovada permite supervisionado, não mandato nem autonomia', () => {
    const result = readiness('agency.produce-change');
    expect(result.capabilityMaturity).toBe('proven');
    expect(result.readinessLevel).toBe('supervised');
    expect(result.eligibleLevels).toEqual(['manual', 'supervised']);
    expect(result.nextLevel).toBe('mandated');
    expect(codes(result)).toContain('operational_criteria_pending');
  });

  it('3. evidência negativa reduz a readiness; regressão bloqueia', () => {
    const baseline = readiness('agency.run-tests');
    expect(baseline.readinessLevel).toBe('mandated');

    // Negativa recente seguida de 1 recuperação: maturidade ainda operacional
    // (janela pós-negativa) mas readiness cai para supervisionado.
    const recovering = healthyEvaluations([
      negative('agency.run-tests', 10),
      ...positives('agency.run-tests', 1, 11),
    ]);
    const reduced = readiness('agency.run-tests', recovering);
    expect(autonomyLevelRank(reduced.readinessLevel)).toBeLessThan(autonomyLevelRank(baseline.readinessLevel));
    expect(reduced.readinessLevel).toBe('supervised');
    expect(codes(reduced)).toContain('negative_evidence_recent');
    expect(reduced.evidence.recoveryOccasionsAfterNegative).toBe(1);

    // Negativa mais recente ⇒ regredida ⇒ manual.
    const degraded = readiness('agency.run-tests', healthyEvaluations([negative('agency.run-tests', 20)]));
    expect(degraded.capabilityMaturity).toBe('degraded');
    expect(degraded.readinessLevel).toBe('manual');
    expect(codes(degraded)).toContain('capability_degraded');

    // Positiva volta a ampliar: ≥2 ocasiões depois da negativa restauram.
    const restored = readiness(
      'agency.run-tests',
      healthyEvaluations([negative('agency.run-tests', 10), ...positives('agency.run-tests', 2, 11)]),
    );
    expect(restored.readinessLevel).toBe('mandated');
  });

  it('4. ação mutável exige salvaguardas maiores que ação sem mutação', () => {
    const runTests = readiness('agency.run-tests');
    const editFile = readiness('agency.edit-file');
    expect(runTests.readinessLevel).toBe('mandated');
    expect(editFile.readinessLevel).toBe('mandated');
    expect(editFile.safeguards.required.length).toBeGreaterThan(runTests.safeguards.required.length);
    expect(editFile.safeguards.required).toEqual(expect.arrayContaining(['allowed_paths', 'recovery_path']));
    expect(runTests.safeguards.required).not.toContain('recovery_path');

    // A mesma capacidade estreita (run-tests) numa ação mutável não passa de supervisionado.
    const mutating = readiness('agency.run-tests', healthyEvaluations(), {
      ...referenceActionFor('agency.run-tests'),
      effect: 'isolated_mutation',
    });
    expect(mutating.readinessLevel).toBe('supervised');
    expect(codes(mutating)).toEqual(expect.arrayContaining(['action_outside_rule', 'recovery_not_available']));
  });

  it('5. run-tests pode ter readiness maior que produce-change', () => {
    const results = evaluateReferenceAutonomyReadiness(healthyEvaluations());
    const level = (id: string) => results.find((result) => result.capabilityId === id)!.readinessLevel;
    expect(autonomyLevelRank(level('agency.run-tests'))).toBeGreaterThan(autonomyLevelRank(level('agency.produce-change')));
  });

  it('6. sem caminho de recuperação, o nível alto é bloqueado', () => {
    const result = readiness('agency.edit-file', healthyEvaluations(), without(referenceActionFor('agency.edit-file'), 'recovery_path'));
    expect(result.readinessLevel).toBe('supervised');
    expect(codes(result)).toContain('recovery_not_available');
    expect(result.eligibleLevels).not.toContain('mandated');
  });

  it('7. sem Verifier, a regra que o exige bloqueia', () => {
    const result = readiness('agency.produce-change', healthyEvaluations(), without(referenceActionFor('agency.produce-change'), 'verifier'));
    expect(result.readinessLevel).toBe('manual');
    expect(result.blockers).toContainEqual(
      expect.objectContaining({ code: 'verifier_required', blocksLevel: 'supervised', safeguard: 'verifier' }),
    );

    const selfDev = readiness(
      'agency.supervised-self-development',
      healthyEvaluations(),
      without(referenceActionFor('agency.supervised-self-development'), 'verifier'),
    );
    expect(selfDev.readinessLevel).toBe('manual');
    expect(codes(selfDev)).toContain('verifier_required');
  });

  it('8. readiness nunca cria authority', () => {
    const noAuthority = readiness('agency.run-tests');
    expect(noAuthority.readinessLevel).toBe('mandated');
    expect(noAuthority.authority).toEqual({ authorizedLevel: 'manual', source: 'none_observed', exceedsReadiness: false });
    expect(noAuthority.grantsAuthority).toBe(false);

    const observed = { level: 'supervised' as const, source: 'human_item_approval' };
    const withAuthority = evaluateAutonomyReadiness({
      capabilityId: 'agency.run-tests',
      actionContext: referenceActionFor('agency.run-tests'),
      proofEvaluations: healthyEvaluations(),
      authority: observed,
    });
    // Authority lida como está; não é elevada à readiness nem mutada.
    expect(withAuthority.authority.authorizedLevel).toBe('supervised');
    expect(observed).toEqual({ level: 'supervised', source: 'human_item_approval' });

    // Authority acima da readiness é REPORTADA, não corrigida.
    const excess = evaluateAutonomyReadiness({
      capabilityId: 'agency.produce-change',
      actionContext: referenceActionFor('agency.produce-change'),
      proofEvaluations: healthyEvaluations(),
      authority: { level: 'mandated', source: 'autonomous_approval_envelope_v1' },
    });
    expect(excess.readinessLevel).toBe('supervised');
    expect(excess.authority).toEqual({ authorizedLevel: 'mandated', source: 'autonomous_approval_envelope_v1', exceedsReadiness: true });
  });

  it('9. a projeção V1 crua não bypassa a Evaluation V0.1', () => {
    // A régua global V1 promove produce-change a operacional por reprodução…
    const evidence = positives('agency.produce-change', 3);
    const raw = assessCapabilitiesFromEvidence(ANIMA_CAPABILITY_REGISTRY_V0, evidence);
    const rawProduce = raw.assessments.find((entry) => entry.capabilityId === 'agency.produce-change')!;
    expect(rawProduce.derivedMaturity).toBe('operational');
    const evaluated = evaluateCapabilityProofs({ evidence });
    const produce = evaluated.find((entry) => entry.capabilityId === 'agency.produce-change')!;
    expect(produce.derivedMaturity).toBe('proven');
    expect(produce.reproduction?.satisfiesOperational).toBe(false);

    // …e uma avaliação forjada com esse resultado cru falha fechado.
    const forgedFromRaw: CapabilityProofEvaluation = { ...produce, derivedMaturity: 'operational', status: 'aligned', declaredMaturity: 'operational' };
    const forged = readiness('agency.produce-change', [forgedFromRaw]);
    expect(forged.readinessLevel).toBe('manual');
    expect(codes(forged)).toEqual(['proof_evaluation_inconsistent']);

    const ruleless: CapabilityProofEvaluation = { ...produce, rule: null };
    expect(codes(readiness('agency.produce-change', [ruleless]))).toEqual(['proof_evaluation_inconsistent']);

    // Sem avaliação alguma: fail-closed.
    expect(codes(readiness('agency.produce-change', []))).toEqual(['proof_evaluation_missing']);
  });

  it('10. capacidade desconhecida ou fora do recorte: fail-closed', () => {
    const unknown = readiness('agency.does-not-exist');
    expect(unknown.readinessLevel).toBe('manual');
    expect(codes(unknown)).toEqual(['capability_unknown']);
    expect(unknown.grantsAuthority).toBe(false);

    const uncovered = readiness('compute.external-provider');
    expect(uncovered.readinessLevel).toBe('manual');
    expect(codes(uncovered)).toEqual(['readiness_rule_missing']);
  });

  describe('regras complementares', () => {
    it('divergência nunca promove: usa o menor entre declarado e derivado', () => {
      const evaluation = healthyEvaluations().find((entry) => entry.capabilityId === 'agency.run-tests')!;
      const underclaimed: CapabilityProofEvaluation = { ...evaluation, declaredMaturity: 'proven', status: 'underclaimed' };
      const result = readiness('agency.run-tests', [underclaimed]);
      expect(result.capabilityMaturity).toBe('proven');
      expect(result.readinessLevel).toBe('supervised');
    });

    it('evidência insuficiente não sustenta delegação pelo declarado manual', () => {
      const result = readiness('agency.run-tests', evaluateCapabilityProofs({ evidence: [] }));
      expect(result.readinessLevel).toBe('manual');
      expect(codes(result)).toEqual(['capability_not_proven']);
    });

    it('contexto desconhecido = pior caso (impacto, rede, pago, reversibilidade)', () => {
      const result = readiness('agency.run-tests', healthyEvaluations(), {
        effect: 'ephemeral',
        safeguards: referenceActionFor('agency.run-tests').safeguards,
      });
      expect(result.readinessLevel).toBe('supervised');
      expect(codes(result)).toEqual(
        expect.arrayContaining([
          'impact_requires_human_approval',
          'reversibility_not_established',
          'network_boundary_unproven',
          'paid_authority_missing',
        ]),
      );
    });

    it('compute pago e efeito externo nunca passam de supervisionado', () => {
      const paid = readiness('agency.run-tests', healthyEvaluations(), { ...referenceActionFor('agency.run-tests'), paidCompute: 'required' });
      expect(paid.readinessLevel).toBe('supervised');
      expect(codes(paid)).toContain('paid_authority_missing');

      const external = readiness('agency.edit-file', healthyEvaluations(), { ...referenceActionFor('agency.edit-file'), effect: 'external_effect' });
      expect(external.readinessLevel).toBe('supervised');
      expect(codes(external)).toContain('external_side_effects');
    });

    it('verify-change, verifier e self-dev supervisionado têm teto supervisionado estrutural', () => {
      const results = evaluateReferenceAutonomyReadiness(healthyEvaluations());
      for (const id of ['agency.verify-change', 'governance.verifier', 'agency.supervised-self-development']) {
        const result = results.find((entry) => entry.capabilityId === id)!;
        expect(result.readinessLevel).toBe('supervised');
      }
      expect(codes(results.find((entry) => entry.capabilityId === 'agency.verify-change')!)).toContain('human_acceptance_required');
      expect(codes(results.find((entry) => entry.capabilityId === 'agency.supervised-self-development')!)).toContain('supervised_by_definition');
    });

    it('é determinística e não muta a avaliação de entrada', () => {
      const evaluations = healthyEvaluations();
      const snapshot = JSON.stringify(evaluations);
      const first = evaluateReferenceAutonomyReadiness(evaluations);
      const second = evaluateReferenceAutonomyReadiness(evaluations);
      expect(second).toEqual(first);
      expect(JSON.stringify(evaluations)).toBe(snapshot);
    });

    it('caminho de produção (histórico) sem event log: fail-closed', () => {
      const result = evaluateAutonomyReadinessFromHistory({ events: null, capabilityId: 'agency.run-tests' });
      expect(result.readinessLevel).toBe('manual');
      expect(result.authority.authorizedLevel).toBe('manual');
    });

    it('inputs não disponíveis estão formalizados e sem score', () => {
      expect(AUTONOMY_READINESS_INPUTS_V0.data_sensitivity!.availability).toBe('not_yet_available');
      expect(AUTONOMY_READINESS_INPUTS_V0.autonomous_operation!.availability).toBe('not_yet_available');
      const result = readiness('agency.run-tests');
      expect(Object.keys(result)).not.toEqual(expect.arrayContaining(['score']));
    });
  });
});
