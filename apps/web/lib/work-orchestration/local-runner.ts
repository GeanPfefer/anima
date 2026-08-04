import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { validateWorkCheckpoint } from '@anima/core';
import type { WorkCheckpointV1, WorkEvent, WorkExecutorAdapter, WorkExecutorRequest, WorkExecutorSignal, WorkExecutorSignalInput } from '@anima/core';

const RESULT_PREFIX = 'ANIMA_RESULT_JSON=';
const CHECKPOINT_PREFIX = 'ANIMA_CHECKPOINT_JSON=';
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
  /** Liga a emissão de checkpoints mid-flight do runner. */
  readonly emitCheckpoints?: boolean;
  /** JSON do carriedContext da retomada (AUTO-05), repassado ao runner. */
  readonly carriedContext?: string;
  /** Recebe cada linha de stdout assim que completa, para consumo em stream. */
  readonly onLine?: (line: string) => void;
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

export type PersistedAttemptStatus = 'absent' | 'in_progress' | 'terminal' | 'abandoned';
export const classifyPersistedAttempt = (events: readonly WorkEvent[], attemptId: string): PersistedAttemptStatus => {
  const matching = events.filter(event => record(record(event.payload)?.['data'])?.['attempt_id'] === attemptId);
  if (matching.some(event => ['result_submitted', 'execution_failed', 'work_cancelled'].includes(event.type))) return 'terminal';
  // SUP-04: a reconciliação encerrou esta tentativa. Ela não é replay (nada foi
  // entregue) nem reiniciável (o banco recusa o terminal tardio) — recomeçar
  // aqui gastaria uma execução inteira para ser rejeitada no fim.
  if (matching.some(event => event.type === 'attempt_abandoned')) return 'abandoned';
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

// Projeta um envelope `ANIMA_CHECKPOINT_JSON=` do runner num `WorkCheckpointV1`.
// A régua estrutural e de sanitização é a MESMA do core (`validateWorkCheckpoint`),
// não uma segunda cópia; `touchedResources` declarados ficam dentro do escopo
// aprovado; ausência de correlação ou campo obrigatório devolve `null`.
const parseCheckpoint = (line: string, targetReference: string, includedScope: readonly string[]): WorkCheckpointV1 | null => {
  try {
    const root = record(JSON.parse(line.slice(CHECKPOINT_PREFIX.length)) as unknown);
    const handoff = record(root?.['handoff']);
    const checkpoint = record(root?.['checkpoint']);
    if (root?.['schema_version'] !== 1 || root['status'] !== 'checkpoint' || handoff?.['kind'] !== 'checkpoint_bundle' || !checkpoint) return null;
    const reference = handoff['reference'];
    const sha256 = handoff['sha256'];
    if (typeof reference !== 'string' || typeof sha256 !== 'string' || !opaque(reference) || !/^[a-f0-9]{64}$/.test(sha256)) return null;
    const candidate = {
      schemaVersion: 1,
      handoffReference: `local-runner:${targetReference}:${reference}:sha256:${sha256}`,
      completedSteps: checkpoint['completedSteps'], remainingSteps: checkpoint['remainingSteps'], nextStep: checkpoint['nextStep'],
      decisions: checkpoint['decisions'], risks: checkpoint['risks'], touchedResources: checkpoint['touchedResources'],
      validations: checkpoint['validations'], failures: checkpoint['failures'], evidenceReferences: checkpoint['evidenceReferences'],
    } as unknown as WorkCheckpointV1;
    if (validateWorkCheckpoint(candidate) !== null) return null;
    const approved = new Set(includedScope.map(path => path.replace(/\\/g, '/')));
    if (candidate.touchedResources.some(path => !approved.has(path.replace(/\\/g, '/')))) return null;
    return candidate;
  } catch { return null; }
};

// Terminal único a partir do resultado do processo — compartilhado pelos dois
// caminhos (single-shot comandado e stream supervisionado), sem código duplicado.
const terminalInputFrom = (request: WorkExecutorRequest, result: LocalRunnerProcessResult): WorkExecutorSignalInput => {
  if (result.exitCode !== 0) {
    return { kind: 'error', code: 'execution_failed', message: `Runner terminou com código ${result.exitCode}.`, retryable: false, handoffReference: 'checkpoint:runner-failed' };
  }
  const envelope = parseEnvelope(result.stdout);
  if (!envelope) {
    return { kind: 'error', code: 'contract_violation', message: 'Runner retornou envelope inválido.', retryable: false, handoffReference: 'checkpoint:invalid-runner-envelope' };
  }
  const approvedPaths = new Set(request.includedScope.map(path => path.replace(/\\/g, '/')));
  if (envelope.producedPaths.some(path => !approvedPaths.has(path.replace(/\\/g, '/')))) {
    return { kind: 'error', code: 'contract_violation', message: 'Runner produziu arquivo fora do escopo aprovado.', retryable: false, handoffReference: 'checkpoint:runner-scope-violation' };
  }
  const handoffReference = `local-runner:${request.target.reference}:${envelope.handoffReference}:sha256:${envelope.handoffSha256}`;
  return {
    kind: 'result', summary: 'O runner local produziu e validou um resultado para revisão.',
    resultReferences: [`runner-evidence:${envelope.evidenceReference}`, `runner-bundle:${envelope.handoffReference}`],
    validations: request.validationCriteria.map(item => ({ label: item.label, outcome: 'passed' as const })),
    limitations: ['Resultado produzido em workspace isolada; nenhuma alteração foi aplicada ao alvo original.'],
    handoffReference,
  };
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
      // A proposta já autorizou escrita isolada. Alterações preexistentes são
      // preservadas na cópia; esta flag elimina um segundo prompt ambíguo no
      // processo filho sem autorizar aplicação no projeto original.
      const args = ['-m', 'local_agent', '--workspace', input.workspace, '--task', input.task, '--produce-only', '--allow-dirty'];
      if (input.model) args.push('--model', input.model);
      if (input.emitCheckpoints) args.push('--emit-checkpoints');
      if (input.carriedContext) args.push('--carried-context', input.carriedContext);
      const child = spawn(input.pythonExecutable, args, {
        cwd: input.runnerRoot,
        shell: false,
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', ...(input.testCommand ? { LOCAL_AGENT_TEST_COMMAND: input.testCommand } : {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '', stderr = '', settled = false, lineBuffer = '';
      const finish = (result: LocalRunnerProcessResult): void => { if (!settled) { settled = true; clearTimeout(timer); resolveResult(result); } };
      const fail = (cause: Error): void => { if (!settled) { settled = true; clearTimeout(timer); reject(cause); } };
      const stop = (): void => { child.kill(); fail(new Error('runner_cancelled')); };
      const timer = setTimeout(() => { child.kill(); fail(new Error('runner_timeout')); }, input.timeoutMs);
      input.signal.addEventListener('abort', stop, { once: true });
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
        // Entrega cada linha completa assim que chega: um checkpoint impresso
        // antes do terminal precisa ser observável ANTES do processo terminar.
        if (!input.onLine) return;
        lineBuffer += chunk;
        for (let nl = lineBuffer.indexOf('\n'); nl >= 0; nl = lineBuffer.indexOf('\n')) {
          const line = lineBuffer.slice(0, nl).replace(/\r$/, '');
          lineBuffer = lineBuffer.slice(nl + 1);
          input.onLine(line);
        }
      });
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
  // Liga a emissão de checkpoints mid-flight. Só o caminho supervisionado a
  // ativa; o caminho comandado (INT-04) permanece single-shot e byte a byte,
  // preservando a fronteira ratificada em 2B.1 (comandado rejeita checkpoint).
  readonly emitCheckpoints?: boolean;
  /** Cenário local fechado para provar UX-02; nunca é inferido pelo modelo. */
  readonly deterministicDecisionProof?: boolean;
}

type Attach = (sequence: number, value: WorkExecutorSignalInput) => WorkExecutorSignal;

export class LocalRunnerAdapter implements WorkExecutorAdapter {
  readonly id = 'local-runner-v1';
  private readonly process: LocalRunnerProcess;
  constructor(private readonly options: LocalRunnerAdapterOptions) { this.process = options.process ?? new SpawnLocalRunnerProcess(); }

  async *execute(request: WorkExecutorRequest, signal: AbortSignal): AsyncIterable<WorkExecutorSignal> {
    const attach: Attach = (sequence, value) => ({
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
    if (this.options.deterministicDecisionProof && request.target.reference === 'ux02-deterministic-decision') {
      yield* this.runDeterministicDecisionProof(request, attach);
      return;
    }
    const processInput: LocalRunnerProcessInput = {
      runnerRoot: this.options.runnerRoot,
      pythonExecutable: this.options.pythonExecutable ?? resolve(this.options.runnerRoot, '.venv', 'Scripts', 'python.exe'),
      workspace, task: taskFor(request), model: this.options.model, testCommand: commands[0],
      timeoutMs: (request.limits.maxDurationMinutes ?? 30) * 60_000, signal,
      emitCheckpoints: this.options.emitCheckpoints,
      // O carriedContext do AUTO-05 é repassado como contexto de continuação,
      // nunca como instrução de domínio; ausência preserva o começo do zero.
      carriedContext: request.carriedContext ? JSON.stringify(request.carriedContext) : undefined,
    };
    if (!this.options.emitCheckpoints) {
      // Caminho single-shot preservado byte a byte (INT-04 comandado).
      try {
        yield attach(1, terminalInputFrom(request, await this.process.run(processInput)));
      } catch {
        yield signal.aborted
          ? attach(1, { kind: 'cancelled', acknowledged: true, handoffReference: 'checkpoint:runner-cancelled' })
          : attach(1, { kind: 'error', code: 'execution_failed', message: 'Falha no processo do runner local.', retryable: false, handoffReference: 'checkpoint:runner-process-failed' });
      }
      return;
    }
    yield* this.runStreamed(request, signal, attach, processInput);
  }

  private async *runDeterministicDecisionProof(request: WorkExecutorRequest, attach: Attach): AsyncIterable<WorkExecutorSignal> {
    if (request.carriedContext?.continueFromCheckpoint === true) {
      yield attach(1,{kind:'progress',message:'Retomando do checkpoint persistido após a decisão humana.'});
      yield attach(2,{
        kind:'result',
        summary:'O cenário determinístico retomou do checkpoint persistido e concluiu a etapa autorizada.',
        resultReferences:['ux02-proof:resumed-from-checkpoint'],
        validations:[{label:'Retomada consumiu o checkpoint persistido',outcome:'passed'}],
        limitations:['Cenário determinístico local; nenhuma decisão foi produzida livremente por modelo.'],
        handoffReference:'ux02-proof:completed',
      });
      return;
    }
    const touched=request.includedScope[0]!;
    yield attach(1,{kind:'progress',message:'Preparando o checkpoint determinístico do UX-02.'});
    yield attach(2,{kind:'checkpoint',checkpoint:{
      schemaVersion:1,handoffReference:'ux02-proof:checkpoint-1',
      completedSteps:['Cenário determinístico iniciado'],remainingSteps:['Concluir a etapa após autorização humana'],
      nextStep:'Retomar a execução usando a alternativa persistida',decisions:[],risks:['A continuação exige decisão humana explícita'],
      touchedResources:[touched],validations:[{label:'Checkpoint determinístico criado',outcome:'passed'}],
      failures:[],evidenceReferences:['ux02-proof:checkpoint-1'],
    }});
    yield attach(3,{
      kind:'decision_required',reason:'architectural_decision',
      explanation:'O cenário determinístico chegou ao checkpoint conhecido. Deseja continuar dali ou encerrar o trabalho?',
      options:[{id:'continuar',label:'Continuar do checkpoint',effect:'resume'},{id:'encerrar',label:'Encerrar o trabalho',effect:'cancel'}],
    });
  }

  /**
   * Consome o stream do runner: cada `checkpoint` impresso vira um sinal
   * `checkpoint` (jamais convertido em `progress` ou terminal) emitido ANTES do
   * terminal, para que o laço o persista antes de uma eventual interrupção. Um
   * checkpoint mal-formado falha fechado como violação de contrato.
   */
  private async *runStreamed(request: WorkExecutorRequest, signal: AbortSignal, attach: Attach, processInput: LocalRunnerProcessInput): AsyncIterable<WorkExecutorSignal> {
    const queue: WorkExecutorSignal[] = [];
    let seq = 0, malformed = false, done = false, wake: (() => void) | null = null;
    const signalWake = (): void => { const w = wake; wake = null; w?.(); };
    const onLine = (line: string): void => {
      if (!line.startsWith(CHECKPOINT_PREFIX)) return;
      const checkpoint = parseCheckpoint(line, request.target.reference, request.includedScope);
      if (checkpoint) queue.push(attach(++seq, { kind: 'checkpoint', checkpoint }));
      else malformed = true;
      signalWake();
    };
    let result: LocalRunnerProcessResult | undefined, threw = false;
    const runPromise = this.process.run({ ...processInput, onLine })
      .then(value => { result = value; }, () => { threw = true; })
      .finally(() => { done = true; signalWake(); });
    // Drena checkpoints à medida que chegam; só depois de `done` decide o terminal.
    for (;;) {
      while (queue.length) yield queue.shift()!;
      if (done) break;
      await new Promise<void>(resolve => { wake = resolve; if (done || queue.length) { wake = null; resolve(); } });
    }
    await runPromise;
    while (queue.length) yield queue.shift()!;
    if (malformed) {
      yield attach(++seq, { kind: 'error', code: 'contract_violation', message: 'Runner emitiu um checkpoint inválido.', retryable: false, handoffReference: 'checkpoint:invalid-runner-checkpoint' });
      return;
    }
    if (threw) {
      yield signal.aborted
        ? attach(++seq, { kind: 'cancelled', acknowledged: true, handoffReference: 'checkpoint:runner-cancelled' })
        : attach(++seq, { kind: 'error', code: 'execution_failed', message: 'Falha no processo do runner local.', retryable: false, handoffReference: 'checkpoint:runner-process-failed' });
      return;
    }
    yield attach(++seq, terminalInputFrom(request, result!));
  }
}
