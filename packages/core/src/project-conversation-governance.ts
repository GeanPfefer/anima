export type ProjectDecisionProposalStatus = 'awaiting_confirmation' | 'ratified' | 'rejected' | 'changes_requested';

export type PendingProjectDecision = {
  readonly id: string;
  readonly version: number;
  readonly statement: string;
};

export type ProjectConversationGovernanceIntent =
  | { readonly kind: 'conversation'; readonly phase: 'exploration' | 'hypothesis' | 'preference' | 'unrelated' }
  | { readonly kind: 'propose'; readonly statement: string }
  | { readonly kind: 'ratify'; readonly proposal: PendingProjectDecision }
  | { readonly kind: 'reject'; readonly proposal: PendingProjectDecision }
  | { readonly kind: 'request_changes'; readonly proposal: PendingProjectDecision; readonly requestedChanges: string }
  | { readonly kind: 'clarification_required'; readonly proposals: readonly PendingProjectDecision[] };

const normalized = (value: string) => value.trim().replace(/\s+/g, ' ');
const lower = (value: string) => normalized(value).toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const confirmation = /^(?:sim|isso|pode registrar|e exatamente isso|concordo)[.!]?$/;
const rejection = /^(?:nao|nao e isso|prefiro nao decidir isso agora|descarta essa ideia)[.!]?$/;
const revision = /^(?:quase[,;:]?|nao foi isso que eu quis dizer[.;:]?|troca essa parte[.;:]?)(.*)$/;
const uncertain = /\b(?:talvez|nao sei|estou pensando|quem sabe|poderia)\b/;
const exploratory = /\?|^(?:e se|sera que|voce acha|quais seriam|o que acha)/;
const preference = /^(?:eu prefiro|prefiro|quero manter|acho melhor|decidi que|vamos manter)\b/;

const onePending = (pending: readonly PendingProjectDecision[]): PendingProjectDecision | null => pending.length === 1 ? pending[0]! : null;

export const isProjectDecisionConfirmation = (message: string): boolean => confirmation.test(lower(message));

export function interpretProjectConversationGovernance(input: {
  readonly message: string;
  readonly pending: readonly PendingProjectDecision[];
}): ProjectConversationGovernanceIntent {
  const message = normalized(input.message);
  const value = lower(message);
  const choose = (): PendingProjectDecision | ProjectConversationGovernanceIntent => onePending(input.pending)
    ?? (input.pending.length > 1 ? { kind: 'clarification_required', proposals: input.pending } : { kind: 'conversation', phase: 'unrelated' });
  if (confirmation.test(value)) {
    const selected = choose();
    return 'id' in selected ? { kind: 'ratify', proposal: selected } : selected;
  }
  if (rejection.test(value)) {
    const selected = choose();
    return 'id' in selected ? { kind: 'reject', proposal: selected } : selected;
  }
  const change = value.match(revision);
  if (change) {
    const selected = choose();
    return 'id' in selected ? { kind: 'request_changes', proposal: selected, requestedChanges: message } : selected;
  }
  if (exploratory.test(value)) return { kind: 'conversation', phase: 'exploration' };
  if (uncertain.test(value)) return { kind: 'conversation', phase: 'hypothesis' };
  if (preference.test(value) && message.length >= 24) return { kind: 'propose', statement: message };
  if (/\b(?:prefiro|preferencia|direcao)\b/.test(value)) return { kind: 'conversation', phase: 'preference' };
  return { kind: 'conversation', phase: 'unrelated' };
}

export const presentProjectDecisionProposal = (proposal: PendingProjectDecision): string =>
  `Só para confirmar: você quer registrar como direção do projeto: “${proposal.statement}”. É isso?`;
