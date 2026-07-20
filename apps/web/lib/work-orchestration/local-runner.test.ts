import type { WorkExecutorRequest } from '@anima/core';
import { classifyPersistedAttempt, LocalRunnerAdapter, type LocalRunnerProcess } from './local-runner';

const request: WorkExecutorRequest = {
  attemptId: 'attempt-1', workItemId: 'work-1', approvedProposalVersion: 2, capability: 'programming', objective: 'Corrija a função.',
  includedScope: ['a.py'], excludedScope: ['deploy'], target: { kind: 'project', reference: 'anima' },
  permissions: ['workspace_read', 'workspace_write_isolated'], validationCriteria: [{ label: 'testes', command: 'python -m unittest' }],
  limits: { maxAttempts: 1, maxDurationMinutes: 5 }, contextReferences: [],
};
const collect = async (adapter: LocalRunnerAdapter, value: WorkExecutorRequest = request) => {
  const found = []; for await (const signal of adapter.execute(value, new AbortController().signal)) found.push(signal); return found;
};
const targets = { resolve: (reference: string) => reference === 'anima' ? 'G:\\anima' : null };

test('traduz resultado produce-only sem expor caminho absoluto', async () => {
  const process: LocalRunnerProcess = { run: jest.fn().mockResolvedValue({ exitCode: 0, stderr: '', stdout: 'log\nANIMA_RESULT_JSON={"schema_version":1,"status":"result_produced","evidence_reference":"run.json","produced_paths":["a.py"],"handoff":{"kind":"result_bundle","reference":"result.zip","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}\n' }) };
  const signals = await collect(new LocalRunnerAdapter({ runnerRoot: 'G:\\runner', targets, process }));
  expect(signals).toEqual([expect.objectContaining({ kind: 'result', sequence: 1, origin: 'executor', handoffReference: 'local-runner:anima:result.zip:sha256:' + 'a'.repeat(64) })]);
  expect(JSON.stringify(signals)).not.toContain('G:\\');
  expect(process.run).toHaveBeenCalledWith(expect.objectContaining({ workspace: 'G:\\anima', testCommand: 'python -m unittest', timeoutMs: 300000 }));
});

test('falha fechado para alvo, permissão e envelope inválidos', async () => {
  const process: LocalRunnerProcess = { run: jest.fn().mockResolvedValue({ exitCode: 0, stderr: '', stdout: 'sem envelope' }) };
  await expect(collect(new LocalRunnerAdapter({ runnerRoot: 'runner', targets, process }), { ...request, target: { kind: 'project', reference: 'desconhecido' } })).resolves.toEqual([expect.objectContaining({ kind: 'error', code: 'invalid_request' })]);
  await expect(collect(new LocalRunnerAdapter({ runnerRoot: 'runner', targets, process }), { ...request, permissions: [] })).resolves.toEqual([expect.objectContaining({ kind: 'error', code: 'invalid_request' })]);
  await expect(collect(new LocalRunnerAdapter({ runnerRoot: 'runner', targets, process }))).resolves.toEqual([expect.objectContaining({ kind: 'error', code: 'contract_violation' })]);
});

test('traduz saída não zero e cancelamento em terminais tipados', async () => {
  const failed: LocalRunnerProcess = { run: jest.fn().mockResolvedValue({ exitCode: 6, stderr: '', stdout: '' }) };
  await expect(collect(new LocalRunnerAdapter({ runnerRoot: 'runner', targets, process: failed }))).resolves.toEqual([expect.objectContaining({ kind: 'error', code: 'execution_failed' })]);
  const cancelled: LocalRunnerProcess = { run: (_input) => Promise.reject(new Error('runner_cancelled')) };
  const controller = new AbortController(); controller.abort();
  const found = []; for await (const signal of new LocalRunnerAdapter({ runnerRoot: 'runner', targets, process: cancelled }).execute(request, controller.signal)) found.push(signal);
  expect(found).toEqual([expect.objectContaining({ kind: 'cancelled', acknowledged: true })]);
});

test('recusa resultado que produziu arquivo fora do escopo aprovado', async () => {
  const process: LocalRunnerProcess = { run: jest.fn().mockResolvedValue({ exitCode: 0, stderr: '', stdout: 'ANIMA_RESULT_JSON={"schema_version":1,"status":"result_produced","evidence_reference":"run.json","produced_paths":["fora.py"],"handoff":{"kind":"result_bundle","reference":"result.zip","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}' }) };
  await expect(collect(new LocalRunnerAdapter({ runnerRoot: 'runner', targets, process }))).resolves.toEqual([expect.objectContaining({ kind: 'error', code: 'contract_violation', message: expect.stringContaining('fora do escopo') })]);
});

test('reconcilia reentrega pela tentativa persistida sem heurística', () => {
  const event = (type: 'execution_started' | 'result_submitted', attemptId: string) => ({ id: type, workItemId: 'work-1', type, author: 'executor' as const, proposalVersion: 1, payload: { schema_version: 1, data: { attempt_id: attemptId } }, occurredAt: new Date() });
  expect(classifyPersistedAttempt([], 'attempt-1')).toBe('absent');
  expect(classifyPersistedAttempt([event('execution_started', 'attempt-1')], 'attempt-1')).toBe('in_progress');
  expect(classifyPersistedAttempt([event('execution_started', 'attempt-1'), event('result_submitted', 'attempt-1')], 'attempt-1')).toBe('terminal');
  expect(classifyPersistedAttempt([event('result_submitted', 'outro')], 'attempt-1')).toBe('absent');
});
