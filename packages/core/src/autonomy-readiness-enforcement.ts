// Autonomy Readiness Enforcement V0 (2026-09-28) — AUTHORITY NÃO EXCEDE READINESS.
//
// Conflito encontrado (auditoria independente Codex, read-only): o Envelope de
// auto-aprovação V1 (`autonomous-authorization.ts`) concede, por comportamento,
// delegação `mandated` a uma classe estreita de `programming` (= capacidade
// `agency.produce-change`), enquanto a Autonomy Readiness V0 dessa capacidade é
// `supervised` (maturidade `proven`). O envelope não consultava a readiness.
//
// Decisão humana (opção B): nenhuma auto-aprovação do sistema pode conceder um
// nível de delegação ACIMA da readiness. Este módulo é o TETO ADICIONAL — não
// substitui as checagens do envelope V1 (impacto, proveniência, worktree,
// backend local, escopo, limites, Governor), que continuam valendo antes dele.
//
//   effective delegation ≤ autonomy readiness ≤ capability evidence
//   authority existente não amplia o teto da readiness.
//
// Puro: sem I/O, relógio ou LLM. O CONTEXTO da ação é derivado do work item e
// do `execution_spec` REAIS que estão prestes a ser aprovados (nunca da ação
// de referência idealizada). Qualquer fato ausente/ambíguo ⇒ negar.

import {
  AUTONOMY_READINESS_VERSION,
  autonomyLevelRank,
  evaluateAutonomyReadiness,
  type AutonomyActionContext,
  type AutonomyLevel,
  type AutonomyReadinessResult,
  type AutonomyReadinessRule,
  type AutonomySafeguard,
} from './autonomy-readiness';
import type { CapabilityProofEvaluation, CapabilityProofRule } from './capability-proof-evaluation';
import { ISOLATED_WORKSPACE_PERMISSIONS } from './work-orchestration/autonomous-authorization';

/** Nível que uma auto-aprovação `system`/`autonomous_policy` concede (mandato). */
export const AUTO_APPROVAL_DELEGATION_LEVEL: AutonomyLevel = 'mandated';

/** Capacidade `WorkCapability` persistida → capacidade do registry que ela exerce. */
export const WORK_CAPABILITY_TO_REGISTRY_CAPABILITY: Readonly<Record<string, string>> = {
  programming: 'agency.produce-change',
};

export type AutonomyReadinessEnforcementDenial =
  | 'autonomy_readiness_history_unavailable'
  | 'autonomy_readiness_capability_unmapped'
  | 'autonomy_readiness_context_incomplete'
  | 'autonomy_readiness_evaluation_invalid'
  | 'autonomy_readiness_insufficient';

/** Evidência MÍNIMA persistida no envelope (snake_case, como o envelope V1). */
export interface AutonomyReadinessAuditV0 {
  readonly schema_version: 1;
  readonly capability_id: string;
  readonly readiness_rule_version: typeof AUTONOMY_READINESS_VERSION;
  readonly observed_level: AutonomyLevel;
  readonly required_level: AutonomyLevel;
  readonly capability_maturity: string;
  readonly proof_status: string;
  readonly contributing_evidence: number;
  readonly contradicting_evidence: number;
}

export type AutonomyReadinessEnforcementDecision =
  | {
      readonly allowed: true;
      readonly audit: AutonomyReadinessAuditV0;
      readonly readiness: AutonomyReadinessResult;
    }
  | {
      readonly allowed: false;
      readonly reason: AutonomyReadinessEnforcementDenial;
      readonly detail: string;
      readonly readiness: AutonomyReadinessResult | null;
    };

export interface AutoApprovalCandidateFacts {
  readonly impactLevel: string;
  readonly capability: string;
  /** `intent` cru (execution_spec snake_case). */
  readonly intent: unknown;
  /** `proposal` cru (`data.included_scope`). */
  readonly proposal: unknown;
  /** Backends locais autorizados (o mesmo default do envelope V1). */
  readonly allowedLocalCoderBackends: readonly string[];
}

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const isNonBlankString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const isPositiveInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0;

const IMPACT_LEVELS = new Set(['low', 'significant', 'structural', 'strategic', 'financial', 'irreversible', 'external']);

/**
 * Deriva o contexto da ação a partir do item REAL. Cada salvaguarda só é
 * declarada quando um fato do item a sustenta:
 *
 * - `isolated_worktree`, `no_network`: executor `worktree` + permissões ⊆
 *   {workspace_read, workspace_write_isolated} (nenhuma permissão de rede/efeito);
 * - `allowed_paths`: `included_scope` não-vazio;
 * - `gates`: `validation_criteria` com comando;
 * - `max_attempts`/`timeout`: `limits` positivos;
 * - `no_paid_compute`: coder backend local autorizado;
 * - `human_acceptance`, `no_auto_integration`, `verifier`, `recovery_path`,
 *   `checkpoint`: garantias ESTRUTURAIS do executor `worktree` ratificado (teto
 *   `review`, sem PR/merge/push; Verifier na attempt; descarte da worktree +
 *   recovery governado; checkpoints de attempt);
 * - `budget_cap`: a fila autônoma aplica orçamento a toda execução autônoma;
 * - `fail_closed`: o próprio envelope V1 já autorizou (este teto roda depois).
 *
 * `command_allowlist` NÃO é declarada: o envelope não restringe o comando dos
 * gates (gap registrado para a opção C). Reversibilidade: pré-aprovação não há
 * classificação persistida (INTEL-01 grava depois); ela é derivada das mesmas
 * garantias estruturais (mutação só na worktree descartável, sem integração).
 */
export function deriveAutoApprovalActionContext(
  facts: AutoApprovalCandidateFacts,
): { readonly ok: true; readonly context: AutonomyActionContext } | { readonly ok: false; readonly missing: string } {
  if (!IMPACT_LEVELS.has(facts.impactLevel)) return { ok: false, missing: 'impact_level' };

  const spec = asObject(asObject(facts.intent)?.execution_spec);
  if (!spec) return { ok: false, missing: 'execution_spec' };
  if (spec.executor !== 'worktree') return { ok: false, missing: 'executor_worktree' };

  const permissions = spec.permissions;
  if (!Array.isArray(permissions) || permissions.length === 0 || !permissions.every(isNonBlankString)) {
    return { ok: false, missing: 'permissions' };
  }
  const isolated = permissions.every((permission) => ISOLATED_WORKSPACE_PERMISSIONS.includes(permission));
  if (!isolated) return { ok: false, missing: 'permissions_isolated' };
  const writes = permissions.includes('workspace_write_isolated');

  if (!isNonBlankString(spec.coder_backend)) return { ok: false, missing: 'coder_backend' };
  const localBackend = facts.allowedLocalCoderBackends.includes(spec.coder_backend);

  const limits = asObject(spec.limits);
  if (!limits) return { ok: false, missing: 'limits' };

  const criteria = spec.validation_criteria;
  if (!Array.isArray(criteria)) return { ok: false, missing: 'validation_criteria' };
  const gates =
    criteria.length > 0 && criteria.every((criterion) => isNonBlankString(asObject(criterion)?.command));

  const scope = asObject(asObject(facts.proposal)?.data)?.included_scope;
  const allowedPaths = Array.isArray(scope) && scope.length > 0 && scope.every(isNonBlankString);

  const safeguards: AutonomySafeguard[] = [
    'isolated_worktree',
    'no_network',
    'human_acceptance',
    'no_auto_integration',
    'verifier',
    'recovery_path',
    'checkpoint',
    'budget_cap',
    'fail_closed',
  ];
  if (allowedPaths) safeguards.push('allowed_paths');
  if (gates) safeguards.push('gates');
  if (isPositiveInt(limits.max_attempts)) safeguards.push('max_attempts');
  if (isPositiveInt(limits.max_duration_minutes)) safeguards.push('timeout');
  if (localBackend) safeguards.push('no_paid_compute');

  return {
    ok: true,
    context: {
      description: 'Auto-aprovação V1: attempt em worktree isolada do item materializado.',
      effect: writes ? 'isolated_mutation' : 'read_only',
      impactLevel: facts.impactLevel as AutonomyActionContext['impactLevel'],
      reversibility: 'reversible',
      network: 'none',
      paidCompute: localBackend ? 'none' : 'required',
      safeguards,
    },
  };
}

/**
 * Decide se a auto-aprovação do sistema pode prosseguir: a readiness observada
 * precisa ser ≥ `AUTO_APPROVAL_DELEGATION_LEVEL`. Fail-closed em tudo.
 * `proofEvaluations = null` ⇒ histórico indisponível.
 */
export function enforceAutonomyReadinessForAutoApproval(input: {
  readonly facts: AutoApprovalCandidateFacts;
  readonly proofEvaluations: readonly CapabilityProofEvaluation[] | null;
  readonly rules?: readonly AutonomyReadinessRule[];
  readonly proofRules?: readonly CapabilityProofRule[];
}): AutonomyReadinessEnforcementDecision {
  const deny = (
    reason: AutonomyReadinessEnforcementDenial,
    detail: string,
    readiness: AutonomyReadinessResult | null = null,
  ): AutonomyReadinessEnforcementDecision => ({ allowed: false, reason, detail, readiness });

  if (input.proofEvaluations === null) {
    return deny('autonomy_readiness_history_unavailable', 'Histórico de prova indisponível.');
  }

  const capabilityId = WORK_CAPABILITY_TO_REGISTRY_CAPABILITY[input.facts.capability];
  if (!capabilityId) {
    return deny('autonomy_readiness_capability_unmapped', `Capacidade ${input.facts.capability} sem capacidade de registry mapeada.`);
  }

  const context = deriveAutoApprovalActionContext(input.facts);
  if (!context.ok) return deny('autonomy_readiness_context_incomplete', `Fato ausente: ${context.missing}.`);

  const evaluation = input.proofEvaluations.find((entry) => entry.capabilityId === capabilityId);
  if (!evaluation) return deny('autonomy_readiness_evaluation_invalid', 'Proof Evaluation ausente.');
  if (evaluation.status !== 'aligned') {
    // Divergência declarado × derivado (ou evidência insuficiente) é decisão
    // humana pendente — nunca base de delegação automática.
    return deny('autonomy_readiness_evaluation_invalid', `Proof Evaluation com status ${evaluation.status}.`);
  }

  const readiness = evaluateAutonomyReadiness({
    capabilityId,
    actionContext: context.context,
    proofEvaluations: input.proofEvaluations,
    rules: input.rules,
    proofRules: input.proofRules,
  });

  const invalid = readiness.blockers.find((blocker) =>
    ['proof_evaluation_missing', 'proof_evaluation_inconsistent', 'readiness_rule_missing', 'capability_unknown'].includes(blocker.code),
  );
  if (invalid) return deny('autonomy_readiness_evaluation_invalid', `${invalid.code}: ${invalid.detail}`, readiness);

  if (autonomyLevelRank(readiness.readinessLevel) < autonomyLevelRank(AUTO_APPROVAL_DELEGATION_LEVEL)) {
    const blocking = [...new Set(readiness.blockers
      .filter((blocker) => autonomyLevelRank(blocker.blocksLevel) <= autonomyLevelRank(AUTO_APPROVAL_DELEGATION_LEVEL))
      .map((blocker) => blocker.code))];
    return deny(
      'autonomy_readiness_insufficient',
      `${capabilityId}: readiness ${readiness.readinessLevel} < ${AUTO_APPROVAL_DELEGATION_LEVEL} (${blocking.join(', ')}).`,
      readiness,
    );
  }

  return {
    allowed: true,
    readiness,
    audit: {
      schema_version: 1,
      capability_id: capabilityId,
      readiness_rule_version: AUTONOMY_READINESS_VERSION,
      observed_level: readiness.readinessLevel,
      required_level: AUTO_APPROVAL_DELEGATION_LEVEL,
      capability_maturity: readiness.capabilityMaturity ?? 'unknown',
      proof_status: evaluation.status,
      contributing_evidence: readiness.evidence.contributing,
      contradicting_evidence: readiness.evidence.contradicting,
    },
  };
}
