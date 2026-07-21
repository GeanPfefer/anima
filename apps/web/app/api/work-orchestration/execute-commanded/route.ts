import { evaluateAutonomousEligibility } from '@anima/core';
import { createClient } from '@/lib/supabase/server';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import { classifyPersistedAttempt } from '@/lib/work-orchestration/local-runner';
import { buildExecutorRequest, localRunnerFromEnvironment, recordExecutionTerminal, runExecutorOnce } from '@/lib/work-orchestration/execution';

export const runtime = 'nodejs';
export const maxDuration = 1800;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;

export async function POST(request: Request) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return Response.json({ ok: false, error: { code: 'authentication_required' } }, { status: 401 });
  const body = object(await request.json().catch(() => null));
  const workItemId = body?.['workItemId'];
  const expectedProposalVersion = body?.['expectedProposalVersion'];
  const attemptId = body?.['attemptId'];
  if (typeof workItemId !== 'string' || !uuid.test(workItemId) || typeof attemptId !== 'string' || !uuid.test(attemptId)
      || !Number.isInteger(expectedProposalVersion) || (expectedProposalVersion as number) < 1) {
    return Response.json({ ok: false, error: { code: 'invalid_input', message: 'Comando de execução inválido.' } }, { status: 400 });
  }
  const adapter = localRunnerFromEnvironment();
  if (!adapter) {
    return Response.json({ ok: false, error: { code: 'local_runner_not_configured', message: 'Executor local não configurado.' } }, { status: 503 });
  }
  const service = createWorkOrchestrationService(client);
  const current = await service.getItem(workItemId);
  if (!current.ok) return Response.json(current, { status: 404 });
  if (current.value.proposalVersion !== expectedProposalVersion) return Response.json({ ok: false, error: { code: 'version_conflict', message: 'O item mudou desde o comando.' } }, { status: 409 });
  const existingEvents = await service.listEvents(workItemId);
  if (!existingEvents.ok) return Response.json(existingEvents, { status: 500 });
  const persistedAttempt = classifyPersistedAttempt(existingEvents.value, attemptId);
  if (persistedAttempt === 'terminal') return Response.json({ ok: true, value: { item: current.value, attemptId, replayed: true } });
  if (persistedAttempt === 'in_progress') {
    return Response.json({ ok: false, error: { code: 'attempt_in_progress', message: 'A tentativa já está em andamento.' } }, { status: 409 });
  }
  if (persistedAttempt === 'abandoned') {
    return Response.json({ ok: false, error: { code: 'attempt_abandoned', message: 'A reconciliação encerrou esta tentativa; comande uma tentativa nova.' } }, { status: 409 });
  }
  const eligibility = evaluateAutonomousEligibility(current.value);
  if (!eligibility.eligible) return Response.json({ ok: false, error: { code: 'work_not_eligible', gaps: eligibility.gaps } }, { status: 422 });
  const contexts = await service.listContexts(workItemId);
  if (!contexts.ok) return Response.json(contexts, { status: 500 });
  const latestContext = contexts.value.at(-1);
  const { error: startError } = await client.rpc('start_commanded_work_attempt', {
    work_item_id: workItemId, expected_proposal_version: expectedProposalVersion as number, attempt_id: attemptId, executor_id: adapter.id,
  });
  if (startError) return Response.json({ ok: false, error: { code: 'attempt_start_failed', message: startError.message } }, { status: 409 });
  const requestPayload = buildExecutorRequest({
    item: current.value, spec: eligibility.spec, attemptId, contextReferences: latestContext?.references ?? [],
  });
  const run = await runExecutorOnce(adapter, requestPayload, request.signal);
  if (!run.ok) return Response.json({ ok: false, error: { code: 'executor_contract_violation', message: run.defect } }, { status: 502 });
  const terminal = run.terminal;
  const { error: terminalError } = await recordExecutionTerminal(client, {
    workItemId, expectedProposalVersion: expectedProposalVersion as number, attemptId, terminal,
  });
  if (terminalError) return Response.json({ ok: false, error: { code: 'attempt_terminal_failed', message: terminalError.message } }, { status: 500 });
  const updated = await service.getItem(workItemId);
  if (!updated.ok) return Response.json(updated, { status: 500 });
  return Response.json({ ok: true, value: { item: updated.value, attemptId, terminal } });
}
