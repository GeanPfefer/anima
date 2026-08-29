import {
  buildWorktreeHandoff,
  validateWorkCheckpoint,
  type HostObservedCoderOutcome,
  type ObservedCoderInput,
  type ObservedGateInput,
  type WorkCheckpointV1,
  type WorkExecutorAdapter,
  type WorkExecutorRequest,
  type WorkExecutorSignal,
  type WorkExecutorSignalInput,
  type WorkResultValidation,
  type WorktreeGateOutcome,
} from '@anima/core';
import { createHash } from 'node:crypto';
import type { CoderBackend, CoderWorkspace, HostValidationFeedback } from './coder-backend';
import { GitWorktree, parseGateCommand, runGate } from './worktree';

// ============================================================
// Executor da Opção A (ADR-001): roda o toolchain real do Anima numa git
// worktree isolada, a partir de um SHA autorizado. Espelha o formato do
// LocalRunnerAdapter e implementa o MESMO contrato WorkExecutorAdapter, então o
// Supervisor o consome por `runExecutorStreamed` sem nenhum caminho paralelo.
//
// Invariantes (ADR-001): nunca toca o workspace original; nunca faz merge/push/
// apply; comandos passam por allowlist; escrita confinada à raiz; gates
// obrigatórios; resultado sempre para revisão humana; inteligência selecionável
// por `CoderBackend`.
// ============================================================

export const WORKTREE_BRANCH_PREFIX = 'anima-work';
/**
 * Convenção de nome da branch descartável de uma tentativa. O HOST usa a MESMA
 * convenção para observar o git independentemente do adaptador (host-evidence),
 * então a fonte única evita que a observação e a execução divirjam no nome.
 */
export const worktreeBranchFor = (attemptId: string, prefix: string = WORKTREE_BRANCH_PREFIX): string => `${prefix}/${attemptId}`;

export interface WorktreeTarget {
  readonly repoRoot: string;
  readonly sha: string;
  /** Commit do checkpoint durável a partir do qual RETOMAR. Ausente ⇒ nova
   * tentativa a partir de `sha`. O diff continua medido contra `sha` (base). */
  readonly startSha?: string;
}
export interface WorktreeTargetResolver { resolve(reference: string): WorktreeTarget | null; }

export interface WorktreeExecutorOptions {
  readonly targets: WorktreeTargetResolver;
  /** Inteligência selecionável que escreve o código. */
  readonly backend: CoderBackend;
  readonly branchPrefix?: string;
  /** Religa o node_modules real para o gate npm rodar sem instalar. */
  readonly linkNodeModules?: boolean;

  /**
   * Prepara artefatos derivados necessarios aos gates depois que o layout de
   * dependencias foi religado. E chamado novamente em cada rodada de gates.
   *
   * Falha de preparacao encerra a tentativa de forma fail-closed e nao e
   * classificada como falha do codigo produzido pelo backend.
   */
  readonly prepareValidation?: (input: {
    readonly rootPath: string;
    readonly validationCriteria: WorkExecutorRequest['validationCriteria'];
    readonly signal: AbortSignal;
  }) => Promise<void>;
  /** Emite um checkpoint mid-flight após a edição e antes do gate. */
  readonly emitCheckpoint?: boolean;
  /**
   * Internal retries driven only by host-observed gate failure.
   * They stay inside the same attempt/worktree. Default: 0.
   */
  readonly gateRetryLimit?: number;
  /**
   * Observador de gate de PRIMEIRA PARTE DO HOST. Chamado com os fatos brutos que
   * `runGate` (código de host, não o CoderBackend) mediu logo após cada gate. É o
   * canal do HOST — o host injeta e persiste como evidência observada, separada do
   * `worktreeHandoff.gates` atestado. Um executor que não seja este adaptador não o
   * populará; por isso a evidência só existe quando o host de fato roda o gate.
   */
  readonly onGateObserved?: (outcome: ObservedGateInput) => void;
  /**
   * Observador do CODER de PRIMEIRA PARTE DO HOST. Chamado com o tempo de parede que o
   * HOST cronometrou ao redor de `backend.edit()` (não o provider) e o desfecho observado
   * da própria chamada. É o canal do HOST — o host injeta e persiste como evidência
   * observada (`host_observed_coder_evidence_recorded`), separada de qualquer atestação do
   * executor. Emitido EM TODOS os caminhos (sucesso, falha, cancelamento): a duração é
   * fato mesmo quando a edição termina em erro. NÃO carrega tokens/modelo do provider —
   * isso é uma mudança contratual separada (proveniência host-observed ≠ provider-reported).
   */
  readonly onCoderObserved?: (outcome: ObservedCoderInput) => void;
}

const REQUIRED_PERMISSIONS = ['workspace_read', 'workspace_write_isolated'] as const;
const opaque = (value: string): boolean => value.length > 0 && !value.includes('/') && !value.includes('\\') && !value.includes('..');
const norm = (path: string): string => path.replace(/\\/g, '/');
const clip = (value: string, max = 120): string => value.length <= max ? value : `${value.slice(0, max)}…`;

const GATE_DIAGNOSTIC_MAX = 700;
const GATE_DIAGNOSTIC_LINES = 8;
const GATE_DIAGNOSTIC_FOOTER =
  /^(?:Test Suites:|Tests:|Snapshots:|Time:|Ran all test suites\.?|Node\.js v\d+|npm (?:error|ERR!)\b)/i;
const GATE_SECRET_ASSIGNMENT =
  /\b([A-Za-z0-9_]*(?:password|passwd|secret|api[-_]?key|access[-_]?token)|authorization|cookie|set-cookie|x-api-key|proxy-authorization)\b\s*[:=]\s*.*$/gi;
const GATE_BEARER = /\bbearer\s+[a-z0-9._~+/-]{8,}=*/gi;
const GATE_JWT = /\beyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b/gi;
const GATE_WINDOWS_PATH = /[A-Za-z]:[\\/][^\s'"<>|]*/g;
const GATE_POSIX_PATH = /(?:\/[A-Za-z0-9._@-]+){2,}/g;
const ENVIRONMENTAL_GATE_DIAGNOSTIC =
  /(?:\.next[\\/]types|next-env\.d\.ts|ECONNREFUSED|ENOSPC|ENOMEM|out of memory|command not found|is not recognized as (?:an internal|the name)|spawn\s+\S+\s+ENOENT|network (?:is )?unreachable|temporary failure in name resolution)/i;

export interface RepairableGateFailure {
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly diagnostic?: string;
}

/** Decisão pura e conservadora; a evidência bruta continua separada. */
export function isGateFailureEligibleForCoderRepair(
  failure: RepairableGateFailure,
): boolean {
  if (failure.exitCode === 0 || failure.timedOut || failure.cancelled) return false;
  return !ENVIRONMENTAL_GATE_DIAGNOSTIC.test(failure.diagnostic ?? '');
}

const diffSha256 = (diff: string): string =>
  createHash('sha256').update(diff, 'utf8').digest('hex');

export function summarizeGateFailureForRetry(
  stdout: string,
  stderr: string,
): string | undefined {
  const rawLines = `${stderr}\n${stdout}`
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  if (rawLines.length === 0) return undefined;

  // Rodapes de Jest/npm/Node descrevem o encerramento do comando, nao a causa.
  // Removemos somente formatos conhecidos antes de aplicar o limite de linhas.
  // Se tudo for rodape, usamos a saida original para nunca apagar o diagnostico.
  const informativeLines = rawLines.filter(
    line => !GATE_DIAGNOSTIC_FOOTER.test(line),
  );
  const selectedLines =
    informativeLines.length > 0 ? informativeLines : rawLines;

  const sanitized = selectedLines
    .slice(-GATE_DIAGNOSTIC_LINES)
    .map(line => line
      .replace(GATE_SECRET_ASSIGNMENT, (_match, key: string) => `${key}=<redacted>`)
      .replace(GATE_BEARER, 'Bearer <redacted>')
      .replace(GATE_JWT, '<redacted>')
      .replace(GATE_WINDOWS_PATH, '<path>')
      .replace(GATE_POSIX_PATH, '<path>'))
    .join('\n')
    .slice(0, GATE_DIAGNOSTIC_MAX)
    .trim();

  return sanitized.length > 0 ? sanitized : undefined;
}

type Attach = (sequence: number, value: WorkExecutorSignalInput) => WorkExecutorSignal;

export class WorktreeExecutorAdapter implements WorkExecutorAdapter {
  readonly id = 'worktree-v1';
  constructor(private readonly options: WorktreeExecutorOptions) {}

  async *execute(request: WorkExecutorRequest, signal: AbortSignal): AsyncIterable<WorkExecutorSignal> {
    let seq = 0;
    const attach: Attach = (sequence, value) => ({
      attemptId: request.attemptId, workItemId: request.workItemId, approvedProposalVersion: request.approvedProposalVersion,
      origin: 'executor', sequence, ...value,
    }) as unknown as WorkExecutorSignal;

    const missing = REQUIRED_PERMISSIONS.filter(permission => !request.permissions.includes(permission));
    const target = this.options.targets.resolve(request.target.reference);
    const commands = request.validationCriteria.flatMap(item => item.command ? [item.command] : []);
    if (!opaque(request.target.reference) || !target || missing.length > 0 || request.validationCriteria.length === 0) {
      yield attach(++seq, { kind: 'error', code: 'invalid_request', message: !target ? 'Alvo de worktree não autorizado.' : missing.length ? 'Permissões locais insuficientes.' : 'A tentativa precisa de ao menos um critério de validação.', retryable: false, handoffReference: 'checkpoint:invalid-worktree-request' });
      return;
    }
    // Allowlist verificada na ENTRADA: um comando não permitido é pedido
    // inválido, não uma falha de gate. Nada é spawnado.
    if (commands.some(command => parseGateCommand(command) === null)) {
      yield attach(++seq, { kind: 'error', code: 'invalid_request', message: 'Um comando de validação está fora da allowlist permitida.', retryable: false, handoffReference: 'checkpoint:invalid-worktree-request' });
      return;
    }

    const branch = worktreeBranchFor(request.attemptId, this.options.branchPrefix ?? WORKTREE_BRANCH_PREFIX);
    const handoffReference = `worktree:${request.target.reference}:${branch}`;
    let worktree: GitWorktree | null = null;
    let durableCheckpointSha: string | null = null;
    try {
      try {
        worktree = await GitWorktree.create({ repoRoot: target.repoRoot, sha: target.sha, startSha: target.startSha, branch, signal });
      } catch (error) {
        yield attach(++seq, { kind: 'error', code: 'execution_failed', message: `Falha ao criar a worktree isolada: ${clip(error instanceof Error ? error.message : String(error))}`, retryable: true, handoffReference: 'checkpoint:worktree-create-failed' });
        return;
      }
      if (signal.aborted) { yield attach(++seq, { kind: 'cancelled', acknowledged: true, handoffReference }); return; }

      const workspace: CoderWorkspace = {
        readFile: relPath => worktree!.readWorkspaceFile(relPath),
        writeFile: (relPath, content) => worktree!.writeWorkspaceFile(relPath, content),
        // Seam para backends enraizados (ex.: DeepSeek Harness) que rodam o próprio
        // laço agêntico e precisam de um cwd real. Os backends que só propõem edições
        // ignoram este campo. O host segue sendo a autoridade única do git observado,
        // escopo, gates, commit e restauração — o cwd não afrouxa nada disso.
        rootPath: worktree!.root,
      };
      const gateRetryLimit =
        Number.isInteger(this.options.gateRetryLimit) && (this.options.gateRetryLimit ?? 0) > 0
          ? this.options.gateRetryLimit!
          : 0;

      let retryIndex = 0;
      let retryFeedback: HostValidationFeedback | null = null;
      let editResult: Awaited<ReturnType<CoderBackend['edit']>>;
      let changed: readonly string[] = [];
      let changedByAttempt: readonly string[] = [];
      let diffFiles: Awaited<ReturnType<GitWorktree['diffNumstat']>> = [];
      let validations: WorkResultValidation[] = [];
      let gateOutcomes: WorktreeGateOutcome[] = [];
      let failure: {
        label: string;
        command: string;
        exitCode: number;
        timedOut: boolean;
        cancelled: boolean;
        diagnostic?: string;
      } | null = null;
      let diffBeforeRepairSha256: string | null = null;

      while (true) {
        // Relogio de primeira parte do HOST por chamada ao coder. Um retry interno
        // continua sendo uma nova observacao de execucao do backend, embora permaneça
        // dentro do mesmo attemptId/worktree.
        const coderStartedAt = Date.now();
        const observeCoder = (threw: boolean): void => {
          const outcome: HostObservedCoderOutcome =
            signal.aborted ? 'cancelled' : threw ? 'failed' : 'succeeded';
          this.options.onCoderObserved?.({
            backendId: this.options.backend.id,
            durationMs: Date.now() - coderStartedAt,
            outcome,
          });
        };

        try {
          editResult = await this.options.backend.edit(
            {
              objective: request.objective,
              includedScope: request.includedScope,
              excludedScope: request.excludedScope,
              ...(request.carriedContext
                ? { carriedContext: request.carriedContext }
                : {}),
              ...(retryFeedback
                ? { hostValidationFeedback: retryFeedback }
                : {}),
            },
            workspace,
            signal,
          );
          observeCoder(false);
        } catch (error) {
          observeCoder(true);

          const restored = durableCheckpointSha
            ? await worktree.restoreToCheckpoint(durableCheckpointSha)
            : await worktree.restoreToBase();

          if (signal.aborted) {
            yield attach(++seq, {
              kind: 'cancelled',
              acknowledged: true,
              handoffReference,
            });
            return;
          }

          const restoreNote = restored
            ? ''
            : ' A restauração ao estado-base falhou; a worktree será descartada.';

          yield attach(++seq, {
            kind: 'error',
            code: 'execution_failed',
            message: `O backend de código falhou: ${clip(
              error instanceof Error ? error.message : String(error),
            )}.${restoreNote}`,
            retryable: true,
            handoffReference,
          });
          return;
        }

        if (signal.aborted) {
          yield attach(++seq, {
            kind: 'cancelled',
            acknowledged: true,
            handoffReference,
          });
          return;
        }

        // `changed` preserva o diff auditável contra a base original. Enforcement
        // de escopo/no-op usa somente o delta desta attempt contra seu estado
        // inicial; numa retomada, o checkpoint herdado não é uma nova escrita.
        changed = await worktree.changedFiles(signal);
        changedByAttempt = await worktree.changedFilesSinceStart(signal);
        const noChanges = changedByAttempt.length === 0;

        if (!noChanges && retryIndex > 0 && diffBeforeRepairSha256 !== null) {
          const repairedDiffSha256 = diffSha256(await worktree.diff(signal));
          if (repairedDiffSha256 === diffBeforeRepairSha256) {
            yield attach(++seq, {
              kind: 'error',
              code: 'execution_failed',
              message: 'O repair não alterou o diff observado pelo host; execução encerrada sem repetir o gate.',
              retryable: false,
              handoffReference,
            });
            return;
          }
        }

        // Preserve the historical fail-closed behavior unless this executor was
        // explicitly given an internal host-gate retry budget.
        if (noChanges && retryIndex >= gateRetryLimit) {
          yield attach(++seq, {
            kind: 'error',
            code: 'execution_failed',
            message: 'O backend não produziu nenhuma alteração para revisão.',
            retryable: false,
            handoffReference,
          });
          return;
        }

        // Zero diff e gate failure sao evidencias host-side distintas.
        // Se existe or?amento interno, no-change recebe retry antes de qualquer gate.
        if (noChanges && retryIndex < gateRetryLimit) {
          retryIndex += 1;
          retryFeedback = {
            kind: 'no-change',
            retryIndex,
            retryLimit: gateRetryLimit,
          };
          continue;
        }

        if (!noChanges) {
          const approved = new Set(request.includedScope.map(norm));
          const outOfScope = changedByAttempt.filter(path => !approved.has(norm(path)));

          if (outOfScope.length > 0) {
            yield attach(++seq, {
              kind: 'error',
              code: 'contract_violation',
              message: `Alteração fora do escopo aprovado: ${outOfScope
                .map(norm)
                .join(', ')}.`,
              retryable: false,
              handoffReference,
            });
            return;
          }

          diffFiles = await worktree.diffNumstat(signal);

          // Keep checkpoint semantics stable: no empty checkpoint and no duplicate
          // checkpoint merely because the coder received an internal retry.
          if (this.options.emitCheckpoint && retryIndex === 0) {
            durableCheckpointSha = await worktree.commit(
              `anima(checkpoint): ${clip(request.objective, 72)}`,
              signal,
            );
            if (!durableCheckpointSha) {
              yield attach(++seq, {
                kind: 'error',
                code: 'execution_failed',
                message: 'Não foi possível persistir o checkpoint Git da alteração.',
                retryable: false,
                handoffReference,
              });
              return;
            }
            const checkpoint: WorkCheckpointV1 = {
              schemaVersion: 1,
              handoffReference,
              completedSteps: [
                'Worktree isolada criada a partir do SHA autorizado',
                'Alteração aplicada pelo backend de código',
              ],
              remainingSteps: [
                'Executar os gates de validação e produzir o resultado',
              ],
              nextStep:
                'Rodar os critérios de validação e entregar o resultado para revisão',
              decisions: [],
              risks: [],
              touchedResources: changed.map(norm),
              validations: [
                {
                  label: 'Alteração aplicada na worktree isolada',
                  outcome: 'passed',
                },
              ],
              failures: [],
              evidenceReferences: [branch],
            };

            if (validateWorkCheckpoint(checkpoint) === null) {
              yield attach(++seq, { kind: 'checkpoint', checkpoint });
            }
          }
        } else {
          diffFiles = [];
        }

        if (signal.aborted) {
          yield attach(++seq, {
            kind: 'cancelled',
            acknowledged: true,
            handoffReference,
          });
          return;
        }

        if (this.options.linkNodeModules) {
          await worktree.linkNodeModules(signal);
        }

        if (this.options.prepareValidation) {
          try {
            await this.options.prepareValidation({
              rootPath: worktree.root,
              validationCriteria: request.validationCriteria,
              signal,
            });
          } catch (error) {
            yield attach(++seq, {
              kind: 'error',
              code: 'execution_failed',
              message: `Falha ao preparar o ambiente de validacao: ${clip(
                error instanceof Error ? error.message : String(error),
              )}.`,
              retryable: false,
              handoffReference,
            });
            return;
          }
        }

        const timeoutMs =
          (request.limits.maxDurationMinutes ?? 30) * 60_000;

        validations = [];
        gateOutcomes = [];
        failure = null;

        for (const criterion of request.validationCriteria) {
          if (!criterion.command) {
            validations.push({
              label: criterion.label,
              outcome: 'declared',
            });
            continue;
          }

          if (signal.aborted) break;

          const gate = await runGate(
            criterion.command,
            worktree.root,
            timeoutMs,
            signal,
          );

          this.options.onGateObserved?.({
            label: criterion.label,
            command: gate.command,
            exitCode: gate.exitCode,
            durationMs: gate.durationMs,
            timedOut: gate.timedOut,
            cancelled: gate.cancelled,
          });

          const passed =
            gate.exitCode === 0 && !gate.timedOut && !gate.cancelled;

          validations.push({
            label: criterion.label,
            outcome: passed ? 'passed' : 'failed',
          });

          gateOutcomes.push({
            label: criterion.label,
            command: gate.command,
            exitCode: gate.exitCode,
            outcome: passed ? 'passed' : 'failed',
          });

          if (!passed) {
            failure = {
              label: criterion.label,
              command: gate.command,
              exitCode: gate.exitCode,
              timedOut: gate.timedOut,
              cancelled: gate.cancelled,
              diagnostic: summarizeGateFailureForRetry(gate.stdout, gate.stderr),
            };
            break;
          }
        }

        if (signal.aborted) {
          yield attach(++seq, {
            kind: 'cancelled',
            acknowledged: true,
            handoffReference,
          });
          return;
        }

        const canRetry =
          failure !== null &&
          isGateFailureEligibleForCoderRepair(failure) &&
          retryIndex < gateRetryLimit;

        if (!canRetry) {
          if (noChanges) {
            yield attach(++seq, {
              kind: 'error',
              code: 'execution_failed',
              message: 'O backend não produziu nenhuma alteração para revisão.',
              retryable: false,
              handoffReference,
            });
            return;
          }

          break;
        }

        // O gate pode ter ligado o node_modules REAL por junction/symlink.
        // Antes de devolver controle ao coder, essa ponte precisa desaparecer.
        await worktree.unlinkNodeModules();

        const initialDiff = await worktree.diff(signal);
        diffBeforeRepairSha256 = diffSha256(initialDiff);
        retryIndex += 1;
        retryFeedback = {
          kind: 'gate-failure',
          failedGate: {
            label: failure!.label,
            command: failure!.command,
            exitCode: failure!.exitCode,
            timedOut: failure!.timedOut,
            cancelled: failure!.cancelled,
          },
          retryIndex,
          retryLimit: gateRetryLimit,
          changedFiles: changed.map(norm),
          diffSha256: diffBeforeRepairSha256,
          ...(failure!.diagnostic ? { diagnostic: failure!.diagnostic } : {}),
        };
      }

      // O checkpoint intermediário é durável. Um estado final diferente recebe
      // um segundo commit; sem mudança posterior, o SHA do checkpoint é o handoff.
      const commitSha = (await worktree.commit(
        `anima(worktree): ${clip(request.objective, 80)}`,
        signal,
      )) ?? durableCheckpointSha;

      if (failure) {
        yield attach(++seq, {
          kind: 'error',
          code: 'execution_failed',
          message: `Gate falhou: ${failure.command} terminou com c?digo ${failure.exitCode}.`,
          retryable: false,
          handoffReference,
        });
        return;
      }

      // Produtor vivo do handoff durável (INT-05): evidência git estruturada
      // embutida no sinal `result`, persistida pela RPC de término (sinal inteiro
      // em executor_signal) e relida por projectWorktreeHandoff. Opcional e
      // fail-open — sem commit ou sem gate, o resultado ainda vai para revisão.
      const handoff = commitSha
        ? buildWorktreeHandoff({
            workItemId: request.workItemId,
            attemptId: request.attemptId,
            approvedProposalVersion: request.approvedProposalVersion,
            executorId: this.id,
            backendId: this.options.backend.id,
            model: null,
            baseSha: target.sha,
            branch,
            commitSha,
            status: 'succeeded',
            changedFiles: changed.map(norm),
            diffFiles,
            gates: gateOutcomes,
          })
        : null;
      const worktreeHandoff = handoff?.ok ? handoff.value : undefined;

      yield attach(++seq, {
        kind: 'result',
        summary: editResult.summary || 'Alteração produzida e validada em worktree isolada.',
        resultReferences: [`worktree-branch:${branch}`, `worktree-changed:${changed.length}`],
        validations,
        limitations: ['Executado em worktree isolada; nenhuma alteração foi aplicada ao workspace original.'],
        handoffReference,
        ...(worktreeHandoff ? { worktreeHandoff } : {}),
      });
    } finally {
      // Worktree descartável some; a branch fica como referência revisável.
      if (worktree) await worktree.dispose({ deleteBranch: false }).catch(() => {});
    }
  }
}
