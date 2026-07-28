export const workComplexities = ['routine', 'bounded', 'complex', 'unknown'] as const;
export const workRisks = ['low', 'moderate', 'high', 'critical', 'unknown'] as const;
export const workReversibilities = ['reversible', 'conditionally_reversible', 'irreversible', 'unknown'] as const;
export const workPlanClarities = ['clear', 'partial', 'unclear', 'unknown'] as const;
export const workUrgencies = ['deferrable', 'normal', 'time_sensitive', 'immediate', 'unknown'] as const;

export type WorkComplexity = typeof workComplexities[number];
export type WorkRisk = typeof workRisks[number];
export type WorkReversibility = typeof workReversibilities[number];
export type WorkPlanClarity = typeof workPlanClarities[number];
export type WorkUrgency = typeof workUrgencies[number];

export type WorkIntelligenceClassificationAxis =
  | 'complexity'
  | 'risk'
  | 'reversibility'
  | 'planClarity'
  | 'urgency';

export type WorkIntelligenceClassificationProvenanceV1 =
  | {
      readonly kind: 'human_confirmed';
      readonly classifiedAt: string;
      readonly classifierId: string;
    }
  | {
      readonly kind: 'system_assessed';
      readonly classifiedAt: string;
      readonly classifierId: string;
      readonly policyVersion: string;
    };

export interface WorkIntelligenceClassificationV1 {
  readonly schemaVersion: 1;
  readonly complexity: WorkComplexity;
  readonly risk: WorkRisk;
  readonly reversibility: WorkReversibility;
  readonly planClarity: WorkPlanClarity;
  readonly urgency: WorkUrgency;
  readonly provenance: WorkIntelligenceClassificationProvenanceV1;
}

export type ClassificationReadiness =
  | {
      readonly ready: true;
      readonly unknownAxes: readonly [];
    }
  | {
      readonly ready: false;
      readonly reason: 'classification_incomplete';
      readonly unknownAxes: readonly WorkIntelligenceClassificationAxis[];
    };

const classificationKeys = [
  'schemaVersion', 'complexity', 'risk', 'reversibility', 'planClarity', 'urgency', 'provenance',
] as const;
const humanProvenanceKeys = ['kind', 'classifiedAt', 'classifierId'] as const;
const systemProvenanceKeys = ['kind', 'classifiedAt', 'classifierId', 'policyVersion'] as const;
const axisOrder: readonly WorkIntelligenceClassificationAxis[] = [
  'complexity', 'risk', 'reversibility', 'planClarity', 'urgency',
];

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isNonBlank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const hasExactKeys = (value: Readonly<Record<string, unknown>>, expected: readonly string[]): boolean => {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every(key => expected.includes(key));
};
const belongsTo = <T extends string>(value: unknown, vocabulary: readonly T[]): value is T =>
  typeof value === 'string' && vocabulary.includes(value as T);
const isValidInstant = (value: unknown): value is string => {
  if (!isNonBlank(value)) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  return calendarDate.getUTCFullYear() === year
    && calendarDate.getUTCMonth() === month - 1
    && calendarDate.getUTCDate() === day
    && Number(hourText) <= 23
    && Number(minuteText) <= 59
    && Number(secondText) <= 59
    && (offsetHourText === undefined || (Number(offsetHourText) <= 23 && Number(offsetMinuteText) <= 59));
};

/**
 * Valida somente a estrutura e a semântica contratual do INTEL-01.
 * `unknown` é um valor válido; ausência, vocabulário externo e campos extras
 * falham fechados. A função não infere eixos nem seleciona qualquer executor.
 */
export function validateWorkIntelligenceClassification(value: unknown): string | null {
  if (!isRecord(value) || !hasExactKeys(value, classificationKeys)) {
    return 'A classificação exige exatamente schemaVersion, os cinco eixos e provenance.';
  }
  if (value['schemaVersion'] !== 1) return 'schemaVersion deve ser 1.';
  if (!belongsTo(value['complexity'], workComplexities)) return 'Complexidade fora do vocabulário V1.';
  if (!belongsTo(value['risk'], workRisks)) return 'Risco fora do vocabulário V1.';
  if (!belongsTo(value['reversibility'], workReversibilities)) return 'Reversibilidade fora do vocabulário V1.';
  if (!belongsTo(value['planClarity'], workPlanClarities)) return 'Clareza do plano fora do vocabulário V1.';
  if (!belongsTo(value['urgency'], workUrgencies)) return 'Urgência fora do vocabulário V1.';

  const provenance = value['provenance'];
  if (!isRecord(provenance)) return 'Proveniência inválida.';
  if (provenance['kind'] === 'human_confirmed') {
    if (!hasExactKeys(provenance, humanProvenanceKeys)) return 'Proveniência human_confirmed contém campos inválidos.';
  } else if (provenance['kind'] === 'system_assessed') {
    if (!hasExactKeys(provenance, systemProvenanceKeys) || !isNonBlank(provenance['policyVersion'])) {
      return 'Proveniência system_assessed exige policyVersion não vazia.';
    }
  } else {
    return 'Tipo de proveniência inválido.';
  }
  if (!isValidInstant(provenance['classifiedAt'])) return 'classifiedAt deve ser um instante ISO 8601 válido.';
  if (!isNonBlank(provenance['classifierId'])) return 'classifierId deve ser opaco e não vazio.';
  return null;
}

/**
 * Informa se os cinco eixos já contêm fatos suficientes para uma futura etapa
 * de roteamento. Não valida, seleciona ou inicia executor, provedor ou modelo.
 */
export function evaluateClassificationReadiness(
  classification: WorkIntelligenceClassificationV1,
): ClassificationReadiness {
  const unknownAxes = axisOrder.filter(axis => classification[axis] === 'unknown');
  return unknownAxes.length === 0
    ? { ready: true, unknownAxes: [] }
    : { ready: false, reason: 'classification_incomplete', unknownAxes };
}
