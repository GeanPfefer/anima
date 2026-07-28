import {
  evaluateClassificationReadiness,
  validateWorkIntelligenceClassification,
  type ClassificationReadiness,
  type WorkIntelligenceClassificationV1,
} from './work-intelligence-classification';

export interface WorkIntelligenceClassificationEventV1 {
  readonly schemaVersion: 1;
  readonly eventId: string;
  readonly sequence: number;
  readonly workItemId: string;
  readonly approvedProposalVersion: number;
  readonly classificationRevision: number;
  readonly previousClassificationRevision: number;
  readonly supersedesEventId: string | null;
  readonly classification: WorkIntelligenceClassificationV1;
}

export interface CurrentWorkIntelligenceClassification {
  readonly eventId: string;
  readonly sequence: number;
  readonly proposalVersion: number;
  readonly classificationRevision: number;
  readonly classification: WorkIntelligenceClassificationV1;
  readonly readiness: ClassificationReadiness;
}

export type WorkIntelligenceClassificationReconstruction =
  | {
      readonly ok: true;
      readonly current: CurrentWorkIntelligenceClassification | null;
    }
  | {
      readonly ok: false;
      readonly defect: string;
    };

interface ReconstructionInput {
  readonly workItemId: string;
  readonly currentProposalVersion: number;
  readonly events: readonly unknown[];
}

const eventKeys = [
  'schemaVersion',
  'eventId',
  'sequence',
  'workItemId',
  'approvedProposalVersion',
  'classificationRevision',
  'previousClassificationRevision',
  'supersedesEventId',
  'classification',
] as const;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isNonBlank = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const isPositiveInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;
const hasExactKeys = (
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean => {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every(key => expected.includes(key));
};

function parseEvent(value: unknown): WorkIntelligenceClassificationEventV1 | string {
  if (!isRecord(value) || !hasExactKeys(value, eventKeys)) {
    return 'Evento de classificação contém estrutura ou campos inválidos.';
  }
  if (
    value['schemaVersion'] !== 1
    || !isNonBlank(value['eventId'])
    || !isPositiveInteger(value['sequence'])
    || !isNonBlank(value['workItemId'])
    || !isPositiveInteger(value['approvedProposalVersion'])
    || !isPositiveInteger(value['classificationRevision'])
    || !Number.isSafeInteger(value['previousClassificationRevision'])
    || Number(value['previousClassificationRevision']) < 0
    || (value['supersedesEventId'] !== null && !isNonBlank(value['supersedesEventId']))
  ) {
    return 'Evento de classificação contém metadados inválidos.';
  }
  const classificationError = validateWorkIntelligenceClassification(value['classification']);
  if (classificationError !== null) return `Classificação persistida inválida: ${classificationError}`;
  return value as unknown as WorkIntelligenceClassificationEventV1;
}

/**
 * Reconstrói a classificação corrente somente a partir da trilha append-only.
 * A ordem de entrada é irrelevante: `sequence` é a ordem canônica. Qualquer
 * lacuna, bifurcação ou evento inválido falha fechado, em vez de adivinhar.
 */
export function reconstructCurrentWorkIntelligenceClassification(
  input: ReconstructionInput,
): WorkIntelligenceClassificationReconstruction {
  if (!isNonBlank(input.workItemId) || !isPositiveInteger(input.currentProposalVersion)) {
    return { ok: false, defect: 'Correlação corrente de item ou proposta inválida.' };
  }

  const parsed: WorkIntelligenceClassificationEventV1[] = [];
  for (const raw of input.events) {
    const event = parseEvent(raw);
    if (typeof event === 'string') return { ok: false, defect: event };
    if (event.workItemId !== input.workItemId) {
      return { ok: false, defect: 'Evento de classificação pertence a outro item.' };
    }
    parsed.push(event);
  }

  parsed.sort((left, right) =>
    left.sequence - right.sequence || left.eventId.localeCompare(right.eventId));

  const eventIds = new Set<string>();
  const sequences = new Set<number>();
  const heads = new Map<number, WorkIntelligenceClassificationEventV1>();
  for (const event of parsed) {
    if (eventIds.has(event.eventId) || sequences.has(event.sequence)) {
      return { ok: false, defect: 'Evento ou sequência de classificação duplicado.' };
    }
    eventIds.add(event.eventId);
    sequences.add(event.sequence);

    const previous = heads.get(event.approvedProposalVersion);
    const expectedRevision = (previous?.classificationRevision ?? 0) + 1;
    const expectedPreviousRevision = previous?.classificationRevision ?? 0;
    const expectedSupersededId = previous?.eventId ?? null;
    if (
      event.classificationRevision !== expectedRevision
      || event.previousClassificationRevision !== expectedPreviousRevision
      || event.supersedesEventId !== expectedSupersededId
    ) {
      return {
        ok: false,
        defect: `Cadeia de classificação inválida na proposta ${event.approvedProposalVersion}.`,
      };
    }
    heads.set(event.approvedProposalVersion, event);
  }

  const current = heads.get(input.currentProposalVersion);
  if (current === undefined) return { ok: true, current: null };
  return {
    ok: true,
    current: {
      eventId: current.eventId,
      sequence: current.sequence,
      proposalVersion: current.approvedProposalVersion,
      classificationRevision: current.classificationRevision,
      classification: current.classification,
      readiness: evaluateClassificationReadiness(current.classification),
    },
  };
}
