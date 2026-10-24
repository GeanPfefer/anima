/** @jest-environment node */
import { finalizeSingleItemTurn, persistPostTurnHostObservations, type PostTurnObservationInput } from './post-turn-observation';
import { persistHostObservedGateEvidence } from './gate-evidence';
import { persistHostObservedCoderEvidence } from './coder-evidence';
import { observeAndPersistHostGitEvidence } from './host-evidence';
import { verifyAndReleaseCandidate } from './mandated-verification';
import { createWorkOrchestrationService } from './server';
import { projectRoot, readExecutionContract } from './executor-selection';
import type { verifyExternalTargetForContract } from './external-target-resolver';

jest.mock('./gate-evidence', () => ({ persistHostObservedGateEvidence: jest.fn() }));
jest.mock('./coder-evidence', () => ({ persistHostObservedCoderEvidence: jest.fn() }));
jest.mock('./host-evidence', () => ({ observeAndPersistHostGitEvidence: jest.fn() }));
jest.mock('./server', () => ({ createWorkOrchestrationService: jest.fn() }));
jest.mock('./mandated-verification', () => ({ ...jest.requireActual('./mandated-verification'), verifyAndReleaseCandidate: jest.fn() }));

const SHA = '1'.repeat(40);
const identity = { repo_root_canonical: '/srv/shop', git_common_dir_canonical: '/srv/shop/.git', root_commit_sha: '2'.repeat(40), base_sha: SHA };
const contractFor = (target: Record<string, unknown>) =>
  readExecutionContract({ execution_spec: { executor: 'worktree', coder_backend: 'codex-cli', model: 'default', base_sha: SHA, target } });

const verifyOk = jest.fn(async () => ({ ok: true as const, reference: 'ext:shop', repoRoot: '/srv/shop-verified', identity: {} as never }));
const verifyBad = jest.fn(async () => ({ ok: false as const, code: 'external_target_identity_changed', message: 'mudou' }));
function input(contract: PostTurnObservationInput['contract'], verify?: typeof verifyExternalTargetForContract): PostTurnObservationInput {
  return {
    client: { rpc: jest.fn(async () => ({ error: null, data: { id: 'claim-own', work_item_id: 'own', attempt_id: 'attempt-own', approved_proposal_version: 1, release_reason: 'attempt_finished', released_at: '2026-10-24T12:00:00Z' } })) },
    result: { outcome: 'execution_interrupted', selection: { workItemId: 'own', approvedProposalVersion: 1 }, attemptId: 'attempt-own', claimId: 'claim-own', terminalKind: 'result', claimReleased: false, requiresAnotherTurn: false },
    contract, gateObservations: [{ label: 'test', exitCode: 0 }], coderObservations: [{ backendId: 'codex-cli:default', seconds: 1 }],
    systemWriter: { gateEvidence: {}, coderEvidence: {}, hostEvidence: {}, verifierOpinion: {}, executionContext: { record: jest.fn() } }, finalizationTimeoutMs: 50,
    executionContext: null, ...(verify ? { verifyExternalTarget: verify } : {}),
  } as unknown as PostTurnObservationInput;
}
beforeEach(() => {
  jest.clearAllMocks();
  (persistHostObservedGateEvidence as jest.Mock).mockResolvedValue({ ok: true });
  (persistHostObservedCoderEvidence as jest.Mock).mockResolvedValue({ ok: true });
  (observeAndPersistHostGitEvidence as jest.Mock).mockResolvedValue({ ok: true });
  (createWorkOrchestrationService as jest.Mock).mockReturnValue({ getItem: jest.fn(), listEvents: jest.fn() });
  (verifyAndReleaseCandidate as jest.Mock).mockResolvedValue({ status: 'released', verdict: 'verified' });
});

describe('observação Git pós-volta × identidade do target', () => {
  test('externo: o Git observado é o do repositório VERIFICADO, nunca o do Anima', async () => {
    await persistPostTurnHostObservations(input(contractFor({ kind: 'project', reference: 'ext:shop', identity }), verifyOk));
    expect(verifyOk).toHaveBeenCalledTimes(1);
    expect(observeAndPersistHostGitEvidence).toHaveBeenCalledWith(expect.objectContaining({ repoRoot: '/srv/shop-verified', baseSha: SHA }), expect.anything());
    expect(observeAndPersistHostGitEvidence).not.toHaveBeenCalledWith(expect.objectContaining({ repoRoot: projectRoot() }), expect.anything());
  });

  test('externo com identidade alterada: nenhuma evidência Git é fabricada e o Single-Item não declara sucesso', async () => {
    const turn = await finalizeSingleItemTurn(input(contractFor({ kind: 'project', reference: 'ext:shop', identity }), verifyBad));
    expect(observeAndPersistHostGitEvidence).not.toHaveBeenCalled();
    expect(verifyAndReleaseCandidate).not.toHaveBeenCalled();
    expect(turn.outcome).not.toBe('execution_completed');
  });

  test('externo cuja verificação LANÇA também retém (fail-closed)', async () => {
    const throwing = jest.fn(async () => { throw new Error('git sumiu'); });
    await persistPostTurnHostObservations(input(contractFor({ kind: 'project', reference: 'ext:shop', identity }), throwing as never));
    expect(observeAndPersistHostGitEvidence).not.toHaveBeenCalled();
  });

  test('regressão: project:anima continua observando o repositório do Anima, sem consultar o resolver externo', async () => {
    await persistPostTurnHostObservations(input(contractFor({ kind: 'project', reference: 'anima' }), verifyOk));
    expect(verifyOk).not.toHaveBeenCalled();
    expect(observeAndPersistHostGitEvidence).toHaveBeenCalledWith(expect.objectContaining({ repoRoot: projectRoot() }), expect.anything());
  });
});
