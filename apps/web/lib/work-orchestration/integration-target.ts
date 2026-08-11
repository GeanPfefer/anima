import { isAbsolute } from 'node:path';
import type { IntegrationTarget } from '@anima/core';
import { projectRoot } from './executor-selection';

// Alvo confiável da publicação protegida de branch, reconstruído EXCLUSIVAMENTE do
// ambiente do servidor. O cliente nunca escolhe remote, repositório, branch-base
// nem provider: quem os declara é o operador, no servidor. Ausente por padrão —
// sem configuração explícita NÃO há capacidade de publicação, e a rota falha
// fechada (503). É a fronteira física: habilitar o efeito Git externo real exige
// um ato de configuração do operador, nunca um payload de cliente.

/** Id fixo do provider Git da etapa de branch. Nunca vem do cliente. */
export const BRANCH_PUBLICATION_PROVIDER_ID = 'git-branch-publication-v1';

export interface ResolvedBranchPublicationTarget {
  /** Raiz local do repositório onde a branch autorizada (namespace anima-work/)
   * existe — a mesma preservada pelo executor de worktree após o dispose. */
  readonly repoRoot: string;
  readonly target: IntegrationTarget;
}

// Um ref de git seguro para remote/base: sem espaços, sem metacaracteres de
// refspec, sem traversal. Espelha isAnimaWorktreeBranch/safeRef do core para
// falhar cedo e claro na configuração, antes de qualquer argumento git.
const SAFE_REF = (value: string): boolean =>
  value.length > 0 && value.length <= 256 && !/[\s~^:?*[\\]/.test(value) && !value.includes('..') && !value.endsWith('/') && !value.endsWith('.lock');

/**
 * Resolve o alvo confiável do ambiente. Retorna `null` (fail-closed) quando
 * qualquer peça obrigatória está ausente ou é insegura:
 * - `ANIMA_INTEGRATION_REPOSITORY_ID` — URL canônica esperada do remote; o
 *   preflight do provider a compara com `git remote get-url`, então declará-la
 *   explicitamente torna a checagem significativa (detecta remote trocado).
 * - `ANIMA_INTEGRATION_REMOTE_NAME` — nome do remote configurado (ex.: origin).
 * - `ANIMA_INTEGRATION_BASE_BRANCH` — branch-base (ex.: main); é apenas lida no
 *   remote, nunca o alvo do push (o alvo é sempre a branch anima-work/).
 * - `ANIMA_INTEGRATION_REPO_ROOT` (ou a raiz do projeto) — caminho absoluto.
 */
export function branchPublicationTargetFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedBranchPublicationTarget | null {
  const repositoryId = env.ANIMA_INTEGRATION_REPOSITORY_ID?.trim();
  const remoteName = env.ANIMA_INTEGRATION_REMOTE_NAME?.trim();
  const baseBranch = env.ANIMA_INTEGRATION_BASE_BRANCH?.trim();
  const repoRoot = (env.ANIMA_INTEGRATION_REPO_ROOT?.trim() || projectRoot());
  if (!repositoryId || !remoteName || !baseBranch) return null;
  if (!SAFE_REF(remoteName) || !SAFE_REF(baseBranch)) return null;
  if (!isAbsolute(repoRoot)) return null;
  return {
    repoRoot,
    target: { providerId: BRANCH_PUBLICATION_PROVIDER_ID, repositoryId, remoteName, baseBranch },
  };
}
