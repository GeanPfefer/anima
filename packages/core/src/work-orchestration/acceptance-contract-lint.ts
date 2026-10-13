import { readAutonomousExecutionSpec, type AutonomousValidationCriterion } from './eligibility';
import type { WorkItem } from './types';

export type AcceptanceContractLintCode =
  | 'covers_unknown_acceptance' | 'covers_noncanonical_text' | 'duplicate_cover'
  | 'acceptance_without_possible_proof' | 'gate_assertion_without_gate'
  | 'human_review_with_command' | 'no_automated_proof'
  | 'test_binding_files_outside_target_paths' | 'test_binding_command_not_jest' | 'test_binding_vacuous';
export interface AcceptanceContractLintFinding {
  readonly code: AcceptanceContractLintCode;
  readonly subject?: string;
  readonly detail: string;
}
const normalize = (text: string): string => text.normalize('NFKC').replace(/\s+/gu, ' ').trim();

/** Ordem estável: critérios/covers declarados, depois aceites, depois resumo. */
export function lintAcceptanceContract(expectedEffects: readonly string[], criteria: readonly AutonomousValidationCriterion[]): readonly AcceptanceContractLintFinding[] {
  const findings: AcceptanceContractLintFinding[] = [];
  const add = (code: AcceptanceContractLintCode, subject?: string): void => {
    findings.push({ code, ...(subject === undefined ? {} : { subject }), detail: `${code}${subject === undefined ? '' : `: ${subject}`}` });
  };
  const acceptance = new Set(expectedEffects);
  const normalized = new Set(expectedEffects.map(normalize));
  const seen = new Set<string>();
  const possible = new Set<string>();
  const automated = new Set<string>();
  for (const criterion of criteria) {
    const command = typeof criterion.command === 'string' && criterion.command.trim().length > 0;
    const proof = criterion.proof ?? (command ? 'gate' : 'declared');
    const automatic = proof === 'scope' || (proof === 'gate' && command && (criterion.claimKind === 'gate_assertion' || criterion.claimKind === 'test_binding'));
    if (criterion.claimKind === 'gate_assertion' && !(proof === 'gate' && command)) add('gate_assertion_without_gate', criterion.label);
    if (proof === 'human_review' && criterion.command !== undefined) add('human_review_with_command', criterion.label);
    if (criterion.claimKind === 'test_binding') {
      if (criterion.binding?.testFiles.some(file => !criterion.targetPaths?.includes(file))) add('test_binding_files_outside_target_paths', criterion.label);
      if (!/^npm (?:test|run test)(?:\s|$)/.test(criterion.command ?? '')) add('test_binding_command_not_jest', criterion.label);
      if (!(criterion.binding?.minNewTests ?? 0) && !criterion.binding?.boundTests?.length) add('test_binding_vacuous', criterion.label);
    }
    for (const covered of criterion.covers ?? []) {
      if (!acceptance.has(covered)) {
        add('covers_unknown_acceptance', covered);
        if (normalized.has(normalize(covered))) add('covers_noncanonical_text', covered);
      } else {
        if (seen.has(covered)) add('duplicate_cover', covered);
        seen.add(covered);
        if (automatic || proof === 'human_review') possible.add(covered);
        if (automatic) automated.add(covered);
      }
    }
  }
  for (const approved of acceptance) if (!possible.has(approved)) add('acceptance_without_possible_proof', approved);
  if (acceptance.size > 0 && automated.size === 0) add('no_automated_proof');
  return findings;
}

export function lintItemAcceptanceContract(item: WorkItem): { readonly mode: 'v2' | 'legacy'; readonly findings: readonly AcceptanceContractLintFinding[] } {
  const raw = item.intent['execution_spec'];
  const mode = raw !== null && typeof raw === 'object' && !Array.isArray(raw) && raw?.['acceptance_contract'] === 2 ? 'v2' : 'legacy';
  return { mode, findings: lintAcceptanceContract(item.proposal.data.expectedEffects, readAutonomousExecutionSpec(item.intent)?.validationCriteria ?? []) };
}
