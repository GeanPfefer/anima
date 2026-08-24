import { interpretProjectBacklogConversation, presentProjectBacklogProposal, validateProjectBacklogProposalDraft, type ProjectBacklogProposalDraft } from '@anima/core';

export interface RatifiedProjectDecisionRef { readonly id: string; readonly version: number; readonly statement: string }
export interface PendingProjectBacklogRef { readonly id: string; readonly version: number }

export interface ProjectBacklogGovernanceDeps {
  readonly formulate: (decision: RatifiedProjectDecisionRef) => Promise<ProjectBacklogProposalDraft | { readonly noWorkRequired: true; readonly rationale: string }>;
  readonly persistHumanMessage: (message: string) => Promise<string>;
  readonly createProposal: (input: { readonly decision: RatifiedProjectDecisionRef; readonly draft: ProjectBacklogProposalDraft; readonly provenance: { readonly source: 'system_derivation'; readonly sourceDecisionId: string; readonly sourceDecisionVersion: number } }) => Promise<{ readonly id: string; readonly version: number }>;
  readonly requestChanges: (input: { readonly proposal: PendingProjectBacklogRef; readonly sourceMessageId: string; readonly requestedChanges: string }) => Promise<void>;
  readonly materialize: (input: { readonly proposal: PendingProjectBacklogRef; readonly confirmationMessageId: string; readonly provenance: { readonly source: 'human_confirmation'; readonly actor: 'user' } }) => Promise<readonly string[]>;
}

export type ProjectBacklogGovernanceResult =
  | { readonly kind: 'conversation' }
  | { readonly kind: 'no_work_required'; readonly text: string }
  | { readonly kind: 'proposal'; readonly proposalId: string; readonly version: number; readonly text: string }
  | { readonly kind: 'changes_requested'; readonly text: string }
  | { readonly kind: 'rejected' | 'clarification'; readonly text: string }
  | { readonly kind: 'materialized'; readonly workItemIds: readonly string[]; readonly text: string };

export async function processProjectBacklogGovernance(input: {
  readonly message: string;
  readonly pending: readonly PendingProjectBacklogRef[];
  /** Só é fornecida pelo host no mesmo turno em que a decisão foi realmente ratificada. */
  readonly ratifiedDecisionThisTurn?: RatifiedProjectDecisionRef;
}, deps: ProjectBacklogGovernanceDeps): Promise<ProjectBacklogGovernanceResult> {
  if (input.pending.length > 1) return { kind: 'conversation' };
  const pending = input.pending[0];
  if (pending) {
    const intent = interpretProjectBacklogConversation(input.message, true);
    if (intent.kind === 'conversation') return { kind: 'conversation' };
    if(intent.kind==='clarification_required') return {kind:'clarification',text:'Você quer revisar apenas os trabalhos propostos, sem alterar a decisão ratificada?'};
    if(intent.kind==='reject') return {kind:'rejected',text:'Entendi. Não vou registrar nem materializar essa proposta de backlog.'};
    const sourceMessageId = await deps.persistHumanMessage(input.message);
    if (intent.kind === 'request_changes') {
      await deps.requestChanges({ proposal: pending, sourceMessageId, requestedChanges: intent.requestedChanges });
      return { kind: 'changes_requested', text: 'Entendi. A versão atual não será registrada; vou preparar uma proposta revisada para nova confirmação.' };
    }
    const workItemIds = await deps.materialize({ proposal: pending, confirmationMessageId: sourceMessageId, provenance: { source: 'human_confirmation', actor: 'user' } });
    return { kind: 'materialized', workItemIds, text: `Registrei ${workItemIds.length} trabalho${workItemIds.length === 1 ? '' : 's'} como proposta no backlog. Nenhum foi aprovado ou iniciado.` };
  }
  if (!input.ratifiedDecisionThisTurn) return { kind: 'conversation' };
  const draft = await deps.formulate(input.ratifiedDecisionThisTurn);
  if ('noWorkRequired' in draft) {
    if (!draft.rationale.trim()) throw new Error('project_backlog_no_work_rationale_required');
    return { kind: 'no_work_required', text: `Não identifiquei trabalho novo necessário para aplicar essa decisão: ${draft.rationale}` };
  }
  const issue = validateProjectBacklogProposalDraft(draft);
  if (issue) throw new Error(`project_backlog_proposal_invalid:${issue}`);
  const created = await deps.createProposal({
    decision: input.ratifiedDecisionThisTurn, draft,
    provenance: { source: 'system_derivation', sourceDecisionId: input.ratifiedDecisionThisTurn.id, sourceDecisionVersion: input.ratifiedDecisionThisTurn.version },
  });
  return { kind: 'proposal', proposalId: created.id, version: created.version, text: presentProjectBacklogProposal(draft) };
}
