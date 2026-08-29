import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import type { ObservedCoderInput, ObservedGateInput, WorkExecutorRequest, WorkRoutingCandidateV1 } from '@anima/core';
import type { CoderBackend } from './coder-backend';
import { OllamaCoderBackend } from './ollama-coder';
import { resolveOllamaCoderRuntimeConfig } from './ollama-coder-config';
import { GptCoderBackend } from './gpt-coder';
import { createNodeDeepSeekHarnessBackend } from './harness/node-harness-runtime';
import { localRunnerRouteFromEnvironment, type ConfiguredWorkRoute } from './execution';
import { WorktreeExecutorAdapter } from './worktree-executor';
import { runProcess } from './worktree';

// ============================================================
// Seleção EXPLÍCITA de executor a partir do contrato de execução PERSISTIDO
// (ADR-001, fiação da rota). Não é heurística: lê `execution_spec.executor` do
// item e devolve exatamente um `WorkExecutorAdapter` (via ConfiguredWorkRoute).
// O Supervisor continua recebendo só rotas; não conhece worktree, Ollama, etc.
//
// Regras: `project:anima` exige o executor de worktree; o caminho legado (runner
// Python) continua disponível para os demais; configuração inválida falha de
// forma EXPLÍCITA e nenhuma seleção cai silenciosamente num executor diferente.
// ============================================================

const SHA = /^[a-f0-9]{40}$/;

export interface ExecutionContract {
  readonly executor: string | null;
  readonly coderBackend: string | null;
  readonly model: string | null;
  readonly baseSha: string | null;
  readonly targetKind: string | null;
  readonly targetReference: string | null;
  /** Commit do checkpoint durável a partir do qual RETOMAR (decomposição
   * governada). Ausente ⇒ nova tentativa a partir da base. O diff continua
   * medido contra `baseSha`. */
  readonly resumeCheckpointCommitSha: string | null;
}

export type ExecutorSelection =
  | { readonly ok: true; readonly route: ConfiguredWorkRoute }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

const str = (value: unknown): string | null => (typeof value === 'string' && value.trim().length > 0 ? value : null);
const objectOf = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {});

/**
 * Descobre a raiz somente entre o cwd e seus ancestrais. Assim `apps/web` e a
 * raiz do monorepo funcionam, mas um processo fora da árvore precisa declarar
 * `ANIMA_PROJECT_ROOT`; nunca há fallback para um diretório apenas "provável".
 */
export function isAnimaProjectRoot(root: string): boolean {
  return isAbsolute(root)
    && existsSync(join(root, '.git'))
    && existsSync(join(root, 'package.json'))
    && existsSync(join(root, 'apps', 'web', 'package.json'));
}

const discoverProjectRoot = (start: string): string | null => {
  let candidate = resolve(start);
  const filesystemRoot = parse(candidate).root;
  while (true) {
    if (isAnimaProjectRoot(candidate)) return candidate;
    if (candidate === filesystemRoot) return null;
    candidate = dirname(candidate);
  }
};

export function projectRoot(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string {
  const configured = env.ANIMA_PROJECT_ROOT?.trim();
  if (configured && configured.length > 0) return resolve(configured);
  return discoverProjectRoot(cwd) ?? resolve(cwd);
}

/** Lê o SHA autorizado a partir do HEAD do repositório, no momento da proposta.
 * Persistido no contrato; a execução usa exatamente este SHA, nunca o HEAD futuro. */
export async function readAuthorizedBaseSha(repoRoot: string = projectRoot()): Promise<string | null> {
  const result = await runProcess('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { cwd: repoRoot, timeoutMs: 15_000 }).catch(() => null);
  const sha = result?.stdout.trim() ?? '';
  return result && result.exitCode === 0 && SHA.test(sha) ? sha : null;
}

export function readExecutionContract(intent: unknown): ExecutionContract {
  const spec = objectOf(objectOf(intent)['execution_spec']);
  const target = objectOf(spec['target']);
  const resume = objectOf(spec['resume_from_checkpoint']);
  const resumeCommit = str(resume['commit_sha']);
  return {
    executor: str(spec['executor']),
    coderBackend: str(spec['coder_backend']),
    model: str(spec['model']),
    baseSha: str(spec['base_sha']),
    targetKind: str(target['kind']),
    targetReference: str(target['reference']),
    // Só um SHA bem-formado habilita a retomada; qualquer coisa fora disso é
    // ignorada (parte da base, sempre seguro) — nunca um commit arbitrário.
    resumeCheckpointCommitSha: resumeCommit && SHA.test(resumeCommit) ? resumeCommit : null,
  };
}

const worktreeCandidate = (executorId: string, modelRef: string): WorkRoutingCandidateV1 => ({
  schemaVersion: 1,
  routeId: 'worktree-v1:configured',
  executorId,
  providerRef: 'worktree-host',
  modelRef,
  // Única rota explícita desta seleção: `strong` satisfaz qualquer piso de esforço,
  // então a rota escolhida pelo contrato é sempre a selecionada pelo INTEL-02.
  effort: 'strong',
  capabilities: ['programming'],
  availability: 'available',
  latency: 'normal',
  priority: 100,
});

const backendFor = (
  contract: ExecutionContract,
  repoRoot: string,
  override?: CoderBackend,
): CoderBackend | { readonly error: string } => {
  if (override) return override;
  const kind = contract.coderBackend ?? 'ollama';

  // Intelig?ncias selecion?veis atr?s da mesma seam CoderBackend.
  // O Supervisor continua sem conhecer detalhes de provider.
  if (kind === 'ollama') {
    const model = contract.model ?? process.env.ANIMA_WORKTREE_CODER_MODEL ?? 'qwen3-coder:latest';
    const runtime = resolveOllamaCoderRuntimeConfig(model);
    if (!runtime.ok) return { error: runtime.error };
    return new OllamaCoderBackend({
      model,
      url: runtime.value.url,
      backendId: runtime.value.backendId,
    });
  }

  if (kind === 'openai') {
    return new GptCoderBackend({
      model: contract.model ?? process.env.OPENAI_MODEL,
    });
  }

  if (kind === 'deepseek-harness') {
    return createNodeDeepSeekHarnessBackend({
      repoRoot,
      model: contract.model ?? process.env.ANIMA_WORKTREE_CODER_MODEL ?? 'qwen3-coder:latest',
    });
  }

  // O backend determin?stico (`scripted`) s? entra por inje??o em teste.
  return { error: `Backend de c?digo "${kind}" n?o ? permitido no fluxo real.` };
};

// Seletores `--workspace` que o npm resolve ao MESMO workspace apps/web: pelo
// CAMINHO (`apps/web`) ou pelo NOME do pacote (`@anima/web`). `safeValidationCommand`
// admite ambos; a detecção precisa cobrir os dois, senão um gate legítimo de
// typecheck do apps/web (ex.: `--workspace=@anima/web`) roda sem o Next typegen e
// falha na worktree (`.next/types` ausente) — item reprovado por engano.
const ANIMA_WEB_WORKSPACE_SELECTORS: ReadonlySet<string> = new Set(['apps/web', '@anima/web']);

export function needsAnimaWebTypegen(
  validationCriteria: WorkExecutorRequest['validationCriteria'],
): boolean {
  return validationCriteria.some(criterion => {
    const command = criterion.command?.trim().toLowerCase();
    if (!command) return false;

    // Só `typecheck` depende de `.next/types`: `build` (`next build`) gera seus
    // próprios tipos e `test` (jest) não checa tipos. Casa o comando de typecheck
    // com ou sem seletor de workspace, tolerando `npm.cmd` e um sufixo `-- ...`.
    const match = /^npm(?:\.cmd)? run typecheck(?: --workspace=([@a-z0-9._/-]+))?(?: -- .+)?$/.exec(command);
    if (!match) return false;

    const selector = match[1];
    // Sem `--workspace`: typecheck do monorepo inteiro, que inclui apps/web.
    if (selector === undefined) return true;
    // Com `--workspace`: só precisa de typegen quando o alvo é apps/web (por
    // caminho ou por nome), tolerando barra final. Outros workspaces (ex.:
    // packages/core) não dependem de artefatos gerados do Next.
    return ANIMA_WEB_WORKSPACE_SELECTORS.has(selector.replace(/\/+$/, ''));
  });
}

export interface AnimaValidationPreparationInput {
  readonly rootPath: string;
  readonly validationCriteria: WorkExecutorRequest['validationCriteria'];
  readonly signal: AbortSignal;
}

export interface AnimaValidationPreparationDependencies {
  readonly resolveNextCli: (webRoot: string) => string;
  readonly run: typeof runProcess;
}

export function resolveAnimaNextCli(webRoot: string): string {
  const nextCli = join(webRoot, 'node_modules', 'next', 'dist', 'bin', 'next');

  if (!existsSync(nextCli)) {
    throw new Error(`Next CLI nao encontrado no workspace web: ${nextCli}`);
  }

  return nextCli;
}

const defaultAnimaValidationPreparationDependencies: AnimaValidationPreparationDependencies = {
  resolveNextCli: resolveAnimaNextCli,
  run: runProcess,
};

export async function prepareAnimaValidation(
  input: AnimaValidationPreparationInput,
  dependencies: AnimaValidationPreparationDependencies =
    defaultAnimaValidationPreparationDependencies,
): Promise<void> {
  if (!needsAnimaWebTypegen(input.validationCriteria)) return;

  if (input.signal.aborted) {
    throw new Error('Preparacao de validacao cancelada antes do Next typegen.');
  }

  const webRoot = join(input.rootPath, 'apps', 'web');
  const nextCli = dependencies.resolveNextCli(webRoot);

  const result = await dependencies.run(
    process.execPath,
    [nextCli, 'typegen', '.'],
    {
      cwd: webRoot,
      timeoutMs: 120_000,
      signal: input.signal,
    },
  );

  if (result.exitCode === 0 && !result.timedOut && !result.cancelled) return;

  const diagnostic =
    result.stderr.trim() ||
    result.stdout.trim() ||
    `exitCode=${result.exitCode}`;

  throw new Error(
    `Next typegen falhou: ${diagnostic}`,
  );
}

export function gateRetryLimitForCoderBackend(kind: string | null): number {
  // Uma unica correcao interna apos falha elegivel de gate observada pelo host,
  // no mesmo attempt/worktree. OpenAI preserva retry zero.
  return kind === 'deepseek-harness' || kind === 'ollama' ? 1 : 0;
}

export function resolveExecutorRoute(
  contract: ExecutionContract,
  options: {
    readonly backendOverride?: CoderBackend;
    readonly repoRoot?: string;
    /** Observador host-side dos gates, injetado pela rota para captar a evidência
     * observada de gate. Só o executor de worktree (host in-process) o usa. */
    readonly gateObserver?: (outcome: ObservedGateInput) => void;
    /** Observador host-side do coder (duração wall-clock de `backend.edit()`), injetado
     * pela rota para captar a evidência observada do coder. Só o executor de worktree
     * (host in-process) o usa. */
    readonly coderObserver?: (outcome: ObservedCoderInput) => void;
  } = {},
): ExecutorSelection {
  const err = (code: string, message: string): ExecutorSelection => ({ ok: false, error: { code, message } });
  const isAnima = contract.targetKind === 'project' && contract.targetReference === 'anima';

  if (contract.executor === 'worktree') {
    if (contract.targetKind !== 'project' || !contract.targetReference) return err('worktree_target_invalid', 'O executor de worktree exige um alvo de projeto com referência.');
    if (!contract.baseSha || !SHA.test(contract.baseSha)) return err('worktree_base_sha_missing', 'O SHA-base autorizado não foi persistido ou é inválido.');
    const repoRoot = options.repoRoot ?? projectRoot();
    if (!isAnimaProjectRoot(repoRoot)) return err('project_root_invalid', 'A raiz do projeto Anima não é um repositório válido.');
    const backend = backendFor(contract, repoRoot, options.backendOverride);
    if ('error' in backend) return err('coder_backend_invalid', backend.error);
    const reference = contract.targetReference;
    const baseSha = contract.baseSha;
    // Retomada: se o contrato aponta um checkpoint durável, a worktree parte dele
    // (o edit anterior preservado), enquanto o diff continua contra a base.
    const startSha = contract.resumeCheckpointCommitSha ?? undefined;
    const adapter = new WorktreeExecutorAdapter({
      targets: { resolve: ref => ref === reference ? { repoRoot, sha: baseSha, ...(startSha ? { startSha } : {}) } : null },
      backend,
      emitCheckpoint: true,
      linkNodeModules: true,
      ...(isAnima ? { prepareValidation: prepareAnimaValidation } : {}),
      gateRetryLimit: gateRetryLimitForCoderBackend(contract.coderBackend),
      ...(options.gateObserver ? { onGateObserved: options.gateObserver } : {}),
      ...(options.coderObserver ? { onCoderObserved: options.coderObserver } : {}),
    });
    return { ok: true, route: { adapter, candidate: worktreeCandidate(adapter.id, backend.id) } };
  }

  // project:anima NUNCA cai no runner Python (o runner não constrói TS): exige worktree explícito.
  if (isAnima) return err('anima_requires_worktree', 'O alvo project:anima exige o executor de worktree; nenhum outro é permitido.');

  if (contract.executor === 'python_runner' || contract.executor === null) {
    const route = localRunnerRouteFromEnvironment({ emitCheckpoints: true });
    if (!route) return err('local_runner_not_configured', 'Executor local (runner Python) não está configurado.');
    return { ok: true, route };
  }

  return err('executor_unknown', `Executor "${contract.executor}" não é reconhecido.`);
}
