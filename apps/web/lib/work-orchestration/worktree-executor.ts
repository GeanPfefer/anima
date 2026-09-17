import {
  buildWorktreeHandoff,
  validateWorkCheckpoint,
  describeCoderHarnessViolations,
  resolveCommandExecution,
  resolveCommandExecutionPolicy,
  resolveEffectiveCoderHarnessPolicy,
  supervisedWorkspaceAccessPolicy,
  type CoderHarnessPolicyV1,
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
import { analyzeCoderOutputFiles, collectCoderOutputForHarness } from './coder-output-analysis';
import { summarizeCommandOutput } from './output-sanitization';
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
   * Política do contrato do harness aplicada à SAÍDA do coder (runner de teste
   * canônico, runners incompatíveis, fontes de backend não autoritativas). Ausente
   * ⇒ política padrão do monorepo (Jest; rejeita vitest e `entry.coderBackend`). A
   * validação é determinística, host-side e fail-closed — roda antes dos gates caros.
   */
  readonly harnessPolicy?: CoderHarnessPolicyV1;
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

// Régua do resumo de gate: causa (tail), 8 linhas, 700 chars, caminhos redigidos.
const GATE_DIAGNOSTIC_MAX = 700;
const GATE_DIAGNOSTIC_LINES = 8;
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
  // Régua compartilhada (SISTEMA ÚNICO de redaction): causa por tail, rodapés
  // removidos, últimas 8 linhas, caminhos redigidos, truncado a 700 chars.
  return summarizeCommandOutput(stdout, stderr, {
    maxChars: GATE_DIAGNOSTIC_MAX,
    maxLines: GATE_DIAGNOSTIC_LINES,
    dropFooters: true,
    redactPaths: true,
  });
}

type Attach = (sequence: number, value: WorkExecutorSignalInput) => WorkExecutorSignal;

export class WorktreeExecutorAdapter implements WorkExecutorAdapter {
  readonly id = 'worktree-v1';
  constructor(private readonly options: WorktreeExecutorOptions) {}

  async *execute(request: WorkExecutorRequest, signal: AbortSignal): AsyncIterable<WorkExecutorSignal> {
    let seq = 0;
    // Política EFETIVA do harness: sempre superset canônico. Um `harnessPolicy` de
    // caller só pode ENDURECER; listas vazias/omissão NÃO desligam as invariantes
    // (Vitest proibido, `entry.coderBackend` proibido). É esta política que viaja ao
    // coder ANTES da inferência e que o validador estrutural pós-output aplica.
    const effectiveHarnessPolicy = resolveEffectiveCoderHarnessPolicy(this.options.harnessPolicy);
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
        // SEARCH/GLOB host-executados (Coding Harness V3): o agente INVESTIGA
        // amplamente (todo o escopo de LEITURA) sem shell e sem ganhar autoridade de
        // escrita. O confinamento é do git grep/ls-files (só arquivos rastreados sob a
        // raiz) mais o filtro de read-scope no laço; a escrita continua governada.
        search: (input, searchSignal) => worktree!.searchText(input, searchSignal),
        list: (input, listSignal) => worktree!.listFiles(input, listSignal),
        // EXEC/TEST/GIT governados (V3, 3ª fatia): o comando já vem validado pela
        // command policy (allowlist de programa, git read-only, npm run/test, sem
        // metacaractere de shell); a worktree o roda confinado à raiz, sem shell
        // arbitrário, com node_modules/.bin no PATH. Captura/limite de saída é do host.
        exec: (input, execSignal) => worktree!.runCommand(input, execSignal),
        // Seam para backends enraizados (ex.: DeepSeek Harness) que rodam o próprio
        // laço agêntico e precisam de um cwd real. Os backends que só propõem edições
        // ignoram este campo. O host segue sendo a autoridade única do git observado,
        // escopo, gates, commit e restauração — o cwd não afrouxa nada disso.
        rootPath: worktree!.root,
      };
      // Autoridade de acesso ao workspace (V3): LER todo o workspace autorizado,
      // ESCREVER só o escopo do Work Item (`includedScope`). O host reforça a escrita
      // pós-edição via git observado (contract_violation) — ler não concede escrever.
      // Este é o wiring vivo mínimo do Governor; um readScope mais conservador para
      // modo autônomo pode ser injetado no futuro sem mudar os braços.
      const workspaceAccessPolicy = supervisedWorkspaceAccessPolicy(
        request.includedScope,
        request.excludedScope,
      );
      // EXEC authority (V3, 3ª fatia): perfil de comandos supervisionado (dev toolchain
      // + git read-only, rede negada). Distinta de READ/WRITE — rodar testes não concede
      // rede nem escrita. Wiring vivo mínimo do Governor; um perfil autônomo mais
      // restrito é injetável depois sem mudar os braços.
      const commandPolicy = resolveCommandExecutionPolicy('supervised');
      const validationCommands = request.validationCriteria.flatMap(criterion => {
        if (!criterion.command) return [];
        const parsed = parseGateCommand(criterion.command);
        if (!parsed) return [];
        const program = parsed.file.toLowerCase().replace(/\.cmd$/, '');
        const decision = resolveCommandExecution({ program, args: parsed.args }, commandPolicy);
        return decision.ok ? [{ label: criterion.label, program: decision.program, args: decision.args }] : [];
      });
      const gateRetryLimit =
        Number.isInteger(this.options.gateRetryLimit) && (this.options.gateRetryLimit ?? 0) > 0
          ? this.options.gateRetryLimit!
          : 0;

      let retryIndex = 0;
      let retryFeedback: HostValidationFeedback | null = null;
      let editResult: Awaited<ReturnType<CoderBackend['edit']>>;
      let providerUsage: import('@anima/core').ProviderReportedUsageV1 | undefined;
      let providerCallCount: number | undefined;
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
        let transcript: import('@anima/core').CoderTranscript | undefined;
        const observeCoder = (threw: boolean): void => {
          const outcome: HostObservedCoderOutcome =
            signal.aborted ? 'cancelled' : threw ? 'failed' : 'succeeded';
          this.options.onCoderObserved?.({
            backendId: this.options.backend.id,
            durationMs: Date.now() - coderStartedAt,
            outcome,
            ...(transcript ? { transcripts: [transcript] } : {}),
            ...(providerUsage ? { providerUsage } : {}),
            ...(providerCallCount !== undefined ? { providerCallCount } : {}),
            ...(this.options.backend.observation ?? {}),
          });
        };

        try {
          editResult = await this.options.backend.edit(
            {
              workItemId: request.workItemId,
              attemptId: request.attemptId,
              approvedProposalVersion: request.approvedProposalVersion,
              maxDurationMs: (request.limits.maxDurationMinutes ?? 30) * 60_000,
              objective: request.objective,
              onTranscript: value => { transcript = value; },
              includedScope: request.includedScope,
              excludedScope: request.excludedScope,
              // V3: READ amplo / WRITE estreito. includedScope permanece a autoridade
              // de ESCRITA; readScope=workspace habilita investigação ampla.
              workspaceAccessPolicy,
              // V3 (3ª fatia): EXEC governado (dev/test/typecheck/git read-only).
              commandPolicy,
              validationCommands,
              // PRÉ-CODER: a política canônica chega ao backend ANTES da inferência,
              // pelo contrato compartilhado (Ollama/OpenAI/DeepSeek recebem a mesma).
              harnessPolicy: effectiveHarnessPolicy,
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
          providerUsage = editResult.providerUsage;
          providerCallCount = editResult.providerCallCount;
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

          // Leitura FAIL-CLOSED da saída do coder + análise ESTRUTURAL (AST) ANTES dos
          // gates caros e de qualquer checkpoint. Diferencia status Git: uma deleção (D)
          // legitimamente não tem conteúdo; um arquivo A/M/R/C/T DEVE ser legível — se a
          // leitura falhar, é erro terminal (nunca passagem silenciosa de arquivo não
          // inspecionado). Rename (R) inspeciona o DESTINO. Depois, um teste com runner
          // incompatível (ex.: `vitest` num workspace Jest) ou a leitura do backend de
          // fonte não autoritativa (`entry.coderBackend` e equivalentes) são rejeitados
          // FAIL-CLOSED — nunca viram result nem checkpoint. Antes, esses modos só
          // falhavam TARDE (na build/tsc), depois do gasto pago.
          const collected = await collectCoderOutputForHarness(worktree, signal);
          if (!collected.ok) {
            yield attach(++seq, {
              kind: 'error',
              code: 'execution_failed',
              message: `Arquivo alterado (${collected.unreadable.status}) não pôde ser lido para inspeção do harness: ${clip(norm(collected.unreadable.path), 200)}.`,
              retryable: false,
              handoffReference,
            });
            return;
          }
          const harness = analyzeCoderOutputFiles(collected.files, effectiveHarnessPolicy);
          if (!harness.ok) {
            yield attach(++seq, {
              kind: 'error',
              code: 'contract_violation',
              message: `Saída do coder viola o contrato do harness: ${clip(
                describeCoderHarnessViolations(harness.violations),
                500,
              )}.`,
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
          // Não classificar timeout como falha determinística do código.
          message: `${failure.timedOut ? '' : '[gate_failed] '}Gate falhou: ${failure.command} terminou com código ${failure.exitCode}.`,
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
