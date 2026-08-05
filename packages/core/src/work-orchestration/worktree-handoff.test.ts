import {
  buildWorktreeHandoff,
  isAnimaWorktreeBranch,
  parseWorktreeHandoff,
  projectWorktreeHandoff,
  type BuildWorktreeHandoffInput,
  type WorktreeHandoffResult,
  type WorktreeHandoffV1,
} from '.';
import type { WorkEvent } from '.';
import * as WorktreeHandoffModule from './worktree-handoff';
import type { Json } from '@anima/types';

const BASE_SHA = 'a'.repeat(40);
const COMMIT_SHA = 'b'.repeat(40);

const baseInput = (overrides: Partial<BuildWorktreeHandoffInput> = {}): BuildWorktreeHandoffInput => ({
  workItemId: 'item-1',
  attemptId: 'attempt-1',
  approvedProposalVersion: 2,
  executorId: 'worktree-v1',
  backendId: 'ollama',
  model: 'qwen3-coder:latest',
  baseSha: BASE_SHA,
  branch: 'anima-work/attempt-1',
  commitSha: COMMIT_SHA,
  status: 'succeeded',
  changedFiles: ['packages/core/src/live-proof.ts'],
  diffFiles: [{ path: 'packages/core/src/live-proof.ts', insertions: 6, deletions: 0 }],
  gates: [{ label: 'testes do core', command: 'npm test --workspace=packages/core', exitCode: 0, outcome: 'passed' }],
  createdAt: '2026-08-05T12:00:00.000Z',
  ...overrides,
});

const ok = (result: WorktreeHandoffResult): WorktreeHandoffV1 => {
  if (!result.ok) throw new Error(`esperava sucesso, veio defeito ${result.defect}: ${result.explanation}`);
  return result.value;
};

const asJson = (handoff: WorktreeHandoffV1): Json => JSON.parse(JSON.stringify(handoff)) as Json;

/** Evento `result_submitted` com o formato exato que a RPC de término persiste:
 * o sinal inteiro em `data.executor_signal`, com a correlação em snake_case. */
const resultEvent = (handoff: WorktreeHandoffV1 | null, correlation?: { workItemId?: string; attemptId?: string; approvedProposalVersion?: number }): WorkEvent => ({
  id: 'ev-result',
  workItemId: correlation?.workItemId ?? handoff?.workItemId ?? 'item-1',
  type: 'result_submitted',
  author: 'executor',
  proposalVersion: 2,
  payload: {
    schema_version: 1,
    data: {
      work_item_id: correlation?.workItemId ?? handoff?.workItemId ?? 'item-1',
      attempt_id: correlation?.attemptId ?? handoff?.attemptId ?? 'attempt-1',
      approved_proposal_version: correlation?.approvedProposalVersion ?? handoff?.approvedProposalVersion ?? 2,
      summary: 'Alteração produzida e validada em worktree isolada.',
      handoff_reference: 'worktree:anima:anima-work/attempt-1',
      executor_signal: {
        kind: 'result',
        summary: 'ok',
        resultReferences: ['worktree-branch:anima-work/attempt-1'],
        validations: [{ label: 'testes do core', outcome: 'passed' }],
        limitations: [],
        handoffReference: 'worktree:anima:anima-work/attempt-1',
        ...(handoff ? { worktreeHandoff: asJson(handoff) } : {}),
      },
    },
  } as Json,
  occurredAt: new Date('2026-08-05T12:00:01.000Z'),
});

describe('worktree durable handoff — contrato', () => {
  // 1
  it('constrói um handoff válido e nasce local_only', () => {
    const handoff = ok(buildWorktreeHandoff(baseInput()));
    expect(handoff.schemaVersion).toBe(1);
    expect(handoff.status).toBe('succeeded');
    expect(handoff.publicationState).toBe('local_only');
    expect(handoff.diffSummary).toEqual({
      filesChanged: 1, insertions: 6, deletions: 0,
      files: [{ path: 'packages/core/src/live-proof.ts', insertions: 6, deletions: 0 }],
    });
    expect(handoff.safeError).toBeNull();
  });

  // 2
  it('faz parse de um JSON persistido válido', () => {
    const built = ok(buildWorktreeHandoff(baseInput()));
    const parsed = parseWorktreeHandoff(asJson(built));
    expect(parsed).not.toBeNull();
    expect(parsed?.commitSha).toBe(COMMIT_SHA);
    expect(parsed?.branch).toBe('anima-work/attempt-1');
  });

  // 3
  it('é idempotente no round-trip build → serialize → parse', () => {
    const built = ok(buildWorktreeHandoff(baseInput()));
    expect(parseWorktreeHandoff(asJson(built))).toEqual(built);
  });

  // 4
  it('projeta o handoff durável do último result_submitted', () => {
    const built = ok(buildWorktreeHandoff(baseInput()));
    const projected = projectWorktreeHandoff([resultEvent(built)]);
    expect(projected).toEqual(built);
  });

  it('projeta null quando o resultado não trouxe worktreeHandoff', () => {
    expect(projectWorktreeHandoff([resultEvent(null)])).toBeNull();
  });

  // 5
  it('rejeita versão de schema desconhecida', () => {
    const built = ok(buildWorktreeHandoff(baseInput()));
    const tampered = { ...(asJson(built) as Record<string, Json>), schemaVersion: 2 } as Json;
    expect(parseWorktreeHandoff(tampered)).toBeNull();
  });

  // 6
  it('projeta null quando a correlação do handoff não bate com o evento', () => {
    const built = ok(buildWorktreeHandoff(baseInput()));
    expect(projectWorktreeHandoff([resultEvent(built, { workItemId: 'outro-item' })])).toBeNull();
    expect(projectWorktreeHandoff([resultEvent(built, { attemptId: 'outra-tentativa' })])).toBeNull();
  });

  // 7
  it('projeta null quando a proposal version do handoff não bate com o evento', () => {
    const built = ok(buildWorktreeHandoff(baseInput()));
    expect(projectWorktreeHandoff([resultEvent(built, { approvedProposalVersion: 99 })])).toBeNull();
  });

  // 8
  it('rejeita SHA inválido e SHA base idêntico ao commit', () => {
    expect(buildWorktreeHandoff(baseInput({ commitSha: 'zzz' }))).toMatchObject({ ok: false, defect: 'invalid_git_reference' });
    expect(buildWorktreeHandoff(baseInput({ baseSha: BASE_SHA, commitSha: BASE_SHA }))).toMatchObject({ ok: false, defect: 'invalid_git_reference' });
    const built = ok(buildWorktreeHandoff(baseInput()));
    expect(parseWorktreeHandoff({ ...(asJson(built) as Record<string, Json>), commitSha: 'nope' } as Json)).toBeNull();
  });

  // 9
  it('rejeita branch fora do namespace anima-work/', () => {
    expect(isAnimaWorktreeBranch('main')).toBe(false);
    expect(isAnimaWorktreeBranch('anima-work/../main')).toBe(false);
    expect(buildWorktreeHandoff(baseInput({ branch: 'feature/x' }))).toMatchObject({ ok: false, defect: 'branch_not_owned' });
    expect(buildWorktreeHandoff(baseInput({ branch: 'main' }))).toMatchObject({ ok: false, defect: 'branch_not_owned' });
    const built = ok(buildWorktreeHandoff(baseInput()));
    expect(parseWorktreeHandoff({ ...(asJson(built) as Record<string, Json>), branch: 'main' } as Json)).toBeNull();
  });

  // 10
  it('rejeita handoff sem nenhum gate', () => {
    expect(buildWorktreeHandoff(baseInput({ gates: [] }))).toMatchObject({ ok: false, defect: 'invalid_gates' });
  });

  // 11
  it('representa corretamente um gate reprovado', () => {
    const failedGate = { label: 'testes do core', command: 'npm test --workspace=packages/core', exitCode: 1, outcome: 'failed' as const };
    // sucesso com gate reprovado é incoerente → recusado
    expect(buildWorktreeHandoff(baseInput({ gates: [failedGate] }))).toMatchObject({ ok: false, defect: 'invalid_gates' });
    // falha honesta com o gate reprovado registrado → aceito e preservado
    const failed = ok(buildWorktreeHandoff(baseInput({ status: 'failed', gates: [failedGate], safeError: 'Gate falhou: código 1.' })));
    expect(failed.status).toBe('failed');
    expect(failed.gates[0]?.outcome).toBe('failed');
    expect(failed.safeError).toBe('Gate falhou: código 1.');
    // falha sem nenhum gate reprovado é incoerente → recusada
    expect(buildWorktreeHandoff(baseInput({ status: 'failed', gates: [{ label: 'x', command: 'npm test', exitCode: 0, outcome: 'passed' }] })))
      .toMatchObject({ ok: false, defect: 'invalid_status' });
    // sucesso não pode carregar erro
    expect(buildWorktreeHandoff(baseInput({ safeError: 'algum erro' }))).toMatchObject({ ok: false, defect: 'invalid_status' });
  });

  // 12
  it('rejeita segredo em metadado, diff, gate ou erro', () => {
    expect(buildWorktreeHandoff(baseInput({ changedFiles: ['src/x.ts'], diffFiles: [{ path: 'src/x.ts', insertions: 1, deletions: 0 }], gates: [{ label: 'api_key=abc123', command: 'npm test', exitCode: 0, outcome: 'passed' }] })))
      .toMatchObject({ ok: false, defect: 'sensitive_data' });
    expect(buildWorktreeHandoff(baseInput({ status: 'failed', gates: [{ label: 't', command: 'npm test', exitCode: 1, outcome: 'failed' }], safeError: 'falhou com Authorization: Bearer eyJhbGciOiInR5cC.payloadpart.signature' })))
      .toMatchObject({ ok: false, defect: 'sensitive_data' });
    expect(buildWorktreeHandoff(baseInput({ model: 'access_token=sk-live-xyz' }))).toMatchObject({ ok: false, defect: 'sensitive_data' });
  });

  // 13
  it('rejeita caminho absoluto (Windows e POSIX)', () => {
    expect(buildWorktreeHandoff(baseInput({ changedFiles: ['C:\\Users\\gean\\anima\\x.ts'], diffFiles: [{ path: 'C:\\Users\\gean\\anima\\x.ts', insertions: 1, deletions: 0 }] })))
      .toMatchObject({ ok: false, defect: 'sensitive_data' });
    expect(buildWorktreeHandoff(baseInput({ changedFiles: ['/home/gean/anima/x.ts'], diffFiles: [{ path: '/home/gean/anima/x.ts', insertions: 1, deletions: 0 }] })))
      .toMatchObject({ ok: false, defect: 'sensitive_data' });
  });

  // 14
  it('rejeita payload acima dos limites', () => {
    expect(buildWorktreeHandoff(baseInput({ status: 'failed', gates: [{ label: 't', command: 'npm test', exitCode: 1, outcome: 'failed' }], safeError: 'e'.repeat(5000) })))
      .toMatchObject({ ok: false, defect: 'payload_too_large' });
    const manyGates = Array.from({ length: 101 }, (_, i) => ({ label: `g${i}`, command: 'npm test', exitCode: 0, outcome: 'passed' as const }));
    expect(buildWorktreeHandoff(baseInput({ gates: manyGates }))).toMatchObject({ ok: false, defect: 'payload_too_large' });
    expect(buildWorktreeHandoff(baseInput({ executorId: 'x'.repeat(300) }))).toMatchObject({ ok: false, defect: 'payload_too_large' });
  });

  // 15
  it('é utilizável depois que a worktree não existe mais (dado puro, sem fs)', () => {
    // Simula o handoff persistido há muito tempo: só o JSON, nenhuma worktree,
    // nenhum caminho vivo. O parse reconstrói toda a evidência durável.
    const persisted = asJson(ok(buildWorktreeHandoff(baseInput())));
    const revived = parseWorktreeHandoff(persisted);
    expect(revived).not.toBeNull();
    expect(revived?.baseSha).toBe(BASE_SHA);
    expect(revived?.commitSha).toBe(COMMIT_SHA);
    expect(revived?.branch).toBe('anima-work/attempt-1');
    expect(revived?.changedFiles).toEqual(['packages/core/src/live-proof.ts']);
    expect(revived?.gates).toHaveLength(1);
  });

  // 16
  it('é um módulo puro: não expõe aplicar/mergear/enviar e nunca publica ao construir', () => {
    const exportedFunctions = Object.entries(WorktreeHandoffModule)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name)
      .sort();
    expect(exportedFunctions).toEqual(['buildWorktreeHandoff', 'isAnimaWorktreeBranch', 'parseWorktreeHandoff', 'projectWorktreeHandoff']);
    for (const name of exportedFunctions) {
      expect(name).not.toMatch(/apply|merge|push|integrate|publish|commit/i);
    }
    // Construir jamais afirma publicação/aplicação.
    expect(ok(buildWorktreeHandoff(baseInput())).publicationState).toBe('local_only');
  });
});
