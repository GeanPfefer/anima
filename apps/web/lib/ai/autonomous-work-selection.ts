import {
  resolveAutonomousWorkSelection,
  type AutonomousChatWorkSelection,
  type AutonomousSelectionObservedItem,
} from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readAutonomousBacklogCandidates } from '@/lib/work-orchestration/autonomous-backlog-read';

const normalize = (value: string): string => value.toLocaleLowerCase('pt-BR')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export type AutonomousWorkChatIntent = 'inspect' | 'execute';

/** Mandato estreito: consulta ou execução explícita de self-development no Dev. */
export function resolveAutonomousWorkChatIntent(message: string): AutonomousWorkChatIntent | null {
  const value = normalize(message.trim());
  const asksSelection = /\b(?:identifique|selecione|escolha|determine|resolva)\b/.test(value)
    && /\bproxim[oa]\b/.test(value);
  const asksAutonomy = /\b(?:sozinh[oa]|autonom[oa]|autonomamente|automaticamente)\b/.test(value);
  const isDevelopmentWork = /\b(?:work item|trabalho|self-development|autodesenvolvimento|desenvolvimento do anima|desenvolvendo o anima)\b/.test(value);
  const explicitExecution = /\b(?:execute|executar|rode|rodar|continue|continuar|prossiga|prosseguir|inicie|iniciar)\b/.test(value)
    && /\b(?:ciclo|item|trabalho|self-development|autodesenvolvimento|desenvolvimento do anima|anima)\b/.test(value);
  if (explicitExecution && isDevelopmentWork) return 'execute';
  if (asksSelection && asksAutonomy && isDevelopmentWork) return 'inspect';
  return null;
}

export const isAutonomousWorkSelectionRequest = (message: string): boolean =>
  resolveAutonomousWorkChatIntent(message) !== null;

export type AutonomousExecutionAdmission =
  | { readonly outcome: 'admitted'; readonly eventId: string; readonly replayed: boolean }
  | { readonly outcome: 'stale' }
  | { readonly outcome: 'human_decision_required'; readonly reason: string };

/** Mesma admission RPC do cartão. Não cria claim/attempt e não chama executor. */
export async function admitSelectedAutonomousWork(
  client: SupabaseClient<Database>, workItemId: string, proposalVersion: number, requestId: string,
): Promise<AutonomousExecutionAdmission> {
  const result = await client.rpc('request_autonomous_execution', {
    p_work_item_id: workItemId,
    p_expected_proposal_version: proposalVersion,
    p_request_id: requestId,
  });
  if (!result.error) {
    const value = result.data as { eventId?: unknown; replayed?: unknown } | null;
    if (typeof value?.eventId !== 'string') return { outcome: 'human_decision_required', reason: 'admission_receipt_invalid' };
    return { outcome: 'admitted', eventId: value.eventId, replayed: value.replayed === true };
  }
  if (result.error.code === '55000' || /not eligible/i.test(result.error.message)) return { outcome: 'stale' };
  return { outcome: 'human_decision_required', reason: result.error.code || 'admission_refused' };
}

export async function selectAutonomousWorkForChat(
  client: SupabaseClient<Database>,
  userId: string,
  now = new Date(),
): Promise<AutonomousChatWorkSelection> {
  const [candidates, itemsResult, lineageResult] = await Promise.all([
    readAutonomousBacklogCandidates(client),
    client.from('work_items').select('id, state, capability, created_at')
      .eq('user_id', userId).order('created_at', { ascending: true }).limit(200),
    client.from('work_recovery_lineage')
      .select('original_work_item_id, successor_work_item_id, recovery_sequence')
      .eq('user_id', userId).order('recovery_sequence', { ascending: true }).limit(500),
  ]);
  if (itemsResult.error || lineageResult.error) throw new Error('autonomous_selection_projection_unavailable');

  const observed = new Map<string, AutonomousSelectionObservedItem>();
  for (const row of itemsResult.data ?? []) observed.set(row.id, {
    id: row.id, state: row.state, capability: row.capability, createdAt: new Date(row.created_at),
  });
  // O limite da fotografia histórica nunca pode esconder um item da fila atual.
  for (const candidate of candidates) if (!observed.has(candidate.item.id)) observed.set(candidate.item.id, {
    id: candidate.item.id, state: candidate.item.state, capability: candidate.item.capability, createdAt: candidate.item.createdAt,
  });

  const decision = resolveAutonomousWorkSelection({
    candidates,
    observedItems: [...observed.values()],
    lineage: (lineageResult.data ?? []).map(row => ({
      predecessorId: row.original_work_item_id,
      successorId: row.successor_work_item_id,
      recoverySequence: row.recovery_sequence,
    })),
    now,
  });
  console.info('[autonomous-work-selection]', {
    outcome: decision.outcome,
    consideredIds: decision.evidence.consideredIds,
    eliminated: decision.evidence.eliminated,
    selectedId: decision.evidence.selectedId,
    policy: decision.evidence.policy,
    humanDecisionRequired: decision.evidence.humanDecisionRequired,
  });
  return decision;
}

export function renderAutonomousWorkSelection(decision: AutonomousChatWorkSelection): string {
  if (decision.outcome === 'selected') {
    return `Selecionei autonomamente o Work Item canônico elegível ${decision.workItemId}. Critério: ${decision.rationale.policy} (posição ${decision.rationale.selectedPosition} de ${decision.rationale.queueSize} na fila elegível).`;
  }
  if (decision.outcome === 'human_decision_required') {
    return `Não há Work Item diretamente executável. A fronteira atual realmente exige decisão humana nos itens: ${decision.workItemIds.join(', ')}.`;
  }
  const reason = decision.reason === 'waiting_for_targets'
    ? 'os alvos elegíveis estão ocupados'
    : decision.reason === 'invalid_queue'
      ? 'a projeção da fila falhou fechada por inconsistência'
      : 'nenhum item satisfaz a elegibilidade canônica atual';
  return `Nenhum Work Item pode ser selecionado agora: ${reason}. Não vou retomar um predecessor histórico nem inventar trabalho.`;
}
