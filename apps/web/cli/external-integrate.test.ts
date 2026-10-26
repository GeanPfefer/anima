/** @jest-environment node */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectIntegrationStatus } from '@anima/core';
import { parseArgs } from './args';
import { runWorkExternalIntegrate } from './app';
import { EXIT } from './exit-codes';
import { renderHuman } from './render';
import type { ExternalIntegrationRuntime } from '@/lib/work-orchestration/external-integration-service';
import { authorizeExternalIntegration, executeExternalIntegration, inspectExternalIntegration, isValidAuthorizationId } from '@/lib/work-orchestration/external-integration-service';
import {
  authorize, cleanupSandboxes, CLAMP, count, git, main, TARGET_REF, world, type LeaseState, type World,
} from '@/lib/work-orchestration/external-integration.fixture';

// V1-01 — `work external integrate inspect|authorize|execute`. Banco e Trusted System Writer por doubles; repositórios Git reais e descartáveis.
// Nada toca o residente nem o laboratório original.
jest.setTimeout(120_000);
afterAll(cleanupSandboxes);

const ID = '123e4567-e89b-42d3-a456-426614174000';
const AUTH = 'ext-int-shop-0001-aaaa';

interface Harness { w: World; rt: ExternalIntegrationRuntime; rpcCalls: unknown[]; writer: { ready: boolean }; ids: { n: number } }

/** O RPC espelha `authorize_external_integration_effect`: ff_only, replay idempotente, conflito, item já integrado. */
async function harness(over: Parameters<typeof world>[0] = {}): Promise<Harness> {
  const w = await world(over);
  const rpcCalls: unknown[] = [];
  const writer = { ready: true };
  const ids = { n: 0 };
  const rt: ExternalIntegrationRuntime = {
    config: { ok: true, config: w.deps.config },
    common: { getItem: w.deps.getItem, listEvents: w.deps.listEvents, verifyTarget: w.deps.verifyTarget, gitFor: w.deps.gitFor, exists: w.deps.exists },
    rpc: async args => {
      rpcCalls.push(args);
      if (projectIntegrationStatus(w.events) === 'integrated') return { data: null, error: { message: 'work item already integrated' } };
      const prior = w.events.find(e => e.type === 'integration_effect_authorized' && (e.payload as { data: { authorization_id: string } }).data.authorization_id === args.authorization_id);
      if (prior) {
        const same = (prior.payload as { data: { expected_target_sha: string } }).data.expected_target_sha === args.expected_target_sha;
        return same ? { data: { action: 'replayed', operation_key: (prior.payload as { data: { operation_key: string } }).data.operation_key }, error: null } : { data: null, error: { message: 'integration effect authorization conflict' } };
      }
      authorize(w, { id: args.authorization_id, expected: args.expected_target_sha, targetRef: args.target_ref });
      const event = w.events.at(-1)!;
      return { data: { action: 'recorded', operation_key: (event.payload as { data: { operation_key: string } }).data.operation_key }, error: null };
    },
    lease: w.deps.lease,
    humanReviewRefusal: w.deps.humanReviewRefusal,
    persist: w.deps.persist,
    writerReady: async () => writer.ready,
    workTreeOptions: w.deps.workTreeOptions ?? [],
    newAuthorizationId: reference => `ext-int-${reference.replace(/^ext:/, '')}-${String(++ids.n).padStart(4, '0')}-${Math.random().toString(16).slice(2, 10)}`,
    ownerInstanceId: () => w.deps.ownerInstanceId,
  };
  return { w, rt, rpcCalls, writer, ids };
}
const reflog = (w: World): string => git(w.lab.root, 'reflog', 'show', 'refs/heads/main');
const integrate = (h: Harness, action: 'inspect' | 'authorize' | 'execute', authorizationId?: string) =>
  runWorkExternalIntegrate(h.rt, { workItemId: 'w1', action, ...(authorizationId !== undefined ? { authorizationId } : {}) });

describe('parseArgs — work external integrate', () => {
  test('inspect, authorize e execute --auth-id', () => {
    expect(parseArgs(['work', 'external', 'integrate', 'inspect', ID])).toEqual({ ok: true, command: { kind: 'work-external-integrate', id: ID, action: 'inspect', json: false } });
    expect(parseArgs(['work', 'external', 'integrate', 'authorize', ID, '--json'])).toEqual({ ok: true, command: { kind: 'work-external-integrate', id: ID, action: 'authorize', json: true } });
    expect(parseArgs(['work', 'external', 'integrate', 'execute', ID, '--auth-id', AUTH])).toEqual({ ok: true, command: { kind: 'work-external-integrate', id: ID, action: 'execute', authorizationId: AUTH, json: false } });
  });
  test.each([
    ['sem ação', ['work', 'external', 'integrate']],
    ['ação desconhecida', ['work', 'external', 'integrate', 'merge', ID]],
    ['id não é UUID', ['work', 'external', 'integrate', 'inspect', 'SDC-01']],
    ['execute sem --auth-id (authorize+execute implícito proibido)', ['work', 'external', 'integrate', 'execute', ID]],
    ['--auth-id fora do execute', ['work', 'external', 'integrate', 'authorize', ID, '--auth-id', AUTH]],
    ['--auth-id inválido', ['work', 'external', 'integrate', 'execute', ID, '--auth-id', 'x y']],
    ['--auth-id curto', ['work', 'external', 'integrate', 'execute', ID, '--auth-id', 'abc']],
    ['--auth-id duplicado', ['work', 'external', 'integrate', 'execute', ID, '--auth-id', AUTH, '--auth-id', AUTH]],
    ['--json duplicado', ['work', 'external', 'integrate', 'inspect', ID, '--json', '--json']],
    ['flag desconhecida (sem atalhos de força)', ['work', 'external', 'integrate', 'execute', ID, '--auth-id', AUTH, '--force']],
  ])('recusa: %s', (_n, argv) => expect(parseArgs(argv)).toMatchObject({ ok: false }));
  test('a ajuda lista o comando', () => {
    expect(parseArgs(['work', 'external', 'integrate', '--help'])).toEqual({ ok: true, command: { kind: 'help' } });
  });
  test('identificadores de autorização', () => {
    expect(isValidAuthorizationId(AUTH)).toBe(true);
    for (const bad of ['', 'abc', 'a b c d e f g h', '-leading-dash', 'x'.repeat(129), 42, null]) expect(isValidAuthorizationId(bad)).toBe(false);
  });
});

describe('inspect — somente leitura', () => {
  test('mostra alvo, destino, SHAs, aceite, Verifier, revisão, checkout e integração; sem bloqueios', async () => {
    const h = await harness();
    const before = reflog(h.w);
    const r = await integrate(h, 'inspect');
    expect(r.exitCode).toBe(EXIT.OK);
    expect(r.payload).toMatchObject({ ok: true, kind: 'work-external-integrate', mode: 'inspect', reference: 'ext:shop', destination: TARGET_REF, repoRoot: h.w.lab.root,
      currentDestinationSha: h.w.lab.baseSha, candidateCommitSha: h.w.commit, baseSha: h.w.lab.baseSha, attemptId: h.w.attemptId, accepted: true, verifier: 'verified', humanReview: 'ok',
      fastForwardPossible: true, checkout: 'main_worktree', workingTree: 'clean', integration: 'not_integrated', authorizations: [], writerReady: true, blockers: [], ready: true });
    expect(renderHuman(r.payload)).toContain('Sem bloqueios conhecidos');
    expect(reflog(h.w)).toBe(before); expect(h.w.leaseState.seq).toBe(0); expect(h.w.receipts).toHaveLength(0); expect(h.rpcCalls).toHaveLength(0);
  });

  test('lista bloqueios: sem revisão humana, writer indisponível, árvore suja, destino não configurado', async () => {
    const h = await harness();
    h.w.humanRefusal.value = { code: 'external_human_review_missing', message: 'x' };
    h.writer.ready = false;
    writeFileSync(join(h.w.lab.root, 'src/clamp.js'), CLAMP + '// local\n');
    const r = await integrate(h, 'inspect');
    expect(r.exitCode).toBe(EXIT.OK);
    expect((r.payload as unknown as { blockers: string[] }).blockers).toEqual(expect.arrayContaining(['external_human_review_missing', 'trusted_system_writer_unavailable', 'target_checked_out:working_tree_dirty']));
    expect((r.payload as { ready: boolean }).ready).toBe(false);
    const none = await integrate({ ...h, rt: { ...h.rt, config: { ok: false, code: 'external_integration_not_configured', message: 'm' } } }, 'inspect');
    expect((none.payload as unknown as { blockers: string[]; destination: string | null }).blockers).toContain('external_integration_not_configured');
    expect((none.payload as { destination: string | null }).destination).toBeNull();
  });

  test('item que não é trabalho externo é recusado', async () => {
    const h = await harness();
    h.rt = { ...h.rt, common: { ...h.rt.common, getItem: async () => ({ ok: true as const, value: { ...h.w.item, intent: { execution_spec: { target: { kind: 'project', reference: 'anima' } } } } as never }) } };
    expect(await integrate(h, 'inspect')).toMatchObject({ exitCode: EXIT.REJECTED, payload: { ok: false, code: 'not_external_work' } });
  });
});

describe('authorize — ato separado, sem executar', () => {
  test('registra ff_only com identificador novo e único; não toca o Git, o lease nem o recibo', async () => {
    const h = await harness();
    const before = reflog(h.w);
    const a = await integrate(h, 'authorize');
    expect(a.exitCode).toBe(EXIT.OK);
    expect(a.payload).toMatchObject({ ok: true, kind: 'work-external-integrate', mode: 'authorize', action: 'recorded', expectedTargetSha: h.w.lab.baseSha, targetRef: TARGET_REF });
    const authId = (a.payload as { authorizationId: string }).authorizationId;
    expect(isValidAuthorizationId(authId)).toBe(true);
    expect(authId).toMatch(/^ext-int-shop-/);
    expect(h.rpcCalls[0]).toMatchObject({ work_item_id: 'w1', accepted_result_event_id: 'res-1', target_ref: TARGET_REF, expected_target_sha: h.w.lab.baseSha, authorization_id: authId });
    const event = h.w.events.find(e => e.type === 'integration_effect_authorized')!;
    expect(event.author).toBe('user');
    expect((event.payload as { data: Record<string, unknown> }).data).toMatchObject({ mode: 'ff_only', result_commit_sha: h.w.commit, target_ref: TARGET_REF });
    expect(main(h.w)).toBe(h.w.lab.baseSha); expect(reflog(h.w)).toBe(before);
    expect(h.w.leaseState.seq).toBe(0); expect(h.w.receipts).toHaveLength(0);
    expect(renderHuman(a.payload)).toContain('Nada foi executado');
    const b = await integrate(h, 'authorize');
    expect((b.payload as { authorizationId: string }).authorizationId).not.toBe(authId); // identificador sempre novo
  });

  test('antes do aceite / destino que já avançou além do candidato / ff impossível: recusa e nada é gravado', async () => {
    const h = await harness();
    h.rt = { ...h.rt, common: { ...h.rt.common, getItem: async () => ({ ok: true as const, value: { ...h.w.item, state: 'review' } as never }) } };
    expect(await integrate(h, 'authorize')).toMatchObject({ exitCode: EXIT.REJECTED, payload: { ok: false, code: 'item_not_completed' } });
    const g = await harness();
    git(g.w.lab.root, 'checkout', '-q', '-b', 'work');
    git(g.w.lab.root, 'checkout', '-q', 'main'); writeFileSync(join(g.w.lab.root, 'other.txt'), 'x'); git(g.w.lab.root, 'add', '-A'); git(g.w.lab.root, 'commit', '-q', '-m', 'outro');
    expect(await integrate(g, 'authorize')).toMatchObject({ exitCode: EXIT.REJECTED, payload: { ok: false, code: 'ff_not_possible' } });
    expect(g.rpcCalls).toHaveLength(0);
    expect(g.w.events.some(e => e.type === 'integration_effect_authorized')).toBe(false);
  });

  test('destino/referência não configurados: recusa antes do RPC', async () => {
    const h = await harness();
    h.rt = { ...h.rt, config: { ok: true, config: { reference: 'ext:other', targetRef: TARGET_REF } } };
    expect(await integrate(h, 'authorize')).toMatchObject({ exitCode: EXIT.REJECTED, payload: { ok: false, code: 'reference_not_configured' } });
    expect(h.rpcCalls).toHaveLength(0);
    h.rt = { ...h.rt, config: { ok: false, code: 'external_integration_not_configured', message: 'm' } };
    expect(await integrate(h, 'authorize')).toMatchObject({ exitCode: EXIT.REJECTED, payload: { ok: false, code: 'external_integration_not_configured' } });
  });

  test('replay do mesmo authId é idempotente; conflito é recusado', async () => {
    const h = await harness();
    expect(await authorizeExternalIntegration('w1', h.rt, AUTH)).toMatchObject({ ok: true, action: 'recorded', authorizationId: AUTH });
    expect(await authorizeExternalIntegration('w1', h.rt, AUTH)).toMatchObject({ ok: true, action: 'replayed' });
    expect(h.w.events.filter(e => e.type === 'integration_effect_authorized')).toHaveLength(1);
  });
});

describe('execute — somente o efeito autorizado, falhando fechado', () => {
  async function authorized(): Promise<{ h: Harness; authId: string }> {
    const h = await harness();
    const a = await integrate(h, 'authorize');
    return { h, authId: (a.payload as { authorizationId: string }).authorizationId };
  }

  test('integra: ff, recibo pelo writer, lease completed; main == candidato, 2 commits, projectIntegrationStatus = integrated', async () => {
    const { h, authId } = await authorized();
    const r = await integrate(h, 'execute', authId);
    expect(r.exitCode).toBe(EXIT.OK);
    expect(r.payload).toMatchObject({ ok: true, kind: 'work-external-integrate', mode: 'execute', disposition: 'effected', authorizationId: authId, targetRef: TARGET_REF,
      previousTargetSha: h.w.lab.baseSha, resultingTargetSha: h.w.commit });
    expect(main(h.w)).toBe(h.w.commit); expect(count(h.w)).toBe(2);
    expect(h.w.receipts).toHaveLength(1);
    expect(projectIntegrationStatus(h.w.events)).toBe('integrated');
    expect(h.w.leaseState.released).toEqual([{ id: 'lease-1', reason: 'completed' }]);
    expect(git(h.w.lab.root, 'status', '--porcelain')).toBe('');
    expect(renderHuman(r.payload)).toContain('fast-forward');
  });

  test('authId ausente no banco / de outra operação / inválido: recusa sem tocar o Git nem o lease', async () => {
    const { h } = await authorized();
    for (const id of ['ext-int-shop-9999-ffff', AUTH]) {
      const r = await integrate(h, 'execute', id);
      expect(r).toMatchObject({ exitCode: EXIT.REJECTED, payload: { ok: false, code: 'denied:authorization_not_found' } });
    }
    expect(await executeExternalIntegration('w1', 'x y', h.rt)).toEqual({ status: 'denied', reason: 'authorization_id_invalid' });
    expect(main(h.w)).toBe(h.w.lab.baseSha); expect(h.w.leaseState.seq).toBe(0); expect(h.w.receipts).toHaveLength(0);
  });

  test('executor sem prontidão (Trusted System Writer): recusa ANTES do Git e do lease', async () => {
    const { h, authId } = await authorized();
    h.writer.ready = false;
    expect(await integrate(h, 'execute', authId)).toMatchObject({ exitCode: EXIT.REJECTED, payload: { ok: false, code: 'denied:trusted_system_writer_unavailable' } });
    expect(main(h.w)).toBe(h.w.lab.baseSha); expect(h.w.leaseState.seq).toBe(0); expect(h.w.receipts).toHaveLength(0);
    h.writer.ready = true;
    expect(await integrate(h, 'execute', authId)).toMatchObject({ exitCode: EXIT.OK }); // pronto ⇒ o mesmo authId executa
  });

  test('destino/referência não configurados no host: recusa', async () => {
    const { h, authId } = await authorized();
    h.rt = { ...h.rt, config: { ok: true, config: { reference: 'ext:shop', targetRef: 'refs/heads/release' } } };
    expect(await integrate(h, 'execute', authId)).toMatchObject({ exitCode: EXIT.REJECTED, payload: { code: 'denied:destination_not_configured' } });
    h.rt = { ...h.rt, config: { ok: false, code: 'external_integration_not_configured', message: 'm' } };
    expect(await integrate(h, 'execute', authId)).toMatchObject({ exitCode: EXIT.REJECTED, payload: { code: 'denied:external_integration_not_configured' } });
    expect(main(h.w)).toBe(h.w.lab.baseSha);
  });

  test('destino divergente depois da autorização: authorization_stale, sem mutação', async () => {
    const { h, authId } = await authorized();
    git(h.w.lab.root, 'checkout', '-q', '-b', 'work');
    git(h.w.lab.root, 'checkout', '-q', 'main'); writeFileSync(join(h.w.lab.root, 'other.txt'), 'x'); git(h.w.lab.root, 'add', '-A'); git(h.w.lab.root, 'commit', '-q', '-m', 'outro');
    git(h.w.lab.root, 'checkout', '-q', 'work');
    const before = main(h.w);
    expect(await integrate(h, 'execute', authId)).toMatchObject({ exitCode: EXIT.REJECTED, payload: { code: 'human_required:authorization_stale' } });
    expect(main(h.w)).toBe(before); expect(h.w.receipts).toHaveLength(0);
    const inspected = await integrate(h, 'inspect');
    expect((inspected.payload as unknown as { authorizations: { current: boolean }[] }).authorizations[0]!.current).toBe(false);
  });

  test('falha de lease físico: exclusividade indisponível, nada muda', async () => {
    const { h, authId } = await authorized();
    h.w.leaseState.held.set(h.w.lab.root.toLowerCase(), { id: 'lease-other', owner: 'host-2' });
    const r = await integrate(h, 'execute', authId);
    expect(r.exitCode).toBe(EXIT.REJECTED);
    expect(r.payload).toMatchObject({ ok: false, code: expect.stringMatching(/^human_required:repo_exclusivity_unavailable:/) });
    expect(main(h.w)).toBe(h.w.lab.baseSha); expect(h.w.receipts).toHaveLength(0);
  });

  test('retry idempotente e integração já concluída', async () => {
    const { h, authId } = await authorized();
    expect(await integrate(h, 'execute', authId)).toMatchObject({ exitCode: EXIT.OK, payload: { disposition: 'effected' } });
    const again = await integrate(h, 'execute', authId);
    expect(again).toMatchObject({ exitCode: EXIT.OK, payload: { disposition: 'already_persisted' } });
    expect(h.w.receipts).toHaveLength(1); expect(count(h.w)).toBe(2);
    // outra autorização depois de integrado: recusada (RPC) e execução de outro authId também
    expect(await integrate(h, 'authorize')).toMatchObject({ exitCode: EXIT.REJECTED, payload: { ok: false } });
    expect(await integrate(h, 'execute', 'ext-int-shop-other-0002')).toMatchObject({ exitCode: EXIT.REJECTED, payload: { code: 'denied:already_integrated_by_another_authorization' } });
    const inspected = await integrate(h, 'inspect');
    expect(inspected.payload).toMatchObject({ integration: 'integrated' });
    expect((inspected.payload as unknown as { blockers: string[] }).blockers).toContain('already_integrated');
  });

  test('Git avançou e o recibo falhou: reconciliation_required orienta o retry com o MESMO authId e o retry não repete o efeito', async () => {
    const { h, authId } = await authorized();
    h.w.persistFailOnce.on = true;
    const first = await integrate(h, 'execute', authId);
    expect(first.exitCode).toBe(EXIT.ERROR);
    expect(first.payload).toMatchObject({ ok: false, code: expect.stringMatching(/^reconciliation_required:/) });
    expect(renderHuman(first.payload)).toContain('reexecute o mesmo --auth-id');
    expect(main(h.w)).toBe(h.w.commit);
    const retry = await integrate(h, 'execute', authId);
    expect(retry).toMatchObject({ exitCode: EXIT.OK, payload: { disposition: 'reconciled' } });
    expect(count(h.w)).toBe(2); expect(h.w.receipts).toHaveLength(1);
  });

  test('revisão humana ausente / Verifier ausente: recusa sem Git', async () => {
    const { h, authId } = await authorized();
    h.w.humanRefusal.value = { code: 'external_human_review_missing', message: 'x' };
    expect(await integrate(h, 'execute', authId)).toMatchObject({ exitCode: EXIT.REJECTED, payload: { code: 'human_required:external_human_review_missing' } });
    expect(main(h.w)).toBe(h.w.lab.baseSha); expect(h.w.leaseState.seq).toBe(0);
  });
});

describe('contrato do script operacional preservado', () => {
  test('authorize com authId informado e execute devolvem os mesmos formatos de antes (saída bruta do executor)', async () => {
    const h = await harness();
    const auth = await authorizeExternalIntegration('w1', h.rt, AUTH);
    expect(auth).toMatchObject({ ok: true, authorizationId: AUTH, action: 'recorded', targetRef: TARGET_REF, expectedTargetSha: h.w.lab.baseSha });
    const out = await executeExternalIntegration('w1', AUTH, h.rt);
    expect(out).toMatchObject({ status: 'integrated', disposition: 'effected', receipt: { mode: 'ff_only', resultingTargetSha: h.w.commit, mergeCommitSha: null, mergeParents: [] } });
  });
});

describe('identidade e acesso', () => {
  test('target externo desconhecido neste host / identidade física alterada: authorize e execute recusam, inspect lista o bloqueio', async () => {
    const h = await harness();
    h.rt = { ...h.rt, common: { ...h.rt.common, verifyTarget: async () => ({ ok: false as const, code: 'external_target_unknown', message: 'A referência ext:shop não está autorizada neste host.' }) } };
    expect(await integrate(h, 'authorize')).toMatchObject({ exitCode: EXIT.REJECTED, payload: { ok: false, code: 'external_target_unknown' } });
    expect(h.rpcCalls).toHaveLength(0);
    const inspected = await integrate(h, 'inspect');
    expect((inspected.payload as unknown as { blockers: string[] }).blockers).toContain('external_target_unknown');
    expect(main(h.w)).toBe(h.w.lab.baseSha);
  });

  test('item inacessível (RLS/ausente): erro operacional, sem efeito', async () => {
    const h = await harness();
    h.rt = { ...h.rt, common: { ...h.rt.common, getItem: async () => ({ ok: false as const, error: { code: 'not_found', message: 'item não encontrado' } as never }) } };
    for (const action of ['inspect', 'authorize'] as const) {
      const r = await integrate(h, action);
      expect(r.exitCode).toBe(EXIT.ERROR);
      expect(r.payload).toMatchObject({ ok: false });
    }
    expect(h.rpcCalls).toHaveLength(0);
  });
});
