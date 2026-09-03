import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@anima/types';
import { replanFailedWorkItem } from './replan-orchestration';

// A orquestração é glue fino sobre a RPC autoritativa: valida o diagnóstico,
// deriva versão+failureEventId da prontidão de retry e classifica a resposta.
// Toda a semântica de progresso/idempotência vive na RPC (coberta por pgTAP).
const WORK_ID = '5b8e371d-6ca9-453c-bbfe-693ae3266468';
const REF = 'docs/registros/2026-09-02-diagnostico-semantico-pin02.md';
const validDiagnosis = {
  schemaVersion: 1,
  finding: 'test_code_incorrect',
  evidenceReference: REF,
  corrections: [
    { kind: 'resolve_imports', symbols: ['serialize', 'parse'], instruction: 'Importar os símbolos da API pública antes de chamar.' },
  ],
};

type Readiness = { reason: string | null; failureEventId: string | null; proposalVersion: number };
const readiness = (o: Partial<Readiness> = {}): Readiness => ({
  reason: null, failureEventId: 'b6783ef2-0000-4000-8000-000000000001', proposalVersion: 1, ...o,
});

interface FakeOptions {
  readonly readiness?: Readiness;
  readonly rpc?: { data?: unknown; error?: { message: string; code: string } | null };
  readonly stored?: { data?: { diagnosis: unknown } | null; error?: { message: string } | null };
}

const calls: { rpcArgs: unknown } = { rpcArgs: null };

const fakeClient = (opts: FakeOptions): SupabaseClient<Database> => {
  calls.rpcArgs = null;
  return {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          maybeSingle: async () => opts.stored ?? { data: null, error: null },
        }),
      }),
    }),
    rpc: async (name: string, args: unknown) => {
      if (name === 'current_work_retry_readiness') {
        const r = opts.readiness ?? readiness();
        return { data: r, error: null };
      }
      if (name === 'replan_failed_work') {
        calls.rpcArgs = args;
        return opts.rpc ?? { data: null, error: null };
      }
      throw new Error(`rpc inesperada: ${name}`);
    },
  } as unknown as SupabaseClient<Database>;
};

const okData = {
  successorWorkItemId: '00000000-0000-4000-8000-0000000000aa',
  lineageId: '00000000-0000-4000-8000-0000000000bb',
  replanId: '00000000-0000-4000-8000-0000000000cc',
  replayed: false,
  allocatedAttempts: 1,
};

describe('replanFailedWorkItem — fail-closed sobre a RPC', () => {
  test('diagnóstico fornecido inválido é rejeitado ANTES de qualquer RPC', async () => {
    const client = fakeClient({});
    const r = await replanFailedWorkItem(client, WORK_ID, { schemaVersion: 1 });
    expect(r).toMatchObject({ ok: false, code: 'diagnosis_required_or_invalid', rejected: true });
    expect(calls.rpcArgs).toBeNull();
  });

  test('sem diagnóstico e sem registro persistido ⇒ rejeitado', async () => {
    const client = fakeClient({ stored: { data: null, error: null } });
    const r = await replanFailedWorkItem(client, WORK_ID);
    expect(r).toMatchObject({ ok: false, code: 'diagnosis_required_or_invalid' });
  });

  test('falha de leitura da prontidão ⇒ erro (não rejeição)', async () => {
    const client = fakeClient({ readiness: readiness({ reason: 'read_failed' }) });
    const r = await replanFailedWorkItem(client, WORK_ID, validDiagnosis);
    expect(r).toMatchObject({ ok: false, code: 'read_failed', rejected: false });
  });

  test('sem failure event correlacionado ⇒ failure_missing', async () => {
    const client = fakeClient({ readiness: readiness({ failureEventId: null }) });
    const r = await replanFailedWorkItem(client, WORK_ID, validDiagnosis);
    expect(r).toMatchObject({ ok: false, code: 'failure_missing' });
  });

  test('deriva versão+failureEventId da prontidão e repassa o diagnóstico à RPC', async () => {
    const client = fakeClient({ rpc: { data: okData, error: null } });
    const r = await replanFailedWorkItem(client, WORK_ID, validDiagnosis);
    expect(r).toMatchObject({ ok: true, successorWorkItemId: okData.successorWorkItemId, allocatedAttempts: 1 });
    expect(calls.rpcArgs).toMatchObject({
      p_work_item_id: WORK_ID,
      p_expected_proposal_version: 1,
      p_failure_event_id: 'b6783ef2-0000-4000-8000-000000000001',
    });
  });

  test.each([
    ['55000', true],
    ['22023', true],
    ['42501', true],
    ['23505', true],
    ['XX000', false],
  ])('erro de RPC %s classifica rejected=%s', async (code, rejected) => {
    const client = fakeClient({ rpc: { error: { message: code, code } } });
    const r = await replanFailedWorkItem(client, WORK_ID, validDiagnosis);
    expect(r).toMatchObject({ ok: false, rejected });
  });

  test('resposta de RPC malformada ⇒ erro (não rejeição)', async () => {
    const client = fakeClient({ rpc: { data: { successorWorkItemId: 123 }, error: null } });
    const r = await replanFailedWorkItem(client, WORK_ID, validDiagnosis);
    expect(r).toMatchObject({ ok: false, code: 'response_invalid', rejected: false });
  });

  test('sem diagnóstico fornecido, replaya o persistido', async () => {
    const client = fakeClient({ stored: { data: { diagnosis: validDiagnosis }, error: null }, rpc: { data: { ...okData, replayed: true }, error: null } });
    const r = await replanFailedWorkItem(client, WORK_ID);
    expect(r).toMatchObject({ ok: true, replayed: true });
  });
});
