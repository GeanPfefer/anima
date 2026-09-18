import { buildSelfDeficiencyProvenance, selfDeficiencyDedupeKey, SELF_DEFICIENCY_PROVENANCE_KEY, type SelfDeficiencyV0 } from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readSelfDeficiencies } from './self-deficiency-read';

type EventRow = Database['public']['Tables']['work_events']['Row'];
type ItemRow = Pick<Database['public']['Tables']['work_items']['Row'], 'id' | 'state' | 'updated_at' | 'intent'>;

function failRow(input: { id: string; workItemId: string; attemptId: string; reason: string; seq: number; createdAt: string }): EventRow {
  return {
    id: input.id,
    work_item_id: input.workItemId,
    seq: input.seq,
    event_type: 'execution_failed',
    author: 'system',
    proposal_version: 1,
    payload: { schema_version: 1, data: { attempt_id: input.attemptId, reason: input.reason, retryable: false } },
    created_at: input.createdAt,
  } as EventRow;
}

interface FakeOptions {
  readonly events?: readonly EventRow[];
  readonly items?: readonly ItemRow[];
  readonly failEventsRead?: boolean;
  readonly failItemsRead?: boolean;
}

function fakeClient(options: FakeOptions = {}): SupabaseClient<Database> {
  const events = [...(options.events ?? [])];
  const items = [...(options.items ?? [])];
  const from = (table: string) => {
    if (table === 'work_events') {
      const query = {
        select: () => query,
        order: () => query,
        range: async (start: number, end: number) =>
          options.failEventsRead ? { data: null, error: { message: 'read failed' } } : { data: events.slice(start, end + 1), error: null },
      };
      return query;
    }
    return {
      select: async () => (options.failItemsRead ? { data: null, error: { message: 'items read failed' } } : { data: items, error: null }),
    };
  };
  return { from } as unknown as SupabaseClient<Database>;
}

const DEFICIENCY_ID = selfDeficiencyDedupeKey('repeated_failure', 'gate_failed');

const twoFailures: readonly EventRow[] = [
  failRow({ id: 'e1', workItemId: 'w1', attemptId: 'a1', reason: 'gate_failed', seq: 1, createdAt: '2026-09-10T10:00:00.000Z' }),
  failRow({ id: 'e2', workItemId: 'w2', attemptId: 'a2', reason: 'gate_failed', seq: 2, createdAt: '2026-09-11T10:00:00.000Z' }),
];

function provenanceIntent(deficiencyId: string): Record<string, unknown> {
  const deficiency = { id: deficiencyId, kind: 'repeated_failure', subject: 'gate_failed' } as unknown as SelfDeficiencyV0;
  return { [SELF_DEFICIENCY_PROVENANCE_KEY]: buildSelfDeficiencyProvenance(deficiency) };
}

describe('readSelfDeficiencies', () => {
  test('detecta repeated_failure real e fica OPEN sem trabalho cobrindo', async () => {
    const result = await readSelfDeficiencies(fakeClient({ events: twoFailures, items: [] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.eventCount).toBe(2);
    expect(result.deficiencies).toHaveLength(1);
    expect(result.deficiencies[0]).toMatchObject({ id: DEFICIENCY_ID, kind: 'repeated_failure', status: 'open' });
  });

  test('work_item ATIVO carregando a proveniência torna a deficiency COVERED', async () => {
    const items: ItemRow[] = [
      { id: 'wi-fix', state: 'in_progress', updated_at: '2026-09-12T10:00:00.000Z', intent: provenanceIntent(DEFICIENCY_ID) as ItemRow['intent'] },
    ];
    const result = await readSelfDeficiencies(fakeClient({ events: twoFailures, items }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deficiencies[0]?.status).toBe('covered');
  });

  test('falha de leitura do histórico fecha com a razão canônica', async () => {
    const result = await readSelfDeficiencies(fakeClient({ failEventsRead: true }));
    expect(result).toEqual({ ok: false, reason: 'event_history_read_failed' });
  });

  test('falha de leitura da correlação fecha fechado', async () => {
    const result = await readSelfDeficiencies(fakeClient({ events: twoFailures, failItemsRead: true }));
    expect(result).toEqual({ ok: false, reason: 'coverage_read_failed' });
  });
});
