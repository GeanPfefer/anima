import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readProduceChangeOperationalEvidence, readTrustedSystemEvidenceSince } from './produce-change-evidence-read';

type Rows = Record<string, readonly Record<string, unknown>[]>;

interface FakeOptions {
  readonly rows?: Rows;
  readonly failTable?: string;
  readonly boundary?: { data: unknown; error: unknown };
}

function fakeClient(options: FakeOptions = {}): { client: SupabaseClient<Database>; rpcCalls: unknown[][] } {
  const rpcCalls: unknown[][] = [];
  const from = (table: string) => {
    const query = {
      select: () => query,
      order: () => query,
      range: async (start: number, end: number) => options.failTable === table
        ? { data: null, error: { message: 'boom' } }
        : { data: (options.rows?.[table] ?? []).slice(start, end + 1), error: null },
    };
    return query;
  };
  const rpc = async (...args: unknown[]) => {
    rpcCalls.push(args);
    return options.boundary ?? { data: null, error: null };
  };
  return { client: { from, rpc } as unknown as SupabaseClient<Database>, rpcCalls };
}

const ITEM = { id: 'w1', capability: 'programming', impact_level: 'low', intent: {} };
const STARTED = {
  id: 'e1', work_item_id: 'w1', seq: 1, event_type: 'execution_started', author: 'system', proposal_version: 1,
  payload: { schema_version: 1, data: { attempt_id: 'a1' } }, created_at: '2026-09-29T10:00:00.000Z',
};

describe('readTrustedSystemEvidenceSince', () => {
  it('lê a fronteira do banco (RPC sem argumentos do chamador)', async () => {
    const { client, rpcCalls } = fakeClient({ boundary: { data: '2026-09-29T03:19:31.82352+00:00', error: null } });
    await expect(readTrustedSystemEvidenceSince(client)).resolves.toEqual({ ok: true, since: '2026-09-29T03:19:31.824Z' });
    expect(rpcCalls).toEqual([['trusted_system_evidence_since']]);
  });

  it('microssegundos do banco arredondam para CIMA (a fronteira nunca recua)', async () => {
    await expect(readTrustedSystemEvidenceSince(fakeClient({ boundary: { data: '2026-09-29T03:24:34.618679+00:00', error: null } }).client))
      .resolves.toEqual({ ok: true, since: '2026-09-29T03:24:34.619Z' });
    await expect(readTrustedSystemEvidenceSince(fakeClient({ boundary: { data: '2026-09-29T03:24:34.618000+00:00', error: null } }).client))
      .resolves.toEqual({ ok: true, since: '2026-09-29T03:24:34.618Z' });
  });

  it('sem writer ativo ⇒ null explícito', async () => {
    await expect(readTrustedSystemEvidenceSince(fakeClient().client)).resolves.toEqual({ ok: true, since: null });
  });

  it('erro ou valor inválido ⇒ falha fechada, nunca null silencioso', async () => {
    await expect(readTrustedSystemEvidenceSince(fakeClient({ boundary: { data: null, error: { message: 'x' } } }).client))
      .resolves.toEqual({ ok: false, reason: 'trusted_boundary_read_failed' });
    await expect(readTrustedSystemEvidenceSince(fakeClient({ boundary: { data: 'ontem', error: null } }).client))
      .resolves.toEqual({ ok: false, reason: 'trusted_boundary_read_failed' });
  });
});

describe('readProduceChangeOperationalEvidence', () => {
  const rows: Rows = { work_events: [STARTED], work_items: [ITEM], work_recovery_lineage: [] };

  it('projeta com a fronteira lida do banco e a expõe para auditoria', async () => {
    const { client } = fakeClient({ rows, boundary: { data: '2026-09-29T03:19:31.823Z', error: null } });
    const result = await readProduceChangeOperationalEvidence(client);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trustedSystemEvidenceSince).toBe('2026-09-29T03:19:31.823Z');
    expect(result.projection.eligibleLineages).toBe(1);
    expect(result.projection.gaps).toContain('trusted_evidence_generation_missing');
  });

  it('falha ao ler a fronteira fecha a leitura inteira', async () => {
    const { client } = fakeClient({ rows, boundary: { data: null, error: { message: 'x' } } });
    await expect(readProduceChangeOperationalEvidence(client)).resolves.toEqual({ ok: false, reason: 'trusted_boundary_read_failed' });
  });

  it('falha ao ler itens ou lineage fecha com razão própria', async () => {
    await expect(readProduceChangeOperationalEvidence(fakeClient({ rows, failTable: 'work_items' }).client))
      .resolves.toEqual({ ok: false, reason: 'work_items_read_failed' });
    await expect(readProduceChangeOperationalEvidence(fakeClient({ rows, failTable: 'work_recovery_lineage' }).client))
      .resolves.toEqual({ ok: false, reason: 'recovery_lineage_read_failed' });
    await expect(readProduceChangeOperationalEvidence(fakeClient({ rows, failTable: 'work_events' }).client))
      .resolves.toEqual({ ok: false, reason: 'event_history_read_failed' });
  });
});
