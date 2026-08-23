import { materializeNextCanonicalCandidate, type CanonicalMaterializerDeps } from './canonical-materializer';
import { CANONICAL_PROVENANCE_KEY, type CanonicalBacklogCandidate, type CreateWorkProposalCommand } from '@anima/core';
import type { ProjectWorkPlanningResult } from '@/lib/ai/project-work-planner';

// O materializer é provado por DOUBLES (sem planner/LLM/banco reais). Cobre as 15
// regressões: seleção determinística gate o planner; fail-closed sem escrita parcial;
// idempotência; proveniência estável; desfecho máximo `proposed`.

const cand = (
  sourceId: string,
  status: CanonicalBacklogCandidate['status'],
  dependencies: readonly string[] = [],
): CanonicalBacklogCandidate => ({
  sourceId, title: `T ${sourceId}`, status, statusEvidence: null, dependencies,
  sourceRef: { document: 'd.md', heading: `${sourceId} — T`, line: 1 },
});

const validCommand = (): CreateWorkProposalCommand => ({
  sourceMessageId: 'placeholder' as CreateWorkProposalCommand['sourceMessageId'],
  impactLevel: 'low' as CreateWorkProposalCommand['impactLevel'],
  capability: 'programming' as CreateWorkProposalCommand['capability'],
  intent: { execution_spec: { executor: 'worktree' }, planner: 'test' } as CreateWorkProposalCommand['intent'],
  proposal: {
    schemaVersion: 1,
    data: { summary: 's', objective: 'o', includedScope: ['docs/x.md'], excludedScope: [], expectedEffects: [], risks: [] },
  } as CreateWorkProposalCommand['proposal'],
});

interface Spies {
  planCalls: number;
  createCalls: number;
  messageCalls: number;
  lastCommand: CreateWorkProposalCommand | null;
}

const makeDeps = (over: Partial<CanonicalMaterializerDeps> & { materialized?: ReadonlySet<string> }): {
  deps: CanonicalMaterializerDeps; spies: Spies;
} => {
  const spies: Spies = { planCalls: 0, createCalls: 0, messageCalls: 0, lastCommand: null };
  const basePlan = over.planSlice ?? (async (): Promise<ProjectWorkPlanningResult> => ({ ok: true, command: validCommand() }));
  const deps: CanonicalMaterializerDeps = {
    readMaterializedSourceIds: async () => over.materialized ?? new Set<string>(),
    // Conta chamadas mesmo quando o planSlice é injetado.
    planSlice: async (i) => { spies.planCalls++; return basePlan(i); },
    persistSourceMessage: over.persistSourceMessage ?? (async () => { spies.messageCalls++; return 'msg-1'; }),
    createProposal: over.createProposal ?? (async (command) => { spies.createCalls++; spies.lastCommand = command; return { ok: true, workItemId: 'wi-1' }; }),
  };
  return { deps, spies };
};

describe('materializeNextCanonicalCandidate — 15 regressões', () => {
  test('(1) candidato ready → planner UMA vez, proposta criada, ok', async () => {
    const { deps, spies } = makeDeps({ materialized: new Set() });
    const r = await materializeNextCanonicalCandidate({ allCandidates: [cand('DONE-00', 'done'), cand('A-01', 'not_started', ['DONE-00'])] }, deps);
    expect(r).toEqual({ ok: true, workItemId: 'wi-1', sourceId: 'A-01', provenance: expect.objectContaining({ sourceId: 'A-01', kind: 'canonical_backlog' }) });
    expect(spies.planCalls).toBe(1);
    expect(spies.createCalls).toBe(1);
  });

  test('(2) tudo done → planner ZERO, nada criado', async () => {
    const { deps, spies } = makeDeps({});
    const r = await materializeNextCanonicalCandidate({ allCandidates: [cand('A-01', 'done')] }, deps);
    expect(r).toEqual({ ok: false, reason: 'no_candidate:all_settled' });
    expect(spies.planCalls).toBe(0);
    expect(spies.createCalls).toBe(0);
  });

  test('(3) awaiting_review → planner ZERO', async () => {
    const { deps, spies } = makeDeps({});
    await materializeNextCanonicalCandidate({ allCandidates: [cand('A-01', 'awaiting_review')] }, deps);
    expect(spies.planCalls).toBe(0);
  });

  test('(4) unknown → planner ZERO (status_unresolved)', async () => {
    const { deps, spies } = makeDeps({});
    const r = await materializeNextCanonicalCandidate({ allCandidates: [cand('A-01', 'unknown')] }, deps);
    expect(r).toEqual({ ok: false, reason: 'no_candidate:status_unresolved' });
    expect(spies.planCalls).toBe(0);
  });

  test('(5) dependência não resolvida → planner ZERO (awaiting_dependencies)', async () => {
    const { deps, spies } = makeDeps({});
    const r = await materializeNextCanonicalCandidate({ allCandidates: [cand('A-01', 'not_started', ['MISS-99'])] }, deps);
    expect(r).toEqual({ ok: false, reason: 'no_candidate:awaiting_dependencies' });
    expect(spies.planCalls).toBe(0);
  });

  test('(6) sourceId já materializado → sem duplicata (planner ZERO)', async () => {
    const { deps, spies } = makeDeps({ materialized: new Set(['A-01']) });
    const r = await materializeNextCanonicalCandidate({ allCandidates: [cand('A-01', 'not_started')] }, deps);
    expect(r.ok).toBe(false);
    expect(spies.planCalls).toBe(0);
    expect(spies.createCalls).toBe(0);
  });

  test('(7) planner retorna escopo inválido → fail-closed, nada criado', async () => {
    const { deps, spies } = makeDeps({ planSlice: async () => ({ ok: false, message: 'fora dos limites' }) });
    const r = await materializeNextCanonicalCandidate({ allCandidates: [cand('A-01', 'not_started')] }, deps);
    expect(r).toEqual({ ok: false, reason: 'planning_failed:fora dos limites' });
    expect(spies.createCalls).toBe(0);
    expect(spies.messageCalls).toBe(0);
  });

  test('(8) planner backend/permissão inválida → fail-closed (mesmo caminho de escopo)', async () => {
    const { deps, spies } = makeDeps({ planSlice: async () => ({ ok: false, message: 'backend não permitido' }) });
    const r = await materializeNextCanonicalCandidate({ allCandidates: [cand('A-01', 'not_started')] }, deps);
    expect(r.ok).toBe(false);
    expect(spies.createCalls).toBe(0);
  });

  test('(9) planner lança → planning_threw, nada criado', async () => {
    const { deps, spies } = makeDeps({ planSlice: async () => { throw new Error('boom'); } });
    const r = await materializeNextCanonicalCandidate({ allCandidates: [cand('A-01', 'not_started')] }, deps);
    expect(r).toEqual({ ok: false, reason: 'planning_threw:boom' });
    expect(spies.createCalls).toBe(0);
  });

  test('(10a) persistência da mensagem falha → nenhum work_item, create não chamado', async () => {
    const { deps, spies } = makeDeps({ persistSourceMessage: async () => null });
    const r = await materializeNextCanonicalCandidate({ allCandidates: [cand('A-01', 'not_started')] }, deps);
    expect(r).toEqual({ ok: false, reason: 'source_message_persist_failed' });
    expect(spies.createCalls).toBe(0);
  });

  test('(10b) create falha → ok:false, correlação não fica meio-criada', async () => {
    const { deps } = makeDeps({ createProposal: async () => ({ ok: false, error: 'version_conflict' }) });
    const r = await materializeNextCanonicalCandidate({ allCandidates: [cand('A-01', 'not_started')] }, deps);
    expect(r).toEqual({ ok: false, reason: 'create_failed:version_conflict' });
  });

  test('(11) sucesso → exatamente UMA criação de proposta', async () => {
    const { deps, spies } = makeDeps({});
    const r = await materializeNextCanonicalCandidate({ allCandidates: [cand('A-01', 'not_started')] }, deps);
    expect(r.ok).toBe(true);
    expect(spies.createCalls).toBe(1);
    expect(spies.messageCalls).toBe(1);
  });

  test('(12) o work_item carrega proveniência ESTÁVEL até o sourceId (por ID, no intent)', async () => {
    const { deps, spies } = makeDeps({});
    await materializeNextCanonicalCandidate({ allCandidates: [cand('SUP-01', 'not_started')] }, deps);
    const intent = spies.lastCommand!.intent as Record<string, unknown>;
    const prov = intent[CANONICAL_PROVENANCE_KEY] as { sourceId?: string; kind?: string };
    expect(prov.kind).toBe('canonical_backlog');
    expect(prov.sourceId).toBe('SUP-01');
    // sourceMessageId real substituiu o placeholder.
    expect(spies.lastCommand!.sourceMessageId).toBe('msg-1');
  });

  test('(13) replay: com o sourceId já materializado, é idempotente (não duplica)', async () => {
    // 1ª materialização
    const first = makeDeps({ materialized: new Set() });
    const r1 = await materializeNextCanonicalCandidate({ allCandidates: [cand('A-01', 'not_started')] }, first.deps);
    expect(r1.ok).toBe(true);
    // Replay: agora o sourceId aparece na correlação → nenhuma nova criação.
    const second = makeDeps({ materialized: new Set(['A-01']) });
    const r2 = await materializeNextCanonicalCandidate({ allCandidates: [cand('A-01', 'not_started')] }, second.deps);
    expect(r2.ok).toBe(false);
    expect(second.spies.createCalls).toBe(0);
  });

  test('(14) candidato pronto POSTERIOR não é congelado por um bloqueado anterior', async () => {
    const { deps, spies } = makeDeps({});
    const r = await materializeNextCanonicalCandidate({
      allCandidates: [cand('DONE-00', 'done'), cand('B-01', 'not_started', ['MISS-99']), cand('B-02', 'not_started', ['DONE-00'])],
    }, deps);
    expect(r).toEqual({ ok: true, workItemId: 'wi-1', sourceId: 'B-02', provenance: expect.objectContaining({ sourceId: 'B-02' }) });
    expect(spies.planCalls).toBe(1);
  });

  test('(15) materialização NÃO aprova nem executa (só cria proposta; sem portos de approval/execução)', async () => {
    const { deps, spies } = makeDeps({});
    // O driver não expõe nem chama approve/execute — estrutural. O único efeito de mutação
    // é createProposal (create_work_proposal → state=proposed). Confirmamos exatamente isso.
    await materializeNextCanonicalCandidate({ allCandidates: [cand('A-01', 'not_started')] }, deps);
    expect(spies.createCalls).toBe(1);
    expect(Object.keys(deps)).toEqual(expect.arrayContaining(['readMaterializedSourceIds', 'planSlice', 'persistSourceMessage', 'createProposal']));
    expect(Object.keys(deps)).toHaveLength(4); // nenhum porto de approve/execute existe.
  });
});
