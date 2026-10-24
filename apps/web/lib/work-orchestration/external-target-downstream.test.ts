/** @jest-environment node */
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

// T1-R2 P2-4: itens `ext:*` jamais chegam a integração, publicação, review request ou recuperação (todas operam sobre o repositório do
// Anima). A recusa é explícita, vem ANTES de qualquer efeito e nunca cai em projectRoot().
const listEvents = jest.fn();
const getItem = jest.fn();
jest.mock('./server', () => ({ createWorkOrchestrationService: jest.fn(() => ({ getItem, listEvents })) }));

import { EXTERNAL_TARGET_NOT_SUPPORTED_DOWNSTREAM, EXTERNAL_TARGET_STATE_UNREADABLE, externalTargetDownstreamRefusal, itemExternalTargetRefusal } from './external-target-downstream';
import { authorizeIntegrationEffect, executeAuthorizedIntegration, type GitIntegrationEffectProvider } from './integration-effect';
import { BranchPublicationPrecondition, executeAuthorizedBranchPublicationWithSupabase } from './authorized-branch-publication';
import { ReviewRequestPrecondition, executeAuthorizedReviewRequestWithSupabase } from './authorized-review-request';
import { recoverFromFailedCandidate } from './candidate-recovery';
import { recoverFromHarnessDefect } from './harness-recovery';

const SHA = 'a'.repeat(40);
const identity = { repo_root_canonical: '/srv/shop', git_common_dir_canonical: '/srv/shop/.git', root_commit_sha: 'b'.repeat(40), base_sha: SHA };
const externalIntent = { execution_spec: { executor: 'worktree', base_sha: SHA, target: { kind: 'project', reference: 'ext:shop', identity } } };
const animaIntent = { execution_spec: { executor: 'worktree', base_sha: SHA, target: { kind: 'project', reference: 'anima' } } };
const disguisedIntent = { execution_spec: { executor: 'worktree', base_sha: SHA, target: { kind: 'project', reference: 'anima', identity } } };

const tripwire = (name: string) => new Proxy({}, { get: (_t, prop) => () => { throw new Error(`efeito indevido: ${name}.${String(prop)}`); } });
const clientWith = (read: () => Promise<{ data: unknown; error: unknown }>, rpc = jest.fn()) => ({
  from: () => { const chain: Record<string, unknown> = {}; for (const m of ['select', 'eq', 'order', 'limit']) chain[m] = () => chain; chain['single'] = read; return chain; },
  rpc,
}) as unknown as SupabaseClient<Database>;

beforeEach(() => { jest.clearAllMocks(); });

describe('guarda pura', () => {
  test('externo e identidade pendurada em referência não-externa são recusados; anima passa', () => {
    expect(externalTargetDownstreamRefusal(externalIntent)).toBe(EXTERNAL_TARGET_NOT_SUPPORTED_DOWNSTREAM);
    expect(externalTargetDownstreamRefusal(disguisedIntent)).toBe(EXTERNAL_TARGET_NOT_SUPPORTED_DOWNSTREAM);
    expect(externalTargetDownstreamRefusal(animaIntent)).toBeNull();
    expect(externalTargetDownstreamRefusal(null)).toBeNull();
  });
  test('leitura do item: externo ⇒ recusa; interno ⇒ null; erro/ausente/exceção ⇒ não comprovado (fail-closed)', async () => {
    expect(await itemExternalTargetRefusal(clientWith(async () => ({ data: { intent: externalIntent }, error: null })), 'w')).toBe(EXTERNAL_TARGET_NOT_SUPPORTED_DOWNSTREAM);
    expect(await itemExternalTargetRefusal(clientWith(async () => ({ data: { intent: animaIntent }, error: null })), 'w')).toBeNull();
    expect(await itemExternalTargetRefusal(clientWith(async () => ({ data: null, error: { message: 'x' } })), 'w')).toBe(EXTERNAL_TARGET_STATE_UNREADABLE);
    expect(await itemExternalTargetRefusal(clientWith(async () => ({ data: null, error: null })), 'w')).toBe(EXTERNAL_TARGET_STATE_UNREADABLE);
    expect(await itemExternalTargetRefusal(clientWith(async () => { throw new Error('rede'); }), 'w')).toBe(EXTERNAL_TARGET_STATE_UNREADABLE);
  });
});

describe('integração (integration-effect)', () => {
  const item = (intent: unknown) => ({ ok: true as const, value: { id: 'w', state: 'completed', intent } });
  const deps = (intent: unknown) => ({
    getItem: async () => item(intent), listEvents: async () => ({ ok: true as const, value: [] }),
    config: { repoRoot: '/anima', repositoryId: 'r', remoteName: 'origin' }, provider: tripwire('provider'), persist: tripwire('persist'),
  }) as never;
  test('execução: denied/external_target_not_supported_downstream antes de planejar ou tocar o provider', async () => {
    expect(await executeAuthorizedIntegration({ workItemId: 'w', integrationAuthorizationId: 'a' }, deps(externalIntent)))
      .toEqual({ status: 'denied', reason: EXTERNAL_TARGET_NOT_SUPPORTED_DOWNSTREAM });
  });
  test('autorização humana do efeito: recusada antes de qualquer leitura de Git ou RPC', async () => {
    const rpc = jest.fn();
    const outcome = await authorizeIntegrationEffect({ workItemId: 'w', authorizationId: 'a' },
      { ...(deps(externalIntent) as object), provider: tripwire('provider') as unknown as GitIntegrationEffectProvider, rpc } as never);
    expect(outcome).toEqual({ ok: false, reason: EXTERNAL_TARGET_NOT_SUPPORTED_DOWNSTREAM });
    expect(rpc).not.toHaveBeenCalled();
  });
  test('regressão: item do Anima segue para o planejamento normal (não é barrado pela guarda)', async () => {
    const outcome = await executeAuthorizedIntegration({ workItemId: 'w', integrationAuthorizationId: 'a' }, deps(animaIntent));
    expect(outcome).not.toEqual({ status: 'denied', reason: EXTERNAL_TARGET_NOT_SUPPORTED_DOWNSTREAM });
  });
});

describe('publicação de branch e review request (entradas da rota)', () => {
  const client = {} as SupabaseClient<Database>;
  const target = { providerId: 'p', repositoryId: 'r', remoteName: 'origin', baseBranch: 'main' } as never;
  test('branch: precondição explícita; eventos e provider nunca tocados', async () => {
    getItem.mockResolvedValue({ ok: true, value: { intent: externalIntent } });
    const provider = tripwire('provider') as never;
    await expect(executeAuthorizedBranchPublicationWithSupabase(client, { workItemId: 'w', target, provider }))
      .rejects.toMatchObject({ name: 'BranchPublicationPrecondition', code: EXTERNAL_TARGET_NOT_SUPPORTED_DOWNSTREAM });
    await expect(executeAuthorizedBranchPublicationWithSupabase(client, { workItemId: 'w', target, provider })).rejects.toBeInstanceOf(BranchPublicationPrecondition);
    expect(listEvents).not.toHaveBeenCalled();
  });
  test('review request: idem', async () => {
    getItem.mockResolvedValue({ ok: true, value: { intent: externalIntent } });
    await expect(executeAuthorizedReviewRequestWithSupabase(client, { workItemId: 'w', target, provider: tripwire('provider') as never }))
      .rejects.toMatchObject({ code: EXTERNAL_TARGET_NOT_SUPPORTED_DOWNSTREAM });
    await expect(executeAuthorizedReviewRequestWithSupabase(client, { workItemId: 'w', target, provider: tripwire('provider') as never })).rejects.toBeInstanceOf(ReviewRequestPrecondition);
    expect(listEvents).not.toHaveBeenCalled();
  });
  test('item ilegível: falha fechada, sem eventos', async () => {
    getItem.mockResolvedValue({ ok: false, error: { message: 'indisponível' } });
    await expect(executeAuthorizedBranchPublicationWithSupabase(client, { workItemId: 'w', target, provider: tripwire('provider') as never })).rejects.toThrow('indisponível');
    expect(listEvents).not.toHaveBeenCalled();
  });
  test('regressão: item do Anima segue para a leitura de eventos', async () => {
    getItem.mockResolvedValue({ ok: true, value: { intent: animaIntent } });
    listEvents.mockResolvedValue({ ok: true, value: [] });
    await expect(executeAuthorizedBranchPublicationWithSupabase(client, { workItemId: 'w', target, provider: tripwire('provider') as never }))
      .rejects.toMatchObject({ code: 'authorization_not_found' });
    expect(listEvents).toHaveBeenCalledTimes(1);
  });
});

describe('recuperações (Git do Anima)', () => {
  const gitTripwire = tripwire('git') as never;
  test('candidato: recusa antes de ler prontidão, Git ou RPC', async () => {
    const rpc = jest.fn();
    const result = await recoverFromFailedCandidate(clientWith(async () => ({ data: { intent: externalIntent }, error: null }), rpc), 'w', {}, gitTripwire);
    expect(result).toMatchObject({ ok: false, code: EXTERNAL_TARGET_NOT_SUPPORTED_DOWNSTREAM, rejected: true });
    expect(rpc).not.toHaveBeenCalled();
  });
  test('harness: recusa antes de ler prontidão, Git ou RPC', async () => {
    const rpc = jest.fn();
    const result = await recoverFromHarnessDefect(clientWith(async () => ({ data: { intent: externalIntent }, error: null }), rpc), 'w',
      { fixCommits: [SHA], evidenceReference: 'docs/registros/x.md', reason: 'motivo de teste com tamanho adequado' } as never, gitTripwire);
    expect(result).toMatchObject({ ok: false, code: EXTERNAL_TARGET_NOT_SUPPORTED_DOWNSTREAM, rejected: true });
    expect(rpc).not.toHaveBeenCalled();
  });
  test('item ilegível: fail-closed nas duas', async () => {
    const unreadable = clientWith(async () => ({ data: null, error: { message: 'x' } }));
    expect(await recoverFromFailedCandidate(unreadable, 'w', {}, gitTripwire)).toMatchObject({ ok: false, code: EXTERNAL_TARGET_STATE_UNREADABLE });
    expect(await recoverFromHarnessDefect(unreadable, 'w', { fixCommits: [SHA], evidenceReference: 'docs/registros/x.md', reason: 'motivo de teste com tamanho adequado' } as never, gitTripwire))
      .toMatchObject({ ok: false, code: EXTERNAL_TARGET_STATE_UNREADABLE });
  });
});
