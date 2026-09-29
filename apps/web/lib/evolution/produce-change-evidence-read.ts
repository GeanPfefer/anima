import {
  projectProduceChangeOperationalEvidence,
  type ProduceChangeLineageLinkV0,
  type ProduceChangeOperationalEvidenceV0,
  type ProduceChangeWorkItemFactsV0,
} from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readCanonicalWorkHistory, type CanonicalWorkHistoryFailure } from './capability-assessment-read';

// ============================================================
// Trusted System Evidence Boundary V0 (2026-09-29) — leitura canônica da projeção de
// produce-change. A fronteira `trustedSystemEvidenceSince` NUNCA vem do chamador nem de
// configuração: é lida do banco (`trusted_system_evidence_since()`, derivada do registro do
// writer e da ativação do guard de exclusividade — migração 20260929000000). Falha ao ler a
// fronteira fecha a leitura com razão própria: nunca vira `null` silencioso nem valor inventado.
// Isolamento: RLS do usuário (o dono); nenhum service_role.
// ============================================================

const PAGE_SIZE = 500;

export type TrustedSystemEvidenceSinceResult =
  | { readonly ok: true; readonly since: string | null }
  | { readonly ok: false; readonly reason: 'trusted_boundary_read_failed' };

/** Fronteira de evidência system_proven do dono autenticado; `null` = sem writer ativo. */
export async function readTrustedSystemEvidenceSince(
  client: SupabaseClient<Database>,
): Promise<TrustedSystemEvidenceSinceResult> {
  const result = await client.rpc('trusted_system_evidence_since');
  if (result.error) return { ok: false, reason: 'trusted_boundary_read_failed' };
  if (result.data === null) return { ok: true, since: null };
  if (typeof result.data !== 'string' || !Number.isFinite(Date.parse(result.data))) {
    return { ok: false, reason: 'trusted_boundary_read_failed' };
  }
  return { ok: true, since: ceilToMillisecond(result.data) };
}

/**
 * O banco tem microssegundos; `Date` tem milissegundos e TRUNCA. Truncar anteciparia a fronteira
 * (um fato de antes do registro do writer poderia cair dentro dela): arredonda para CIMA.
 */
function ceilToMillisecond(timestamp: string): string {
  const floor = Date.parse(timestamp);
  const fraction = /\.(\d+)/.exec(timestamp)?.[1] ?? '';
  return new Date(/[1-9]/.test(fraction.slice(3)) ? floor + 1 : floor).toISOString();
}

export type ProduceChangeEvidenceReadFailure =
  | CanonicalWorkHistoryFailure
  | 'work_items_read_failed'
  | 'recovery_lineage_read_failed'
  | 'trusted_boundary_read_failed';

export type ProduceChangeEvidenceReadResult =
  | {
      readonly ok: true;
      /** Fronteira efetivamente usada (auditoria): a mesma lida do banco. */
      readonly trustedSystemEvidenceSince: string | null;
      readonly projection: ProduceChangeOperationalEvidenceV0;
    }
  | { readonly ok: false; readonly reason: ProduceChangeEvidenceReadFailure };

async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[] | null> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const result = await page(from, from + PAGE_SIZE - 1);
    if (result.error || result.data === null) return null;
    rows.push(...result.data);
    if (result.data.length < PAGE_SIZE) return rows;
  }
}

/** Projeção de produce-change sobre o histórico real, com a fronteira confiável do banco. */
export async function readProduceChangeOperationalEvidence(
  client: SupabaseClient<Database>,
): Promise<ProduceChangeEvidenceReadResult> {
  const history = await readCanonicalWorkHistory(client);
  if (!history.ok) return { ok: false, reason: history.reason };

  const items = await readAll((from, to) => client.from('work_items')
    .select('id,capability,impact_level,intent').order('id', { ascending: true }).range(from, to));
  if (items === null) return { ok: false, reason: 'work_items_read_failed' };

  const links = await readAll((from, to) => client.from('work_recovery_lineage')
    .select('original_work_item_id,successor_work_item_id,recovery_sequence')
    .order('successor_work_item_id', { ascending: true }).range(from, to));
  if (links === null) return { ok: false, reason: 'recovery_lineage_read_failed' };

  const boundary = await readTrustedSystemEvidenceSince(client);
  if (!boundary.ok) return { ok: false, reason: boundary.reason };

  const facts: ProduceChangeWorkItemFactsV0[] = items.map(item => ({
    id: item.id, capability: item.capability, impactLevel: item.impact_level, intent: item.intent,
  }));
  const lineageLinks: ProduceChangeLineageLinkV0[] = links.map(link => ({
    originalWorkItemId: link.original_work_item_id,
    successorWorkItemId: link.successor_work_item_id,
    recoverySequence: link.recovery_sequence,
  }));

  return {
    ok: true,
    trustedSystemEvidenceSince: boundary.since,
    projection: projectProduceChangeOperationalEvidence({
      events: history.events, items: facts, lineageLinks, trustedSystemEvidenceSince: boundary.since,
    }),
  };
}
