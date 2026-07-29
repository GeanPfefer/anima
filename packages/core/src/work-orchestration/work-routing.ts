import type { WorkCapability } from './types';
import {
  evaluateClassificationReadiness,
  validateWorkIntelligenceClassification,
  type WorkIntelligenceClassificationV1,
} from './work-intelligence-classification';

export const workEffortLevels = ['light', 'standard', 'strong'] as const;
export type WorkEffortLevel = typeof workEffortLevels[number];
export type WorkRouteAvailability = 'available' | 'unavailable';
export type WorkRouteLatency = 'low' | 'normal' | 'high';

export interface WorkRoutingCandidateV1 {
  readonly schemaVersion: 1;
  /** Identificador opaco da combinação executável; não é nome de fornecedor. */
  readonly routeId: string;
  readonly executorId: string;
  readonly providerRef: string;
  readonly modelRef: string;
  readonly effort: WorkEffortLevel;
  readonly capabilities: readonly WorkCapability[];
  readonly availability: WorkRouteAvailability;
  readonly latency: WorkRouteLatency;
  /** Ordem declarada pelo nó para candidatos equivalentes. */
  readonly priority: number;
}

export type WorkRoutingRejectionReason =
  | 'unavailable'
  | 'capability_unsupported'
  | 'effort_insufficient'
  | 'higher_effort_than_needed'
  | 'tie_break_lost';

export interface WorkRoutingRejectedCandidateV1 {
  readonly routeId: string;
  readonly reasons: readonly WorkRoutingRejectionReason[];
}

export interface WorkRoutingDecisionV1 {
  readonly schemaVersion: 1;
  readonly policyVersion: 'work-routing-v1';
  readonly capability: WorkCapability;
  readonly requiredEffort: WorkEffortLevel;
  readonly selected: {
    readonly routeId: string;
    readonly executorId: string;
    readonly providerRef: string;
    readonly modelRef: string;
    readonly effort: WorkEffortLevel;
  };
  readonly factors: {
    readonly complexity: WorkIntelligenceClassificationV1['complexity'];
    readonly risk: WorkIntelligenceClassificationV1['risk'];
    readonly reversibility: WorkIntelligenceClassificationV1['reversibility'];
    readonly planClarity: WorkIntelligenceClassificationV1['planClarity'];
    readonly urgency: WorkIntelligenceClassificationV1['urgency'];
    readonly urgencyTieBreakApplied: boolean;
  };
  readonly rejectedCandidates: readonly WorkRoutingRejectedCandidateV1[];
}

export type WorkRoutingPolicyResult =
  | { readonly outcome: 'selected'; readonly decision: WorkRoutingDecisionV1 }
  | {
      readonly outcome: 'unavailable';
      readonly reason: 'classification_invalid' | 'classification_incomplete' | 'no_capable_route';
      readonly explanation: string;
      readonly rejectedCandidates: readonly WorkRoutingRejectedCandidateV1[];
    };

const effortRank: Readonly<Record<WorkEffortLevel, number>> = { light: 0, standard: 1, strong: 2 };
const latencyRank: Readonly<Record<WorkRouteLatency, number>> = { low: 0, normal: 1, high: 2 };
const nonBlank = (value: string): boolean => value.trim().length > 0;

export function requiredEffortFor(
  classification: WorkIntelligenceClassificationV1,
): WorkEffortLevel {
  if (
    classification.complexity === 'complex'
    || classification.risk === 'high'
    || classification.risk === 'critical'
    || classification.reversibility === 'irreversible'
    || classification.planClarity === 'unclear'
  ) return 'strong';

  if (
    classification.complexity === 'routine'
    && classification.risk === 'low'
    && classification.reversibility === 'reversible'
    && classification.planClarity === 'clear'
  ) return 'light';

  return 'standard';
}

export function validateWorkRoutingCandidate(candidate: WorkRoutingCandidateV1): string | null {
  if (candidate.schemaVersion !== 1 || !nonBlank(candidate.routeId) || !nonBlank(candidate.executorId)
    || !nonBlank(candidate.providerRef) || !nonBlank(candidate.modelRef)) {
    return 'A rota exige versão e identificadores opacos não vazios.';
  }
  if (!workEffortLevels.includes(candidate.effort)
    || !['available', 'unavailable'].includes(candidate.availability)
    || !['low', 'normal', 'high'].includes(candidate.latency)) {
    return 'A rota contém esforço, disponibilidade ou latência fora do vocabulário V1.';
  }
  if (!Number.isInteger(candidate.priority) || candidate.priority < 0
    || candidate.capabilities.length === 0 || new Set(candidate.capabilities).size !== candidate.capabilities.length) {
    return 'A rota exige prioridade não negativa e capacidades únicas.';
  }
  return null;
}

const reasonsFor = (
  candidate: WorkRoutingCandidateV1,
  capability: WorkCapability,
  requiredEffort: WorkEffortLevel,
): WorkRoutingRejectionReason[] => {
  const reasons: WorkRoutingRejectionReason[] = [];
  if (candidate.availability !== 'available') reasons.push('unavailable');
  if (!candidate.capabilities.includes(capability)) reasons.push('capability_unsupported');
  if (effortRank[candidate.effort] < effortRank[requiredEffort]) reasons.push('effort_insufficient');
  return reasons;
};

export function selectWorkRoute(input: {
  readonly capability: WorkCapability;
  readonly classification: WorkIntelligenceClassificationV1;
  readonly candidates: readonly WorkRoutingCandidateV1[];
}): WorkRoutingPolicyResult {
  const invalidClassification = validateWorkIntelligenceClassification(input.classification);
  if (invalidClassification) {
    return { outcome: 'unavailable', reason: 'classification_invalid', explanation: invalidClassification, rejectedCandidates: [] };
  }
  const readiness = evaluateClassificationReadiness(input.classification);
  if (!readiness.ready) {
    return {
      outcome: 'unavailable', reason: 'classification_incomplete',
      explanation: `Classificação incompleta: ${readiness.unknownAxes.join(', ')}.`,
      rejectedCandidates: [],
    };
  }
  const invalidCandidate = input.candidates.find(validateWorkRoutingCandidate);
  if (invalidCandidate) {
    return {
      outcome: 'unavailable', reason: 'no_capable_route',
      explanation: `Catálogo contém rota inválida: ${invalidCandidate.routeId || '(sem id)'}.`,
      rejectedCandidates: [],
    };
  }

  const requiredEffort = requiredEffortFor(input.classification);
  const rejected = new Map<string, WorkRoutingRejectionReason[]>();
  const capable = input.candidates.filter(candidate => {
    const reasons = reasonsFor(candidate, input.capability, requiredEffort);
    if (reasons.length) rejected.set(candidate.routeId, reasons);
    return reasons.length === 0;
  });
  if (capable.length === 0) {
    return {
      outcome: 'unavailable', reason: 'no_capable_route',
      explanation: `Nenhuma rota disponível satisfaz o esforço mínimo ${requiredEffort}.`,
      rejectedCandidates: input.candidates.map(candidate => ({
        routeId: candidate.routeId,
        reasons: rejected.get(candidate.routeId) ?? [],
      })),
    };
  }

  const lowestEffortRank = Math.min(...capable.map(candidate => effortRank[candidate.effort]));
  const minimum = capable.filter(candidate => {
    if (effortRank[candidate.effort] === lowestEffortRank) return true;
    rejected.set(candidate.routeId, ['higher_effort_than_needed']);
    return false;
  });
  const urgencyTieBreakApplied = ['time_sensitive', 'immediate'].includes(input.classification.urgency)
    && minimum.length > 1;
  const ordered = [...minimum].sort((left, right) => {
    if (urgencyTieBreakApplied) {
      const latency = latencyRank[left.latency] - latencyRank[right.latency];
      if (latency !== 0) return latency;
    }
    const priority = left.priority - right.priority;
    return priority !== 0 ? priority : left.routeId.localeCompare(right.routeId);
  });
  const selected = ordered[0]!;
  for (const candidate of ordered.slice(1)) rejected.set(candidate.routeId, ['tie_break_lost']);

  return {
    outcome: 'selected',
    decision: {
      schemaVersion: 1,
      policyVersion: 'work-routing-v1',
      capability: input.capability,
      requiredEffort,
      selected: {
        routeId: selected.routeId,
        executorId: selected.executorId,
        providerRef: selected.providerRef,
        modelRef: selected.modelRef,
        effort: selected.effort,
      },
      factors: {
        complexity: input.classification.complexity,
        risk: input.classification.risk,
        reversibility: input.classification.reversibility,
        planClarity: input.classification.planClarity,
        urgency: input.classification.urgency,
        urgencyTieBreakApplied,
      },
      rejectedCandidates: input.candidates
        .filter(candidate => candidate.routeId !== selected.routeId)
        .map(candidate => ({ routeId: candidate.routeId, reasons: rejected.get(candidate.routeId) ?? ['tie_break_lost'] })),
    },
  };
}
