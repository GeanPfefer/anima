import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@anima/types';
import { authorizeResume } from './authorize-resume';

// O application service é glue fino sobre a RPC autoritativa `authorize_work_resume`:
// valida a autorização humana (codec puro), deriva versão+failureEventId da prontidão
// de retry e classifica a resposta. Toda a semântica (saldo esgotado, teto agregado,
// append-only, anti-loop, idempotência) vive na RPC (coberta por pgTAP 32/32).
const WORK_ID = '7b132de5-8ca1-436e-9d23-e4317d59aaea';
const REF = 'docs/registros/2026-09-02-recovery-budget-transferido-esgotado.md';
const validAuthorization = {
  schemaVersion: 1,
  requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  reason: 'Retomada humana limitada apos revisar a nova evidencia.',
  additionalAttempts: 1,
  aggregateCeiling: 4,
  diagnosis: {
    reference: REF,
    priorApiAssumption: 'exports_absent',
    correctedApiAssumption: 'exports_present',
    apiPath: 'packages/core/src/project-intake.ts',
    exports: ['parseProjectIntake', 'serializeProjectIntake'],
    syntaxFailure: 'unbalanced_block',
    anchorFailure: 'no_match_cause_unproven',
  },
  planRevision: 'inspect_existing_exports_and_current_reads_v1',
  compute: { placement: 'local', preferred: 'qwen3-coder:latest', fallback: 'qwen2.5-coder:14b', paid: false },
};

type Readiness = { reason: string | null; failureEventId: string | null; proposalVersion: number };
const readiness = (o: Partial<Readiness> = {}): Readiness => ({
  reason: null, failureEventId: '07664942-c43a-46c4-bce5-333daec2d7d3', proposalVersion: 1, ...o,
});

interface FakeOptions {
  readonly readiness?: Readiness;
  readonly rpc?: { data?: unknown; error?: { message: string; code: string } | null };
  readonly stored?: { data?: { authority: unknown } | null; error?: { message: string } | null };
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
      if (name === 'current_work_retry_readiness') return { data: opts.readiness ?? readiness(), error: null };
      if (name === 'authorize_work_resume') { calls.rpcArgs = args; return opts.rpc ?? { data: null, error: null }; }
      throw new Error(`rpc inesperada: ${name}`);
    },
  } as unknown as SupabaseClient<Database>;
};

const okData = {
  authorizationId: '00000000-0000-4000-8000-0000000000a0',
  successorWorkItemId: '00000000-0000-4000-8000-0000000000aa',
  lineageId: '00000000-0000-4000-8000-0000000000bb',
  additionalAttempts: 1,
  aggregateCeiling: 4,
  previousConsumed: 3,
  replayed: false,
};

describe('authorizeResume — fail-closed sobre a RPC', () => {
  test('autorização fornecida inválida é rejeitada ANTES de qualquer RPC', async () => {
    const client = fakeClient({});
    const r = await authorizeResume(client, WORK_ID, { schemaVersion: 1 });
    expect(r).toMatchObject({ ok: false, code: 'authorization_required_or_invalid', rejected: true });
    expect(calls.rpcArgs).toBeNull();
  });

  test('sem autorização e sem concessão persistida ⇒ rejeitado (não inventa autoridade)', async () => {
    const client = fakeClient({ stored: { data: null, error: null } });
    const r = await authorizeResume(client, WORK_ID);
    expect(r).toMatchObject({ ok: false, code: 'authorization_required_or_invalid' });
    expect(calls.rpcArgs).toBeNull();
  });

  test('falha de leitura da prontidão ⇒ erro operacional (não rejeição)', async () => {
    const client = fakeClient({ readiness: readiness({ reason: 'read_failed' }) });
    const r = await authorizeResume(client, WORK_ID, validAuthorization);
    expect(r).toMatchObject({ ok: false, code: 'read_failed', rejected: false });
    expect(calls.rpcArgs).toBeNull();
  });

  test('sem failure event correlacionado ⇒ failure_missing', async () => {
    const client = fakeClient({ readiness: readiness({ failureEventId: null }) });
    const r = await authorizeResume(client, WORK_ID, validAuthorization);
    expect(r).toMatchObject({ ok: false, code: 'failure_missing' });
  });

  test('happy: deriva versão+failureEventId e repassa a autorização à RPC', async () => {
    const client = fakeClient({ rpc: { data: okData, error: null } });
    const r = await authorizeResume(client, WORK_ID, validAuthorization);
    expect(r).toMatchObject({ ok: true, authorizationId: okData.authorizationId, successorWorkItemId: okData.successorWorkItemId, additionalAttempts: 1, aggregateCeiling: 4, previousConsumed: 3, replayed: false });
    expect(calls.rpcArgs).toMatchObject({
      p_work_item_id: WORK_ID,
      p_expected_proposal_version: 1,
      p_failure_event_id: '07664942-c43a-46c4-bce5-333daec2d7d3',
      p_authorization: validAuthorization,
    });
  });

  test.each([
    ['22023', true],
    ['55000', true],
    ['42501', true],
    ['23505', true],
    ['XX000', false],
  ])('erro de RPC %s classifica rejected=%s', async (code, rejected) => {
    const client = fakeClient({ rpc: { error: { message: code, code } } });
    const r = await authorizeResume(client, WORK_ID, validAuthorization);
    expect(r).toMatchObject({ ok: false, rejected });
  });

  test('resposta de RPC malformada ⇒ erro (não rejeição)', async () => {
    const client = fakeClient({ rpc: { data: { successorWorkItemId: 123 }, error: null } });
    const r = await authorizeResume(client, WORK_ID, validAuthorization);
    expect(r).toMatchObject({ ok: false, code: 'response_invalid', rejected: false });
  });

  test('sem autorização fornecida, replaya a concessão persistida', async () => {
    const client = fakeClient({ stored: { data: { authority: validAuthorization }, error: null }, rpc: { data: { ...okData, replayed: true }, error: null } });
    const r = await authorizeResume(client, WORK_ID);
    expect(r).toMatchObject({ ok: true, replayed: true });
    expect(calls.rpcArgs).toMatchObject({ p_authorization: validAuthorization });
  });
});
