import { isAbsolute } from 'node:path';
import { evaluateAutonomousEligibility, validateWorkExecutorTranscript, type WorkExecutorSignal } from '@anima/core';
import type { Json } from '@anima/types';
import { createClient } from '@/lib/supabase/server';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import { classifyPersistedAttempt, LocalRunnerAdapter } from '@/lib/work-orchestration/local-runner';

export const runtime = 'nodejs';
export const maxDuration = 1800;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;

const targetsFromEnvironment = (): Readonly<Record<string, string>> | null => {
  try {
    const parsed = object(JSON.parse(process.env.ANIMA_LOCAL_TARGETS_JSON ?? 'null') as unknown);
    if (!parsed) return null;
    const targets: Record<string, string> = {};
    for (const [reference, path] of Object.entries(parsed)) {
      if (!reference.trim() || typeof path !== 'string' || !isAbsolute(path)) return null;
      targets[reference] = path;
    }
    return targets;
  } catch { return null; }
};

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
  const runnerRoot = process.env.ANIMA_LOCAL_RUNNER_ROOT;
  const targets = targetsFromEnvironment();
  if (!runnerRoot || !isAbsolute(runnerRoot) || !targets) {
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
  const adapter = new LocalRunnerAdapter({
    runnerRoot, model: process.env.ANIMA_LOCAL_RUNNER_MODEL,
    targets: { resolve: reference => targets[reference] ?? null },
  });
  const { error: startError } = await client.rpc('start_commanded_work_attempt', {
    work_item_id: workItemId, expected_proposal_version: expectedProposalVersion as number, attempt_id: attemptId, executor_id: adapter.id,
  });
  if (startError) return Response.json({ ok: false, error: { code: 'attempt_start_failed', message: startError.message } }, { status: 409 });
  const requestPayload = {
    attemptId, workItemId, approvedProposalVersion: expectedProposalVersion as number, capability: current.value.capability,
    objective: current.value.proposal.data.objective, includedScope: current.value.proposal.data.includedScope,
    excludedScope: current.value.proposal.data.excludedScope, target: eligibility.spec.target,
    permissions: eligibility.spec.permissions, validationCriteria: eligibility.spec.validationCriteria, limits: eligibility.spec.limits,
    contextReferences: latestContext?.references ?? [],
  };
  const signals: WorkExecutorSignal[] = [];
  for await (const signal of adapter.execute(requestPayload, request.signal)) signals.push(signal);
  const transcriptDefect = validateWorkExecutorTranscript(signals);
  if (transcriptDefect) return Response.json({ ok: false, error: { code: 'executor_contract_violation', message: transcriptDefect } }, { status: 502 });
  const terminal = signals.at(-1)!;
  const { error: terminalError } = await client.rpc('record_commanded_work_terminal', {
    work_item_id: workItemId, expected_proposal_version: expectedProposalVersion as number, attempt_id: attemptId, signal: terminal as unknown as Json,
  });
  if (terminalError) return Response.json({ ok: false, error: { code: 'attempt_terminal_failed', message: terminalError.message } }, { status: 500 });
  const updated = await service.getItem(workItemId);
  if (!updated.ok) return Response.json(updated, { status: 500 });
  return Response.json({ ok: true, value: { item: updated.value, attemptId, terminal } });
}
