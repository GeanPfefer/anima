/** @jest-environment node */
import type { MandateRecordView, WorkEvent } from '@anima/core';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AcceptanceReads, MandatedAcceptanceRequest } from './acceptance-mandate';
import { cleanEnv, createRepo, git, SCOPE, tempDir, type FixtureRepo } from './git-fixture.test-helper';
import {
  ACCEPT_EXIT, checkAcceptEnvironment, latestResultEventId, runAcceptMandatedCli, supabaseLedgerReader, type AcceptMandatedCliDeps, type LedgerReader,
} from './mandated-acceptance-run';
import { UNAVAILABLE_TRUSTED_SYSTEM_WRITER, createTrustedSystemWriter, type TrustedSystemWriter } from './trusted-system-writer';

const NOW = new Date('2026-10-17T12:00:00.000Z');
const ITEM = '11111111-1111-4111-8111-111111111111';
const MANDATE = '33333333-3333-4333-8333-333333333333';
const RESULT = '44444444-4444-4444-8444-444444444444';
const SHA256 = 'a'.repeat(64);

interface WorldOptions {
  readonly repo: FixtureRepo;
  readonly handoff?: string;           // commit declarado pelo runner no resultado
  readonly hostCommit?: string;        // commit observado pelo host
  readonly hostFiles?: readonly string[];
  readonly verifier?: { version?: string; gaps?: number; violations?: number; verdict?: string };
  readonly mandate?: Partial<MandateRecordView>;
  readonly noContext?: boolean;
  readonly extraResult?: boolean;
}

const ev = (seq: number, type: string, data: Record<string, unknown>, author = 'system', id = `ev-${seq}`): WorkEvent =>
  ({ id, workItemId: ITEM, type: type as WorkEvent['type'], author: author as WorkEvent['author'], proposalVersion: 1, payload: { schema_version: 1, data } as WorkEvent['payload'], occurredAt: NOW, seq });

function world(o: WorldOptions): AcceptanceReads {
  const { repo } = o; const v = o.verifier ?? {};
  const events: WorkEvent[] = [
    ev(2, 'work_intelligence_classified', { classification: { complexity: 'bounded', risk: 'low', reversibility: 'reversible', planClarity: 'clear', provenance: { kind: 'human_confirmed' } } }, 'user'),
    ev(10, 'work_mandate_granted', {}, 'user'),
    ev(20, 'execution_started', { attempt_id: 'att' }, 'anima'),
    ev(30, 'result_submitted', { attempt_id: 'att', executor_signal: { worktreeHandoff: { commitSha: o.handoff ?? repo.commit } } }, 'executor', RESULT),
    ev(31, 'host_observed_evidence_recorded', { attempt_id: 'att', evidence: { baseSha: repo.base, observedCommitSha: o.hostCommit ?? repo.commit, observedChangedFiles: o.hostFiles ?? SCOPE } }, 'system', 'git'),
    ...(o.noContext ? [] : [ev(32, 'host_observed_execution_context_recorded', {
      attempt_id: 'att', approved_proposal_version: 1, origin: 'host', recorded_by: 'trusted_system_writer', execution_mode: 'unattended', actor_kind: 'automated_runner',
      evidence: { attemptId: 'att', approvedProposalVersion: 1, executionMode: 'unattended', actorKind: 'automated_runner' },
      authority: { approval_author: 'user', approval_authority: 'human', approved_seq: 1, classified_seq: 2, leases_observed: 0, human_acts_after_mandate: 0 } })]),
    ev(33, 'verifier_opinion_recorded', { attempt_id: 'att', result_event_id: RESULT, verdict: v.verdict ?? 'verified', verifier_version: v.version ?? 'work-verifier-v6', observed_event_id: 'git',
      opinion: { verifierVersion: v.version ?? 'work-verifier-v6', summary: { gaps: v.gaps ?? 0, violations: v.violations ?? 0 }, findings: [{ code: 'test_binding_satisfied', provenance: 'independent' }] } }),
    ...(o.extraResult ? [ev(40, 'result_submitted', { attempt_id: 'att2', executor_signal: { worktreeHandoff: { commitSha: repo.commit } } }, 'executor', 'res-newer')] : []),
  ];
  const mandate: MandateRecordView = {
    id: MANDATE, workItemId: ITEM, proposalVersion: 1, contractSha256: SHA256, baseSha: repo.base, scopeFiles: SCOPE,
    notBefore: '2026-10-17T11:00:00.000Z', expiresAt: '2026-10-18T11:00:00.000Z', allowedActions: ['accept'], policyVersion: 'acceptance-mandate-v1',
    revokedAt: null, consumedAt: null, grantedEventSeq: 10, ...o.mandate,
  };
  return { item: { state: 'review', proposalVersion: 1, impactLevel: 'low', intent: { execution_spec: { validation_criteria: [{ claim_kind: 'test_binding' }] } } }, events, mandate };
}

type Accept = jest.Mock<ReturnType<TrustedSystemWriter['mandatedAcceptance']['accept']>, [MandatedAcceptanceRequest]>;
const tripwire = (name: string) => new Proxy({}, { get: () => () => { throw new Error(`sink indevido chamado: ${name}`); } });

function harness(reads: AcceptanceReads | { fail: string }, over: Partial<AcceptMandatedCliDeps> & { accept?: Accept } = {}) {
  const accept: Accept = over.accept ?? jest.fn(async (_r: MandatedAcceptanceRequest) => ({ ok: true as const, value: { action: 'accepted' as const, eventSeq: 99 } }));
  const writer = { available: true, mandatedAcceptance: { accept },
    hostEvidence: tripwire('hostEvidence'), gateEvidence: tripwire('gateEvidence'), coderEvidence: tripwire('coderEvidence'), executionContext: tripwire('executionContext'),
    verifierOpinion: tripwire('verifierOpinion'), integrationReceipt: () => { throw new Error('sink indevido chamado: integrationReceipt'); } } as unknown as TrustedSystemWriter;
  const read = jest.fn(async () => 'fail' in reads ? { ok: false as const, message: reads.fail } : { ok: true as const, value: reads });
  const resolveReader = jest.fn(async (): Promise<LedgerReader | null> => ({ read }));
  const lines: string[] = [];
  const deps: AcceptMandatedCliDeps = { env: cleanEnv(), writer, resolveReader, now: () => NOW, write: (l) => lines.push(l), ...over };
  const out = () => JSON.parse(lines.at(-1) ?? '{}') as Record<string, unknown>;
  return { deps, accept, read, resolveReader, lines, out };
}
const args = (repo: FixtureRepo, extra: string[] = []) => [ITEM, '--mandate', MANDATE, '--repo', repo.root, ...extra];

describe('composição operacional do aceite sob mandato (Git real + ledger + writer)', () => {
  test('caminho feliz: lê o ledger, inspeciona o Git CONFIÁVEL e chama SÓ o sink do writer, com relatório real', async () => {
    const repo = createRepo(); const h = harness(world({ repo }));
    expect(await runAcceptMandatedCli(args(repo), h.deps)).toBe(ACCEPT_EXIT.OK);
    expect(h.accept).toHaveBeenCalledTimes(1);
    const request = h.accept.mock.calls[0]![0];
    expect(request).toMatchObject({ workItemId: ITEM, proposalVersion: 1, reviewedResultEventId: RESULT, mandateId: MANDATE });
    expect(request.integrity).toMatchObject({ schemaVersion: 1, commitSha: repo.commit, baseSha: repo.base, parentShas: [repo.base], commitCount: 1, mergeCount: 0, baseIsAncestor: true, changedFiles: [...SCOPE] });
    expect(request.integrity.changeStatuses).toEqual(SCOPE.map(path => ({ path, status: 'A' })));
    expect(h.out()).toMatchObject({ ok: true, action: 'accepted', eventSeq: 99, resultEventId: RESULT });
  });

  test('ambiente Git hostil do pai (GIT_DIR/OBJECT_DIRECTORY/ALTERNATES/REPLACE/CONFIG) NÃO muda o que é inspecionado', async () => {
    const repo = createRepo(); const decoy = createRepo({ [SCOPE[1]]: 'export const decoy = 1\n' });
    const env = { ...cleanEnv(), GIT_DIR: join(decoy.root, '.git'), GIT_WORK_TREE: decoy.root, GIT_OBJECT_DIRECTORY: join(decoy.root, '.git', 'objects'),
      GIT_ALTERNATE_OBJECT_DIRECTORIES: join(decoy.root, '.git', 'objects'), GIT_REPLACE_REF_BASE: 'refs/evil/', GIT_INDEX_FILE: join(decoy.root, 'idx'),
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: decoy.root } as NodeJS.ProcessEnv;
    const h = harness(world({ repo }), { env });
    expect(await runAcceptMandatedCli(args(repo), h.deps)).toBe(ACCEPT_EXIT.OK);
    expect(h.accept.mock.calls[0]![0].integrity.commitSha).toBe(repo.commit);
  });

  test.each([
    ['filho do runner (ANIMA_EXECUTION_MODE herdado)', { ANIMA_EXECUTION_MODE: 'unattended' }, 'runs_inside_runner_environment'],
    ['runner kind herdado', { ANIMA_EXECUTION_RUNNER_KIND: 'scheduled_launcher' }, 'runs_inside_runner_environment'],
    ['senha do grantor no ambiente', { ANIMA_MANDATE_GRANTOR_PASSWORD: 'x' }, 'grantor_secret_in_acceptance_process'],
    ['token do grantor no ambiente', { ANIMA_MANDATE_GRANTOR_ACCESS_TOKEN: 'x' }, 'grantor_secret_in_acceptance_process'],
  ])('recusa sem NENHUM efeito: %s', async (_n, extra, error) => {
    const repo = createRepo(); const h = harness(world({ repo }), { env: { ...cleanEnv(), ...extra } as NodeJS.ProcessEnv });
    expect(await runAcceptMandatedCli(args(repo), h.deps)).toBe(ACCEPT_EXIT.REFUSED);
    expect(h.out()).toMatchObject({ ok: false, error });
    expect(h.resolveReader).not.toHaveBeenCalled(); expect(h.read).not.toHaveBeenCalled(); expect(h.accept).not.toHaveBeenCalled();
  });

  test('T1-R2: item com target externo é recusado pelo aceite sob mandato, sem inspecionar o Git do Anima nem chamar o sink', async () => {
    const repo = createRepo(); const reads = world({ repo });
    const identity = { repo_root_canonical: '/srv/shop', git_common_dir_canonical: '/srv/shop/.git', root_commit_sha: 'b'.repeat(40), base_sha: 'a'.repeat(40) };
    const external: AcceptanceReads = { ...reads, item: { ...reads.item, intent: { execution_spec: { target: { kind: 'project', reference: 'ext:shop', identity } } } } };
    const runGitFor = jest.fn();
    const h = harness(external, { runGitFor });
    expect(await runAcceptMandatedCli(args(repo), h.deps)).toBe(ACCEPT_EXIT.REFUSED);
    expect(h.out()).toMatchObject({ ok: false, error: 'external_target_not_supported_downstream' });
    expect(runGitFor).not.toHaveBeenCalled(); expect(h.accept).not.toHaveBeenCalled();
  });

  test('writer indisponível: falha ANTES de ler ou inspecionar o Git, sem efeito e sem cair para a sessão residente', async () => {
    const repo = createRepo(); const h = harness(world({ repo }), { writer: UNAVAILABLE_TRUSTED_SYSTEM_WRITER });
    expect(await runAcceptMandatedCli(args(repo), h.deps)).toBe(ACCEPT_EXIT.REFUSED);
    expect(h.out()).toMatchObject({ ok: false, error: 'trusted_system_writer_unavailable' });
    expect(h.resolveReader).not.toHaveBeenCalled();
  });

  test('writer disponível mas a identidade falha no momento da RPC: persist falha fechado (nada aceito)', async () => {
    const repo = createRepo(); const h = harness(world({ repo }), { writer: createTrustedSystemWriter(async () => null) });
    expect(await runAcceptMandatedCli(args(repo), h.deps)).toBe(ACCEPT_EXIT.FAILED);
    expect(h.out()).toMatchObject({ ok: false, stage: 'persist', reason: 'trusted_system_writer_unavailable' });
  });

  test.each([
    ['uso inválido (sem mandato)', [ITEM, '--repo', 'x']],
    ['item não-UUID', ['nao-uuid', '--mandate', MANDATE]],
    ['resultado não-UUID', [ITEM, '--mandate', MANDATE, '--result', 'x']],
  ])('uso: %s', async (_n, argv) => {
    const h = harness(world({ repo: createRepo() }));
    expect(await runAcceptMandatedCli(argv, h.deps)).toBe(ACCEPT_EXIT.USAGE);
    expect(h.accept).not.toHaveBeenCalled();
  });

  test('repositório confiável ausente, relativo, vazio ou redirecionado: recusa sem efeito', async () => {
    const repo = createRepo(); const h = harness(world({ repo }));
    for (const repoArg of [undefined, 'relativo/repo', tempDir('anima-sem-git')]) {
      const argv = [ITEM, '--mandate', MANDATE, ...(repoArg ? ['--repo', repoArg] : [])];
      expect(await runAcceptMandatedCli(argv, h.deps)).toBe(ACCEPT_EXIT.REFUSED);
    }
    const redirect = tempDir('anima-redir'); writeFileSync(join(redirect, '.git'), `gitdir: ${join(repo.root, '.git')}\n`);
    expect(await runAcceptMandatedCli([ITEM, '--mandate', MANDATE, '--repo', redirect], h.deps)).toBe(ACCEPT_EXIT.REFUSED);
    expect(h.out()).toMatchObject({ error: 'trusted_repo_git_is_a_redirect_file' });
    expect(h.accept).not.toHaveBeenCalled();
  });

  test.each([
    ['mandato expirado', { expiresAt: '2026-10-17T11:59:00.000Z' }],
    ['mandato ainda não vigente', { notBefore: '2026-10-17T13:00:00.000Z', expiresAt: '2026-10-17T14:00:00.000Z' }],
    ['mandato revogado', { revokedAt: '2026-10-17T11:30:00.000Z' }],
    ['mandato consumido', { consumedAt: '2026-10-17T11:30:00.000Z' }],
    ['ação não permitida', { allowedActions: ['accept', 'integrate'] }],
    ['política divergente', { policyVersion: 'acceptance-mandate-v0' }],
    ['base do mandato divergente', { baseSha: 'f'.repeat(40) }],
    ['escopo do mandato diferente do observado', { scopeFiles: [SCOPE[1]] }],
  ])('%s: pré-checagem recusa e o writer NÃO é chamado', async (_n, mandate) => {
    const repo = createRepo(); const h = harness(world({ repo, mandate }));
    expect([ACCEPT_EXIT.REFUSED]).toContain(await runAcceptMandatedCli(args(repo), h.deps));
    expect(h.out()).toMatchObject({ ok: false });
    expect(h.accept).not.toHaveBeenCalled();
  });

  test('mandato ausente/outro item/leitura falha: exit FAILED, nada aceito', async () => {
    const repo = createRepo(); const h = harness({ fail: 'mandate_not_found' });
    expect(await runAcceptMandatedCli(args(repo), h.deps)).toBe(ACCEPT_EXIT.FAILED);
    expect(h.out()).toMatchObject({ ok: false, stage: 'read', reason: 'mandate_not_found' });
    expect(h.accept).not.toHaveBeenCalled();
    const unavailable = harness(world({ repo }), { resolveReader: async () => null });
    expect(await runAcceptMandatedCli(args(repo), unavailable.deps)).toBe(ACCEPT_EXIT.FAILED);
    expect(unavailable.out()).toMatchObject({ error: 'ledger_reader_unavailable' });
  });

  test('resultado divergente: --result que não é o corrente é recusado; sem --result usa o mais recente', async () => {
    const repo = createRepo(); const h = harness(world({ repo, extraResult: true }));
    expect(await runAcceptMandatedCli(args(repo, ['--result', RESULT]), h.deps)).toBe(ACCEPT_EXIT.REFUSED);
    expect(h.accept).not.toHaveBeenCalled();
    // o resultado mais recente ('res-newer') não tem parecer correlacionado ⇒ também recusado, e é ESSE o escolhido por padrão
    expect(await runAcceptMandatedCli(args(repo), h.deps)).toBe(ACCEPT_EXIT.REFUSED);
    expect(latestResultEventId(world({ repo, extraResult: true }).events)).toBe('res-newer');
    expect(h.accept).not.toHaveBeenCalled();
  });

  test.each([
    ['Verifier v5', { version: 'work-verifier-v5' }],
    ['lacuna no parecer', { gaps: 1 }],
    ['violação no parecer', { violations: 1 }],
    ['parecer rejeitado', { verdict: 'rejected' }],
    ['parecer inconclusivo', { verdict: 'inconclusive' }],
  ])('parecer inválido (%s): recusa e o writer NÃO é chamado', async (_n, verifier) => {
    const repo = createRepo(); const h = harness(world({ repo, verifier }));
    expect(await runAcceptMandatedCli(args(repo), h.deps)).toBe(ACCEPT_EXIT.REFUSED);
    expect(h.accept).not.toHaveBeenCalled();
  });

  test('sem fato de execution_context da attempt: recusa', async () => {
    const repo = createRepo(); const h = harness(world({ repo, noContext: true }));
    expect(await runAcceptMandatedCli(args(repo), h.deps)).toBe(ACCEPT_EXIT.REFUSED);
    expect(h.accept).not.toHaveBeenCalled();
  });

  describe('Git adulterado / troca de candidato', () => {
    test('troca de candidato: o runner declara OUTRO commit do repositório; o host observou o original ⇒ recusa', async () => {
      const repo = createRepo();
      git(repo.root, 'checkout', '-q', '-b', 'swap', repo.base);
      writeFileSync(join(repo.root, SCOPE[1]), 'export const evil = 1\n'); writeFileSync(join(repo.root, SCOPE[0]), 'x\n');
      git(repo.root, 'add', '-A'); git(repo.root, 'commit', '-q', '-m', 'swap');
      const swapped = git(repo.root, 'rev-parse', 'HEAD');
      const h = harness(world({ repo, handoff: swapped }));
      expect(await runAcceptMandatedCli(args(repo), h.deps)).toBe(ACCEPT_EXIT.REFUSED);
      expect(h.out()).toMatchObject({ ok: false, stage: 'integrity_policy' });
      expect(h.accept).not.toHaveBeenCalled();
    });

    test('ledger e host concordam num commit com arquivo EXTRA no Git real ⇒ recusa na política de integridade', async () => {
      const repo = createRepo({ [SCOPE[0]]: 't\n', [SCOPE[1]]: 'a\n', 'packages/core/src/extra.ts': 'e\n' });
      const h = harness(world({ repo }));
      expect(await runAcceptMandatedCli(args(repo), h.deps)).toBe(ACCEPT_EXIT.REFUSED);
      expect(h.out()).toMatchObject({ ok: false, stage: 'integrity_policy' });
      expect(h.accept).not.toHaveBeenCalled();
    });

    test('commit declarado inexistente no repositório confiável ⇒ recusa (integrity_git)', async () => {
      const repo = createRepo(); const ghost = 'e'.repeat(40);
      const h = harness(world({ repo, handoff: ghost, hostCommit: ghost }));
      expect(await runAcceptMandatedCli(args(repo), h.deps)).toBe(ACCEPT_EXIT.REFUSED);
      expect(h.out()).toMatchObject({ ok: false, stage: 'integrity_git', reason: 'commit_not_found' });
      expect(h.accept).not.toHaveBeenCalled();
    });

    test('refs/replace plantado pelo runner para esconder um arquivo extra NÃO engana o writer', async () => {
      const repo = createRepo({ [SCOPE[0]]: 't\n', [SCOPE[1]]: 'a\n', 'packages/core/src/extra.ts': 'e\n' });
      const honestTree = git(repo.root, 'rev-parse', `${repo.base}^{tree}`);
      const clean = git(repo.root, 'commit-tree', honestTree, '-p', repo.base, '-m', 'limpo');
      git(repo.root, 'replace', '-f', repo.commit, clean); // para o Git comum, o candidato parece limpo
      const h = harness(world({ repo }));
      expect(await runAcceptMandatedCli(args(repo), h.deps)).toBe(ACCEPT_EXIT.REFUSED);
      expect(h.out()).toMatchObject({ ok: false, stage: 'integrity_policy' });
      expect(h.accept).not.toHaveBeenCalled();
    });

    test('link simbólico no escopo ⇒ recusa (modo de arquivo)', async () => {
      const repo = createRepo({ [SCOPE[1]]: 'a\n' });
      const blobFile = join(repo.root, '.blob.tmp'); writeFileSync(blobFile, 'fora');
      git(repo.root, 'update-index', '--add', '--cacheinfo', `120000,${git(repo.root, 'hash-object', '-w', blobFile)},${SCOPE[0]}`);
      git(repo.root, 'commit', '-q', '--amend', '-m', 'symlink');
      const commit = git(repo.root, 'rev-parse', 'HEAD');
      const h = harness(world({ repo, handoff: commit, hostCommit: commit }));
      expect(await runAcceptMandatedCli(args(repo), h.deps)).toBe(ACCEPT_EXIT.REFUSED);
      expect(h.out()).toMatchObject({ ok: false, stage: 'integrity_git', reason: 'git_unusual_file_mode' });
      expect(h.accept).not.toHaveBeenCalled();
    });

    test('candidato com merge ou pai diferente da base ⇒ recusa', async () => {
      const repo = createRepo();
      git(repo.root, 'checkout', '-q', '-b', 'outro', repo.base);
      writeFileSync(join(repo.root, 'README.md'), 'mudou\n'); git(repo.root, 'commit', '-q', '-am', 'divergente');
      const middle = git(repo.root, 'rev-parse', 'HEAD');
      git(repo.root, 'checkout', '-q', '-b', 'cand2', middle);
      writeFileSync(join(repo.root, SCOPE[0]), 't\n'); writeFileSync(join(repo.root, SCOPE[1]), 'a\n');
      git(repo.root, 'add', '-A'); git(repo.root, 'commit', '-q', '-m', 'filho do intermediário');
      const grandchild = git(repo.root, 'rev-parse', 'HEAD');
      const h = harness(world({ repo, handoff: grandchild, hostCommit: grandchild }));
      expect(await runAcceptMandatedCli(args(repo), h.deps)).toBe(ACCEPT_EXIT.REFUSED);
      expect(h.accept).not.toHaveBeenCalled();
    });

    test('.git/shallow forjado pelo runner ⇒ recusa', async () => {
      const repo = createRepo(); writeFileSync(join(repo.root, '.git', 'shallow'), `${repo.commit}\n`);
      const h = harness(world({ repo }));
      expect([ACCEPT_EXIT.REFUSED, ACCEPT_EXIT.FAILED]).toContain(await runAcceptMandatedCli(args(repo), h.deps));
      expect(h.accept).not.toHaveBeenCalled();
    });
  });

  test('replay devolvido pelo banco é repassado como sucesso idempotente', async () => {
    const repo = createRepo(); const accept: Accept = jest.fn(async (_r: MandatedAcceptanceRequest) => ({ ok: true as const, value: { action: 'replayed' as const, eventSeq: 99 } }));
    const h = harness(world({ repo }), { accept });
    expect(await runAcceptMandatedCli(args(repo), h.deps)).toBe(ACCEPT_EXIT.OK);
    expect(h.out()).toMatchObject({ ok: true, action: 'replayed' });
  });

  test('recusa do banco (mandato consumido por outro) ⇒ FAILED com a razão, sem mascarar', async () => {
    const repo = createRepo(); const accept: Accept = jest.fn(async (_r: MandatedAcceptanceRequest) => ({ ok: false as const, message: 'acceptance mandate: mandate_consumed' }));
    const h = harness(world({ repo }), { accept });
    expect(await runAcceptMandatedCli(args(repo), h.deps)).toBe(ACCEPT_EXIT.FAILED);
    expect(h.out()).toMatchObject({ ok: false, stage: 'persist', reason: 'acceptance mandate: mandate_consumed' });
  });
});

describe('checkAcceptEnvironment', () => {
  test('aceita ambiente limpo e recusa marcas do runner e segredos do grantor', () => {
    expect(checkAcceptEnvironment({ PATH: 'x' })).toEqual({ ok: true });
    expect(checkAcceptEnvironment({ ANIMA_EXECUTION_ACTOR: 'automated' })).toEqual({ ok: false, reason: 'runs_inside_runner_environment' });
    expect(checkAcceptEnvironment({ ANIMA_MANDATE_GRANTOR_PASSWORD: 's' })).toEqual({ ok: false, reason: 'grantor_secret_in_acceptance_process' });
    expect(checkAcceptEnvironment({ ANIMA_MANDATE_GRANTOR_EMAIL: 'g@x' })).toEqual({ ok: true });
  });
});

describe('supabaseLedgerReader', () => {
  type Row = Record<string, unknown>;
  const table = (rows: Record<string, { data: unknown; error?: { message: string } }>) => ({
    from: (name: string) => {
      const res = rows[name] ?? { data: null, error: { message: 'tabela inesperada' } };
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'limit']) chain[m] = () => chain;
      chain.maybeSingle = async () => ({ data: res.data, error: res.error ?? null });
      chain.then = (resolve: (v: unknown) => void) => resolve({ data: res.data, error: res.error ?? null });
      return chain;
    },
    rpc: () => { throw new Error('o leitor nunca chama RPC'); },
  });
  const itemRow: Row = { id: ITEM, state: 'review', proposal_version: 1, impact_level: 'low', intent: { execution_spec: {} } };
  const mandateRow: Row = { id: MANDATE, work_item_id: ITEM, proposal_version: 1, contract_sha256: SHA256, base_sha: 'b'.repeat(40), scope_files: [...SCOPE],
    not_before: '2026-10-17T11:00:00Z', expires_at: '2026-10-18T11:00:00Z', allowed_actions: ['accept'], policy_version: 'acceptance-mandate-v1', revoked_at: null, consumed_at: null, granted_event_seq: 10 };
  const eventRow = (seq: number): Row => ({ id: `e${seq}`, work_item_id: ITEM, event_type: 'work_mandate_granted', author: 'user', proposal_version: 1, payload: {}, created_at: '2026-10-17T10:00:00Z', seq });
  const reader = (rows: Parameters<typeof table>[0]) => supabaseLedgerReader(table(rows) as never);

  test('mapeia item, mandato e eventos (ordenados) para o modelo do núcleo', async () => {
    const r = await reader({ work_items: { data: itemRow }, work_acceptance_mandates: { data: mandateRow }, work_events: { data: [eventRow(1), eventRow(2)] } }).read(ITEM, MANDATE);
    expect(r).toMatchObject({ ok: true, value: {
      item: { state: 'review', proposalVersion: 1, impactLevel: 'low' },
      mandate: { id: MANDATE, workItemId: ITEM, allowedActions: ['accept'], grantedEventSeq: 10, scopeFiles: [...SCOPE] },
    } });
    expect(r.ok && r.value.events.map(e => e.seq)).toEqual([1, 2]);
  });
  test.each([
    ['item ausente', { work_items: { data: null }, work_acceptance_mandates: { data: mandateRow }, work_events: { data: [eventRow(1)] } }, 'item_not_found'],
    ['erro ao ler item', { work_items: { data: null, error: { message: 'rls' } }, work_acceptance_mandates: { data: mandateRow }, work_events: { data: [eventRow(1)] } }, 'item_read_failed: rls'],
    ['mandato ausente', { work_items: { data: itemRow }, work_acceptance_mandates: { data: null }, work_events: { data: [eventRow(1)] } }, 'mandate_not_found'],
    ['mandato de outro item', { work_items: { data: itemRow }, work_acceptance_mandates: { data: { ...mandateRow, work_item_id: 'outro' } }, work_events: { data: [eventRow(1)] } }, 'mandate_belongs_to_another_item'],
    ['sem eventos', { work_items: { data: itemRow }, work_acceptance_mandates: { data: mandateRow }, work_events: { data: [] } }, 'events_unavailable_or_truncated'],
    ['eventos truncados', { work_items: { data: itemRow }, work_acceptance_mandates: { data: mandateRow }, work_events: { data: Array.from({ length: 5000 }, (_v, i) => eventRow(i + 1)) } }, 'events_unavailable_or_truncated'],
    ['erro ao ler eventos', { work_items: { data: itemRow }, work_acceptance_mandates: { data: mandateRow }, work_events: { data: null, error: { message: 'boom' } } }, 'events_read_failed: boom'],
  ])('falha fechado: %s', async (_n, rows, message) => {
    expect(await reader(rows as never).read(ITEM, MANDATE)).toEqual({ ok: false, message });
  });
});
