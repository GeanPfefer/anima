import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { WorkEvent, WorkExecutorAdapter, WorkExecutorRequest, WorkExecutorSignal, WorkExecutorSignalInput } from '@anima/core';

const RESULT_PREFIX = 'ANIMA_RESULT_JSON=';
const REQUIRED_PERMISSIONS = new Set(['workspace_read', 'workspace_write_isolated']);

export interface LocalRunnerProcessInput {
  readonly runnerRoot: string;
  readonly pythonExecutable: string;
  readonly workspace: string;
  readonly task: string;
  readonly model?: string;
  readonly testCommand?: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

export interface LocalRunnerProcessResult { readonly exitCode: number; readonly stdout: string; readonly stderr: string; }
export interface LocalRunnerProcess { run(input: LocalRunnerProcessInput): Promise<LocalRunnerProcessResult>; }
export interface LocalTargetResolver { resolve(reference: string): string | null; }

interface RunnerEnvelope {
  readonly schemaVersion: 1;
  readonly status: 'result_produced';
  readonly evidenceReference: string;
  readonly producedPaths: readonly string[];
  readonly handoffReference: string;
  readonly handoffSha256: string;
}

const opaque = (value: string): boolean => value.length > 0 && !value.includes('/') && !value.includes('\\') && !value.includes('..');
const record = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;

export type PersistedAttemptStatus = 'absent' | 'in_progress' | 'terminal';
export const classifyPersistedAttempt = (events: readonly WorkEvent[], attemptId: string): PersistedAttemptStatus => {
  const matching = events.filter(event => record(record(event.payload)?.['data'])?.['attempt_id'] === attemptId);
  if (matching.some(event => ['result_submitted', 'execution_failed', 'work_cancelled'].includes(event.type))) return 'terminal';
  return matching.some(event => event.type === 'execution_started') ? 'in_progress' : 'absent';
};

const parseEnvelope = (stdout: string): RunnerEnvelope | null => {
  const lines = stdout.split(/\r?\n/).filter(line => line.startsWith(RESULT_PREFIX));
  if (lines.length !== 1) return null;
  try {
    const root = record(JSON.parse(lines[0]!.slice(RESULT_PREFIX.length)) as unknown);
    const handoff = record(root?.['handoff']);
    const evidenceReference = root?.['evidence_reference'];
    const handoffReference = handoff?.['reference'];
    const handoffSha256 = handoff?.['sha256'];
    const producedPaths = root?.['produced_paths'];
    if (root?.['schema_version'] !== 1 || root['status'] !== 'result_produced' || handoff?.['kind'] !== 'result_bundle') return null;
    if (typeof evidenceReference !== 'string' || typeof handoffReference !== 'string' || typeof handoffSha256 !== 'string' || !Array.isArray(producedPaths)) return null;
    if (!opaque(evidenceReference) || !opaque(handoffReference) || !/^[a-f0-9]{64}$/.test(handoffSha256)) return null;
    if (producedPaths.length === 0 || !producedPaths.every(path => typeof path === 'string' && path.length > 0 && !path.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(path) && !path.split(/[\\/]/).includes('..'))) return null;
    return { schemaVersion: 1, status: 'result_produced', evidenceReference, producedPaths: producedPaths as string[], handoffReference, handoffSha256 };
  } catch { return null; }
};

const taskFor = (request: WorkExecutorRequest): string => [
  request.objective,
  `Escopo incluído: ${request.includedScope.join('; ')}.`,
  `Fora do escopo: ${request.excludedScope.join('; ')}.`,
  `Critérios: ${request.validationCriteria.map(item => item.label).join('; ')}.`,
].join('\n');

export class SpawnLocalRunnerProcess implements LocalRunnerProcess {
  run(input: LocalRunnerProcessInput): Promise<LocalRunnerProcessResult> {
    return new Promise((resolveResult, reject) => {
      const args = ['-m', 'local_agent', '--workspace', input.workspace, '--task', input.task, '--produce-only'];
      if (input.model) args.push('--model', input.model);
      const child = spawn(input.pythonExecutable, args, {
        cwd: input.runnerRoot,
        shell: false,
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', ...(input.testCommand ? { LOCAL_AGENT_TEST_COMMAND: input.testCommand } : {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '', stderr = '', settled = false;
      const finish = (result: LocalRunnerProcessResult): void => { if (!settled) { settled = true; clearTimeout(timer); resolveResult(result); } };
      const fail = (cause: Error): void => { if (!settled) { settled = true; clearTimeout(timer); reject(cause); } };
      const stop = (): void => { child.kill(); fail(new Error('runner_cancelled')); };
      const timer = setTimeout(() => { child.kill(); fail(new Error('runner_timeout')); }, input.timeoutMs);
      input.signal.addEventListener('abort', stop, { once: true });
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => { stdout += chunk; });
      child.stderr.on('data', (chunk: string) => { stderr += chunk; });
      child.on('error', fail);
      child.on('close', code => { input.signal.removeEventListener('abort', stop); finish({ exitCode: code ?? -1, stdout, stderr }); });
      child.stdin.end('A\n');
    });
  }
}

export interface LocalRunnerAdapterOptions {
  readonly runnerRoot: string;
  readonly pythonExecutable?: string;
  readonly model?: string;
  readonly targets: LocalTargetResolver;
  readonly process?: LocalRunnerProcess;
}

export class LocalRunnerAdapter implements WorkExecutorAdapter {
  readonly id = 'local-runner-v1';
  private readonly process: LocalRunnerProcess;
  constructor(private readonly options: LocalRunnerAdapterOptions) { this.process = options.process ?? new SpawnLocalRunnerProcess(); }

  async *execute(request: WorkExecutorRequest, signal: AbortSignal): AsyncIterable<WorkExecutorSignal> {
    const attach = (sequence: number, value: WorkExecutorSignalInput): WorkExecutorSignal => ({
      attemptId: request.attemptId, workItemId: request.workItemId, approvedProposalVersion: request.approvedProposalVersion,
      origin: 'executor', sequence, ...value,
    }) as unknown as WorkExecutorSignal;
    const missing = [...REQUIRED_PERMISSIONS].filter(permission => !request.permissions.includes(permission));
    const workspace = this.options.targets.resolve(request.target.reference);
    const commands = request.validationCriteria.flatMap(item => item.command ? [item.command] : []);
    if (!opaque(request.target.reference) || !workspace || missing.length > 0 || commands.length > 1) {
      yield attach(1, { kind: 'error', code: 'invalid_request', message: !workspace ? 'Alvo local não autorizado.' : missing.length ? 'Permissões locais insuficientes.' : 'Mais de um comando de validação não é suportado.', retryable: false, handoffReference: 'checkpoint:invalid-local-request' });
      return;
    }
    const timeoutMs = (request.limits.maxDurationMinutes ?? 30) * 60_000;
    try {
      const result = await this.process.run({
        runnerRoot: this.options.runnerRoot,
        pythonExecutable: this.options.pythonExecutable ?? resolve(this.options.runnerRoot, '.venv', 'Scripts', 'python.exe'),
        workspace, task: taskFor(request), model: this.options.model, testCommand: commands[0], timeoutMs, signal,
      });
      if (result.exitCode !== 0) {
        yield attach(1, { kind: 'error', code: 'execution_failed', message: `Runner terminou com código ${result.exitCode}.`, retryable: false, handoffReference: 'checkpoint:runner-failed' });
        return;
      }
      const envelope = parseEnvelope(result.stdout);
      if (!envelope) {
        yield attach(1, { kind: 'error', code: 'contract_violation', message: 'Runner retornou envelope inválido.', retryable: false, handoffReference: 'checkpoint:invalid-runner-envelope' });
        return;
      }
      const approvedPaths = new Set(request.includedScope.map(path => path.replace(/\\/g, '/')));
      if (envelope.producedPaths.some(path => !approvedPaths.has(path.replace(/\\/g, '/')))) {
        yield attach(1, { kind: 'error', code: 'contract_violation', message: 'Runner produziu arquivo fora do escopo aprovado.', retryable: false, handoffReference: 'checkpoint:runner-scope-violation' });
        return;
      }
      const handoffReference = `local-runner:${request.target.reference}:${envelope.handoffReference}:sha256:${envelope.handoffSha256}`;
      yield attach(1, {
        kind: 'result', summary: 'O runner local produziu e validou um resultado para revisão.',
        resultReferences: [`runner-evidence:${envelope.evidenceReference}`, `runner-bundle:${envelope.handoffReference}`],
        validations: request.validationCriteria.map(item => ({ label: item.label, outcome: 'passed' as const })),
        limitations: ['Resultado produzido em workspace isolada; nenhuma alteração foi aplicada ao alvo original.'],
        handoffReference,
      });
    } catch {
      const cancelled = signal.aborted;
      yield cancelled
        ? attach(1, { kind: 'cancelled', acknowledged: true, handoffReference: 'checkpoint:runner-cancelled' })
        : attach(1, { kind: 'error', code: 'execution_failed', message: 'Falha no processo do runner local.', retryable: false, handoffReference: 'checkpoint:runner-process-failed' });
    }
  }
}
