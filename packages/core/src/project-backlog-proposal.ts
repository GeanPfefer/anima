import { isValidWorkIntent, isValidWorkProposal, type WorkCapability, type WorkImpactLevel, type WorkIntent, type WorkProposal } from './work-orchestration';

export type ProjectBacklogProposalStatus = 'awaiting_confirmation' | 'changes_requested' | 'materialized';

export interface ProjectBacklogSlice {
  readonly sliceKey: string;
  readonly summary: string;
  readonly objective: string;
  readonly impactLevel: WorkImpactLevel;
  readonly capability: WorkCapability;
  readonly intent: WorkIntent;
  readonly proposal: WorkProposal;
  readonly dependencies: readonly string[];
}

export interface ProjectBacklogProposalDraft {
  readonly objective: string;
  readonly slices: readonly ProjectBacklogSlice[];
  readonly rationale: string;
  readonly exclusions: readonly string[];
  readonly uncertainties: readonly string[];
}

const nonBlank = (value: string): boolean => value.trim().length > 0;
const unique = (values: readonly string[]): boolean => new Set(values).size === values.length;

export function validateProjectBacklogProposalDraft(value: ProjectBacklogProposalDraft): string | null {
  if (!nonBlank(value.objective)) return 'objective_invalid';
  if (value.slices.length < 1 || value.slices.length > 12) return 'slice_count_invalid';
  if (!unique(value.slices.map(slice => slice.sliceKey))) return 'slice_key_duplicate';
  const keys = new Set(value.slices.map(slice => slice.sliceKey));
  for (const slice of value.slices) {
    if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(slice.sliceKey)) return 'slice_key_invalid';
    if (!nonBlank(slice.summary) || !nonBlank(slice.objective)) return 'slice_text_invalid';
    if (!isValidWorkIntent(slice.intent) || !isValidWorkProposal(slice.proposal)) return 'slice_work_contract_invalid';
    if (!unique(slice.dependencies) || slice.dependencies.some(dep => dep === slice.sliceKey || !keys.has(dep))) return 'slice_dependencies_invalid';
  }
  return null;
}

const normalize = (value: string): string => value.trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
const confirmation = /^(?:pode registrar isso no backlog|pode criar esses trabalhos|sim,? coloca no backlog|pode registrar|assim esta bom,? pode registrar)[.!]?$/;

export const isProjectBacklogMaterializationConfirmation = (message: string): boolean => confirmation.test(normalize(message));

export type ProjectBacklogConversationIntent =
  | { readonly kind: 'conversation' }
  | { readonly kind: 'materialize' }
  | { readonly kind: 'request_changes'; readonly requestedChanges: string };

export function interpretProjectBacklogConversation(message: string, hasOnePending: boolean): ProjectBacklogConversationIntent {
  const normalized = normalize(message);
  if (!hasOnePending) return { kind: 'conversation' };
  if (isProjectBacklogMaterializationConfirmation(message)) return { kind: 'materialize' };
  if (/^(?:tira|remove|divide|inclui|nao quero|isso nao e prioridade)\b/.test(normalized)) return { kind: 'request_changes', requestedChanges: message.trim() };
  return { kind: 'conversation' };
}

export function presentProjectBacklogProposal(draft: ProjectBacklogProposalDraft): string {
  const items = draft.slices.map((slice, index) => `${index + 1}. ${slice.summary}`).join('\n');
  return `Para transformar essa decisão em trabalho, proponho estes recortes:\n\n${items}\n\nQuer que eu registre esses trabalhos no backlog?`;
}
