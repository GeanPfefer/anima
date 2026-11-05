import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildConversationBrief,
  type BriefDecision,
  type BriefEvent,
  type BriefItem,
  type BriefRead,
  type ConversationBrief,
} from './conversation-brief';

// ============================================================
// ACC-01-E1 — leitores READ-ONLY do Chat Dev. Todos recebem o cliente Supabase
// AUTENTICADO do usuário (RLS é a autoridade); nunca service_role, nunca escrita,
// nunca payload de evento. Uma falha vira `{ kind: 'failed' }` — distinta de
// "nenhum registro" — para o modelo não confundir erro com ausência.
// ============================================================

export type UserClient = SupabaseClient<Database>;

export const OPEN_WORK_STATES = ['proposed', 'approved', 'in_progress', 'blocked', 'review', 'changes_requested'] as const;
const OPEN_WORK_READ_LIMIT = 30;
const EVENT_READ_LIMIT = 200;

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

function itemSummary(proposal: unknown, originalRequest: string): string {
  const summary = object(object(proposal).data).summary;
  return typeof summary === 'string' && summary.trim() ? summary : originalRequest;
}

export async function readRatifiedDecisions(client: UserClient, limit: number, status: 'ratified' | 'awaiting_confirmation' = 'ratified'): Promise<BriefRead<BriefDecision>> {
  try {
    const states = await client.from('project_decision_proposal_state')
      .select('id, version, statement, status, created_at')
      .eq('status', status).order('created_at', { ascending: false }).limit(limit + 1);
    if (states.error) return { kind: 'failed' };
    const rows = (states.data ?? []).flatMap(row => row.id && row.version && row.statement
      ? [{ id: row.id, version: row.version, statement: row.statement, createdAt: row.created_at ?? null }] : []);
    const truncated = rows.length > limit;
    const page = rows.slice(0, limit);
    const origins = new Map<string, { at: string | null; source: string | null }>();
    if (status === 'ratified' && page.length > 0) {
      const events = await client.from('project_decision_events')
        .select('proposal_id, proposal_version, created_at, provenance')
        .eq('event_type', 'ratified').in('proposal_id', page.map(row => row.id));
      if (events.error) return { kind: 'failed' };
      for (const event of events.data ?? []) {
        const source = object(event.provenance).source_message_id;
        origins.set(`${event.proposal_id}:${event.proposal_version}`, {
          at: event.created_at, source: typeof source === 'string' ? source : null,
        });
      }
    }
    return {
      kind: 'ok', truncated,
      rows: page.map(row => {
        const origin = origins.get(`${row.id}:${row.version}`);
        return {
          id: row.id, version: row.version, statement: row.statement,
          ratifiedAt: origin?.at ?? (status === 'ratified' ? null : row.createdAt),
          sourceMessageId: origin?.source ?? null,
        };
      }),
    };
  } catch {
    return { kind: 'failed' };
  }
}

export async function readOpenWork(client: UserClient, userId: string, states: readonly string[] = OPEN_WORK_STATES, limit = OPEN_WORK_READ_LIMIT): Promise<BriefRead<BriefItem>> {
  try {
    const result = await client.from('work_items')
      .select('id, state, capability, proposal_version, updated_at, proposal, original_request')
      .eq('user_id', userId).in('state', states as Database['public']['Enums']['work_state'][])
      .order('updated_at', { ascending: false }).limit(limit);
    if (result.error) return { kind: 'failed' };
    const rows = result.data ?? [];
    return {
      kind: 'ok', truncated: rows.length === limit,
      rows: rows.map(row => ({
        id: row.id, state: row.state, capability: row.capability, proposalVersion: row.proposal_version,
        updatedAt: row.updated_at, summary: itemSummary(row.proposal, row.original_request),
      })),
    };
  } catch {
    return { kind: 'failed' };
  }
}

/** Metadados de eventos (sem payload). */
export async function readWorkEvents(client: UserClient, itemIds: readonly string[], limit = EVENT_READ_LIMIT): Promise<BriefRead<BriefEvent>> {
  if (itemIds.length === 0) return { kind: 'ok', rows: [] };
  try {
    const result = await client.from('work_events')
      .select('work_item_id, event_type, author, created_at')
      .in('work_item_id', [...itemIds]).order('created_at', { ascending: false }).limit(limit);
    if (result.error) return { kind: 'failed' };
    const rows = result.data ?? [];
    return {
      kind: 'ok', truncated: rows.length === limit,
      rows: rows.map(row => ({ workItemId: row.work_item_id, eventType: row.event_type, author: row.author, createdAt: row.created_at })),
    };
  } catch {
    return { kind: 'failed' };
  }
}

export async function readFocus(client: UserClient, userId: string): Promise<string | null | 'failed'> {
  try {
    const result = await client.from('work_focus').select('work_item_id').eq('user_id', userId).maybeSingle();
    if (result.error) return 'failed';
    return result.data?.work_item_id ?? null;
  } catch {
    return 'failed';
  }
}

/** Instante da última resposta do assistente na sessão ativa; null = nenhuma. */
export async function readLastAssistantAt(client: UserClient, userId: string): Promise<string | null | 'failed'> {
  try {
    const session = await client.from('conversation_sessions').select('id')
      .eq('user_id', userId).is('archived_at', null).maybeSingle();
    if (session.error) return 'failed';
    if (!session.data) return null;
    const last = await client.from('ai_conversations').select('created_at')
      .eq('session_id', session.data.id).eq('role', 'assistant')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (last.error) return 'failed';
    return last.data?.created_at ?? null;
  } catch {
    return 'failed';
  }
}

export async function readConversationBrief(client: UserClient, userId: string, now: () => Date = () => new Date()): Promise<ConversationBrief> {
  const [decisions, items, focusItemId, lastAssistantAt] = await Promise.all([
    readRatifiedDecisions(client, 8),
    readOpenWork(client, userId),
    readFocus(client, userId),
    readLastAssistantAt(client, userId),
  ]);
  const ids = new Set<string>(items.kind === 'ok' ? items.rows.map(item => item.id) : []);
  const events = items.kind === 'ok' ? await readWorkEvents(client, [...ids]) : { kind: 'failed' as const };
  return buildConversationBrief({ generatedAt: now().toISOString(), decisions, items, events, focusItemId, lastAssistantAt });
}

/** Brief fail-closed: qualquer exceção vira um aviso honesto, nunca um brief inventado. */
export async function readConversationBriefSafe(client: UserClient, userId: string): Promise<string> {
  try {
    return (await readConversationBrief(client, userId)).text;
  } catch {
    return 'BRIEF DO PROJETO: indisponível (falha ao consultar). Não afirme decisões nem estados de trabalho; use as ferramentas de leitura ou diga que não conseguiu consultar.';
  }
}
