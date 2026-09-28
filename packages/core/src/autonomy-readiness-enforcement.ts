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
import {
  DEFAULT_AUTHORIZED_LOCAL_CODER_BACKENDS,
  ISOLATED_WORKSPACE_PERMISSIONS,
} from './work-orchestration/autonomous-authorization';
import { isAllowedGateCommand } from './work-orchestration/gate-command-policy';
import { readVerifierRequirement } from './work-orchestration/verifier-requirement';

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
  /** Perfil de garantias do runtime usado para derivar as salvaguardas. */
  readonly lane_guarantees_version: string;
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
}

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const isNonBlankString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const isPositiveInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0;

const IMPACT_LEVELS = new Set(['low', 'significant', 'structural', 'strategic', 'financial', 'irreversible', 'external']);

/**
 * Perfil VERSIONADO do que o runtime GARANTE para o lane de auto-aprovação
 * (item `programming`, executor `worktree`, coder local). Cada campo aponta o
 * ponto de enforcement real e é amarrado ao runtime por teste de contrato em
 * `apps/web/lib/work-orchestration/auto-approval.test.ts` (seleção do executor).
 * Não é parâmetro do chamador: o enforcement usa sempre esta constante.
 */
export interface MandatedLaneRuntimeGuarantees {
  readonly version: string;
  /** `selectExecutor(worktree)` constrói `WorktreeExecutorAdapter` com `emitCheckpoint: true`. */
  readonly checkpointEmitted: boolean;
  /**
   * Verifier no caminho: `advisory_fail_open` (parecer nunca bloqueia) ou
   * `required_fail_closed` — Mandated Verifier Enforcement V0: para itens com
   * `execution_spec.verifier_requirement = required_fail_closed`,
   * `WorkOrchestrationService.reviewResult` (web + CLI) e `planResultReview` recusam o
   * ACEITE sem parecer `verified` correlacionado ao resultado revisado
   * (`evaluateVerifierRequirement`). Ausente/inconclusivo/rejeitado/descorrelacionado
   * ⇒ aceite negado; `request_changes` continua disponível.
   */
  readonly verifier: 'advisory_fail_open' | 'required_fail_closed';
  /** Rede: permissão negada (aplicacional) ≠ isolamento provado (kernel). */
  readonly network: 'permission_denied' | 'isolation_proven';
  /** Semântica exata do budget: attempts+tempo (autonomous-work-budget-v1). Sem custo/resource units. */
  readonly budget: 'attempts_and_runtime' | 'none';
  /** Executor `worktree` termina em `review`: aceite é decisão humana. */
  readonly humanAcceptance: boolean;
  /** Integração/merge/PR exige decisão humana (INT-05); o executor não integra. */
  readonly noAutoIntegration: boolean;
  /** Mutação só na worktree descartável; falha ⇒ recovery governado (humano). */
  readonly recoveryByWorktreeDisposal: boolean;
  /** Backends que a SQL (`work_item_cost_class`) e o envelope tratam como locais. */
  readonly localCoderBackends: readonly string[];
}

export const MANDATED_LANE_RUNTIME_GUARANTEES_V0: MandatedLaneRuntimeGuarantees = {
  version: 'mandated-worktree-lane-v1',
  checkpointEmitted: true,
  // Só depois do enforcement real (verifier-requirement.ts + service.reviewResult).
  verifier: 'required_fail_closed',
  network: 'permission_denied',
  budget: 'attempts_and_runtime',
  humanAcceptance: true,
  noAutoIntegration: true,
  recoveryByWorktreeDisposal: true,
  localCoderBackends: DEFAULT_AUTHORIZED_LOCAL_CODER_BACKENDS,
};

/**
 * Deriva o contexto da ação SÓ de fatos demonstráveis: item persistido,
 * `execution_spec`, policy versionada (allowlist de gate) e o perfil de garantias
 * do runtime. PRESENTE = garantida para ESTE caminho, não "existe no código".
 *
 * - `isolated_worktree`: executor `worktree` + permissões ⊆ {workspace_read,
 *   workspace_write_isolated};
 * - `no_network`: mesma condição (nenhuma permissão de rede) — PERMISSÃO negada;
 *   `network_isolation` só com isolamento provado (nunca hoje);
 * - `allowed_paths`: `included_scope` não-vazio;
 * - `gates` + `command_allowlist`: TODO comando de gate na allowlist
 *   gate-command-allowlist-v1 (a mesma do executor e do Envelope V1);
 * - `max_attempts`/`timeout`: `limits` inteiros positivos;
 * - `no_paid_compute`: coder backend no conjunto local do perfil;
 * - `budget_cap`: perfil `attempts_and_runtime` (não é teto de custo);
 * - `checkpoint`, `human_acceptance`, `no_auto_integration`, `recovery_path`:
 *   perfil de garantias do runtime;
 * - `verifier`: só se o perfil garante o enforcement fail-closed E o PRÓPRIO item
 *   declara `verifier_requirement: required_fail_closed` (é o marcador que ativa o
 *   gate de aceite para este item);
 * - `fail_closed`: só se TODA precondição obrigatória nega ao falhar — envelope,
 *   histórico/avaliação/contexto (este módulo), gates allowlisted, escopo, limites,
 *   provider local e Verifier obrigatório.
 *
 * Reversibilidade: pré-aprovação não há classificação persistida (INTEL-01 grava
 * depois); derivada `reversible` da mutação confinada à worktree descartável sem
 * integração — só quando o perfil garante as duas coisas.
 */
export function deriveAutoApprovalActionContext(
  facts: AutoApprovalCandidateFacts,
  guarantees: MandatedLaneRuntimeGuarantees = MANDATED_LANE_RUNTIME_GUARANTEES_V0,
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
  const localBackend = guarantees.localCoderBackends.includes(spec.coder_backend);

  const limits = asObject(spec.limits);
  if (!limits) return { ok: false, missing: 'limits' };
  const attemptsBounded = isPositiveInt(limits.max_attempts);
  const timeBounded = isPositiveInt(limits.max_duration_minutes);

  const criteria = spec.validation_criteria;
  if (!Array.isArray(criteria)) return { ok: false, missing: 'validation_criteria' };
  const gatesAllowlisted =
    criteria.length > 0 && criteria.every((criterion) => isAllowedGateCommand(asObject(criterion)?.command));

  const scope = asObject(asObject(facts.proposal)?.data)?.included_scope;
  const allowedPaths = Array.isArray(scope) && scope.length > 0 && scope.every(isNonBlankString);

  const verifierFailClosed =
    guarantees.verifier === 'required_fail_closed' && readVerifierRequirement(facts.intent) === 'required_fail_closed';
  const failClosed =
    verifierFailClosed && gatesAllowlisted && allowedPaths && attemptsBounded && timeBounded && localBackend;

  const safeguards: AutonomySafeguard[] = ['isolated_worktree', 'no_network'];
  if (guarantees.network === 'isolation_proven') safeguards.push('network_isolation');
  if (allowedPaths) safeguards.push('allowed_paths');
  if (gatesAllowlisted) safeguards.push('gates', 'command_allowlist');
  if (attemptsBounded) safeguards.push('max_attempts');
  if (timeBounded) safeguards.push('timeout');
  if (localBackend) safeguards.push('no_paid_compute');
  if (guarantees.budget === 'attempts_and_runtime') safeguards.push('budget_cap');
  if (guarantees.checkpointEmitted) safeguards.push('checkpoint');
  if (guarantees.humanAcceptance) safeguards.push('human_acceptance');
  if (guarantees.noAutoIntegration) safeguards.push('no_auto_integration');
  if (guarantees.recoveryByWorktreeDisposal) safeguards.push('recovery_path');
  if (verifierFailClosed) safeguards.push('verifier');
  if (failClosed) safeguards.push('fail_closed');

  const reversible = writes ? guarantees.recoveryByWorktreeDisposal && guarantees.noAutoIntegration : true;

  return {
    ok: true,
    context: {
      description: 'Auto-aprovação V1: attempt em worktree isolada do item materializado.',
      effect: writes ? 'isolated_mutation' : 'read_only',
      impactLevel: facts.impactLevel as AutonomyActionContext['impactLevel'],
      reversibility: reversible ? 'reversible' : 'unknown',
      // Requisito de rede DA AÇÃO: nenhuma permissão de rede foi pedida.
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
      lane_guarantees_version: MANDATED_LANE_RUNTIME_GUARANTEES_V0.version,
    },
  };
}
