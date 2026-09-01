jest.mock('@anima/supabase', () => ({
  // Isola a projeção do mapper real (coberto em packages/supabase): o teste controla
  // o WorkItem produzido por linha e injeta uma linha inválida via `THROW`.
  mapWorkItem: (row: { id: string; state: string; proposalVersion?: number; intent?: unknown }) => {
    if (row.id === 'THROW') throw new Error('linha inválida');
    return { id: row.id, state: row.state, proposalVersion: row.proposalVersion ?? 1, intent: row.intent ?? {}, capability: 'programming' };
  },
}));

import { readAutonomousBacklogCandidates } from './autonomous-backlog-read';
import type { WorkIntelligenceClassificationV1 } from '@anima/core';

const validClassification: WorkIntelligenceClassificationV1 = {
  schemaVersion: 1, complexity: 'bounded', risk: 'low', reversibility: 'reversible', planClarity: 'clear', urgency: 'normal',
  provenance: { kind: 'human_confirmed', classifiedAt: '2026-08-22T10:00:00Z', classifierId: 'user:opaque' },
};

type Script = {
  work_items?: { data: unknown; error: unknown };
  /** 2ª query de `work_items`: dependências `completed` (a que usa `.eq('state','completed')`). */
  work_items_completed?: { data: unknown; error: unknown };
  work_events?: { data: unknown; error: unknown };
  work_claims?: { data: unknown; error: unknown };
  classification?: (id: string) => { data: unknown; error: unknown };
};

// Fake client: cada `from(table)` devolve um builder encadeável e "thenable" que
// resolve o resultado roteirizado da tabela; `rpc` resolve por item. A 2ª leitura de
// `work_items` (dependências `completed`) é distinguida pelo `.eq('state','completed')`.
const makeClient = (script: Script) => ({
  from: (table: keyof Script) => {
    const eqs: Array<[string, unknown]> = [];
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'in', 'is', 'order']) builder[m] = () => builder;
    builder.eq = (col: string, val: unknown) => { eqs.push([col, val]); return builder; };
    builder.then = (resolve: (v: unknown) => void) => {
      if (table === 'work_items' && eqs.some(([c, v]) => c === 'state' && v === 'completed') && script.work_items_completed) {
        return resolve(script.work_items_completed);
      }
      return resolve(script[table] ?? { data: [], error: null });
    };
    return builder;
  },
  rpc: (_name: string, args: { p_work_item_id: string }) =>
    Promise.resolve(script.classification ? script.classification(args.p_work_item_id) : { data: null, error: null }),
});

const run = (script: Script) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readAutonomousBacklogCandidates(makeClient(script) as any);

describe('readAutonomousBacklogCandidates — projeção do backlog', () => {
  test('monta candidatos: aprovação de maior seq, claim aberto e classificação vigente', async () => {
    const candidates = await run({
      work_items: { data: [{ id: 'a', state: 'approved' }], error: null },
      work_events: {
        data: [
          { work_item_id: 'a', seq: 30, proposal_version: 2, created_at: '2026-08-22T12:00:00Z' },
          { work_item_id: 'a', seq: 10, proposal_version: 1, created_at: '2026-08-22T11:00:00Z' },
        ],
        error: null,
      },
      work_claims: {
        data: [{
          id: 'claim-1', work_item_id: 'a', approved_proposal_version: 2, owner_instance_id: 'sup',
          acquired_at: '2026-08-22T12:01:00Z', expires_at: '2026-08-22T12:31:00Z', attempt_id: null,
        }],
        error: null,
      },
      classification: () => ({ data: { classification: validClassification }, error: null }),
    });

    expect(candidates).toHaveLength(1);
    const [c] = candidates;
    // Aprovação vigente é a de MAIOR seq (o log é ordenado desc; o primeiro vence).
    expect(c!.approval).toEqual({ seq: 30, approvedAt: new Date('2026-08-22T12:00:00Z'), proposalVersion: 2 });
    expect(c!.openClaim).toMatchObject({ claimId: 'claim-1', workItemId: 'a', release: null, attemptId: null });
    expect(c!.currentClassification).toEqual(validClassification);
  });

  test('classificação ausente/ inválida vira null (item não fica pronto, mas entra no backlog)', async () => {
    const candidates = await run({
      work_items: { data: [{ id: 'a', state: 'approved' }], error: null },
      classification: () => ({ data: { classification: { schemaVersion: 1 } }, error: null }), // inválida
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.currentClassification).toBeNull();
    expect(candidates[0]!.approval).toBeNull();
    expect(candidates[0]!.openClaim).toBeNull();
  });

  test('linha de item inválida é descartada (fail-closed), sem derrubar a leitura', async () => {
    const candidates = await run({
      work_items: { data: [{ id: 'THROW', state: 'approved' }, { id: 'ok', state: 'blocked' }], error: null },
      classification: () => ({ data: null, error: null }),
    });
    expect(candidates.map(c => c.item.id)).toEqual(['ok']);
  });

  test('falha ao ler itens → [] (fail-closed: sem candidatos, o driver para em no_eligible_work)', async () => {
    const candidates = await run({ work_items: { data: null, error: { code: '55000', message: 'x' } } });
    expect(candidates).toEqual([]);
  });

  test('inclui a dependência `completed` referenciada (a projeção precisa vê-la p/ satisfazer depends_on)', async () => {
    const depId = '11111111-1111-4111-8111-111111111111';
    const candidates = await run({
      // B (não-terminal) depende de A (completed, terminal → fora do conjunto não-terminal).
      work_items: { data: [{ id: 'b', state: 'approved', intent: { execution_spec: { depends_on_work_item_ids: [depId] } } }], error: null },
      work_items_completed: { data: [{ id: depId, state: 'completed' }], error: null },
      classification: () => ({ data: { classification: validClassification }, error: null }),
    });
    // A dependência completed entra como candidato INERTE, para `projectAutonomousQueue`
    // resolver a dependência (sem ela, B ficaria eternamente inelegível na projeção do driver).
    expect(candidates).toHaveLength(2);
    expect(candidates.map(c => c.item.id)).toEqual(expect.arrayContaining(['b', depId]));
    const dep = candidates.find(c => c.item.id === depId)!;
    expect(dep.item.state).toBe('completed');
    expect(dep.approval).toBeNull();
    expect(dep.openClaim).toBeNull();
    expect(dep.currentClassification).toBeNull();
  });

  test('dependência referenciada que NÃO está completed não é incluída (fail-closed: dependente continua bloqueado)', async () => {
    const depId = '22222222-2222-4222-8222-222222222222';
    const candidates = await run({
      work_items: { data: [{ id: 'b', state: 'approved', intent: { execution_spec: { depends_on_work_item_ids: [depId] } } }], error: null },
      work_items_completed: { data: [], error: null }, // a query por `completed` não encontra A (failed/cancelled/inexistente)
      classification: () => ({ data: { classification: validClassification }, error: null }),
    });
    expect(candidates.map(c => c.item.id)).toEqual(['b']); // só o dependente; A ausente ⇒ projeção falha fechado
  });
});
