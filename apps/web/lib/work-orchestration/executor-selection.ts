import { isAbsolute, resolve } from 'node:path';
import type { ObservedCoderInput, ObservedGateInput, WorkRoutingCandidateV1 } from '@anima/core';
import type { CoderBackend } from './coder-backend';
import { OllamaCoderBackend } from './ollama-coder';
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
}

export type ExecutorSelection =
  | { readonly ok: true; readonly route: ConfiguredWorkRoute }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

const str = (value: unknown): string | null => (typeof value === 'string' && value.trim().length > 0 ? value : null);
const objectOf = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {});

export function projectRoot(): string {
  return resolve(process.env.ANIMA_PROJECT_ROOT ?? resolve(process.cwd(), '..', '..'));
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
  return {
    executor: str(spec['executor']),
    coderBackend: str(spec['coder_backend']),
    model: str(spec['model']),
    baseSha: str(spec['base_sha']),
    targetKind: str(target['kind']),
    targetReference: str(target['reference']),
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
    return new OllamaCoderBackend({
      model: contract.model ?? process.env.ANIMA_WORKTREE_CODER_MODEL ?? 'qwen3-coder:latest',
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

export function gateRetryLimitForCoderBackend(kind: string | null): number {
  // Uma ?nica corre??o interna ap?s falha ordin?ria de gate observada pelo host,
  // no mesmo attempt/worktree. Outros backends preservam retry zero.
  return kind === 'deepseek-harness' ? 1 : 0;
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
    if (!isAbsolute(repoRoot)) return err('project_root_invalid', 'A raiz do projeto n?o est? configurada.');
    const backend = backendFor(contract, repoRoot, options.backendOverride);
    if ('error' in backend) return err('coder_backend_invalid', backend.error);
    const reference = contract.targetReference;
    const baseSha = contract.baseSha;
    const adapter = new WorktreeExecutorAdapter({
      targets: { resolve: ref => ref === reference ? { repoRoot, sha: baseSha } : null },
      backend,
      emitCheckpoint: true,
      linkNodeModules: true,
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
