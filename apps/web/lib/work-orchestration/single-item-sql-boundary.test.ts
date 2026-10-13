import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SINGLE_ITEM_SQL_BOUNDARY_REFUSAL, singleItemSqlBoundaryRefusal, workClaimRpc } from './single-item-sql-boundary';

type Reply = { data: unknown; error: { code?: string; message?: string } | null };
const clientReplying = (reply: () => Promise<Reply>) => {
  const rpc = jest.fn((..._args: unknown[]) => reply());
  return { rpc, client: { rpc } as unknown as Pick<SupabaseClient<Database>, 'rpc'> };
};

const INSTALLED: Reply = { data: null, error: { code: '22023', message: 'invalid claim request' } };

test('RPC instalada com o contrato real libera o gate com UMA sonda sem efeitos', async () => {
  const { rpc, client } = clientReplying(async () => INSTALLED);
  await expect(singleItemSqlBoundaryRefusal(client)).resolves.toBeNull();
  expect(rpc).toHaveBeenCalledTimes(1);
  // Sonda inofensiva por construção: item nil inexistente, owner em branco, lease inválido.
  expect(rpc).toHaveBeenCalledWith('acquire_single_item_work_claim', {
    work_item_id: '00000000-0000-0000-0000-000000000000',
    expected_proposal_version: 1,
    claim_id: '00000000-0000-0000-0000-000000000000',
    owner_instance_id: '',
    lease_seconds: 0,
  });
});

test.each<[string, Reply]>([
  ['RPC ausente ou com outra assinatura (PostgREST)', { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.acquire_single_item_work_claim' } }],
  ['EXECUTE negado', { data: null, error: { code: '42501', message: 'permission denied for function acquire_single_item_work_claim' } }],
  ['sem sessão autenticada', { data: null, error: { code: '42501', message: 'authentication required' } }],
  ['fora da allowlist de orquestração', { data: null, error: { code: '42501', message: 'work orchestration is not enabled' } }],
  ['validação inicial ausente: chegou a procurar o item', { data: null, error: { code: 'P0002', message: 'work item not found' } }],
  ['recusa de posse (corpo incompatível)', { data: null, error: { code: '55000', message: 'single_item_foreign_claim_open' } }],
  ['mesmo código SQL com mensagem diferente', { data: null, error: { code: '22023', message: 'invalid input syntax' } }],
  ['sucesso inesperado com sonda inválida', { data: { id: 'x' }, error: null }],
  ['resposta vazia sem erro', { data: null, error: null }],
  ['erro sem código', { data: null, error: { message: 'invalid claim request' } }],
  ['erro com código indefinido', { data: null, error: {} }],
])('fail-closed: %s', async (_label, reply) => {
  const { client } = clientReplying(async () => reply);
  await expect(singleItemSqlBoundaryRefusal(client)).resolves.toBe(SINGLE_ITEM_SQL_BOUNDARY_REFUSAL);
});

test('fail-closed: rede/exceção/rejeição não abrem o gate', async () => {
  const rejected = clientReplying(async () => { throw new Error('fetch failed'); });
  await expect(singleItemSqlBoundaryRefusal(rejected.client)).resolves.toBe('single_item_atomic_claim_unavailable');
  const syncThrow = { rpc: () => { throw new Error('boom'); } } as unknown as Pick<SupabaseClient<Database>, 'rpc'>;
  await expect(singleItemSqlBoundaryRefusal(syncThrow)).resolves.toBe('single_item_atomic_claim_unavailable');
});

test('configuração de operador/env não habilita nem desabilita o gate; só a resposta do banco decide', async () => {
  const saved = { ...process.env };
  try {
    for (const key of ['ANIMA_COMPUTE_ROUTER_V1_ENABLED', 'ANIMA_SINGLE_ITEM_SQL_BOUNDARY', 'ANIMA_SINGLE_ITEM_BYPASS', 'SINGLE_ITEM_ALLOW']) process.env[key] = '1';
    const missing = clientReplying(async () => ({ data: null, error: { code: 'PGRST202', message: 'missing' } }));
    await expect(singleItemSqlBoundaryRefusal(missing.client)).resolves.toBe(SINGLE_ITEM_SQL_BOUNDARY_REFUSAL);
    for (const key of ['ANIMA_COMPUTE_ROUTER_V1_ENABLED', 'ANIMA_SINGLE_ITEM_SQL_BOUNDARY', 'ANIMA_SINGLE_ITEM_BYPASS', 'SINGLE_ITEM_ALLOW']) delete process.env[key];
    const installed = clientReplying(async () => INSTALLED);
    await expect(singleItemSqlBoundaryRefusal(installed.client)).resolves.toBeNull();
  } finally {
    process.env = saved;
  }
});

test('a sonda só usa a RPC scoped: nunca claim global, início, liberação ou manutenção', async () => {
  const { rpc, client } = clientReplying(async () => INSTALLED);
  await singleItemSqlBoundaryRefusal(client);
  expect(rpc.mock.calls.map(call => call[0])).toEqual(['acquire_single_item_work_claim']);
});

test('código do gate é estável e a seleção de RPC preserva o contrato global', () => {
  expect(SINGLE_ITEM_SQL_BOUNDARY_REFUSAL).toBe('single_item_atomic_claim_unavailable');
  expect(workClaimRpc(false)).toBe('acquire_work_claim');
  expect(workClaimRpc(true)).toBe('acquire_single_item_work_claim');
});
