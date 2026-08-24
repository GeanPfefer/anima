import { interpretProjectConversationGovernance, presentProjectDecisionProposal, type PendingProjectDecision } from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

type Result = { readonly text: string; readonly sourceMessageId: string; readonly kind: 'proposal' | 'ratified' | 'rejected' | 'changes_requested' | 'clarification' };

const resultObject = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

async function sourceMessage(client: SupabaseClient<Database>, userId: string, content: string, retryMessageId?: string): Promise<string> {
  if (retryMessageId) {
    const existing = await client.from('ai_conversations').select('id').eq('id', retryMessageId).eq('user_id', userId).eq('role', 'user').maybeSingle();
    if (existing.data) return existing.data.id;
  }
  const inserted = await client.from('ai_conversations').insert({ user_id: userId, role: 'user', content }).select('id').single();
  if (!inserted.data) throw new Error('project_governance_source_message_failed');
  return inserted.data.id;
}

export async function processProjectConversationGovernance(input: {
  readonly client: SupabaseClient<Database>;
  readonly userId: string;
  readonly message: string;
  readonly retryMessageId?: string;
}): Promise<Result | null> {
  const pendingRead = await input.client.from('project_decision_proposal_state')
    .select('id, version, statement').eq('status', 'awaiting_confirmation').order('created_at', { ascending: false }).limit(10);
  if (pendingRead.error) throw new Error('project_governance_pending_read_failed');
  const pending: PendingProjectDecision[] = (pendingRead.data ?? []).flatMap(row => row.id && row.version && row.statement
    ? [{ id: row.id, version: row.version, statement: row.statement }] : []);
  const intent = interpretProjectConversationGovernance({ message: input.message, pending });
  if (intent.kind === 'conversation') return null;
  const sourceId = await sourceMessage(input.client, input.userId, input.message, input.retryMessageId);
  if (intent.kind === 'clarification_required') return {
    kind: 'clarification', sourceMessageId: sourceId,
    text: `Há mais de uma proposta aguardando confirmação. Diga qual delas deseja decidir:\n${intent.proposals.map(p => `- ${p.id} — ${p.statement}`).join('\n')}`,
  };
  if (intent.kind === 'propose') {
    const created = await input.client.rpc('create_project_decision_proposal', {
      statement: intent.statement, rationale: '', constraints: [], implications: [], alternatives: [], uncertainties: [],
      provenance: { source: 'human_expression', source_message_id: sourceId, authority: 'user_preference' },
      idempotency_key: `proposal:${sourceId}`, supersedes_id: undefined,
    });
    if (created.error) throw new Error('project_governance_proposal_failed');
    const value = resultObject(created.data);
    const proposal: PendingProjectDecision = { id: String(value.proposal_id), version: Number(value.version), statement: intent.statement };
    return { kind: 'proposal', sourceMessageId: sourceId, text: presentProjectDecisionProposal(proposal) };
  }
  const outcome = intent.kind === 'ratify' ? 'ratified' : intent.kind === 'reject' ? 'rejected' : 'changes_requested';
  const resolved = await input.client.rpc('resolve_project_decision_proposal', {
    proposal_id: intent.proposal.id, expected_version: intent.proposal.version, outcome,
    idempotency_key: `${outcome}:${sourceId}`, provenance: { source: 'human_confirmation', source_message_id: sourceId, actor: 'user' },
  });
  if (resolved.error) throw new Error('project_governance_resolution_failed');
  return {
    kind: outcome, sourceMessageId: sourceId,
    text: outcome === 'ratified' ? 'Decisão ratificada e registrada. Nenhuma ação operacional foi iniciada.'
      : outcome === 'rejected' ? 'Proposta rejeitada. Nenhuma decisão foi ratificada.'
      : 'Entendi o pedido de revisão. A versão anterior não foi ratificada; formule a direção revisada para uma nova confirmação.',
  };
}
