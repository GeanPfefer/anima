/** @jest-environment node */
jest.mock('./server', () => ({ createWorkOrchestrationService: jest.fn() }));
jest.mock('./autonomous-readiness', () => ({ projectAutonomousReadiness: jest.fn(async () => new Map()) }));
jest.mock('./retry-readiness', () => ({ readWorkRetryReadiness: jest.fn(async () => ({ status: 'NOT_APPLICABLE' })) }));
jest.mock('./serialize', () => ({ serializeReconstructedWorkPresentation: jest.fn((item: { id: string }) => ({ item: { id: item.id } })) }));

import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createWorkOrchestrationService } from './server';
import { loadWorkDetail } from './work-detail';
import type { WorkReferenceLookup } from './work-reference';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const client = {} as SupabaseClient<Database>;
const serviceMock = createWorkOrchestrationService as jest.Mock;

const canonical = (sourceId: string) => ({ canonical_provenance: { kind: 'canonical_backlog', sourceId, document: 'docs/planos/071.md', heading: 'h', canonicalObjective: `Título de ${sourceId}`, planningGeneration: 1, materializationReason: 'selected_ready' } });
function useItems(items: Record<string, { sourceId?: string; summary?: string }>, options: { eventsFail?: boolean } = {}) {
  const getItem = jest.fn(async (id: string) => {
    const found = items[id];
    if (!found) return { ok: false, error: { code: 'work_item_not_found', message: 'x', retryable: false } };
    return { ok: true, value: { id, intent: found.sourceId ? canonical(found.sourceId) : {}, proposal: { data: { summary: found.summary ?? 'Resumo' } } } };
  });
  serviceMock.mockReturnValue({
    getItem,
    listEvents: jest.fn(async () => options.eventsFail ? { ok: false, error: { code: 'persistence_failure' } } : { ok: true, value: [] }),
    listContexts: jest.fn(async () => ({ ok: true, value: [] })),
  });
  return getItem;
}
const lookup = (candidates: { workItemId: string; sourceId: string; state?: string }[]): WorkReferenceLookup => ({
  findByCanonicalSourceId: async () => candidates.map(c => ({ workItemId: c.workItemId, state: c.state ?? 'completed', proposalVersion: 1, createdAt: '2026-10-20T19:00:00+00:00', intent: canonical(c.sourceId) })),
});

beforeEach(() => jest.clearAllMocks());

test('UUID abre o item direto, com a apresentação reconstruída serializável', async () => {
  useItems({ [ID_A]: { sourceId: 'PROOF-01' } });
  const result = await loadWorkDetail(client, ID_A);
  expect(result).toMatchObject({ kind: 'ok', workItemId: ID_A, reference: 'PROOF-01', title: 'Título de PROOF-01' });
  expect(result.kind === 'ok' && result.presentation).toMatchObject({ item: { id: ID_A } });
});

test('código legível único resolve pelo mesmo resolvedor da CLI', async () => {
  useItems({ [ID_A]: { sourceId: 'PROOF-01' } });
  expect(await loadWorkDetail(client, 'PROOF-01', undefined, { lookup: lookup([{ workItemId: ID_A, sourceId: 'PROOF-01' }]) })).toMatchObject({ kind: 'ok', workItemId: ID_A });
});

test('código compartilhado por sucessores é ambíguo: nenhum item é aberto em silêncio', async () => {
  const getItem = useItems({ [ID_A]: { sourceId: 'SDC-02' }, [ID_B]: { sourceId: 'SDC-02' } });
  const result = await loadWorkDetail(client, 'SDC-02', undefined, { lookup: lookup([{ workItemId: ID_A, sourceId: 'SDC-02' }, { workItemId: ID_B, sourceId: 'SDC-02' }]) });
  expect(result.kind).toBe('ambiguous');
  expect(result.kind === 'ambiguous' && result.candidates.map(c => c.workItemId)).toEqual([ID_A, ID_B]);
  expect(getItem).not.toHaveBeenCalled();
});

test('?item desambigua, mas só se o item tiver exatamente aquele código', async () => {
  useItems({ [ID_A]: { sourceId: 'SDC-02' }, [ID_B]: { sourceId: 'SDC-09' } });
  expect(await loadWorkDetail(client, 'SDC-02', ID_A)).toMatchObject({ kind: 'ok', workItemId: ID_A });
  expect(await loadWorkDetail(client, 'SDC-02', ID_B)).toEqual({ kind: 'not_found' });
  expect(await loadWorkDetail(client, 'SDC-02', 'nao-e-uuid')).toEqual({ kind: 'invalid' });
});

test.each(['proof-01', 'PROOF-1', 'DROP TABLE', '../etc', ''])('referência inválida %j', async param => {
  useItems({});
  expect(await loadWorkDetail(client, param, undefined, { lookup: lookup([]) })).toEqual({ kind: 'invalid' });
});

test('inexistente (código ou UUID de outro usuário/inexistente sob RLS) → not_found', async () => {
  useItems({});
  expect(await loadWorkDetail(client, 'PROOF-99', undefined, { lookup: lookup([]) })).toEqual({ kind: 'not_found' });
  expect(await loadWorkDetail(client, ID_A)).toEqual({ kind: 'not_found' });
});

test('falha de leitura de eventos ou exceção → error, sem vazar detalhes', async () => {
  useItems({ [ID_A]: { sourceId: 'PROOF-01' } }, { eventsFail: true });
  expect(await loadWorkDetail(client, ID_A)).toEqual({ kind: 'error' });
  useItems({ [ID_A]: { sourceId: 'PROOF-01' } });
  const throwing: WorkReferenceLookup = { findByCanonicalSourceId: async () => { throw new Error('boom'); } };
  expect(await loadWorkDetail(client, 'PROOF-01', undefined, { lookup: throwing })).toEqual({ kind: 'error' });
});

test('item sem proveniência canônica usa o resumo como título e não tem código', async () => {
  useItems({ [ID_A]: { summary: 'Só o resumo' } });
  expect(await loadWorkDetail(client, ID_A)).toMatchObject({ kind: 'ok', reference: null, title: 'Só o resumo' });
});
