import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readCapabilityAssessments } from './capability-assessment-read';

type EventRow =
  Database['public']['Tables']['work_events']['Row'];

const PAGE_SIZE = 500;

function row(
  overrides: Partial<EventRow> = {},
): EventRow {
  return {
    id: 'event-1',
    work_item_id: 'work-1',
    seq: 1,
    event_type: 'host_observed_gate_evidence_recorded',
    author: 'system',
    proposal_version: 1,
    payload: {
      schema_version: 1,
      data: {
        work_item_id: 'work-1',
        attempt_id: 'attempt-1',
        approved_proposal_version: 1,
        origin: 'host',
        coverage: {
          gates: true,
        },
        evidence: {
          schemaVersion: 1,
          workItemId: 'work-1',
          attemptId: 'attempt-1',
          approvedProposalVersion: 1,
          gates: [
            {
              label: 'unit',
              command: 'npm test',
              exitCode: 0,
              durationMs: 10,
              timedOut: false,
              cancelled: false,
              outcome: 'passed',
            },
          ],
          observedAt:
            '2026-09-16T18:00:00.000Z',
          coverage: {
            gates: true,
          },
        },
      },
    },
    created_at:
      '2026-09-16T18:00:00.000Z',
    ...overrides,
  } as EventRow;
}

interface FakeClientOptions {
  readonly rows?: readonly EventRow[];
  readonly failAtFrom?: number;
}

function fakeClient(
  options: FakeClientOptions = {},
): SupabaseClient<Database> {
  const rows = [...(options.rows ?? [])];

  const from = (_table: string) => {
    const query = {
      select: (_columns: string) => query,
      order: (
        _column: string,
        _options: { ascending: boolean },
      ) => query,
      range: async (
        start: number,
        end: number,
      ) => {
        if (
          options.failAtFrom !== undefined &&
          start === options.failAtFrom
        ) {
          return {
            data: null,
            error: {
              message: 'read failed',
            },
          };
        }

        return {
          data: rows.slice(start, end + 1),
          error: null,
        };
      },
    };

    return query;
  };

  return {
    from,
  } as unknown as SupabaseClient<Database>;
}


function verifierRow(
  overrides: {
    readonly id?: string;
    readonly seq?: number;
    readonly createdAt?: string;
    readonly envelopeAttemptId?: string;
  } = {},
): EventRow {
  const opinion = {
    schemaVersion: 1,
    workItemId: 'work-1',
    attemptId: 'attempt-1',
    approvedProposalVersion: 2,
    verifierVersion: 'work-verifier-v1',
    verdict: 'verified',
    restsOnAttestedEvidence: true,
    summary: {
      violations: 0,
      gaps: 0,
      checks: 1,
      attested: 1,
      independent: 0,
    },
    findings: [
      {
        code: 'gates_passed',
        severity: 'ok',
        provenance: 'attested',
      },
    ],
    evidenceBasis: {
      resultEventId: 'result-1',
      observedEventId: null,
      observedGateEventId: null,
      coverage: {
        git: false,
        gates: false,
      },
    },
  };

  return {
    ...row({
      id: overrides.id ?? 'verifier-1',
      seq: overrides.seq ?? 10,
      event_type: 'verifier_opinion_recorded',
      proposal_version: 2,
      created_at:
        overrides.createdAt ??
        '2026-09-16T19:00:00.000Z',
    }),
    payload: {
      schema_version: 1,
      data: {
        work_item_id: 'work-1',
        attempt_id:
          overrides.envelopeAttemptId ??
          'attempt-1',
        approved_proposal_version: 2,
        origin: 'verifier',
        verifier_version:
          'work-verifier-v1',
        verdict: 'verified',
        opinion,
      },
    },
  } as EventRow;
}

function malformedGateRow(): EventRow {
  const valid = row();

  const payload = JSON.parse(
    JSON.stringify(valid.payload),
  ) as {
    data?: {
      attempt_id?: string;
    };
  };

  if (!payload.data) {
    throw new Error(
      'fixture de gate sem data',
    );
  }

  /**
   * Envelope e evidência passam a discordar.
   * O projector canônico precisa rejeitar.
   */
  payload.data.attempt_id =
    'attempt-diferente';

  return {
    ...valid,
    payload:
      payload as EventRow['payload'],
  };
}
describe('readCapabilityAssessments', () => {
  test('lê evento real tipado e deriva assessment sem expor row bruta', async () => {
    const result =
      await readCapabilityAssessments(
        fakeClient({
          rows: [row()],
        }),
      );

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    expect(result.eventCount).toBe(1);
    expect(result.projection.issues).toEqual([]);

    expect(
      result.projection.assessments,
    ).toEqual([
      expect.objectContaining({
        capabilityId: 'agency.run-tests',
        declaredMaturity: 'proven',
        definitionMaturity: 'implemented',
        derivedMaturity: 'proven',
      }),
    ]);

    expect(result).not.toHaveProperty('events');
    expect(result).not.toHaveProperty('rows');
  });

  test('histórico vazio é válido e não inventa assessments', async () => {
    const result =
      await readCapabilityAssessments(
        fakeClient(),
      );

    expect(result).toEqual({
      ok: true,
      projection: {
        assessments: [],
        issues: [],
      },
      eventCount: 0,
    });
  });

  test('falha de leitura fecha o read-model sem derivar de histórico parcial', async () => {
    const result =
      await readCapabilityAssessments(
        fakeClient({
          failAtFrom: 0,
        }),
      );

    expect(result).toEqual({
      ok: false,
      reason: 'event_history_read_failed',
    });
  });

  test('row inválida falha fechado em vez de ser ignorada', async () => {
    const invalid = {
      ...row(),
      created_at: 'não-é-data',
    } as EventRow;

    const result =
      await readCapabilityAssessments(
        fakeClient({
          rows: [invalid],
        }),
      );

    expect(result).toEqual({
      ok: false,
      reason: 'event_history_invalid',
    });
  });

  test('pagina além do primeiro bloco sem truncar silenciosamente', async () => {
    const rows: EventRow[] = [];

    for (let index = 0; index < PAGE_SIZE + 1; index += 1) {
      rows.push(
        row({
          id: `event-${index}`,
          seq: index + 1,

          /**
           * Evento irrelevante ao resolver de capabilities, mas ainda é
           * histórico válido e precisa ser contado/lido integralmente.
           */
          event_type: 'work_proposed',
          payload: {
            schema_version: 1,
            data: {},
          },
          created_at: new Date(
            Date.UTC(
              2026,
              8,
              16,
              18,
              0,
              index,
            ),
          ).toISOString(),
        }),
      );
    }

    const result =
      await readCapabilityAssessments(
        fakeClient({
          rows,
        }),
      );

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    expect(result.eventCount).toBe(
      PAGE_SIZE + 1,
    );
  });

  test('falha na segunda página não devolve assessment baseado só na primeira', async () => {
    const rows: EventRow[] =
      Array.from(
        { length: PAGE_SIZE + 1 },
        (_, index) =>
          row({
            id: `event-${index}`,
            seq: index + 1,
            event_type: 'work_proposed',
            payload: {
              schema_version: 1,
              data: {},
            },
          }),
      );

    const result =
      await readCapabilityAssessments(
        fakeClient({
          rows,
          failAtFrom: PAGE_SIZE,
        }),
      );

    expect(result).toEqual({
      ok: false,
      reason: 'event_history_read_failed',
    });
  });

  test('evento host-observed semanticamente incoerente falha fechado', async () => {
    const result =
      await readCapabilityAssessments(
        fakeClient({
          rows: [
            malformedGateRow(),
          ],
        }),
      );

    expect(result).toEqual({
      ok: false,
      reason: 'event_history_invalid',
    });
  });

  test('Verifier semanticamente válido é aceito pelo boundary', async () => {
    const result =
      await readCapabilityAssessments(
        fakeClient({
          rows: [
            verifierRow(),
          ],
        }),
      );

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    /**
     * Um parecer sozinho não prova capability:
     * o objetivo aqui é somente comprovar que o evento
     * persistido é semanticamente válido.
     */
    expect(result.eventCount).toBe(1);
    expect(
      result.projection.assessments,
    ).toEqual([]);
  });

  test('Verifier posterior incoerente não pode desaparecer e deixar parecer antigo sobreviver', async () => {
    const validOlder =
      verifierRow({
        id: 'verifier-valid-old',
        seq: 20,
        createdAt:
          '2026-09-16T19:00:00.000Z',
      });

    const invalidNewer =
      verifierRow({
        id: 'verifier-invalid-new',
        seq: 21,
        createdAt:
          '2026-09-16T19:01:00.000Z',

        /**
         * O opinion declara attempt-1, mas o
         * envelope persistido declara outra.
         */
        envelopeAttemptId:
          'attempt-outra',
      });

    const result =
      await readCapabilityAssessments(
        fakeClient({
          rows: [
            validOlder,
            invalidNewer,
          ],
        }),
      );

    expect(result).toEqual({
      ok: false,
      reason: 'event_history_invalid',
    });
  });
});