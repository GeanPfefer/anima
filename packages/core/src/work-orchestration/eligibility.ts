import { Constants, type Json } from '@anima/types';
import type { WorkCapability, WorkIntent, WorkItem, WorkState } from './types';

// AUTO-01 — Elegibilidade para execução autônoma (Marco 003 §Elegibilidade).
// Predicado puro e fail-closed: na dúvida, o item NÃO é elegível e cada lacuna
// explica exatamente o que falta. A especificação de execução ainda não tem
// persistência própria; quando declarada, vive em `intent.execution_spec`
// (jsonb já existente), sem migration nesta fase.

export type AutonomousTargetKind = 'project' | 'workspace' | 'resource';
export interface AutonomousExecutionTarget { readonly kind: AutonomousTargetKind; readonly reference: string; }
export interface AutonomousExecutionLimits {
  readonly maxAttempts?: number;
  readonly maxDurationMinutes?: number;
  readonly maxResourceUnits?: number;
}
export interface AutonomousValidationCriterion { readonly label: string; readonly command?: string; }
export interface AutonomousExecutionSpecV1 {
  readonly schemaVersion: 1;
  readonly target: AutonomousExecutionTarget;
  // Lista explícita; vazia significa "nenhuma permissão adicional", declarada de propósito.
  readonly permissions: readonly string[];
  readonly validationCriteria: readonly AutonomousValidationCriterion[];
  readonly limits: AutonomousExecutionLimits;
}

export type AutonomousEligibilityGapCode =
  | 'proposal_not_approved'
  | 'human_decision_pending'
  | 'work_already_closed'
  | 'execution_already_active'
  | 'work_blocked_unresolved'
  | 'scope_not_concrete'
  | 'expected_result_missing'
  | 'capability_unknown'
  | 'target_missing'
  | 'permissions_not_declared'
  | 'validation_criteria_missing'
  | 'limits_missing'
  | 'execution_spec_invalid';

export interface AutonomousEligibilityGap {
  readonly code: AutonomousEligibilityGapCode;
  // Requisito do Marco 003 que a lacuna viola, para rastreabilidade.
  readonly requirement: string;
  readonly explanation: string;
}

export type AutonomousEligibilityEvaluation =
  | { readonly eligible: true; readonly spec: AutonomousExecutionSpecV1 }
  | { readonly eligible: false; readonly gaps: readonly AutonomousEligibilityGap[] };

// Payload proposto (sem migration nesta fase) para o evento `work_blocked`
// já previsto no vocabulário da arquitetura, com razão tipada — nunca "outro".
export interface WorkBlockedNotEligiblePayloadV1 {
  readonly schema_version: 1;
  readonly reason: 'not_eligible';
  readonly gaps: readonly AutonomousEligibilityGapCode[];
}

const gap = (code: AutonomousEligibilityGapCode, requirement: string, explanation: string): AutonomousEligibilityGap => ({ code, requirement, explanation });

const REQUIREMENT = {
  approvedVersion: 'versão aprovada da proposta',
  noPendingDecision: 'nenhuma decisão humana pendente',
  concreteScope: 'escopo concreto (o que entra e o que não entra)',
  expectedResult: 'resultado esperado descrito',
  capability: 'capacidade executora identificada',
  target: 'alvo conhecido (projeto, workspace ou recurso)',
  permissions: 'permissões explícitas para o que a execução exige',
  validation: 'critérios de validação verificáveis',
  limits: 'limites de tentativa, tempo ou recurso',
} as const;

const stateGaps = (state: WorkState): readonly AutonomousEligibilityGap[] => {
  switch (state) {
    case 'approved': return [];
    case 'proposed': return [
      gap('proposal_not_approved', REQUIREMENT.approvedVersion, 'A proposta ainda não foi aprovada pelo usuário.'),
      gap('human_decision_pending', REQUIREMENT.noPendingDecision, 'A decisão sobre a proposta está pendente.'),
    ];
    case 'review': return [gap('human_decision_pending', REQUIREMENT.noPendingDecision, 'Há um resultado aguardando revisão humana.')];
    case 'changes_requested': return [gap('human_decision_pending', REQUIREMENT.noPendingDecision, 'Correções foram solicitadas e aguardam nova proposta ou decisão.')];
    case 'in_progress': return [gap('execution_already_active', REQUIREMENT.noPendingDecision, 'Já existe execução em andamento para este item.')];
    case 'blocked': return [gap('work_blocked_unresolved', REQUIREMENT.noPendingDecision, 'O item está bloqueado aguardando informação, autoridade ou dependência externa.')];
    case 'completed':
    case 'failed':
    case 'rejected':
    case 'cancelled':
      return [gap('work_already_closed', REQUIREMENT.approvedVersion, `O item está encerrado (${state}) e não pode entrar em execução autônoma.`)];
  }
};

const hasConcreteEntries = (values: readonly string[]): boolean => values.length > 0 && values.every(value => value.trim().length > 0);

const knownCapabilities: ReadonlySet<string> = new Set<string>(Constants.public.Enums.work_capability);

const isPlainObject = (value: Json | undefined): value is Readonly<Record<string, Json>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPositiveInteger = (value: Json | undefined): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

const targetKinds: ReadonlySet<string> = new Set(['project', 'workspace', 'resource']);

type SpecParse =
  | { readonly kind: 'absent' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'declared'; readonly raw: Readonly<Record<string, Json>> };

const readSpec = (intent: WorkIntent): SpecParse => {
  const raw = intent['execution_spec'];
  if (raw === undefined || raw === null) return { kind: 'absent' };
  if (!isPlainObject(raw) || raw['schema_version'] !== 1) return { kind: 'invalid' };
  return { kind: 'declared', raw };
};

const parseTarget = (raw: Readonly<Record<string, Json>>): AutonomousExecutionTarget | null => {
  const value = raw['target'];
  if (!isPlainObject(value)) return null;
  const kind = value['kind'];
  const reference = value['reference'];
  if (typeof kind !== 'string' || !targetKinds.has(kind)) return null;
  if (typeof reference !== 'string' || reference.trim().length === 0) return null;
  return { kind: kind as AutonomousTargetKind, reference };
};

const parsePermissions = (raw: Readonly<Record<string, Json>>): readonly string[] | null => {
  const value = raw['permissions'];
  if (!Array.isArray(value)) return null;
  if (!value.every(entry => typeof entry === 'string' && entry.trim().length > 0)) return null;
  return value as readonly string[];
};

const parseValidationCriteria = (raw: Readonly<Record<string, Json>>): readonly AutonomousValidationCriterion[] | null => {
  const value = raw['validation_criteria'];
  if (!Array.isArray(value) || value.length === 0) return null;
  const criteria: AutonomousValidationCriterion[] = [];
  for (const entry of value) {
    if (!isPlainObject(entry)) return null;
    const label = entry['label'];
    if (typeof label !== 'string' || label.trim().length === 0) return null;
    const command = entry['command'];
    if (command !== undefined && (typeof command !== 'string' || command.trim().length === 0)) return null;
    criteria.push(command === undefined ? { label } : { label, command });
  }
  return criteria;
};

const parseLimits = (raw: Readonly<Record<string, Json>>): AutonomousExecutionLimits | null => {
  const value = raw['limits'];
  if (!isPlainObject(value)) return null;
  const maxAttempts = value['max_attempts'];
  const maxDurationMinutes = value['max_duration_minutes'];
  const maxResourceUnits = value['max_resource_units'];
  const limits: { maxAttempts?: number; maxDurationMinutes?: number; maxResourceUnits?: number } = {};
  if (maxAttempts !== undefined) { if (!isPositiveInteger(maxAttempts)) return null; limits.maxAttempts = maxAttempts; }
  if (maxDurationMinutes !== undefined) { if (!isPositiveInteger(maxDurationMinutes)) return null; limits.maxDurationMinutes = maxDurationMinutes; }
  if (maxResourceUnits !== undefined) { if (!isPositiveInteger(maxResourceUnits)) return null; limits.maxResourceUnits = maxResourceUnits; }
  if (limits.maxAttempts === undefined && limits.maxDurationMinutes === undefined && limits.maxResourceUnits === undefined) return null;
  return limits;
};

export function evaluateAutonomousEligibility(item: WorkItem): AutonomousEligibilityEvaluation {
  const gaps: AutonomousEligibilityGap[] = [...stateGaps(item.state)];

  const { includedScope, excludedScope, objective, expectedEffects } = item.proposal.data;
  if (!hasConcreteEntries(includedScope) || !hasConcreteEntries(excludedScope)) {
    gaps.push(gap('scope_not_concrete', REQUIREMENT.concreteScope, 'A proposta precisa declarar concretamente o que entra e o que não entra no escopo.'));
  }
  if (objective.trim().length === 0 || !hasConcreteEntries(expectedEffects)) {
    gaps.push(gap('expected_result_missing', REQUIREMENT.expectedResult, 'A proposta precisa descrever o resultado esperado da execução.'));
  }
  if (!knownCapabilities.has(item.capability as WorkCapability)) {
    gaps.push(gap('capability_unknown', REQUIREMENT.capability, `A capacidade executora "${String(item.capability)}" não é reconhecida pelo domínio.`));
  }

  const spec = readSpec(item.intent);
  let parsedSpec: AutonomousExecutionSpecV1 | null = null;
  if (spec.kind === 'invalid') {
    gaps.push(gap('execution_spec_invalid', REQUIREMENT.target, 'A especificação de execução declarada está malformada; corrija-a antes de reavaliar (fail-closed).'));
  } else if (spec.kind === 'absent') {
    gaps.push(
      gap('target_missing', REQUIREMENT.target, 'Nenhum alvo de execução (projeto, workspace ou recurso) foi declarado.'),
      gap('permissions_not_declared', REQUIREMENT.permissions, 'As permissões exigidas pela execução não foram declaradas explicitamente.'),
      gap('validation_criteria_missing', REQUIREMENT.validation, 'Nenhum critério verificável de validação foi declarado.'),
      gap('limits_missing', REQUIREMENT.limits, 'Nenhum limite de tentativa, tempo ou recurso foi declarado.'),
    );
  } else {
    const target = parseTarget(spec.raw);
    const permissions = parsePermissions(spec.raw);
    const validationCriteria = parseValidationCriteria(spec.raw);
    const limits = parseLimits(spec.raw);
    if (target === null) gaps.push(gap('target_missing', REQUIREMENT.target, 'O alvo de execução declarado é ausente ou inválido (kind e reference são obrigatórios).'));
    if (permissions === null) gaps.push(gap('permissions_not_declared', REQUIREMENT.permissions, 'As permissões precisam ser uma lista explícita (vazia significa "nenhuma adicional").'));
    if (validationCriteria === null) gaps.push(gap('validation_criteria_missing', REQUIREMENT.validation, 'Os critérios de validação precisam de pelo menos uma entrada verificável com rótulo.'));
    if (limits === null) gaps.push(gap('limits_missing', REQUIREMENT.limits, 'Declare ao menos um limite positivo de tentativas, tempo ou recurso.'));
    if (target !== null && permissions !== null && validationCriteria !== null && limits !== null) {
      parsedSpec = { schemaVersion: 1, target, permissions, validationCriteria, limits };
    }
  }

  if (gaps.length > 0) return { eligible: false, gaps };
  // parsedSpec só é nulo aqui se alguma lacuna tivesse sido registrada acima.
  return { eligible: true, spec: parsedSpec! };
}

export const buildNotEligibleBlockPayload = (evaluation: AutonomousEligibilityEvaluation): WorkBlockedNotEligiblePayloadV1 | null =>
  evaluation.eligible ? null : { schema_version: 1, reason: 'not_eligible', gaps: evaluation.gaps.map(entry => entry.code) };
