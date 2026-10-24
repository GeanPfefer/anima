// ============================================================
// Target EXTERNO autorizado (Project Builder V0 — T1). Contrato PURO.
//
// O Single-Item executa em worktree isolada de um repositório Git. Até aqui o único
// repositório possível era o do próprio Anima (`project:anima`). Um target externo é um
// repositório Git que o operador autorizou explicitamente; sua IDENTIDADE é gravada no
// `intent.execution_spec.target` (JSON existente, sem migration) e revalidada em cada
// ponto crítico. Este módulo só define o formato e a comparação: não toca disco nem Git.
//
// Invariantes:
//   - a referência é `ext:<slug>`; `anima`/`project:anima` NUNCA representam um externo;
//   - a identidade é fechada (4 campos, SHAs completos, caminhos absolutos);
//   - a comparação distingue alias de textual (barra, caixa em Windows) de mudança real.
// ============================================================

export const EXTERNAL_TARGET_REFERENCE_PATTERN = /^ext:[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

const FULL_SHA = /^[0-9a-f]{40}$/;

/** Identidade física/canônica do repositório, como persistida em `execution_spec.target.identity`. */
export interface ExternalTargetIdentityV1 {
  readonly repoRootCanonical: string;
  readonly gitCommonDirCanonical: string;
  readonly rootCommitSha: string;
  readonly baseSha: string;
}

export interface ExternalTargetV1 {
  readonly reference: string;
  readonly identity: ExternalTargetIdentityV1;
}

export type ExternalTargetRead =
  | { readonly ok: true; readonly target: ExternalTargetV1 }
  | { readonly ok: false; readonly reason: string };

export type ExternalTargetMismatch =
  | 'repo_root_changed'
  | 'git_common_dir_changed'
  | 'root_commit_changed'
  | 'base_sha_changed';

export const isExternalTargetReference = (value: unknown): value is string =>
  typeof value === 'string' && EXTERNAL_TARGET_REFERENCE_PATTERN.test(value);

export const isFullCommitSha = (value: unknown): value is string => typeof value === 'string' && FULL_SHA.test(value);

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Caminho absoluto POSIX, de unidade Windows ou UNC; sem segmento `..`. */
export function isAbsoluteCanonicalPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || value.includes('\0')) return false;
  const absolute = value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\');
  return absolute && !value.split(/[\\/]/).includes('..');
}

/**
 * Normaliza só a GRAFIA de um caminho já canônico (barras, barra final, caixa em
 * Windows). Não resolve symlinks: isso é do resolver (realpath), antes de comparar.
 */
export function normalizeCanonicalPath(value: string): string {
  let path = value.replace(/\\/g, '/');
  if (path.length > 1 && !/^[A-Za-z]:\/$/.test(path)) path = path.replace(/\/+$/, '');
  return /^[A-Za-z]:\//.test(path) || path.startsWith('//') ? path.toLowerCase() : path;
}

export const sameCanonicalPath = (a: string, b: string): boolean => normalizeCanonicalPath(a) === normalizeCanonicalPath(b);

/** `inner` é igual a, ou está dentro de, `outer` (ambos canônicos). */
export function canonicalPathContains(outer: string, inner: string): boolean {
  const o = normalizeCanonicalPath(outer);
  const i = normalizeCanonicalPath(inner);
  return i === o || i.startsWith(o.endsWith('/') ? o : `${o}/`);
}

/**
 * Lê `execution_spec.target` de um externo. Estrito e fail-closed: qualquer desvio
 * (referência fora do padrão, campo extra, SHA curto, caminho relativo) é recusado.
 */
export function readExternalTarget(raw: unknown): ExternalTargetRead {
  if (!isObject(raw) || raw['kind'] !== 'project') return { ok: false, reason: 'external_target_kind_invalid' };
  if (!isExternalTargetReference(raw['reference'])) return { ok: false, reason: 'external_target_reference_invalid' };
  const identity = raw['identity'];
  if (!isObject(identity)) return { ok: false, reason: 'external_target_identity_missing' };
  const keys = Object.keys(identity).sort().join(',');
  if (keys !== 'base_sha,git_common_dir_canonical,repo_root_canonical,root_commit_sha') {
    return { ok: false, reason: 'external_target_identity_malformed' };
  }
  const repoRoot = identity['repo_root_canonical'];
  const gitDir = identity['git_common_dir_canonical'];
  const root = identity['root_commit_sha'];
  const base = identity['base_sha'];
  if (!isAbsoluteCanonicalPath(repoRoot) || !isAbsoluteCanonicalPath(gitDir)) return { ok: false, reason: 'external_target_identity_path_invalid' };
  if (!isFullCommitSha(root) || !isFullCommitSha(base)) return { ok: false, reason: 'external_target_identity_sha_invalid' };
  return {
    ok: true,
    target: { reference: raw['reference'], identity: { repoRootCanonical: repoRoot, gitCommonDirCanonical: gitDir, rootCommitSha: root, baseSha: base } },
  };
}

/** Serializa a identidade no formato persistido (`execution_spec.target`). */
export function externalTargetToSpecTarget(target: ExternalTargetV1): Record<string, unknown> {
  return {
    kind: 'project',
    reference: target.reference,
    identity: {
      repo_root_canonical: target.identity.repoRootCanonical,
      git_common_dir_canonical: target.identity.gitCommonDirCanonical,
      root_commit_sha: target.identity.rootCommitSha,
      base_sha: target.identity.baseSha,
    },
  };
}

/** `null` ⇒ mesma identidade. Caso contrário, o PRIMEIRO campo que mudou. */
export function compareExternalTargetIdentity(
  authorized: ExternalTargetIdentityV1,
  observed: ExternalTargetIdentityV1,
): ExternalTargetMismatch | null {
  if (!sameCanonicalPath(authorized.repoRootCanonical, observed.repoRootCanonical)) return 'repo_root_changed';
  if (!sameCanonicalPath(authorized.gitCommonDirCanonical, observed.gitCommonDirCanonical)) return 'git_common_dir_changed';
  if (authorized.rootCommitSha !== observed.rootCommitSha) return 'root_commit_changed';
  if (authorized.baseSha !== observed.baseSha) return 'base_sha_changed';
  return null;
}
