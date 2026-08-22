import {
  validateWorkIntelligenceClassification,
  type AutonomousQueueCandidate,
  type WorkClaim,
  type WorkIntelligenceClassificationV1,
  type WorkItem,
} from '@anima/core';
import { mapWorkItem } from '@anima/supabase';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================================
// Fotografia do backlog do usuário como `AutonomousQueueCandidate[]` — a entrada
// que a POLÍTICA pura (`planAutonomousBacklogTurn`/`projectAutonomousQueue`)
// consome. Nada no app vivo construía isso: a fila era computada só em SQL
// (`autonomous_work_queue`). Esta projeção NÃO é autoridade de exclusão nem de
// seleção — o banco continua sendo. Ela alimenta a DECISÃO de laço (executar vs
// parar + razão); uma eventual divergência com o SQL é SEGURA: no pior caso o
// driver tenta uma volta que o servidor recusa, ou para uma invocação cedo.
//
// Fail-closed por item: uma linha que não mapeia sai do backlog (não vira
// candidato), nunca derruba a leitura inteira.
// ============================================================

// Estados NÃO-terminais: a política precisa de TODOS (não só os elegíveis) para
// contar `pending` (running/awaitingHuman/blocked) e explicar a parada.
const NON_TERMINAL_STATES = [
  'proposed', 'approved', 'in_progress', 'blocked', 'review', 'changes_requested',
] satisfies Database['public']['Enums']['work_state'][];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Lê o backlog não-terminal do usuário (RLS escopa ao dono) e monta os
 * candidatos: item + classificação vigente + aprovação vigente + claim em aberto.
 * Read-only e idempotente. Uma falha de leitura devolve `[]` (fail-closed: sem
 * candidatos ⇒ o driver para em `no_eligible_work`, nunca executa às cegas).
 */
export async function readAutonomousBacklogCandidates(
  client: SupabaseClient<Database>,
): Promise<readonly AutonomousQueueCandidate[]> {
  const itemsRes = await client.from('work_items').select('*').in('state', NON_TERMINAL_STATES);
  if (itemsRes.error || !itemsRes.data) return [];

  const items: WorkItem[] = [];
  for (const row of itemsRes.data) {
    try { items.push(mapWorkItem(row)); } catch { /* linha inválida sai do backlog */ }
  }
  if (items.length === 0) return [];
  const ids = items.map(item => item.id);

  // Aprovação vigente: o `work_approved` de maior `seq` por item (ordem única do log).
  const approvalsRes = await client.from('work_events')
    .select('work_item_id, seq, proposal_version, created_at')
    .eq('event_type', 'work_approved')
    .in('work_item_id', ids)
    .order('seq', { ascending: false });
  const latestApproval = new Map<string, { seq: number; approvedAt: Date; proposalVersion: number }>();
  for (const ev of approvalsRes.data ?? []) {
    if (latestApproval.has(ev.work_item_id)) continue; // ordenado desc ⇒ o primeiro é o maior seq
    if (ev.proposal_version === null) continue;
    latestApproval.set(ev.work_item_id, {
      seq: ev.seq, approvedAt: new Date(ev.created_at), proposalVersion: ev.proposal_version,
    });
  }

  // Claim em aberto (não liberado). O índice único parcial garante no máximo um por item.
  const claimsRes = await client.from('work_claims').select('*').is('released_at', null).in('work_item_id', ids);
  const openClaim = new Map<string, WorkClaim>();
  for (const row of claimsRes.data ?? []) {
    openClaim.set(row.work_item_id, {
      claimId: row.id,
      workItemId: row.work_item_id,
      approvedProposalVersion: row.approved_proposal_version,
      ownerInstanceId: row.owner_instance_id,
      acquiredAt: new Date(row.acquired_at),
      expiresAt: new Date(row.expires_at),
      attemptId: row.attempt_id,
      release: null, // filtrado por released_at IS NULL
    });
  }

  const candidates: AutonomousQueueCandidate[] = [];
  for (const item of items) {
    // Classificação vigente pela RPC canônica (reconstrói a revisão corrente).
    const clsRes = await client.rpc('current_work_intelligence_classification', { p_work_item_id: item.id });
    let currentClassification: WorkIntelligenceClassificationV1 | null = null;
    const root = clsRes.error ? null : clsRes.data;
    const raw = isRecord(root) ? root['classification'] : null;
    if (raw != null && validateWorkIntelligenceClassification(raw) === null) {
      currentClassification = raw as unknown as WorkIntelligenceClassificationV1;
    }
    candidates.push({
      item,
      currentClassification,
      approval: latestApproval.get(item.id) ?? null,
      openClaim: openClaim.get(item.id) ?? null,
    });
  }
  return candidates;
}
