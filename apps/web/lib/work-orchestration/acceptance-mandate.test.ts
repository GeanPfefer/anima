/** @jest-environment node */
import {
  acceptUnderMandate,
  collectCandidateIntegrity,
  grantAcceptanceMandate,
  mandatedAcceptanceSinkFor,
  mandateGrantorSinkFor,
  NO_REPLACE,
  type AcceptanceReads,
  type GitRunner,
  type MandateGrantorSink,
  type MandatedAcceptanceSink,
} from './acceptance-mandate';
import { createTrustedSystemWriter } from './trusted-system-writer';
import type { AcceptanceMandateGrantRequestV1, MandateRecordView, WorkEvent } from '@anima/core';

const NOW = new Date('2026-10-17T12:00:00.000Z');
const ITEM = '11111111-1111-4111-8111-111111111111';
const MANDATE = '33333333-3333-4333-8333-333333333333';
const SHA = 'a'.repeat(64); const BASE = 'b'.repeat(40); const COMMIT = 'c'.repeat(40);
const FILES = ['packages/core/src/x.test.ts', 'packages/core/src/x.ts'];

const request = (over: Partial<AcceptanceMandateGrantRequestV1> = {}): AcceptanceMandateGrantRequestV1 => ({
  workItemId: ITEM, proposalVersion: 1, contractSha256: SHA, baseSha: BASE, scopeFiles: FILES,
  notBefore: '2026-10-17T12:00:00.000Z', expiresAt: '2026-10-18T11:00:00.000Z', requestId: '22222222-2222-4222-8222-222222222222', ...over,
});

describe('grantAcceptanceMandate (o que o humano VIU)', () => {
  const sink = (over: Partial<{ preview: unknown; grant: unknown }> = {}): MandateGrantorSink & { grant: jest.Mock; preview: jest.Mock } => ({
    preview: jest.fn(async () => over.preview ?? { ok: true, value: { workItemId: ITEM, state: 'approved', proposalVersion: 1, contractSha256: SHA, baseSha: BASE, includedScope: FILES, blockers: [], policyVersion: 'acceptance-mandate-v1' } }),
    grant: jest.fn(async () => over.grant ?? { ok: true, value: { action: 'granted', mandateId: MANDATE, eventSeq: 7 } }),
    revoke: jest.fn(),
  }) as never;
  test('concede quando o hash visto é o atual e não há bloqueios', async () => {
    const s = sink();
    await expect(grantAcceptanceMandate(s, request(), () => NOW)).resolves.toEqual({ ok: true, action: 'granted', mandateId: MANDATE, eventSeq: 7 });
    expect(s.grant).toHaveBeenCalledTimes(1);
  });
  test.each([
    ['pedido inválido (escopo sensível)', request({ scopeFiles: ['supabase/migrations/1.sql'] }), undefined, 'validation'],
    ['janela > 24 h', request({ expiresAt: '2026-10-18T13:00:00.000Z' }), undefined, 'validation'],
    ['hash que o humano não viu', request({ contractSha256: 'f'.repeat(64) }), undefined, 'hash_mismatch'],
    ['versão diferente da atual', request({ proposalVersion: 2 }), undefined, 'hash_mismatch'],
    ['preview com bloqueios', request(), { ok: true, value: { workItemId: ITEM, state: 'approved', proposalVersion: 1, contractSha256: SHA, baseSha: BASE, includedScope: FILES, blockers: ['paid_compute_present'], policyVersion: 'x' } }, 'blocked'],
    ['preview falha', request(), { ok: false, message: 'mandate grantor required' }, 'preview'],
  ] as const)('recusa %s e NÃO chama grant', async (_n, req, preview, stage) => {
    const s = sink(preview ? { preview } : {});
    await expect(grantAcceptanceMandate(s, req, () => NOW)).resolves.toMatchObject({ ok: false, stage });
    expect(s.grant).not.toHaveBeenCalled();
  });
  test('falha de persistência e exceção do preview viram resultado tipado (nunca lançam)', async () => {
    await expect(grantAcceptanceMandate(sink({ grant: { ok: false, message: 'mandate not grantable: x' } }), request(), () => NOW)).resolves.toMatchObject({ ok: false, stage: 'persist' });
    const boom = sink(); boom.preview.mockRejectedValue(new Error('rede'));
    await expect(grantAcceptanceMandate(boom, request(), () => NOW)).resolves.toMatchObject({ ok: false, stage: 'preview', reason: 'rede' });
  });
});

describe('sinks RPC', () => {
  test('grantor: nomes de argumentos e parse do retorno', async () => {
    const rpc = jest.fn()
      .mockResolvedValueOnce({ data: { workItemId: ITEM, state: 'approved', proposalVersion: 1, contractSha256: SHA, baseSha: BASE, includedScope: FILES, blockers: [], policyVersion: 'acceptance-mandate-v1' }, error: null })
      .mockResolvedValueOnce({ data: { action: 'replayed', mandate_id: MANDATE, event_seq: 9 }, error: null })
      .mockResolvedValueOnce({ data: { action: 'revoked', mandate_id: MANDATE }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'mandate grantor required' } });
    const s = mandateGrantorSinkFor({ rpc } as never);
    await expect(s.preview(ITEM)).resolves.toMatchObject({ ok: true, value: { contractSha256: SHA, blockers: [] } });
    await expect(s.grant(request())).resolves.toEqual({ ok: true, value: { action: 'replayed', mandateId: MANDATE, eventSeq: 9 } });
    expect(rpc).toHaveBeenNthCalledWith(2, 'grant_acceptance_mandate', expect.objectContaining({ p_work_item_id: ITEM, p_expected_proposal_version: 1, p_contract_sha256: SHA, p_base_sha: BASE, p_scope_files: FILES, p_request_id: request().requestId }));
    await expect(s.revoke(MANDATE, 'motivo')).resolves.toEqual({ ok: true, value: { action: 'revoked', mandateId: MANDATE } });
    await expect(s.preview(ITEM)).resolves.toEqual({ ok: false, message: 'mandate grantor required' });
  });
  test('preview/grant malformados falham fechado', async () => {
    const s = mandateGrantorSinkFor({ rpc: jest.fn().mockResolvedValue({ data: { foo: 1 }, error: null }) } as never);
    await expect(s.preview(ITEM)).resolves.toEqual({ ok: false, message: 'preview_malformed' });
    await expect(s.grant(request())).resolves.toEqual({ ok: false, message: 'grant_malformed' });
  });
  test('writer: RPC de aceite com correlação e relatório', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: { action: 'accepted', event_seq: 12, mandate_id: MANDATE }, error: null });
    const s = mandatedAcceptanceSinkFor({ rpc } as never);
    const integrity = { schemaVersion: 1 } as never;
    await expect(s.accept({ workItemId: ITEM, proposalVersion: 1, reviewedResultEventId: 'r', mandateId: MANDATE, integrity })).resolves.toEqual({ ok: true, value: { action: 'accepted', eventSeq: 12 } });
    expect(rpc).toHaveBeenCalledWith('accept_work_result_under_mandate', { p_work_item_id: ITEM, p_expected_proposal_version: 1, p_reviewed_result_event_id: 'r', p_mandate_id: MANDATE, p_integrity: integrity });
  });
  test('writer indisponível ⇒ o sink de aceite falha fechado (nunca cai para a sessão residente)', async () => {
    const down = createTrustedSystemWriter(async () => null);
    await expect(down.mandatedAcceptance.accept({ workItemId: ITEM, proposalVersion: 1, reviewedResultEventId: 'r', mandateId: MANDATE, integrity: {} as never })).resolves.toEqual({ ok: false, message: 'trusted_system_writer_unavailable' });
  });
});

describe('collectCandidateIntegrity (Git do lado confiável)', () => {
  const calls: string[][] = [];
  const git = (over: Record<string, { exitCode: number; stdout: string }> = {}): GitRunner => async (args) => {
    calls.push([...args]);
    const key = args.filter(a => a !== NO_REPLACE).join(' ');
    const table: Record<string, { exitCode: number; stdout: string }> = {
      [`cat-file -t ${COMMIT}`]: { exitCode: 0, stdout: 'commit\n' }, [`cat-file -t ${BASE}`]: { exitCode: 0, stdout: 'commit\n' },
      [`cat-file commit ${COMMIT}`]: { exitCode: 0, stdout: `tree ${'e'.repeat(40)}\nparent ${BASE}\nauthor x <x@x> 1 +0000\n\nmsg\n` },
      [`rev-list --parents -n 1 ${COMMIT}`]: { exitCode: 0, stdout: `${COMMIT} ${BASE}\n` },
      [`rev-list --count ${BASE}..${COMMIT}`]: { exitCode: 0, stdout: '1\n' }, [`rev-list --merges --count ${BASE}..${COMMIT}`]: { exitCode: 0, stdout: '0\n' },
      [`merge-base --is-ancestor ${BASE} ${COMMIT}`]: { exitCode: 0, stdout: '' },
      [`diff --name-status --no-renames ${BASE} ${COMMIT}`]: { exitCode: 0, stdout: `A\t${FILES[1]}\nA\t${FILES[0]}\n` },
      [`diff --raw --no-renames ${BASE} ${COMMIT}`]: { exitCode: 0, stdout: `:000000 100644 0000000 1111111 A	${FILES[1]}
:000000 100755 0000000 2222222 A	${FILES[0]}
` },
      ...over,
    };
    return table[key] ?? { exitCode: 128, stdout: '' };
  };
  test('candidato íntegro vira relatório canônico (arquivos e status ordenados)', async () => {
    const r = await collectCandidateIntegrity(git(), { baseSha: BASE, commitSha: COMMIT }, () => NOW);
    expect(r).toMatchObject({ ok: true, value: { schemaVersion: 1, commitSha: COMMIT, baseSha: BASE, parentShas: [BASE], commitCount: 1, mergeCount: 0, baseIsAncestor: true, changedFiles: FILES } });
    expect(r.ok && r.value.changeStatuses).toEqual(FILES.map(path => ({ path, status: 'A' })));
  });
  test('pais do OBJETO divergentes do grafo (shallow/enxerto/replace) falham fechado', async () => {
    const forged = { [`cat-file commit ${COMMIT}`]: { exitCode: 0, stdout: `tree ${'e'.repeat(40)}\nparent ${'d'.repeat(40)}\nauthor x <x@x> 1 +0000\n\nmsg\n` } };
    await expect(collectCandidateIntegrity(git(forged), { baseSha: BASE, commitSha: COMMIT }, () => NOW)).resolves.toEqual({ ok: false, message: 'git_graph_inconsistent' });
    const noParents = { [`cat-file commit ${COMMIT}`]: { exitCode: 0, stdout: `tree ${'e'.repeat(40)}\nauthor x <x@x> 1 +0000\n\nmsg\n` } };
    await expect(collectCandidateIntegrity(git(noParents), { baseSha: BASE, commitSha: COMMIT }, () => NOW)).resolves.toEqual({ ok: false, message: 'git_graph_inconsistent' });
  });
  test('TODA chamada Git roda com --no-replace-objects (refs/replace não pode reescrever o candidato)', async () => {
    calls.length = 0;
    await collectCandidateIntegrity(git(), { baseSha: BASE, commitSha: COMMIT }, () => NOW);
    expect(calls.length).toBeGreaterThanOrEqual(7);
    for (const args of calls) expect(args[0]).toBe(NO_REPLACE);
  });
  test.each([
    ['link simbólico', ':000000 120000 0000000 1111111 A'],
    ['submódulo', ':000000 160000 0000000 1111111 A'],
    ['modo ausente/ilegível', 'lixo'],
  ])('recusa %s com o nome de arquivo correto', async (_n, head) => {
    const raw = { [`diff --raw --no-renames ${BASE} ${COMMIT}`]: { exitCode: 0, stdout: `:000000 100644 0000000 1111111 A	${FILES[1]}
${head}	${FILES[0]}
` } };
    await expect(collectCandidateIntegrity(git(raw), { baseSha: BASE, commitSha: COMMIT }, () => NOW)).resolves.toEqual({ ok: false, message: 'git_unusual_file_mode' });
  });
  test('falha do diff --raw falha fechado', async () => {
    await expect(collectCandidateIntegrity(git({ [`diff --raw --no-renames ${BASE} ${COMMIT}`]: { exitCode: 128, stdout: '' } }), { baseSha: BASE, commitSha: COMMIT }, () => NOW)).resolves.toEqual({ ok: false, message: 'git_unavailable' });
  });
  test('ancestralidade negativa (exit 1) é um FATO, não erro; outros códigos falham fechado', async () => {
    await expect(collectCandidateIntegrity(git({ [`merge-base --is-ancestor ${BASE} ${COMMIT}`]: { exitCode: 1, stdout: '' } }), { baseSha: BASE, commitSha: COMMIT }, () => NOW)).resolves.toMatchObject({ ok: true, value: { baseIsAncestor: false } });
    await expect(collectCandidateIntegrity(git({ [`merge-base --is-ancestor ${BASE} ${COMMIT}`]: { exitCode: 128, stdout: '' } }), { baseSha: BASE, commitSha: COMMIT })).resolves.toEqual({ ok: false, message: 'git_unavailable' });
  });
  test.each([
    ['SHA inválido', { baseSha: 'x', commitSha: COMMIT }, {}, 'invalid_sha'],
    ['commit inexistente', { baseSha: BASE, commitSha: COMMIT }, { [`cat-file -t ${COMMIT}`]: { exitCode: 128, stdout: '' } }, 'commit_not_found'],
    ['objeto não é commit (tree)', { baseSha: BASE, commitSha: COMMIT }, { [`cat-file -t ${COMMIT}`]: { exitCode: 0, stdout: 'tree\n' } }, 'commit_not_found'],
    ['saída de contagem malformada', { baseSha: BASE, commitSha: COMMIT }, { [`rev-list --count ${BASE}..${COMMIT}`]: { exitCode: 0, stdout: 'abc' } }, 'git_output_malformed'],
    ['pais de outro commit', { baseSha: BASE, commitSha: COMMIT }, { [`rev-list --parents -n 1 ${COMMIT}`]: { exitCode: 0, stdout: `${'d'.repeat(40)} ${BASE}\n` } }, 'git_output_malformed'],
    ['diff falha', { baseSha: BASE, commitSha: COMMIT }, { [`diff --name-status --no-renames ${BASE} ${COMMIT}`]: { exitCode: 1, stdout: '' } }, 'git_unavailable'],
  ] as const)('recusa %s', async (_n, input, over, message) => {
    await expect(collectCandidateIntegrity(git(over), input, () => NOW)).resolves.toEqual({ ok: false, message });
  });
  test('git que lança é tratado como indisponível', async () => {
    await expect(collectCandidateIntegrity(async () => { throw new Error('x'); }, { baseSha: BASE, commitSha: COMMIT })).resolves.toMatchObject({ ok: false });
  });
  test('merge e múltiplos commits aparecem no relatório (a política decide)', async () => {
    const r = await collectCandidateIntegrity(git({ [`rev-list --merges --count ${BASE}..${COMMIT}`]: { exitCode: 0, stdout: '1\n' }, [`rev-list --count ${BASE}..${COMMIT}`]: { exitCode: 0, stdout: '3\n' } }), { baseSha: BASE, commitSha: COMMIT }, () => NOW);
    expect(r).toMatchObject({ ok: true, value: { mergeCount: 1, commitCount: 3 } });
  });
});

describe('acceptUnderMandate (orquestração fail-closed)', () => {
  const ev = (seq: number, type: string, data: Record<string, unknown>, author: WorkEvent['author'] = 'system', id = `e${seq}`): WorkEvent => ({
    id, workItemId: ITEM, type: type as WorkEvent['type'], author, proposalVersion: 1, seq, occurredAt: NOW,
    payload: { schema_version: 1, data } as unknown as WorkEvent['payload'],
  });
  const ledger = (): WorkEvent[] => [
    ev(2, 'work_intelligence_classified', { classification: { complexity: 'bounded', risk: 'low', reversibility: 'reversible', planClarity: 'clear', provenance: { kind: 'human_confirmed' } } }, 'user'),
    ev(10, 'work_mandate_granted', {}, 'user'),
    ev(20, 'execution_started', { attempt_id: 'att' }, 'anima'),
    ev(30, 'result_submitted', { attempt_id: 'att', executor_signal: { worktreeHandoff: { commitSha: COMMIT } } }, 'executor', 'res'),
    ev(31, 'host_observed_evidence_recorded', { attempt_id: 'att', evidence: { baseSha: BASE, observedCommitSha: COMMIT, observedChangedFiles: FILES } }, 'system', 'git'),
    ev(32, 'host_observed_execution_context_recorded', {
      attempt_id: 'att', approved_proposal_version: 1, origin: 'host', recorded_by: 'trusted_system_writer', execution_mode: 'unattended', actor_kind: 'automated_runner',
      evidence: { attemptId: 'att', approvedProposalVersion: 1, executionMode: 'unattended', actorKind: 'automated_runner' },
      authority: { approval_author: 'user', approval_authority: 'human', approved_seq: 1, classified_seq: 2, leases_observed: 0, human_acts_after_mandate: 0 } }),
    ev(33, 'verifier_opinion_recorded', { attempt_id: 'att', result_event_id: 'res', verdict: 'verified', verifier_version: 'work-verifier-v6', observed_event_id: 'git',
      opinion: { verifierVersion: 'work-verifier-v6', summary: { gaps: 0, violations: 0 }, findings: [{ code: 'test_binding_satisfied', provenance: 'independent' }] } }),
  ];
  const mandate = (over: Partial<MandateRecordView> = {}): MandateRecordView => ({
    id: MANDATE, workItemId: ITEM, proposalVersion: 1, contractSha256: SHA, baseSha: BASE, scopeFiles: FILES, notBefore: '2026-10-17T11:00:00.000Z',
    expiresAt: '2026-10-18T11:00:00.000Z', allowedActions: ['accept'], policyVersion: 'acceptance-mandate-v1', revokedAt: null, consumedAt: null, grantedEventSeq: 10, ...over,
  });
  const reads = (over: Partial<AcceptanceReads> = {}): AcceptanceReads => ({
    item: { state: 'review', proposalVersion: 1, impactLevel: 'low', intent: { execution_spec: { validation_criteria: [{ claim_kind: 'test_binding' }] } } },
    events: ledger(), mandate: mandate(), ...over,
  });
  const goodGit: GitRunner = async (args) => {
    const k = args.filter(a => a !== NO_REPLACE).join(' ');
    if (k.startsWith('cat-file commit')) return { exitCode: 0, stdout: `tree ${'e'.repeat(40)}\nparent ${BASE}\nauthor x <x@x> 1 +0000\n\nmsg\n` };
    if (k.startsWith('cat-file')) return { exitCode: 0, stdout: 'commit\n' };
    if (k.startsWith('rev-list --parents')) return { exitCode: 0, stdout: `${COMMIT} ${BASE}\n` };
    if (k.startsWith('rev-list --merges')) return { exitCode: 0, stdout: '0\n' };
    if (k.startsWith('rev-list --count')) return { exitCode: 0, stdout: '1\n' };
    if (k.startsWith('merge-base')) return { exitCode: 0, stdout: '' };
    if (k.startsWith('diff --raw')) return { exitCode: 0, stdout: `:000000 100644 0000000 1111111 A	${FILES[0]}
:000000 100644 0000000 2222222 A	${FILES[1]}
` };
    if (k.startsWith('diff')) return { exitCode: 0, stdout: `A\t${FILES[0]}\nA\t${FILES[1]}\n` };
    return { exitCode: 1, stdout: '' };
  };
  const sink = (): MandatedAcceptanceSink & { accept: jest.Mock } => ({ accept: jest.fn(async () => ({ ok: true as const, value: { action: 'accepted' as const, eventSeq: 99 } })) });
  const run = (r: AcceptanceReads, s = sink(), git: GitRunner = goodGit) =>
    acceptUnderMandate({ read: async () => ({ ok: true, value: r }), runGit: git, sink: s, now: () => NOW }, { workItemId: ITEM, mandateId: MANDATE, reviewedResultEventId: 'res' }).then(o => ({ o, s }));

  test('caminho feliz: chama o sink do writer UMA vez com o relatório colhido do Git', async () => {
    const { o, s } = await run(reads());
    expect(o).toEqual({ ok: true, action: 'accepted', eventSeq: 99 });
    expect(s.accept).toHaveBeenCalledTimes(1);
    expect(s.accept.mock.calls[0]![0]).toMatchObject({ workItemId: ITEM, proposalVersion: 1, reviewedResultEventId: 'res', mandateId: MANDATE, integrity: { commitSha: COMMIT, baseSha: BASE, mergeCount: 0, changedFiles: FILES } });
  });
  test.each([
    ['mandato expirado', reads({ mandate: mandate({ expiresAt: '2026-10-17T11:59:00.000Z' }) }), 'mandate_expired'],
    ['mandato revogado', reads({ mandate: mandate({ revokedAt: '2026-10-17T11:30:00Z' }) }), 'mandate_revoked'],
    ['mandato consumido', reads({ mandate: mandate({ consumedAt: '2026-10-17T11:30:00Z' }) }), 'mandate_consumed'],
    ['mandato concedido depois da attempt', reads({ mandate: mandate({ grantedEventSeq: 25 }) }), 'not_anticipated'],
    ['versão diferente', reads({ mandate: mandate({ proposalVersion: 2 }) }), 'wrong_item_or_version'],
    ['item fora de review', reads({ item: { state: 'completed', proposalVersion: 1, impactLevel: 'low', intent: {} } }), 'item_not_in_review'],
    ['impacto acima de low', reads({ item: { state: 'review', proposalVersion: 1, impactLevel: 'significant', intent: {} } }), 'impact_not_low'],
    ['ação ampliada no mandato', reads({ mandate: mandate({ allowedActions: ['accept', 'integrate'] }) }), 'action_not_allowed'],
    ['sem parecer do Verifier', reads({ events: ledger().filter(e => e.type !== 'verifier_opinion_recorded') }), 'verifier_missing'],
    ['Verifier v5', reads({ events: ledger().map(e => e.type === 'verifier_opinion_recorded' ? { ...e, payload: { data: { ...(e.payload as { data: Record<string, unknown> }).data, verifier_version: 'work-verifier-v5' } } as unknown as WorkEvent['payload'] } : e) }), 'verifier_version_too_old'],
    ['sem fato de contexto', reads({ events: ledger().filter(e => e.type !== 'host_observed_execution_context_recorded') }), 'context_fact_missing_or_invalid'],
  ] as const)('pré-checagem recusa %s sem tocar Git nem writer', async (_n, r, defect) => {
    const runGit = jest.fn(goodGit); const s = sink();
    const o = await acceptUnderMandate({ read: async () => ({ ok: true, value: r }), runGit, sink: s, now: () => NOW }, { workItemId: ITEM, mandateId: MANDATE, reviewedResultEventId: 'res' });
    expect(o).toMatchObject({ ok: false, stage: 'precheck' });
    expect(!o.ok && o.defects).toContain(defect);
    expect(runGit).not.toHaveBeenCalled(); expect(s.accept).not.toHaveBeenCalled();
  });
  test.each([
    ['merge no candidato', { 'rev-list --merges': '1\n' }, 'has_merges'],
    ['dois commits', { 'rev-list --count': '2\n' }, 'not_single_child_of_base'],
    ['arquivo extra', { 'diff --name-status': `A\t${FILES[0]}\nA\t${FILES[1]}\nA\tpackages/core/src/extra.ts\n` }, 'scope_mismatch'],
    ['modificação em vez de adição', { 'diff --name-status': `M\t${FILES[0]}\nA\t${FILES[1]}\n` }, 'disallowed_change_status'],
  ] as const)('integridade recusa %s sem chamar o writer', async (_n, patch, defect) => {
    const git: GitRunner = async (args) => { const k = args.filter(a => a !== NO_REPLACE).join(' '); for (const [p, out] of Object.entries(patch)) if (k.startsWith(p)) return { exitCode: 0, stdout: out }; return goodGit(args); };
    const { o, s } = await run(reads(), sink(), git);
    expect(o).toMatchObject({ ok: false, stage: 'integrity_policy', defects: [defect] });
    expect(s.accept).not.toHaveBeenCalled();
  });
  test('o host observou arquivo extra ⇒ recusa mesmo com Git local limpo', async () => {
    const events = ledger().map(e => e.type === 'host_observed_evidence_recorded' ? { ...e, payload: { data: { attempt_id: 'att', evidence: { baseSha: BASE, observedCommitSha: COMMIT, observedChangedFiles: [...FILES, 'y.ts'] } } } as unknown as WorkEvent['payload'] } : e);
    const { o, s } = await run(reads({ events }));
    expect(o).toMatchObject({ ok: false, stage: 'integrity_policy', defects: ['host_scope_mismatch'] });
    expect(s.accept).not.toHaveBeenCalled();
  });
  test('Git indisponível, leitura falha, banco recusa e exceção: sempre resultado tipado, nunca lança', async () => {
    expect((await run(reads(), sink(), async () => ({ exitCode: 128, stdout: '' }))).o).toMatchObject({ ok: false, stage: 'integrity_git' });
    expect(await acceptUnderMandate({ read: async () => ({ ok: false, message: 'rls' }), runGit: goodGit, sink: sink() }, { workItemId: ITEM, mandateId: MANDATE, reviewedResultEventId: 'res' })).toEqual({ ok: false, stage: 'read', reason: 'rls' });
    const refuse = { accept: jest.fn(async () => ({ ok: false as const, message: 'acceptance mandate: contract_changed' })) };
    expect((await run(reads(), refuse as never)).o).toEqual({ ok: false, stage: 'persist', reason: 'acceptance mandate: contract_changed' });
    const boom = { accept: jest.fn(async () => { throw new Error('rede'); }) };
    expect((await run(reads(), boom as never)).o).toMatchObject({ ok: false, stage: 'persist', reason: 'rede' });
  });
  test('replay devolvido pelo banco é repassado', async () => {
    const replay = { accept: jest.fn(async () => ({ ok: true as const, value: { action: 'replayed' as const, eventSeq: 99 } })) };
    expect((await run(reads(), replay as never)).o).toEqual({ ok: true, action: 'replayed', eventSeq: 99 });
  });
});
