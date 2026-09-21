import {
  detectSelfDeficiencies,
  readSelfDeficiencyIdFromIntent,
  resolveSelfDeficiencyLifecycle,
  type SelfDeficiencyCoverage,
  type SelfDeficiencyV0,
} from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readCanonicalWorkHistory, type CanonicalWorkHistoryFailure } from './capability-assessment-read';

// ============================================================
// Read-model server-side de SELF-DEFICIENCY V0 (READ-ONLY).
//
// Reusa o carregador canônico único (`readCanonicalWorkHistory`, com as proteções
// do incidente 51929) e as primitivas PURAS do core (detecção determinística +
// ciclo de vida). A cobertura (dedup contra trabalho existente) vem dos próprios
// work_items que carregam `self_deficiency_provenance.deficiencyId` no intent —
// o MESMO padrão de correlação estável do canonical-materializer.
//
// NÃO cria trabalho, NÃO aprova, NÃO persiste — projeção de leitura sob RLS.
// ============================================================

export type SelfDeficiencyReadResult =
  | {
      readonly ok: true;
      readonly deficiencies: readonly SelfDeficiencyV0[];
      readonly eventCount: number;
    }
  | { readonly ok: false; readonly reason: CanonicalWorkHistoryFailure | 'coverage_read_failed' };

const COVERAGE_PAGE_SIZE = 500;

type CoverageRow = Pick<
  Database['public']['Tables']['work_items']['Row'],
  'id' | 'state' | 'updated_at' | 'intent'
>;

async function readAllSelfDeficiencyCoverageRows(
  client: SupabaseClient<Database>,
): Promise<readonly CoverageRow[] | null> {
  const rows: CoverageRow[] = [];
  for (let from = 0; ; from += COVERAGE_PAGE_SIZE) {
    const result = await client.from('work_items')
      .select('id,state,updated_at,intent')
      .order('id', { ascending: true })
      .range(from, from + COVERAGE_PAGE_SIZE - 1);
    if (result.error || result.data === null) return null;
    rows.push(...result.data);
    if (result.data.length < COVERAGE_PAGE_SIZE) return rows;
  }
}

/**
 * Projeta as deficiências próprias do histórico do usuário, já com o ciclo de
 * vida resolvido contra o trabalho governado que as cobre. Fail-closed: um
 * histórico incompatível/ inválido fecha com a razão canônica em vez de derivar
 * deficiência sobre estado não confiável.
 */
export async function readSelfDeficiencies(
  client: SupabaseClient<Database>,
): Promise<SelfDeficiencyReadResult> {
  const history = await readCanonicalWorkHistory(client);
  if (!history.ok) return { ok: false, reason: history.reason };

  const detected = detectSelfDeficiencies({ events: history.events });

  // Correlação REAL: work_items que carregam a proveniência de uma deficiência.
  const items = await readAllSelfDeficiencyCoverageRows(client);
  if (items === null) return { ok: false, reason: 'coverage_read_failed' };

  const coverage: SelfDeficiencyCoverage[] = [];
  for (const row of items) {
    const deficiencyId = readSelfDeficiencyIdFromIntent(row.intent);
    if (!deficiencyId) continue;
    coverage.push({
      deficiencyId,
      workItemId: row.id,
      state: row.state,
      updatedAt: row.updated_at,
    });
  }

  return {
    ok: true,
    deficiencies: resolveSelfDeficiencyLifecycle(detected, coverage),
    eventCount: history.events.length,
  };
}
