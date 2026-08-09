import {
  acceptResultForIntegration,
  buildIntegrationPublicationRequest,
  buildIntegrationRecordInput,
  buildWorktreeHandoff,
  decideIntegration,
  produceResultForIntegration,
  publicationIdempotencyKey,
  recordIntegrated,
  validatePublicationOutcome,
  type ExecutionEventCorrelation,
  type IntegrationBoundary,
  type IntegrationPublicationOutcome,
  type IntegrationPublicationRequest,
  type IntegrationPublisher,
  type TerminalExecutionAttempt,
  type WorktreeHandoffV1,
} from '.';

// Substrato puro da camada de integração/publicação (ADR-002). Cobre as linhas
// 🆕 da matriz de invariantes: publicação só derivável de autorização, correlação
// e namespace fail-closed, idempotência determinística, o estado interno que não
// mente diante de falha externa, e o laço puro autorizado→publicado→integrated.

const BASE_SHA = 'a'.repeat(40);
const COMMIT_SHA = 'b'.repeat(40);

const attempt: TerminalExecutionAttempt = {
  attemptId: 'attempt-1',
  workItemId: 'work-1',
  approvedProposalVersion: 3,
  status: 'succeeded',
  executorId: 'worktree-v1',
  startedAt: new Date('2026-08-09T10:00:00Z'),
  finishedAt: new Date('2026-08-09T10:10:00Z'),
  resultSummary: 'Alteração produzida em worktree isolada.',
  stopReason: 'result_produced',
  handoffReference: 'worktree:project-anima:anima-work/attempt-1',
};

const correlation = (origin: ExecutionEventCorrelation['origin']): ExecutionEventCorrelation => ({
  attemptId: attempt.attemptId,
  workItemId: attempt.workItemId,
  approvedProposalVersion: attempt.approvedProposalVersion,
  origin,
});

const handoff = (overrides: Partial<Parameters<typeof buildWorktreeHandoff>[0]> = {}): WorktreeHandoffV1 => {
  const result = buildWorktreeHandoff({
    workItemId: attempt.workItemId,
    attemptId: attempt.attemptId,
    approvedProposalVersion: attempt.approvedProposalVersion,
    executorId: 'worktree-v1',
    backendId: 'ollama-coder',
    model: null,
    baseSha: BASE_SHA,
    branch: 'anima-work/attempt-1',
    commitSha: COMMIT_SHA,
    status: 'succeeded',
    changedFiles: ['src/x.ts'],
    diffFiles: [{ path: 'src/x.ts', insertions: 3, deletions: 0 }],
    gates: [{ label: 'test', command: 'npm test', exitCode: 0, outcome: 'passed' }],
    ...overrides,
  });
  if (!result.ok) throw new Error(`handoff inválido no teste: ${result.explanation}`);
  return result.value;
};

const produced = (): IntegrationBoundary => {
  const result = produceResultForIntegration({
    attempt,
    workItemState: 'review',
    resultCorrelation: correlation('executor'),
    handoff: { kind: 'execution_result', reference: attempt.handoffReference, resultEventId: 'result-event-1' },
  });
  if (!result.ok) throw new Error(result.explanation);
  return result.value;
};

const accepted = (): IntegrationBoundary => {
  const result = acceptResultForIntegration(produced(), {
    workItemState: 'completed',
    decisionId: 'acceptance-1',
    acceptedResultEventId: 'result-event-1',
    correlation: correlation('user'),
  });
  if (!result.ok) throw new Error(result.explanation);
  return result.value;
};

const authorized = (): IntegrationBoundary => {
  const result = decideIntegration(accepted(), {
    workItemState: 'completed',
    decisionId: 'integration-decision-1',
    decision: 'authorize',
    correlation: correlation('user'),
  });
  if (!result.ok) throw new Error(result.explanation);
  return result.value;
};

// Publisher fake determinístico e idempotente por idempotencyKey ("create-or-get"):
// nenhum efeito real, e a mesma request após crash não produz um segundo efeito.
class FakeIntegrationPublisher implements IntegrationPublisher {
  readonly id = 'fake-publisher';
  private readonly published = new Map<string, IntegrationPublicationOutcome>();
  publishCount = 0;
  constructor(
    private readonly behavior: (request: IntegrationPublicationRequest) => IntegrationPublicationOutcome =
      request => ({ ok: true, reviewableReference: `pr://fake/${request.branch}@${request.commitSha}`, idempotencyKey: request.idempotencyKey }),
  ) {}

  async publish(request: IntegrationPublicationRequest): Promise<IntegrationPublicationOutcome> {
    const existing = this.published.get(request.idempotencyKey);
    if (existing) return existing;
    this.publishCount++;
    const outcome = this.behavior(request);
    this.published.set(request.idempotencyKey, outcome);
    return outcome;
  }
}

describe('integração/publicação — substrato puro (ADR-002)', () => {
  test('fronteira autorizada + evidência válida deriva a request determinística', () => {
    const result = buildIntegrationPublicationRequest(authorized(), handoff());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      correlation: { attemptId: 'attempt-1', workItemId: 'work-1', approvedProposalVersion: 3 },
      authorizationDecisionId: 'integration-decision-1',
      acceptedResultEventId: 'result-event-1',
      baseSha: BASE_SHA,
      branch: 'anima-work/attempt-1',
      commitSha: COMMIT_SHA,
      executorId: 'worktree-v1',
      backendId: 'ollama-coder',
    });
    expect(result.value.idempotencyKey).toBe(publicationIdempotencyKey('integration-decision-1', COMMIT_SHA));
  });

  test('sem 2ª autorização a publicação é impossível — nenhuma request é derivável', () => {
    // produced (só resultado), accepted (aceito mas não autorizado) e recusado.
    expect(buildIntegrationPublicationRequest(produced(), handoff())).toMatchObject({ ok: false, defect: 'not_authorized' });
    expect(buildIntegrationPublicationRequest(accepted(), handoff())).toMatchObject({ ok: false, defect: 'not_authorized' });
    const refused = decideIntegration(accepted(), {
      workItemState: 'completed', decisionId: 'integration-decision-1', decision: 'refuse', correlation: correlation('user'),
    });
    if (!refused.ok) throw new Error(refused.explanation);
    expect(buildIntegrationPublicationRequest(refused.value, handoff())).toMatchObject({ ok: false, defect: 'not_authorized' });
  });

  test('evidência de outra tentativa/item/versão é recusada por correlação', () => {
    expect(buildIntegrationPublicationRequest(authorized(), handoff({ attemptId: 'attempt-other', branch: 'anima-work/attempt-other' })))
      .toMatchObject({ ok: false, defect: 'correlation_mismatch' });
    expect(buildIntegrationPublicationRequest(authorized(), handoff({ workItemId: 'work-other' })))
      .toMatchObject({ ok: false, defect: 'correlation_mismatch' });
    expect(buildIntegrationPublicationRequest(authorized(), handoff({ approvedProposalVersion: 4 })))
      .toMatchObject({ ok: false, defect: 'correlation_mismatch' });
  });

  test('branch fora do namespace do Anima é recusada', () => {
    const foreign: WorktreeHandoffV1 = { ...handoff(), branch: 'main' };
    expect(buildIntegrationPublicationRequest(authorized(), foreign)).toMatchObject({ ok: false, defect: 'branch_not_owned' });
  });

  test('desfecho de falha não pode ser publicado', () => {
    const failed = handoff({ status: 'failed', gates: [{ label: 'test', command: 'npm test', exitCode: 1, outcome: 'failed' }] });
    expect(buildIntegrationPublicationRequest(authorized(), failed)).toMatchObject({ ok: false, defect: 'result_not_succeeded' });
  });

  test('evidência já publicada não gera nova request', () => {
    const alreadyPublished: WorktreeHandoffV1 = { ...handoff(), publicationState: 'published' };
    expect(buildIntegrationPublicationRequest(authorized(), alreadyPublished)).toMatchObject({ ok: false, defect: 'already_published' });
  });

  test('a chave de idempotência é determinística e ligada a autorização+commit', () => {
    const a = buildIntegrationPublicationRequest(authorized(), handoff());
    const b = buildIntegrationPublicationRequest(authorized(), handoff());
    if (!a.ok || !b.ok) throw new Error('esperava requests válidas');
    expect(a.value.idempotencyKey).toBe(b.value.idempotencyKey);
    expect(a.value.idempotencyKey).not.toBe(publicationIdempotencyKey('integration-decision-1', 'c'.repeat(40)));
  });

  test('a régua do outcome é fail-closed', () => {
    const request = (() => { const r = buildIntegrationPublicationRequest(authorized(), handoff()); if (!r.ok) throw new Error(); return r.value; })();
    expect(validatePublicationOutcome(request, { ok: true, reviewableReference: 'pr://x', idempotencyKey: request.idempotencyKey })).toBeNull();
    expect(validatePublicationOutcome(request, { ok: true, reviewableReference: 'pr://x', idempotencyKey: 'outra-chave' })).not.toBeNull();
    expect(validatePublicationOutcome(request, { ok: true, reviewableReference: '   ', idempotencyKey: request.idempotencyKey })).not.toBeNull();
    expect(validatePublicationOutcome(request, { ok: false, code: 'credentials_missing', message: 'sem credenciais', retryable: false })).toBeNull();
    expect(validatePublicationOutcome(request, { ok: false, code: 'inexistente' as never, message: 'x', retryable: false })).not.toBeNull();
    expect(validatePublicationOutcome(request, { ok: false, code: 'publish_failed', message: '  ', retryable: true })).not.toBeNull();
  });

  test('falha externa não vira integração — o estado interno não mente', async () => {
    const request = (() => { const r = buildIntegrationPublicationRequest(authorized(), handoff()); if (!r.ok) throw new Error(); return r.value; })();
    const publisher = new FakeIntegrationPublisher(() => ({ ok: false, code: 'credentials_missing', message: 'provider sem credenciais', retryable: false }));
    const outcome = await publisher.publish(request);
    expect(outcome.ok).toBe(false);
    // Nenhum input de registro é derivável de uma falha: a fronteira segue autorizada.
    expect(buildIntegrationRecordInput(request, outcome)).toBeNull();
    const stillAuthorized = authorized();
    expect(stillAuthorized.status).toBe('integration_authorized');
  });

  test('laço puro autorizado→publicado→integrated é idempotente sob retry (sem efeito real)', async () => {
    const boundary = authorized();
    const request = (() => { const r = buildIntegrationPublicationRequest(boundary, handoff()); if (!r.ok) throw new Error(r.defect); return r.value; })();
    const publisher = new FakeIntegrationPublisher();

    const outcome = await publisher.publish(request);
    expect(outcome).toMatchObject({ ok: true, idempotencyKey: request.idempotencyKey });
    expect(validatePublicationOutcome(request, outcome)).toBeNull();

    const recordInput = buildIntegrationRecordInput(request, outcome);
    expect(recordInput).not.toBeNull();
    const integrated = recordIntegrated(boundary, recordInput!);
    expect(integrated).toMatchObject({ ok: true, value: { status: 'integrated', integrationRecord: { authorizationDecisionId: 'integration-decision-1' } } });

    // Retry após "crash": mesma request → publisher create-or-get não duplica o
    // efeito, e recordIntegrated é idempotente com o mesmo recordId determinístico.
    const retryOutcome = await publisher.publish(request);
    expect(publisher.publishCount).toBe(1);
    expect(retryOutcome).toEqual(outcome);
    if (!integrated.ok) throw new Error('esperava integração');
    const retryRecordInput = buildIntegrationRecordInput(request, retryOutcome);
    expect(recordIntegrated(integrated.value, retryRecordInput!)).toEqual(integrated);
  });
});
