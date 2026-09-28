// Autonomy Readiness Engine V0 (2026-09-28) — PRONTIDÃO para delegação progressiva.
//
// Responde, por capacidade e tipo de ação: "dada a maturidade AVALIADA e o
// contexto da ação, até que nível essa ação PODERIA ser delegada com segurança
// agora — e o que bloqueia o próximo nível?".
//
// Três conceitos distintos; nenhum implica o seguinte:
//
//   Capability maturity  — "o Anima consegue fazer isso?"          (Proof Evaluation V0.1)
//   Autonomy readiness   — "há evidência para delegar neste escopo?" (ESTE módulo)
//   Authority            — "o humano/governança autorizou de fato?"  (envelopes/authorities)
//
// FRONTEIRA: puro, determinístico, sem I/O, LLM, relógio ou score. NÃO executa,
// NÃO concede, cria nem altera authority, NÃO muta flag de autonomia nem o
// registry. `readinessLevel = mandated` continua `authorizedLevel = manual` se
// nenhuma authority existir. A authority, quando informada, é só LIDA.
//
// Entrada de maturidade: SOMENTE `CapabilityProofEvaluation` (V0.1). A projeção
// crua `deriveCapabilityAssessmentsFromWorkHistory` usa a régua global de
// reprodução e NÃO pode decidir readiness — uma avaliação incoerente com a regra
// canônica (ex.: derivado acima do teto da regra) falha fechado.

import { maturityRank, type CapabilityMaturity } from './capability-map';
import { ANIMA_CAPABILITY_REGISTRY_V0 } from './capability-registry';
import type { CapabilityEvidenceObservation } from './capability-proof-engine';
import {
  CAPABILITY_PROOF_RULES_V0,
  evaluateCapabilityProofsFromHistory,
  type CapabilityProofEvaluation,
  type CapabilityProofRule,
  type CapabilityProofStatus,
} from './capability-proof-evaluation';
import type { WorkEvent, WorkImpactLevel } from './work-orchestration/types';
import type { WorkReversibility } from './work-orchestration/work-intelligence-classification';

// ─── Níveis de delegação ─────────────────────────────────────────────────────

/**
 * Níveis de DELEGAÇÃO (não de maturidade). Vocabulário do Marco 005 §8
 * ("aprovação é mandato, não micropermissão"):
 *
 * - `manual`     — o humano executa/decide tudo; o Anima no máximo sugere.
 * - `supervised` — o Anima executa UMA ação aprovada pelo humano (item a item),
 *                  sob supervisão; o resultado volta ao humano.
 * - `mandated`   — o Anima decide/executa dentro de um MANDATO (envelope)
 *                  previamente autorizado, com limites e salvaguardas explícitos.
 * - `autonomous` — o Anima opera sozinho dentro de um envelope ESTÁVEL. Não é
 *                  autoridade ilimitada; nenhum sinal atual permite derivá-lo.
 */
export type AutonomyLevel = 'manual' | 'supervised' | 'mandated' | 'autonomous';

export const AUTONOMY_LEVELS: readonly AutonomyLevel[] = [
  'manual',
  'supervised',
  'mandated',
  'autonomous',
] as const;

export const AUTONOMY_LEVEL_LABEL_PT: Record<AutonomyLevel, string> = {
  manual: 'Manual',
  supervised: 'Supervisionada',
  mandated: 'Sob mandato',
  autonomous: 'Autônoma',
};

export const AUTONOMY_READINESS_VERSION = 'autonomy-readiness-v0' as const;

export function autonomyLevelRank(level: AutonomyLevel): number {
  return AUTONOMY_LEVELS.indexOf(level);
}

function minLevel(a: AutonomyLevel, b: AutonomyLevel): AutonomyLevel {
  return autonomyLevelRank(a) <= autonomyLevelRank(b) ? a : b;
}

// ─── Salvaguardas ────────────────────────────────────────────────────────────

/**
 * Salvaguardas que o CONTEXTO da ação declara presentes. Cada uma corresponde a
 * uma primitiva que já existe no Anima (não é policy engine novo):
 *
 * - `isolated_worktree`   — executor de worktree (ADR-001; `workspace_write_isolated`);
 * - `allowed_paths`       — `included_scope` explícito na proposta;
 * - `command_allowlist`   — política de comando do Coding Harness V3;
 * - `timeout`/`max_attempts` — `execution_spec.limits`;
 * - `gates`               — gates host-observed;
 * - `verifier`            — parecer do Verifier (advisory);
 * - `human_acceptance`    — review request + decisão humana (`accept`/`request_changes`);
 * - `no_network`          — negação de rede por política de comando;
 * - `no_paid_compute`     — sem node/provider pago (authority paga ausente);
 * - `budget_cap`          — orçamento local/externo com bloqueio (governance.budgets);
 * - `recovery_path`       — descarte da worktree + recovery/successor governado;
 * - `checkpoint`          — checkpoints de attempt (retomada);
 * - `fail_closed`         — evaluator determinístico que nega na dúvida;
 * - `no_auto_integration` — integração/merge exige decisão humana (INT-05).
 */
export type AutonomySafeguard =
  | 'isolated_worktree'
  | 'allowed_paths'
  | 'command_allowlist'
  | 'timeout'
  | 'max_attempts'
  | 'gates'
  | 'verifier'
  | 'human_acceptance'
  | 'no_network'
  | 'no_paid_compute'
  | 'budget_cap'
  | 'recovery_path'
  | 'checkpoint'
  | 'fail_closed'
  | 'no_auto_integration';

// ─── Contexto da ação ────────────────────────────────────────────────────────

/**
 * Efeito da ação, do mais contido ao mais amplo:
 * - `read_only`         — nada é escrito;
 * - `ephemeral`         — só artefatos temporários (ex.: saída de testes);
 * - `isolated_mutation` — mutação persistente confinada à worktree isolada;
 * - `shared_mutation`   — mutação na árvore/estado compartilhado (fora da worktree);
 * - `external_effect`   — efeito fora da máquina (rede, publicação, provider).
 */
export type AutonomyActionEffect =
  | 'read_only'
  | 'ephemeral'
  | 'isolated_mutation'
  | 'shared_mutation'
  | 'external_effect';

const MUTATING_EFFECTS: ReadonlySet<AutonomyActionEffect> = new Set([
  'isolated_mutation',
  'shared_mutation',
  'external_effect',
]);

export type AutonomyRequirement = 'none' | 'required' | 'unknown';

export interface AutonomyActionContext {
  /** Descrição curta da ação avaliada (auditoria/UI). */
  readonly description?: string;
  readonly effect: AutonomyActionEffect;
  /** `work_impact_level` persistido; ausente = `unknown` (fail-closed). */
  readonly impactLevel?: WorkImpactLevel | 'unknown';
  /** Eixo da Work Intelligence Classification; ausente = `unknown`. */
  readonly reversibility?: WorkReversibility;
  /** Acesso de rede exigido pela ação; ausente = `unknown`. */
  readonly network?: AutonomyRequirement;
  /** Compute pago exigido pela ação; ausente = `unknown`. */
  readonly paidCompute?: AutonomyRequirement;
  /** Salvaguardas GARANTIDAS pelo executor para esta ação. */
  readonly safeguards: readonly AutonomySafeguard[];
}

/**
 * Authority VIGENTE, lida de fora (read-only). O engine nunca a cria nem a
 * altera; só a compara com a readiness.
 */
export interface AutonomyAuthorityObservation {
  readonly level: AutonomyLevel;
  /** Origem auditável (ex.: `autonomous_approval_envelope_v1`, `human_item_approval`). */
  readonly source: string;
}

// ─── Inputs formalizados ─────────────────────────────────────────────────────

export type AutonomyReadinessInputAvailability = 'available' | 'derivable' | 'not_yet_available';

/**
 * Inventário dos inputs de readiness (Fase 2): o que o V0 usa, o que poderia
 * derivar das fontes existentes e o que o Anima ainda não mede. Documentação
 * executável — os testes garantem que nada `not_yet_available` é consultado.
 */
export const AUTONOMY_READINESS_INPUTS_V0: Readonly<
  Record<string, { readonly availability: AutonomyReadinessInputAvailability; readonly source: string }>
> = {
  derived_maturity: { availability: 'available', source: 'CapabilityProofEvaluation.derivedMaturity' },
  declared_maturity: { availability: 'available', source: 'CapabilityProofEvaluation.declaredMaturity' },
  divergence_status: { availability: 'available', source: 'CapabilityProofEvaluation.status' },
  reproduction: { availability: 'available', source: 'CapabilityProofEvaluation.reproduction' },
  negative_evidence: { availability: 'available', source: 'CapabilityProofEvaluation.evidence (outcome negative)' },
  inconclusive_evidence: { availability: 'available', source: 'CapabilityProofEvaluation.summary.inconclusive' },
  impact: { availability: 'available', source: 'work_items.impact_level (contexto da ação)' },
  reversibility: { availability: 'available', source: 'Work Intelligence Classification (contexto da ação)' },
  verifier: { availability: 'available', source: 'salvaguarda `verifier` do contexto' },
  recovery_path: { availability: 'available', source: 'salvaguarda `recovery_path` do contexto' },
  scope_clarity: { availability: 'available', source: 'salvaguarda `allowed_paths` do contexto' },
  external_side_effects: { availability: 'available', source: 'AutonomyActionContext.effect' },
  paid_compute: { availability: 'available', source: 'AutonomyActionContext.paidCompute' },
  network: { availability: 'available', source: 'AutonomyActionContext.network' },
  human_review: { availability: 'available', source: 'salvaguarda `human_acceptance` do contexto' },
  current_authority: { availability: 'derivable', source: 'envelopes/authorities persistidos — V0 só aceita observação passada pelo chamador' },
  freshness: { availability: 'derivable', source: 'observedAt/freshness da evidência — sem política de frescor no V0' },
  success_rate: { availability: 'not_yet_available', source: 'attempts falhas não geram evidência negativa (limitação V0.1)' },
  verifier_calibration: { availability: 'not_yet_available', source: 'changes_requested não calibra o verifier' },
  data_sensitivity: { availability: 'not_yet_available', source: 'nenhuma classificação de sensibilidade de dados' },
  autonomous_operation: { availability: 'not_yet_available', source: 'sinal `autonomous_operation` não é produzido por nenhum adapter' },
};

// ─── Regras V0 ───────────────────────────────────────────────────────────────

export interface AutonomyReadinessRule {
  readonly capabilityId: string;
  /** Classe de ação que a regra cobre. */
  readonly action: string;
  /**
   * Teto ESTRUTURAL da capacidade, independente de evidência (ex.: supervisionado
   * por definição; verificação nunca é autoridade única de aceite).
   */
  readonly levelCeiling: AutonomyLevel;
  /** Por que o nível acima do teto não é alcançável (blockers factuais). */
  readonly ceilingBlockers: readonly AutonomyBlockerCode[];
  /** Efeitos admitidos acima de `supervised`; fora deles a ação excede a regra. */
  readonly delegableEffects: readonly AutonomyActionEffect[];
  /** Salvaguardas exigidas por nível (cumulativas: cada nível exige também as do anterior). */
  readonly requiredSafeguards: Readonly<Partial<Record<Exclude<AutonomyLevel, 'manual'>, readonly AutonomySafeguard[]>>>;
  /** Ação de referência: o uso governado atual (projeção da UI). */
  readonly referenceAction: AutonomyActionContext;
}

const GOVERNED_ATTEMPT_SAFEGUARDS: readonly AutonomySafeguard[] = [
  'isolated_worktree',
  'allowed_paths',
  'command_allowlist',
  'timeout',
  'max_attempts',
  'gates',
  'verifier',
  'human_acceptance',
  'no_network',
  'no_paid_compute',
  'budget_cap',
  'recovery_path',
  'checkpoint',
  'fail_closed',
  'no_auto_integration',
];

/**
 * V0: capacidades de sinal alto com Proof Evaluation V0.1 canônica. Provider,
 * cloud e compute pago ficam FORA (ampliam demais o recorte).
 */
export const AUTONOMY_READINESS_RULES_V0: readonly AutonomyReadinessRule[] = [
  {
    capabilityId: 'agency.run-tests',
    action: 'Executar testes/gates allowlisted no repo autorizado, com timeout, sem rede, sem provider e sem mutação além de artefatos temporários.',
    levelCeiling: 'mandated',
    // Autonomia exige isolamento de rede em nível de kernel (hoje a negação é
    // política de comando) e o sinal de operação autônoma, que não existe.
    ceilingBlockers: ['network_boundary_unproven', 'autonomous_operation_evidence_unavailable'],
    delegableEffects: ['read_only', 'ephemeral'],
    requiredSafeguards: {
      supervised: ['command_allowlist', 'timeout'],
      mandated: ['isolated_worktree', 'no_network', 'no_paid_compute', 'fail_closed'],
    },
    referenceAction: {
      description: 'Gates host-observed de uma attempt governada (worktree, allowlist, timeout, sem rede).',
      effect: 'ephemeral',
      impactLevel: 'low',
      reversibility: 'reversible',
      network: 'none',
      paidCompute: 'none',
      safeguards: ['isolated_worktree', 'command_allowlist', 'timeout', 'no_network', 'no_paid_compute', 'fail_closed'],
    },
  },
  {
    capabilityId: 'agency.edit-file',
    action: 'Editar arquivos dentro de escopo explícito, confinado à worktree isolada, com caminho de recuperação.',
    levelCeiling: 'mandated',
    ceilingBlockers: ['autonomous_operation_evidence_unavailable'],
    delegableEffects: ['isolated_mutation'],
    requiredSafeguards: {
      // Mutação persistente: já no supervisionado exige isolamento e escopo.
      supervised: ['isolated_worktree', 'allowed_paths'],
      mandated: ['recovery_path', 'max_attempts', 'timeout', 'no_paid_compute', 'no_auto_integration', 'fail_closed'],
    },
    referenceAction: {
      description: 'Edição do coder local numa attempt governada (worktree, included_scope, limites, sem integração).',
      effect: 'isolated_mutation',
      impactLevel: 'low',
      reversibility: 'reversible',
      network: 'none',
      paidCompute: 'none',
      safeguards: ['isolated_worktree', 'allowed_paths', 'recovery_path', 'max_attempts', 'timeout', 'no_paid_compute', 'no_auto_integration', 'fail_closed'],
    },
  },
  {
    capabilityId: 'agency.produce-change',
    action: 'Produzir uma mudança de código em worktree, com escopo explícito, gates e Verifier obrigatórios e sem integração automática.',
    levelCeiling: 'mandated',
    ceilingBlockers: ['autonomous_operation_evidence_unavailable'],
    delegableEffects: ['isolated_mutation'],
    requiredSafeguards: {
      supervised: ['isolated_worktree', 'allowed_paths', 'gates', 'verifier', 'human_acceptance', 'no_auto_integration', 'max_attempts', 'recovery_path'],
      mandated: ['timeout', 'budget_cap', 'no_paid_compute', 'checkpoint', 'fail_closed'],
    },
    referenceAction: {
      description: 'Attempt governada com coder local até review (sem integração).',
      effect: 'isolated_mutation',
      impactLevel: 'low',
      reversibility: 'reversible',
      network: 'none',
      paidCompute: 'none',
      safeguards: GOVERNED_ATTEMPT_SAFEGUARDS,
    },
  },
  {
    capabilityId: 'agency.verify-change',
    action: 'Conferir uma mudança contra o contrato aprovado como etapa de um fluxo supervisionado.',
    // Verificar é advisory: nunca autoridade única de aceite.
    levelCeiling: 'supervised',
    ceilingBlockers: ['human_acceptance_required'],
    delegableEffects: ['read_only', 'ephemeral'],
    requiredSafeguards: {
      supervised: ['gates', 'human_acceptance', 'fail_closed'],
    },
    referenceAction: {
      description: 'Gates + Verifier sobre a attempt, com decisão humana na revisão.',
      effect: 'ephemeral',
      impactLevel: 'low',
      reversibility: 'reversible',
      network: 'none',
      paidCompute: 'none',
      safeguards: ['gates', 'verifier', 'human_acceptance', 'fail_closed', 'isolated_worktree'],
    },
  },
  {
    capabilityId: 'governance.verifier',
    action: 'Emitir parecer advisory sobre a attempt (verified/rejected) para a revisão humana.',
    levelCeiling: 'supervised',
    ceilingBlockers: ['human_acceptance_required'],
    delegableEffects: ['read_only'],
    requiredSafeguards: {
      supervised: ['human_acceptance', 'fail_closed'],
    },
    referenceAction: {
      description: 'Parecer append-only sobre Git + gates observados; aceite continua humano.',
      effect: 'read_only',
      impactLevel: 'low',
      reversibility: 'reversible',
      network: 'none',
      paidCompute: 'none',
      safeguards: ['human_acceptance', 'fail_closed', 'gates'],
    },
  },
  {
    capabilityId: 'agency.supervised-self-development',
    action: 'Percorrer a esteira backlog → attempt → worktree → coder → gates → review com aceite humano.',
    // Supervisionado por definição: o degrau seguinte é OUTRA capacidade
    // (agency.continuous-self-development), não esta sem humano.
    levelCeiling: 'supervised',
    ceilingBlockers: ['supervised_by_definition'],
    delegableEffects: ['isolated_mutation'],
    requiredSafeguards: {
      supervised: [
        'isolated_worktree',
        'allowed_paths',
        'gates',
        'verifier',
        'human_acceptance',
        'no_auto_integration',
        'recovery_path',
        'max_attempts',
        'budget_cap',
      ],
    },
    referenceAction: {
      description: 'Ciclo supervisionado completo até a decisão humana de revisão.',
      effect: 'isolated_mutation',
      impactLevel: 'low',
      reversibility: 'reversible',
      network: 'none',
      paidCompute: 'none',
      safeguards: GOVERNED_ATTEMPT_SAFEGUARDS,
    },
  },
];

// ─── Resultado ───────────────────────────────────────────────────────────────

export type AutonomyBlockerCode =
  | 'capability_unknown'
  | 'readiness_rule_missing'
  | 'proof_evaluation_missing'
  | 'proof_evaluation_inconsistent'
  | 'capability_not_proven'
  | 'capability_degraded'
  | 'operational_criteria_pending'
  | 'autonomous_operation_evidence_unavailable'
  | 'negative_evidence_recent'
  | 'action_outside_rule'
  | 'impact_requires_human_approval'
  | 'reversibility_not_established'
  | 'external_side_effects'
  | 'isolation_absent'
  | 'scope_not_bounded'
  | 'recovery_not_available'
  | 'verifier_required'
  | 'human_acceptance_required'
  | 'supervised_by_definition'
  | 'paid_authority_missing'
  | 'network_boundary_unproven'
  | 'safeguard_missing';

export interface AutonomyBlocker {
  readonly code: AutonomyBlockerCode;
  /** Menor nível que este blocker impede. */
  readonly blocksLevel: AutonomyLevel;
  readonly detail: string;
  readonly safeguard?: AutonomySafeguard;
}

export interface AutonomyReadinessEvidenceView {
  readonly proofStatus: CapabilityProofStatus | null;
  readonly declaredMaturity: CapabilityMaturity | null;
  readonly derivedMaturity: CapabilityMaturity | null;
  readonly contributing: number;
  readonly contradicting: number;
  readonly inconclusive: number;
  readonly reproducedOccasions: number | null;
  /** Ocasiões positivas depois da última evidência negativa (null = sem negativa). */
  readonly recoveryOccasionsAfterNegative: number | null;
}

export interface AutonomyAuthorityView {
  /** Nível efetivamente AUTORIZADO. Sem authority observada ⇒ `manual`. */
  readonly authorizedLevel: AutonomyLevel;
  readonly source: string;
  /** Authority vigente acima da readiness — reportado, nunca corrigido aqui. */
  readonly exceedsReadiness: boolean;
}

export interface AutonomyReadinessResult {
  readonly version: typeof AUTONOMY_READINESS_VERSION;
  readonly capabilityId: string;
  /** Maturidade EFETIVA usada (conservadora: menor entre declarado e derivado). */
  readonly capabilityMaturity: CapabilityMaturity | null;
  /** Maior nível para o qual a evidência + contexto sustentam delegação. */
  readonly readinessLevel: AutonomyLevel;
  readonly eligibleLevels: readonly AutonomyLevel[];
  /** Próximo nível da escada (null só em `autonomous`); os blockers dizem por que não é alcançável. */
  readonly nextLevel: AutonomyLevel | null;
  /** Por que os níveis acima de `readinessLevel` não são alcançáveis. */
  readonly blockers: readonly AutonomyBlocker[];
  readonly safeguards: {
    /** Exigidas pelo nível de readiness (cumulativas). */
    readonly required: readonly AutonomySafeguard[];
    /** Declaradas presentes pelo contexto. */
    readonly present: readonly AutonomySafeguard[];
    /** Faltando para o próximo nível. */
    readonly missingForNext: readonly AutonomySafeguard[];
  };
  readonly evidence: AutonomyReadinessEvidenceView;
  readonly authority: AutonomyAuthorityView;
  /** Invariante estrutural: readiness nunca concede authority. */
  readonly grantsAuthority: false;
  readonly explanation: string;
}

export interface EvaluateAutonomyReadinessInput {
  readonly capabilityId: string;
  readonly actionContext: AutonomyActionContext;
  /**
   * Saída de `evaluateCapabilityProofs`/`…FromHistory` (V0.1). ÚNICA fonte de
   * maturidade aceita — a projeção V1 crua não entra aqui.
   */
  readonly proofEvaluations: readonly CapabilityProofEvaluation[];
  /** Authority vigente (read-only). Ausente ⇒ `manual`. */
  readonly authority?: AutonomyAuthorityObservation | null;
  readonly rules?: readonly AutonomyReadinessRule[];
  /** Regras de prova canônicas para checar coerência da avaliação. */
  readonly proofRules?: readonly CapabilityProofRule[];
  readonly knownCapabilityIds?: readonly string[];
}

// ─── Avaliação ───────────────────────────────────────────────────────────────

const MATURITY_PT: Record<CapabilityMaturity, string> = {
  projected: 'projetada',
  specified: 'especificada',
  implemented: 'implementada',
  proven: 'comprovada',
  operational: 'operacional',
  autonomous: 'autônoma',
  degraded: 'regredida',
};

/** Nível máximo que a MATURIDADE sustenta. Operacional NUNCA implica autônomo. */
function maturityLevelCap(maturity: CapabilityMaturity): AutonomyLevel {
  if (maturity === 'autonomous') return 'autonomous';
  if (maturity === 'operational') return 'mandated';
  if (maturity === 'proven') return 'supervised';
  return 'manual';
}

function maturityBlocker(maturity: CapabilityMaturity): AutonomyBlocker | null {
  if (maturity === 'degraded') {
    return { code: 'capability_degraded', blocksLevel: 'supervised', detail: 'A evidência forte mais recente contradiz a capacidade (regredida); re-provar antes de delegar.' };
  }
  if (maturityRank(maturity) < maturityRank('proven')) {
    return { code: 'capability_not_proven', blocksLevel: 'supervised', detail: `Maturidade ${MATURITY_PT[maturity]}: sem prova de funcionamento.` };
  }
  if (maturity === 'proven') {
    return { code: 'operational_criteria_pending', blocksLevel: 'mandated', detail: 'Comprovada, não operacional: mandato exige critério operacional satisfeito na Proof Evaluation.' };
  }
  if (maturity === 'operational') {
    return { code: 'autonomous_operation_evidence_unavailable', blocksLevel: 'autonomous', detail: 'Operacional ≠ autônoma: não existe sinal de operação verificada sem humano no ciclo.' };
  }
  return null;
}

const SAFEGUARD_BLOCKER: Partial<Record<AutonomySafeguard, AutonomyBlockerCode>> = {
  verifier: 'verifier_required',
  human_acceptance: 'human_acceptance_required',
  recovery_path: 'recovery_not_available',
  allowed_paths: 'scope_not_bounded',
  isolated_worktree: 'isolation_absent',
  no_paid_compute: 'paid_authority_missing',
  no_network: 'network_boundary_unproven',
};

function cumulativeSafeguards(rule: AutonomyReadinessRule, level: AutonomyLevel): AutonomySafeguard[] {
  const out: AutonomySafeguard[] = [];
  for (const candidate of AUTONOMY_LEVELS) {
    if (candidate === 'manual') continue;
    if (autonomyLevelRank(candidate) > autonomyLevelRank(level)) break;
    for (const safeguard of rule.requiredSafeguards[candidate] ?? []) {
      if (!out.includes(safeguard)) out.push(safeguard);
    }
  }
  return out;
}

function isContributing(observation: CapabilityEvidenceObservation): boolean {
  return observation.evidenceClass !== 'assisted_procedure' && observation.outcome !== 'inconclusive' && observation.evidenceClass !== 'implementation';
}

/** Ocasiões positivas independentes depois da última negativa forte (null = sem negativa). */
function recoveryAfterNegative(evaluation: CapabilityProofEvaluation): number | null {
  const strong = evaluation.evidence.filter(isContributing);
  const lastNegative = strong.map((observation) => observation.outcome).lastIndexOf('negative');
  if (lastNegative < 0) return null;
  const occasions = new Set<string>();
  for (const observation of strong.slice(lastNegative + 1)) {
    if (observation.outcome === 'positive') occasions.add(observation.occasionId ?? observation.id);
  }
  return occasions.size;
}

function sameRule(left: CapabilityProofRule, right: CapabilityProofRule): boolean {
  return (
    left.capabilityId === right.capabilityId &&
    left.derivationCeiling === right.derivationCeiling &&
    left.reproductionSatisfiesOperational === right.reproductionSatisfiesOperational
  );
}

/**
 * Coerência mínima da avaliação com a regra canônica V0.1. Rejeita o que a
 * projeção V1 crua produziria (regra ausente, teto ignorado, reprodução contada
 * como operacional onde a regra não aceita).
 */
function evaluationInconsistency(
  evaluation: CapabilityProofEvaluation,
  proofRules: readonly CapabilityProofRule[],
): string | null {
  const canonical = proofRules.find((rule) => rule.capabilityId === evaluation.capabilityId);
  if (!canonical) return 'Sem regra canônica de prova para esta capacidade.';
  if (evaluation.rule === null || !sameRule(evaluation.rule, canonical)) {
    return 'A avaliação não carrega a regra canônica V0.1 (projeção crua ou regra alterada).';
  }
  const derived = evaluation.derivedMaturity;
  if (derived !== null && derived !== 'degraded' && maturityRank(derived) > maturityRank(canonical.derivationCeiling)) {
    return `Derivado ${MATURITY_PT[derived]} acima do teto da regra (${MATURITY_PT[canonical.derivationCeiling]}).`;
  }
  if (
    derived === 'operational' &&
    !canonical.reproductionSatisfiesOperational
  ) {
    return 'Operacional por reprodução numa capacidade cuja regra não aceita reprodução como critério operacional.';
  }
  return null;
}

/** Maturidade efetiva: conservadora. Divergência nunca promove. */
function effectiveMaturity(evaluation: CapabilityProofEvaluation): CapabilityMaturity | null {
  const derived = evaluation.derivedMaturity;
  if (derived === null) return null;
  if (derived === 'degraded') return 'degraded';
  const declared = evaluation.declaredMaturity;
  if (declared === 'degraded') return 'degraded';
  return maturityRank(derived) <= maturityRank(declared) ? derived : declared;
}

function authorityView(
  authority: AutonomyAuthorityObservation | null | undefined,
  readiness: AutonomyLevel,
): AutonomyAuthorityView {
  if (!authority) return { authorizedLevel: 'manual', source: 'none_observed', exceedsReadiness: false };
  return {
    authorizedLevel: authority.level,
    source: authority.source,
    exceedsReadiness: autonomyLevelRank(authority.level) > autonomyLevelRank(readiness),
  };
}

const EMPTY_EVIDENCE: AutonomyReadinessEvidenceView = {
  proofStatus: null,
  declaredMaturity: null,
  derivedMaturity: null,
  contributing: 0,
  contradicting: 0,
  inconclusive: 0,
  reproducedOccasions: null,
  recoveryOccasionsAfterNegative: null,
};

function failClosed(
  input: EvaluateAutonomyReadinessInput,
  code: AutonomyBlockerCode,
  detail: string,
  evidence: AutonomyReadinessEvidenceView = EMPTY_EVIDENCE,
  capabilityMaturity: CapabilityMaturity | null = null,
): AutonomyReadinessResult {
  return {
    version: AUTONOMY_READINESS_VERSION,
    capabilityId: input.capabilityId,
    capabilityMaturity,
    readinessLevel: 'manual',
    eligibleLevels: ['manual'],
    nextLevel: 'supervised',
    blockers: [{ code, blocksLevel: 'supervised', detail }],
    safeguards: { required: [], present: [...input.actionContext.safeguards], missingForNext: [] },
    evidence,
    authority: authorityView(input.authority, 'manual'),
    grantsAuthority: false,
    explanation: `Readiness manual (fail-closed): ${detail}`,
  };
}

/**
 * Avalia a PRONTIDÃO de delegação de uma ação sobre uma capacidade. Pura e
 * determinística. Nunca cria, altera ou implica authority.
 */
export function evaluateAutonomyReadiness(
  input: EvaluateAutonomyReadinessInput,
): AutonomyReadinessResult {
  const known = input.knownCapabilityIds ?? ANIMA_CAPABILITY_REGISTRY_V0.map((capability) => capability.id);
  if (!known.includes(input.capabilityId)) {
    return failClosed(input, 'capability_unknown', 'Capacidade desconhecida pelo registry.');
  }

  const rules = input.rules ?? AUTONOMY_READINESS_RULES_V0;
  const rule = rules.find((candidate) => candidate.capabilityId === input.capabilityId);
  if (!rule) {
    return failClosed(input, 'readiness_rule_missing', 'Capacidade fora do recorte V0 de readiness.');
  }

  const evaluation = input.proofEvaluations.find((entry) => entry.capabilityId === input.capabilityId);
  if (!evaluation) {
    return failClosed(input, 'proof_evaluation_missing', 'Sem Capability Proof Evaluation V0.1 para esta capacidade.');
  }

  const recovery = recoveryAfterNegative(evaluation);
  const evidence: AutonomyReadinessEvidenceView = {
    proofStatus: evaluation.status,
    declaredMaturity: evaluation.declaredMaturity,
    derivedMaturity: evaluation.derivedMaturity,
    contributing: evaluation.summary.contributing,
    contradicting: evaluation.summary.contradicting,
    inconclusive: evaluation.summary.inconclusive,
    reproducedOccasions: evaluation.reproduction?.occasions ?? null,
    recoveryOccasionsAfterNegative: recovery,
  };

  const inconsistency = evaluationInconsistency(evaluation, input.proofRules ?? CAPABILITY_PROOF_RULES_V0);
  if (inconsistency) {
    return failClosed(input, 'proof_evaluation_inconsistent', inconsistency, evidence);
  }

  const maturity = effectiveMaturity(evaluation);
  if (maturity === null) {
    return failClosed(
      input,
      'capability_not_proven',
      `Proof Evaluation sem maturidade derivada (${evaluation.status}); o declarado manual não sustenta delegação.`,
      evidence,
    );
  }

  const context = input.actionContext;
  const present = new Set(context.safeguards);
  const blockers: AutonomyBlocker[] = [];
  let cap: AutonomyLevel = 'autonomous';
  const limit = (level: AutonomyLevel, blocker: AutonomyBlocker): void => {
    cap = minLevel(cap, level);
    const duplicate = blockers.some((existing) => existing.code === blocker.code && existing.blocksLevel === blocker.blocksLevel);
    if (!duplicate) blockers.push(blocker);
  };

  // 1. Maturidade avaliada.
  const byMaturity = maturityLevelCap(maturity);
  const mBlocker = maturityBlocker(maturity);
  if (mBlocker) limit(byMaturity, mBlocker);

  // 2. Evidência negativa recente reduz: sem ≥2 ocasiões positivas depois da
  //    última negativa, nada acima de `supervised` (onde o aceite humano por
  //    item é a salvaguarda contra a falha observada). Regressão total
  //    (`degraded`) já bloqueia tudo no passo 1.
  if (recovery !== null && recovery < 2) {
    limit('supervised', {
      code: 'negative_evidence_recent',
      blocksLevel: 'mandated',
      detail: `Evidência negativa recente: ${recovery} ocasião(ões) positiva(s) desde a última negativa (<2).`,
    });
  }

  // 3. Teto estrutural da capacidade.
  if (autonomyLevelRank(rule.levelCeiling) < autonomyLevelRank('autonomous')) {
    const above = AUTONOMY_LEVELS[autonomyLevelRank(rule.levelCeiling) + 1]!;
    for (const code of rule.ceilingBlockers) {
      limit(rule.levelCeiling, { code, blocksLevel: above, detail: `Teto estrutural da regra (${AUTONOMY_LEVEL_LABEL_PT[rule.levelCeiling]}).` });
    }
  }

  // 4. Risco da ação (genérico, fail-closed: desconhecido = pior caso).
  //    Acima de `supervised` exige: impacto baixo, reversível, sem efeito
  //    externo, sem compute pago, sem rede, efeito dentro da regra.
  const impact = context.impactLevel ?? 'unknown';
  if (impact !== 'low') {
    limit('supervised', {
      code: 'impact_requires_human_approval',
      blocksLevel: 'mandated',
      detail: impact === 'unknown' ? 'Impacto desconhecido.' : `Impacto ${impact} exige aprovação humana prévia por item.`,
    });
  }
  const reversibility = context.reversibility ?? 'unknown';
  if (reversibility === 'irreversible' || reversibility === 'unknown') {
    limit('supervised', { code: 'reversibility_not_established', blocksLevel: 'mandated', detail: `Reversibilidade: ${reversibility}.` });
  }
  if (context.effect === 'external_effect') {
    limit('supervised', { code: 'external_side_effects', blocksLevel: 'mandated', detail: 'Ação com efeito fora da máquina.' });
  }
  if (context.effect === 'shared_mutation') {
    limit('supervised', { code: 'isolation_absent', blocksLevel: 'mandated', detail: 'Mutação fora da worktree isolada.' });
  }
  const paid = context.paidCompute ?? 'unknown';
  if (paid !== 'none') {
    limit('supervised', {
      code: 'paid_authority_missing',
      blocksLevel: 'mandated',
      detail: paid === 'unknown' ? 'Uso de compute pago desconhecido.' : 'Compute pago exige authority humana por item (fora do V0).',
    });
  }
  const network = context.network ?? 'unknown';
  if (network !== 'none') {
    limit('supervised', {
      code: 'network_boundary_unproven',
      blocksLevel: 'mandated',
      detail: network === 'unknown' ? 'Acesso de rede desconhecido.' : 'Ação exige rede; boundary de rede não provado.',
    });
  }
  if (!rule.delegableEffects.includes(context.effect)) {
    limit('supervised', {
      code: 'action_outside_rule',
      blocksLevel: 'mandated',
      detail: `Efeito ${context.effect} fora da classe delegável da regra (${rule.delegableEffects.join(', ')}).`,
    });
  }
  // Mutação acima de supervisionado sempre exige caminho de recuperação, mesmo
  // que a regra esqueça de pedir.
  if (MUTATING_EFFECTS.has(context.effect) && !present.has('recovery_path')) {
    limit('supervised', {
      code: 'recovery_not_available',
      blocksLevel: 'mandated',
      detail: 'Ação mutável sem caminho de recuperação (rollback/restore).',
      safeguard: 'recovery_path',
    });
  }

  // 5. Salvaguardas por nível: o nível só é elegível se TODAS as exigidas
  //    (cumulativas) estão presentes.
  let readiness: AutonomyLevel = 'manual';
  for (const level of AUTONOMY_LEVELS) {
    if (level === 'manual') continue;
    if (autonomyLevelRank(level) > autonomyLevelRank(cap)) break;
    const missing = cumulativeSafeguards(rule, level).filter((safeguard) => !present.has(safeguard));
    if (missing.length > 0) {
      for (const safeguard of missing) {
        if (blockers.some((blocker) => blocker.safeguard === safeguard)) continue;
        blockers.push({
          code: SAFEGUARD_BLOCKER[safeguard] ?? 'safeguard_missing',
          blocksLevel: level,
          detail: `Salvaguarda exigida ausente: ${safeguard}.`,
          safeguard,
        });
      }
      break;
    }
    readiness = level;
  }

  // Só reportamos o que impede níveis ACIMA da readiness.
  const relevant = blockers
    .filter((blocker) => autonomyLevelRank(blocker.blocksLevel) > autonomyLevelRank(readiness))
    .sort((left, right) => autonomyLevelRank(left.blocksLevel) - autonomyLevelRank(right.blocksLevel));

  const nextLevel = readiness === 'autonomous' ? null : AUTONOMY_LEVELS[autonomyLevelRank(readiness) + 1]!;
  const missingForNext =
    nextLevel === null
      ? []
      : cumulativeSafeguards(rule, nextLevel).filter((safeguard) => !present.has(safeguard));
  const eligibleLevels = AUTONOMY_LEVELS.filter((level) => autonomyLevelRank(level) <= autonomyLevelRank(readiness));
  const authority = authorityView(input.authority, readiness);

  const nextBlockers = relevant.filter((blocker) => blocker.blocksLevel === nextLevel).map((blocker) => blocker.code);
  const explanation =
    `Maturidade ${MATURITY_PT[maturity]} → readiness ${AUTONOMY_LEVEL_LABEL_PT[readiness]}` +
    (nextLevel && nextBlockers.length > 0 ? `; ${AUTONOMY_LEVEL_LABEL_PT[nextLevel]} bloqueada por ${[...new Set(nextBlockers)].join(', ')}` : '') +
    `. Readiness ≠ authority: autorizado = ${AUTONOMY_LEVEL_LABEL_PT[authority.authorizedLevel]}` +
    (authority.exceedsReadiness ? ' (authority vigente ACIMA da readiness — revisar; o engine não altera).' : '.');

  return {
    version: AUTONOMY_READINESS_VERSION,
    capabilityId: input.capabilityId,
    capabilityMaturity: maturity,
    readinessLevel: readiness,
    eligibleLevels,
    nextLevel,
    blockers: relevant,
    safeguards: {
      required: cumulativeSafeguards(rule, readiness),
      present: [...context.safeguards],
      missingForNext,
    },
    evidence,
    authority,
    grantsAuthority: false,
    explanation,
  };
}

/**
 * Laço de feedback (re-avaliação), caminho SEGURO de produção:
 * work_events → Proof Evaluation V0.1 → readiness. Evidência nova (positiva ou
 * negativa) muda a readiness na próxima leitura; authority nunca é mutada.
 */
export function evaluateAutonomyReadinessFromHistory(input: {
  readonly events: readonly WorkEvent[] | null;
  readonly capabilityId: string;
  readonly actionContext?: AutonomyActionContext;
  readonly authority?: AutonomyAuthorityObservation | null;
}): AutonomyReadinessResult {
  const proofEvaluations = evaluateCapabilityProofsFromHistory({ events: input.events });
  return evaluateAutonomyReadiness({
    capabilityId: input.capabilityId,
    actionContext: input.actionContext ?? referenceActionFor(input.capabilityId),
    proofEvaluations,
    authority: input.authority,
  });
}

const UNKNOWN_ACTION: AutonomyActionContext = {
  description: 'Ação não descrita (fail-closed).',
  effect: 'external_effect',
  safeguards: [],
};

export function referenceActionFor(capabilityId: string): AutonomyActionContext {
  return AUTONOMY_READINESS_RULES_V0.find((rule) => rule.capabilityId === capabilityId)?.referenceAction ?? UNKNOWN_ACTION;
}

/**
 * Readiness das capacidades cobertas pelo V0 para a AÇÃO DE REFERÊNCIA (uso
 * governado atual). Projeção para a UI; nenhuma authority é lida nem criada.
 */
export function evaluateReferenceAutonomyReadiness(
  proofEvaluations: readonly CapabilityProofEvaluation[],
): readonly AutonomyReadinessResult[] {
  return AUTONOMY_READINESS_RULES_V0.map((rule) =>
    evaluateAutonomyReadiness({
      capabilityId: rule.capabilityId,
      actionContext: rule.referenceAction,
      proofEvaluations,
    }),
  );
}
