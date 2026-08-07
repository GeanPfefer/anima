import {
  validateWorkCheckpoint,
  type WorkCheckpointV1,
  type WorkExecutorAdapter,
  type WorkExecutorRequest,
  type WorkExecutorSignal,
  type WorkExecutorSignalInput,
  type WorkResultValidation,
} from '@anima/core';
import type { CoderBackend, CoderWorkspace } from './coder-backend';
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

export interface WorktreeTarget { readonly repoRoot: string; readonly sha: string; }
export interface WorktreeTargetResolver { resolve(reference: string): WorktreeTarget | null; }

export interface WorktreeExecutorOptions {
  readonly targets: WorktreeTargetResolver;
  /** Inteligência selecionável que escreve o código. */
  readonly backend: CoderBackend;
  readonly branchPrefix?: string;
  /** Religa o node_modules real para o gate npm rodar sem instalar. */
  readonly linkNodeModules?: boolean;
  /** Emite um checkpoint mid-flight após a edição e antes do gate. */
  readonly emitCheckpoint?: boolean;
}

const REQUIRED_PERMISSIONS = ['workspace_read', 'workspace_write_isolated'] as const;
const opaque = (value: string): boolean => value.length > 0 && !value.includes('/') && !value.includes('\\') && !value.includes('..');
const norm = (path: string): string => path.replace(/\\/g, '/');
const clip = (value: string, max = 120): string => value.length <= max ? value : `${value.slice(0, max)}…`;

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

    const branch = `${this.options.branchPrefix ?? 'anima-work'}/${request.attemptId}`;
    const handoffReference = `worktree:${request.target.reference}:${branch}`;
    let worktree: GitWorktree | null = null;
    try {
      try {
        worktree = await GitWorktree.create({ repoRoot: target.repoRoot, sha: target.sha, branch, signal });
      } catch (error) {
        yield attach(++seq, { kind: 'error', code: 'execution_failed', message: `Falha ao criar a worktree isolada: ${clip(error instanceof Error ? error.message : String(error))}`, retryable: true, handoffReference: 'checkpoint:worktree-create-failed' });
        return;
      }
      if (signal.aborted) { yield attach(++seq, { kind: 'cancelled', acknowledged: true, handoffReference }); return; }

      const workspace: CoderWorkspace = {
        readFile: relPath => worktree!.readWorkspaceFile(relPath),
        writeFile: (relPath, content) => worktree!.writeWorkspaceFile(relPath, content),
      };
      let editResult;
      try {
        editResult = await this.options.backend.edit(
          { objective: request.objective, includedScope: request.includedScope, excludedScope: request.excludedScope, ...(request.carriedContext ? { carriedContext: request.carriedContext } : {}) },
          workspace, signal,
        );
      } catch (error) {
        // Autoridade ÚNICA de restauração (outcome atomicity): a camada da
        // worktree volta ao estado-base. A restauração é SEMPRE tentada — ANTES de
        // classificar o desfecho e INDEPENDENTE de `signal.aborted` —, porque o
        // cancelamento da tentativa não pode cancelar a limpeza que preserva o
        // invariant. `restoreToBase()` nunca rejeita: devolve false em falha, e a
        // worktree segue condenada ao dispose (contenção final); nunca vira sucesso.
        const restored = await worktree.restoreToBase();
        if (signal.aborted) { yield attach(++seq, { kind: 'cancelled', acknowledged: true, handoffReference }); return; }
        const restoreNote = restored ? '' : ' A restauração ao estado-base falhou; a worktree será descartada.';
        yield attach(++seq, { kind: 'error', code: 'execution_failed', message: `O backend de código falhou: ${clip(error instanceof Error ? error.message : String(error))}.${restoreNote}`, retryable: true, handoffReference });
        return;
      }
      if (signal.aborted) { yield attach(++seq, { kind: 'cancelled', acknowledged: true, handoffReference }); return; }

      const changed = await worktree.changedFiles(signal);
      if (changed.length === 0) {
        yield attach(++seq, { kind: 'error', code: 'execution_failed', message: 'O backend não produziu nenhuma alteração para revisão.', retryable: false, handoffReference });
        return;
      }
      const approved = new Set(request.includedScope.map(norm));
      const outOfScope = changed.filter(path => !approved.has(norm(path)));
      if (outOfScope.length > 0) {
        yield attach(++seq, { kind: 'error', code: 'contract_violation', message: `Alteração fora do escopo aprovado: ${outOfScope.map(norm).join(', ')}.`, retryable: false, handoffReference });
        return;
      }

      if (this.options.emitCheckpoint) {
        const checkpoint: WorkCheckpointV1 = {
          schemaVersion: 1, handoffReference,
          completedSteps: ['Worktree isolada criada a partir do SHA autorizado', 'Alteração aplicada pelo backend de código'],
          remainingSteps: ['Executar os gates de validação e produzir o resultado'],
          nextStep: 'Rodar os critérios de validação e entregar o resultado para revisão',
          decisions: [], risks: [],
          touchedResources: changed.map(norm),
          validations: [{ label: 'Alteração aplicada na worktree isolada', outcome: 'passed' }],
          failures: [], evidenceReferences: [branch],
        };
        if (validateWorkCheckpoint(checkpoint) === null) yield attach(++seq, { kind: 'checkpoint', checkpoint });
      }
      if (signal.aborted) { yield attach(++seq, { kind: 'cancelled', acknowledged: true, handoffReference }); return; }

      if (this.options.linkNodeModules) await worktree.linkNodeModules(signal);

      const timeoutMs = (request.limits.maxDurationMinutes ?? 30) * 60_000;
      const validations: WorkResultValidation[] = [];
      let failure: { command: string; exitCode: number } | null = null;
      for (const criterion of request.validationCriteria) {
        if (!criterion.command) { validations.push({ label: criterion.label, outcome: 'declared' }); continue; }
        if (signal.aborted) break;
        const gate = await runGate(criterion.command, worktree.root, timeoutMs, signal);
        const passed = gate.exitCode === 0 && !gate.timedOut && !gate.cancelled;
        validations.push({ label: criterion.label, outcome: passed ? 'passed' : 'failed' });
        if (!passed) { failure = { command: gate.command, exitCode: gate.exitCode }; break; }
      }
      if (signal.aborted) { yield attach(++seq, { kind: 'cancelled', acknowledged: true, handoffReference }); return; }

      // Commit na branch descartável, capturando a mudança como referência
      // revisável — jamais pushado, jamais merjado.
      await worktree.commit(`anima(worktree): ${clip(request.objective, 80)}`, signal);

      if (failure) {
        yield attach(++seq, { kind: 'error', code: 'execution_failed', message: `Gate falhou: ${failure.command} terminou com código ${failure.exitCode}.`, retryable: false, handoffReference });
        return;
      }
      yield attach(++seq, {
        kind: 'result',
        summary: editResult.summary || 'Alteração produzida e validada em worktree isolada.',
        resultReferences: [`worktree-branch:${branch}`, `worktree-changed:${changed.length}`],
        validations,
        limitations: ['Executado em worktree isolada; nenhuma alteração foi aplicada ao workspace original.'],
        handoffReference,
      });
    } finally {
      // Worktree descartável some; a branch fica como referência revisável.
      if (worktree) await worktree.dispose({ deleteBranch: false }).catch(() => {});
    }
  }
}
