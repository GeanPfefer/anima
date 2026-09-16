// ============================================================
// WorkspaceAccessPolicy — LEITURA e ESCRITA são autoridades DISTINTAS (Coding
// Harness V3, 2ª fatia). Um coding agent precisa INVESTIGAR amplamente sem
// receber autoridade ampla de escrita.
//
//   • READ scope  — o que o agente pode listar/buscar/grep/ler/inspecionar.
//   • WRITE scope — EXCLUSIVAMENTE o que ele pode modificar (o Work Item/Governor).
//
// Invariantes (todas host-side; NUNCA confiar no modelo):
//   1. WRITE scope nunca é maior que o autorizado pelo Work Item/Governor.
//   2. READ scope pode ser MAIOR que WRITE scope (≥).
//   3. O modelo pode ler deps/tipos/testes/configs/implementações fora do WRITE scope.
//   4. READ não escapa do workspace/repo autorizado (o confinamento de FS — safeJoin
//      da worktree — é a fronteira DURA; esta política é a camada lexical/lógica).
//   5. Path traversal/symlink escape continua fail-closed (safeJoin + esta política).
//   6. Escrever fora do WRITE scope continua contract_violation (git observado do host).
//   7. Ler um arquivo NÃO concede permissão de editá-lo.
//
// Módulo PURO (sem I/O), model-agnostic — consumido pelo laço compartilhado
// (Ollama/OpenAI) e disponível a qualquer backend futuro. A execução real de
// busca/leitura/escrita e o confinamento de FS ficam na worktree; aqui vivem só as
// AUTORIDADES lógicas e suas invariantes.
// ============================================================

/** READ scope: ou todo o workspace autorizado (menos excluídos/sensíveis), ou uma
 * allowlist explícita de caminhos. WRITE scope é sempre uma allowlist exata. */
export type WorkspaceReadScope =
  | { readonly kind: 'workspace' }
  | { readonly kind: 'paths'; readonly paths: readonly string[] };

export interface WorkspaceAccessPolicyV1 {
  readonly schemaVersion: 1;
  /** Caminhos que o agente pode MODIFICAR (exato, fail-closed). */
  readonly writeScope: readonly string[];
  /** O que o agente pode LER; sempre ⊇ writeScope. */
  readonly readScope: WorkspaceReadScope;
  /** Caminhos/prefixos NUNCA legíveis nem graváveis (sensíveis/fora do contrato). */
  readonly excluded: readonly string[];
}

/** Normaliza `\`→`/`, remove `./` inicial e espaços. Não resolve traversal (isso é
 * fail-closed em `resolveScopedPath`/`safeJoin`); só canoniza a forma para comparar. */
export const normalizeScopePath = (raw: string): string =>
  (typeof raw === 'string' ? raw : '').replace(/\\/g, '/').replace(/^\.\//, '').trim();

const dedupeNormalized = (values: Iterable<string>): readonly string[] =>
  [...new Set([...values].map(normalizeScopePath).filter(Boolean))];

/**
 * Resolve uma política sã a partir do WRITE scope (obrigatório) e, opcionalmente, de
 * um READ scope e exclusões. FAIL-CLOSED por construção quanto às invariantes:
 *   • WRITE scope é a allowlist exata dada (normalizada/deduplicada);
 *   • READ scope em modo `paths` é SEMPRE um superset do WRITE scope (invariante 2);
 *   • READ scope ausente ⇒ `paths` = WRITE scope (retrocompatível: read == write).
 * NÃO amplia WRITE scope jamais.
 */
export function resolveWorkspaceAccessPolicy(input: {
  readonly writeScope: readonly string[];
  readonly readScope?: WorkspaceReadScope;
  readonly excluded?: readonly string[];
}): WorkspaceAccessPolicyV1 {
  const writeScope = dedupeNormalized(input.writeScope);
  const excluded = dedupeNormalized(input.excluded ?? []);
  const readScope: WorkspaceReadScope = !input.readScope || input.readScope.kind === 'paths'
    ? { kind: 'paths', paths: dedupeNormalized([...(input.readScope?.kind === 'paths' ? input.readScope.paths : []), ...writeScope]) }
    : { kind: 'workspace' };
  return { schemaVersion: 1, writeScope, readScope, excluded };
}

/** Retrocompatível: quando não há política, read == write == includedScope. */
export function workspaceAccessPolicyFromIncludedScope(
  includedScope: readonly string[],
  excludedScope: readonly string[] = [],
): WorkspaceAccessPolicyV1 {
  return resolveWorkspaceAccessPolicy({ writeScope: includedScope, excluded: excludedScope });
}

/** Política de self-dev supervisionado: LER todo o workspace, ESCREVER só o Work Item. */
export function supervisedWorkspaceAccessPolicy(
  includedScope: readonly string[],
  excludedScope: readonly string[] = [],
): WorkspaceAccessPolicyV1 {
  return resolveWorkspaceAccessPolicy({
    writeScope: includedScope,
    readScope: { kind: 'workspace' },
    excluded: excludedScope,
  });
}

const isLexicallyUnsafe = (p: string): boolean =>
  p.length === 0 || p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.split('/').some(s => s === '' || s === '.' || s === '..');

/** True se `path` cai sob algum prefixo/arquivo excluído. */
export function isPathExcluded(path: string, policy: Pick<WorkspaceAccessPolicyV1, 'excluded'>): boolean {
  const p = normalizeScopePath(path);
  return policy.excluded.some(raw => {
    const e = normalizeScopePath(raw);
    return e.length > 0 && (p === e || p.startsWith(e.endsWith('/') ? e : `${e}/`));
  });
}

/** Autoridade de ESCRITA (exata, fail-closed): só caminhos do WRITE scope, nunca excluídos. */
export function isPathWritable(path: string, policy: WorkspaceAccessPolicyV1): boolean {
  const p = normalizeScopePath(path);
  if (isLexicallyUnsafe(p) || isPathExcluded(p, policy)) return false;
  return policy.writeScope.includes(p);
}

/**
 * Autoridade de LEITURA. O WRITE scope é sempre legível (invariante 2). Em modo
 * `workspace`, qualquer caminho lexicalmente seguro e não-excluído é legível — o
 * confinamento de FS (safeJoin) é a fronteira dura que impede escapar do repo. Em
 * modo `paths`, exige pertencer à allowlist de leitura. NUNCA lê excluído/traversal.
 */
export function isPathReadable(path: string, policy: WorkspaceAccessPolicyV1): boolean {
  const p = normalizeScopePath(path);
  if (isLexicallyUnsafe(p) || isPathExcluded(p, policy)) return false;
  if (policy.writeScope.includes(p)) return true;
  if (policy.readScope.kind === 'workspace') return true;
  return policy.readScope.paths.includes(p);
}
