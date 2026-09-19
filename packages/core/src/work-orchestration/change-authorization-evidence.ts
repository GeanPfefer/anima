import { isSafeRelativePath } from './eligibility';
import {
  isPathWritable,
  normalizeScopePath,
  supervisedWorkspaceAccessPolicy,
} from './workspace-access-policy';

// ============================================================
// Change Authorization Evidence V0 — host-observed, SHADOW.
//
// Fecha a barreira da Enforcement Readiness V0: torna o CHANGE AUTHORIZATION SCOPE
// (o que o Work Item AUTORIZOU o coder a modificar) uma evidência host-observada,
// estruturada, persistida e REVALIDÁVEL pela readiness — sem alterar a autoridade
// operacional atual.
//
// Fronteiras (jamais colapsadas):
//   Declared Scope           != Resolved Authorization Scope
//   Gate Evidence Scope      != Change Authorization Scope
//   Observed Authorized Change != Planner Assertion
//
// FONTE AUTORITATIVA: o `includedScope`/`excludedScope` do Work Item (proposal
// versionado) que o executor USOU naquela execução — resolvido em
// `WorkspaceAccessPolicyV1` e reforçado HARD pelo executor (contract_violation).
// Esta evidência reutiliza EXATAMENTE `isPathWritable` sobre a mesma política
// (`supervisedWorkspaceAccessPolicy`), para não criar uma segunda semântica de
// autorização. Nos arquivos REALMENTE alterados de uma attempt bem-sucedida, essa
// semântica concorda com o verdicto host (o coder só pôde escrever paths writable).
//
// DIVERGÊNCIA DOCUMENTADA (não-bloqueante): o verdicto pós-hoc do host
// (`worktree-executor` contract_violation) compara `changedByAttempt` com o
// `includedScope` CRU por membership; `isPathWritable` adiciona `excluded` e a
// checagem lexical. Como a autoridade per-edit (o coder só escreve writable) impede
// escrita fora/excluída ANTES, os dois concordam nos arquivos realizados.
//
// PROSA EM includedScope: alguns Work Items históricos declaram escopo em linguagem
// natural (ex.: "migrar tela X"), não paths exatos. NÃO se inventa path a partir de
// prosa (sem LLM): entradas que o host consegue interpretar canonicamente como
// caminho relativo seguro SEM espaços entram como superfície verificável; as demais
// ficam registradas como não verificáveis e REBAIXAM o status.
// ============================================================

export type ChangeAuthorizationStatus =
  | 'verified' // toda a superfície declarada é caminho verificável host-side
  | 'partially_verifiable' // parte da superfície é prosa/não verificável
  | 'unavailable'; // nenhuma superfície verificável (ou escopo ausente)

export type ChangeAuthorizationSource = 'work_item_included_scope';

export interface ChangeAuthorizationEvidenceV1 {
  readonly source: ChangeAuthorizationSource;
  /** DERIVADO dos fatos (recomputado no parser; nunca aceito do JSON). */
  readonly status: ChangeAuthorizationStatus;
  /** Escopo DECLARADO no Work Item, como veio (fato de entrada). */
  readonly declaredScope: readonly string[];
  /** Entradas do escopo que o host interpreta como caminho relativo seguro (normalizadas). */
  readonly verifiableAuthorizedPaths: readonly string[];
  /** Entradas descritivas/não verificáveis (prosa/inseguras), como declaradas. */
  readonly unverifiableScopeEntries: readonly string[];
  readonly excludedScope: readonly string[];
  /** Arquivos REALMENTE alterados, host-observados (normalizados). */
  readonly changedFiles: readonly string[];
  /** DERIVADO: changedFiles autorizados pela MESMA semântica do executor (isPathWritable). */
  readonly authorizedChangedFiles: readonly string[];
  /** DERIVADO: changedFiles fora do escopo AUTORIZADO (≠ fora do gate target). */
  readonly unauthorizedChangedFiles: readonly string[];
}

/** Fatos brutos host-observados que fundamentam a evidência (o que se persiste). */
export interface ChangeAuthorizationFactsV1 {
  readonly declaredScope: readonly string[];
  readonly excludedScope?: readonly string[];
  readonly changedFiles: readonly string[];
}

const dedupe = (values: readonly string[]): readonly string[] =>
  [...new Set(values.map(normalizeScopePath).filter(Boolean))];

/** Caminho verificável = relativo seguro (canônico) e SEM espaço (prosa tem espaço). */
const isVerifiableScopePath = (entry: string): boolean =>
  isSafeRelativePath(entry) && !/\s/.test(entry.trim());

/**
 * Classifica, de forma pura e determinística, a autorização de mudanças a partir dos
 * FATOS host-observados. Reutiliza a política canônica (`supervisedWorkspaceAccessPolicy`
 * + `isPathWritable`); não usa LLM, relógio, rede ou estado global. A mesma entrada
 * sempre produz a mesma evidência.
 */
export function classifyChangeAuthorization(
  facts: ChangeAuthorizationFactsV1,
): ChangeAuthorizationEvidenceV1 {
  const declaredScope = [...facts.declaredScope];
  const excludedScope = [...(facts.excludedScope ?? [])];
  const verifiable = declaredScope.filter(isVerifiableScopePath);
  const unverifiableScopeEntries = declaredScope.filter(entry => !isVerifiableScopePath(entry));
  const verifiableAuthorizedPaths = dedupe(verifiable);

  // Política canônica (mesma que o executor constrói): WRITE = includedScope.
  const policy = supervisedWorkspaceAccessPolicy(declaredScope, excludedScope);
  const changedFiles = dedupe(facts.changedFiles);
  const authorizedChangedFiles = changedFiles.filter(path => isPathWritable(path, policy));
  const unauthorizedChangedFiles = changedFiles.filter(path => !isPathWritable(path, policy));

  const status: ChangeAuthorizationStatus =
    verifiableAuthorizedPaths.length === 0
      ? 'unavailable'
      : unverifiableScopeEntries.length > 0
        ? 'partially_verifiable'
        : 'verified';

  return {
    source: 'work_item_included_scope',
    status,
    declaredScope,
    verifiableAuthorizedPaths,
    unverifiableScopeEntries,
    excludedScope,
    changedFiles,
    authorizedChangedFiles,
    unauthorizedChangedFiles,
  };
}
