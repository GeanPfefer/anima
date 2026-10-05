import { resolveWorkReference, readWorkHumanReference, createSupabaseWorkReferenceLookup, type WorkReferenceCandidate } from './work-reference';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

const id = '11111111-1111-1111-1111-111111111111';
const intent = { canonical_provenance: { kind: 'canonical_backlog', sourceId: 'SDC-01', document: 'docs/backlog.md', heading: 'SDC', canonicalObjective: 'Executor legível', planningGeneration: 1 } };
const candidate: WorkReferenceCandidate = { workItemId: id, state: 'approved', proposalVersion: 1, createdAt: '2026-10-03', intent };

test('UUID passa intacto sem consulta, inclusive UUID inexistente', async () => {
  const findByCanonicalSourceId = jest.fn();
  expect(await resolveWorkReference({ findByCanonicalSourceId }, id)).toEqual({ ok: true, workItemId: id });
  expect(findByCanonicalSourceId).not.toHaveBeenCalled();
});
test('referência exata resolve o mesmo UUID e revalida provenance', async () => {
  const findByCanonicalSourceId = jest.fn(async () => [candidate, { ...candidate, intent: {} }, { ...candidate, intent: { canonical_provenance: { ...intent.canonical_provenance, sourceId: 'AKT-04' } } }]);
  expect(await resolveWorkReference({ findByCanonicalSourceId }, 'SDC-01')).toEqual({ ok: true, workItemId: id });
  expect(findByCanonicalSourceId).toHaveBeenCalledWith('SDC-01');
});
test.each(['sdc-01', 'Executor', 'SDC-1', ' SDC-01', 'SDC-01 ', 'SDC-01\n'])('forma inválida %j não consulta', async input => {
  const findByCanonicalSourceId = jest.fn();
  expect(await resolveWorkReference({ findByCanonicalSourceId }, input)).toEqual({ ok: false, code: 'invalid_work_reference' });
  expect(findByCanonicalSourceId).not.toHaveBeenCalled();
});
test('ausente e provenance inválida não resolvem', async () => {
  expect(await resolveWorkReference({ findByCanonicalSourceId: async () => [{ ...candidate, intent: {} }] }, 'SDC-01')).toEqual({ ok: false, code: 'work_reference_not_found' });
  expect(readWorkHumanReference({})).toBeNull();
  expect(readWorkHumanReference(intent)).toEqual({ reference: 'SDC-01', title: 'Executor legível' });
});
test('ambiguidade não escolhe por estado, versão ou recência', async () => {
  const result = await resolveWorkReference({ findByCanonicalSourceId: async () => [candidate, { ...candidate, workItemId: '22222222-2222-2222-2222-222222222222', state: 'completed', proposalVersion: 9, createdAt: '2026-10-04' }] }, 'SDC-01');
  expect(result).toMatchObject({ ok: false, code: 'work_reference_ambiguous', candidates: [{ workItemId: id, document: 'docs/backlog.md', state: 'approved', proposalVersion: 1, createdAt: '2026-10-03' }, { state: 'completed', proposalVersion: 9 }] });
  expect(result).not.toHaveProperty('workItemId');
});
test('adapter filtra jsonb e ordena sem rede; erro de leitura não vira ausência', async () => {
  const query = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis(), range: jest.fn(async () => ({ data: [{ id, state: 'approved', proposal_version: 1, created_at: '2026-10-03', intent }], error: null })) };
  const client = { from: jest.fn(() => query) } as unknown as SupabaseClient<Database>;
  expect(await createSupabaseWorkReferenceLookup(client).findByCanonicalSourceId('SDC-01')).toEqual([candidate]);
  expect(query.eq).toHaveBeenCalledWith('intent->canonical_provenance->>sourceId', 'SDC-01');
  expect(query.order).toHaveBeenCalledWith('created_at', { ascending: true });
  query.range.mockImplementation(async () => { throw new Error('read failed'); });
  await expect(createSupabaseWorkReferenceLookup(client).findByCanonicalSourceId('SDC-01')).rejects.toThrow('read failed');
});
