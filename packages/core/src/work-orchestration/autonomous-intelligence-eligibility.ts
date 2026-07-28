import type {
  AutonomousEligibilityEvaluation,
  AutonomousExecutionSpecV1,
} from './eligibility';
import {
  validateWorkIntelligenceClassification,
  type ClassificationReadiness,
  type WorkIntelligenceClassificationAxis,
  type WorkIntelligenceClassificationV1,
} from './work-intelligence-classification';

export type AutonomousIntelligenceIneligibilityReason =
  | 'auto_01_ineligible'
  | 'work_intelligence_classification_missing'
  | 'work_intelligence_classification_incomplete';

export type AutonomousIntelligenceEligibility =
  | {
      readonly eligible: true;
      readonly spec: AutonomousExecutionSpecV1;
      readonly classification: WorkIntelligenceClassificationV1;
    }
  | {
      readonly eligible: false;
      readonly reason: 'auto_01_ineligible';
      readonly auto01: Extract<AutonomousEligibilityEvaluation, { eligible: false }>;
    }
  | {
      readonly eligible: false;
      readonly reason: 'work_intelligence_classification_missing';
      readonly unknownAxes: readonly [];
    }
  | {
      readonly eligible: false;
      readonly reason: 'work_intelligence_classification_incomplete';
      readonly unknownAxes: readonly WorkIntelligenceClassificationAxis[];
    };

export interface AutonomousIntelligenceEligibilityInput {
  readonly auto01: AutonomousEligibilityEvaluation;
  readonly currentClassification: WorkIntelligenceClassificationV1 | null;
  readonly readiness: ClassificationReadiness | null;
}

/**
 * Compõe o AUTO-01 com o gate do INTEL-01 sem alterar o parser do
 * `execution_spec`. Bloqueios anteriores prevalecem; inteligência só é
 * consultada quando o contrato base já permite execução autônoma.
 */
export function evaluateAutonomousIntelligenceEligibility(
  input: AutonomousIntelligenceEligibilityInput,
): AutonomousIntelligenceEligibility {
  if (!input.auto01.eligible) {
    return { eligible: false, reason: 'auto_01_ineligible', auto01: input.auto01 };
  }
  if (
    input.currentClassification === null
    || validateWorkIntelligenceClassification(input.currentClassification) !== null
    || input.readiness === null
  ) {
    return {
      eligible: false,
      reason: 'work_intelligence_classification_missing',
      unknownAxes: [],
    };
  }
  if (!input.readiness.ready) {
    return {
      eligible: false,
      reason: 'work_intelligence_classification_incomplete',
      unknownAxes: input.readiness.unknownAxes,
    };
  }
  return {
    eligible: true,
    spec: input.auto01.spec,
    classification: input.currentClassification,
  };
}
