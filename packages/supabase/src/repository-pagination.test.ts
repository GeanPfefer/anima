import type { Database, Tables } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseWorkOrchestrationRepository } from './repository';

const eventRow = (seq: number): Tables<'work_events'> => ({
  id: `event-${seq}`, seq, work_item_id: 'item', event_type: 'result_submitted', author: 'executor',
  proposal_version: 2, payload: { schema_version: 1, data: {} }, created_at: '2026-10-08T00:00:00Z',
});
function clientFor(pages: readonly { data: Tables<'work_events'>[] | null; error: { code: string; message: string } | null }[]) {
  const calls: { table: string; filters: [string, unknown][]; cursor: number | null; limit: number | null; order: unknown[] }[] = [];
  const client = { from(table: string) {
    const call = { table, filters: [] as [string, unknown][], cursor: null as number | null, limit: null as number | null, order: [] as unknown[] };
    const page = pages[calls.length];
    calls.push(call);
    const query: Record<string, unknown> = {
      select: jest.fn(() => query), eq: (key: string, value: unknown) => { call.filters.push([key, value]); return query; },
      gt: (key: string, value: number) => { expect(key).toBe('seq'); call.cursor = value; return query; },
      order: (key: string, options: unknown) => { call.order.push([key, options]); return query; },
      limit: (value: number) => { call.limit = value; return query; },
      then: (resolve: (value: typeof page) => unknown) => Promise.resolve(page).then(resolve),
    };
    return query;
  } } as unknown as SupabaseClient<Database>;
  return { client, calls };
}
describe('listEvents keyset pagination (mock transport, not a live RLS proof)', () => {
  test('reads all pages in seq order even with a server cap below the requested limit', async () => {
    const { client, calls } = clientFor([
      { data: [eventRow(1), eventRow(2)], error: null }, { data: [eventRow(3)], error: null }, { data: [], error: null },
    ]);
    const result = await new SupabaseWorkOrchestrationRepository(client).listEvents('item');
    expect(result.ok && result.value.map(event => [event.id, event.seq])).toEqual([['event-1', 1], ['event-2', 2], ['event-3', 3]]);
    expect(calls.map(c => c.cursor)).toEqual([null, 2, 3]);
    for (const call of calls) expect(call).toMatchObject({ table: 'work_events', filters: [['work_item_id', 'item']], limit: 1000, order: [['seq', { ascending: true }]] });
  });
  test('empty history is successful', async () => {
    const { client } = clientFor([{ data: [], error: null }]);
    expect(await new SupabaseWorkOrchestrationRepository(client).listEvents('item')).toEqual({ ok: true, value: [] });
  });
  test('later page error does not return partial history', async () => {
    const { client } = clientFor([{ data: [eventRow(1)], error: null }, { data: null, error: { code: '42501', message: 'denied' } }]);
    expect(await new SupabaseWorkOrchestrationRepository(client).listEvents('item')).toMatchObject({ ok: false });
  });
  test('non-increasing seq fails closed rather than looping or duplicating', async () => {
    const { client } = clientFor([{ data: [eventRow(1)], error: null }, { data: [eventRow(1)], error: null }]);
    expect(await new SupabaseWorkOrchestrationRepository(client).listEvents('item')).toMatchObject({ ok: false, error: { code: 'persistence_failure' } });
  });
});
