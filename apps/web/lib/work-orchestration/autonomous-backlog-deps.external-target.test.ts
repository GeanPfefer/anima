/** @jest-environment node */
import type { AutonomousQueueEntry, ProposalVersion, WorkItemId } from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

// Target externo: identidade autorizada × repositório vivo é conferida DENTRO de `runTurn`, antes de
// `runSupervisorTurn` (única porta de claim/attempt). Supervisor e governor mockados.
jest.mock('./resource-governor', () => ({
  readResourceAdmission: jest.fn(() => ({ verdict: 'permit', pressure: 'low' as const })),
  readMachinePressure: jest.fn(() => 'low' as const),
}));
jest.mock('./supervisor', () => ({ runSupervisorTurn: jest.fn(async () => { throw new Error('stop-after-selection'); }) }));

import { buildProjectBacklogCycleDeps } from './autonomous-backlog-deps';
import { runSupervisorTurn } from './supervisor';

const SHA = 'a'.repeat(40);
const identity = { repo_root_canonical: '/srv/shop', git_common_dir_canonical: '/srv/shop/.git', root_commit_sha: 'b'.repeat(40), base_sha: SHA };
const entryFor = (targetReference: string): AutonomousQueueEntry => ({
  workItemId: '00000000-0000-0000-0000-0000000000b1' as WorkItemId, approvedProposalVersion: 1 as ProposalVersion,
  approvalSeq: 1, approvedAt: new Date(), capability: 'programming', targetReference, queuePosition: 0, targetOccupied: false,
});
const clientFor = (target: Record<string, unknown>) => {
  const intent = { execution_spec: { executor: 'worktree', coder_backend: 'ollama', model: 'qwen3-coder:latest', base_sha: SHA, target,
    validation_criteria: [{ label: 'testes', command: 'npm test' }] } };
  return {
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain, eq: () => chain, order: () => chain,
        maybeSingle: async () => ({ data: table === 'work_items' ? { intent } : null, error: null }),
        limit: async () => ({ data: [], error: null }),
      };
      return chain;
    },
    rpc: async () => ({ data: null, error: null }),
  } as unknown as SupabaseClient<Database>;
};
const externalTarget = { kind: 'project', reference: 'ext:shop', identity };

describe('buildProjectBacklogCycleDeps — target externo antes do claim', () => {
  beforeEach(() => jest.clearAllMocks());

  test('identidade alterada/desconhecida: selection_not_executable, sem claim nem attempt', async () => {
    for (const code of ['external_target_identity_changed', 'external_target_unknown', 'external_target_not_configured']) {
      const verify = jest.fn(async () => ({ ok: false as const, code, message: 'recusado' }));
      const deps = buildProjectBacklogCycleDeps(clientFor(externalTarget), 'owner', { verifyExternalTarget: verify });
      expect(deps.hostPermitsAutonomousWork()).toBe(true);
      const turn = await deps.runTurn(entryFor('ext:shop'), new AbortController().signal);
      expect(turn.outcome).toBe('selection_not_executable');
      expect(turn.refusal?.code).toBe(code);
      expect(turn.attemptId).toBeNull();
      expect(turn.claimId).toBeNull();
    }
    expect(runSupervisorTurn).not.toHaveBeenCalled();
  });

  test('target verificado: a rota entregue ao Supervisor resolve a raiz VERIFICADA e nenhuma outra', async () => {
    const verify = jest.fn(async () => ({ ok: true as const, reference: 'ext:shop', repoRoot: '/srv/shop-verified', identity: {} as never }));
    const deps = buildProjectBacklogCycleDeps(clientFor(externalTarget), 'owner', { verifyExternalTarget: verify });
    expect(deps.hostPermitsAutonomousWork()).toBe(true);
    await expect(deps.runTurn(entryFor('ext:shop'), new AbortController().signal)).rejects.toThrow('stop-after-selection');
    expect(verify).toHaveBeenCalledTimes(1);
    const routes = (runSupervisorTurn as jest.Mock).mock.calls[0][0].routes as Array<{ adapter: { options: { targets: { resolve: (r: string) => { repoRoot: string } | null } } } }>;
    expect(routes[0]!.adapter.options.targets.resolve('ext:shop')).toMatchObject({ repoRoot: '/srv/shop-verified' });
    expect(routes[0]!.adapter.options.targets.resolve('anima')).toBeNull();
  });

  test('sem verificador injetado, o resolver real recusa target externo não configurado no host', async () => {
    const saved = process.env.ANIMA_EXTERNAL_TARGET; delete process.env.ANIMA_EXTERNAL_TARGET;
    try {
      const deps = buildProjectBacklogCycleDeps(clientFor(externalTarget), 'owner');
      expect(deps.hostPermitsAutonomousWork()).toBe(true);
      const turn = await deps.runTurn(entryFor('ext:shop'), new AbortController().signal);
      expect(turn.refusal?.code).toBe('external_target_not_configured');
      expect(runSupervisorTurn).not.toHaveBeenCalled();
    } finally { if (saved !== undefined) process.env.ANIMA_EXTERNAL_TARGET = saved; }
  });

  test('regressão: project:anima não passa pelo resolver externo', async () => {
    const verify = jest.fn();
    const deps = buildProjectBacklogCycleDeps(clientFor({ kind: 'project', reference: 'anima' }), 'owner', { verifyExternalTarget: verify });
    expect(deps.hostPermitsAutonomousWork()).toBe(true);
    await expect(deps.runTurn(entryFor('anima'), new AbortController().signal)).rejects.toThrow('stop-after-selection');
    expect(verify).not.toHaveBeenCalled();
  });
});
