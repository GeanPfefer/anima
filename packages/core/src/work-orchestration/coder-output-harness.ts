// ============================================================
// Contrato do harness do coder — AUTORIDADE de política + tipos puros.
//
// Duas propriedades canônicas do código que o coder produz neste monorepo:
//   1. o runner de teste canônico é Jest; runners incompatíveis (ex.: `vitest`)
//      são proibidos;
//   2. a autoridade sobre qual coder backend roda é o INTENT do item
//      (materializado no contrato de execução — `contract.coderBackend` / a decisão
//      materializada equivalente `computeDecision.selectedProvider`), NUNCA a
//      entrada da fila (`entry.coderBackend`).
//
// Este módulo é PURO (sem I/O, sem `typescript`, sem custo). Ele detém a POLÍTICA
// canônica e as invariantes mínimas que nenhum caller pode enfraquecer, além do
// texto compartilhado que leva a política ao coder ANTES da inferência. A ANÁLISE
// estrutural (AST) da saída vive na borda que tem o `typescript` do workspace
// (`apps/web/lib/work-orchestration/coder-output-analysis.ts`) e consome estes
// tipos/política — a detecção NÃO é feita por regex.
// ============================================================

export type CanonicalTestRunner = 'jest';

export interface CoderHarnessPolicyV1 {
  readonly schemaVersion: 1;
  /** O único runner de teste aceito para o output deste workspace. */
  readonly canonicalTestRunner: CanonicalTestRunner;
  /** Especificadores de módulo de runners INCOMPATÍVEIS com o canônico. */
  readonly incompatibleTestRunners: readonly string[];
  /**
   * Expressões `objeto.propriedade` que leem o backend do coder de uma fonte NÃO
   * autoritativa (a autoridade é o intent/contrato, nunca a fila).
   */
  readonly forbiddenBackendSources: readonly string[];
}

/**
 * A POLÍTICA CANÔNICA host-trusted. É a autoridade mínima: nenhum caller pode
 * removê-la. `resolveEffectiveCoderHarnessPolicy` garante que a política efetiva
 * SEMPRE seja um superset destas invariantes.
 */
export const CANONICAL_CODER_HARNESS_POLICY_V1: CoderHarnessPolicyV1 = {
  schemaVersion: 1,
  canonicalTestRunner: 'jest',
  incompatibleTestRunners: ['vitest'],
  forbiddenBackendSources: ['entry.coderBackend'],
};

/** Alias histórico: o default É a política canônica (não há default mais fraco). */
export const DEFAULT_CODER_HARNESS_POLICY_V1: CoderHarnessPolicyV1 = CANONICAL_CODER_HARNESS_POLICY_V1;

const dedupe = (values: Iterable<string>): readonly string[] =>
  [...new Set([...values].map(v => v.trim()).filter(Boolean))];

/**
 * Resolve a política EFETIVA a partir de um override opcional de caller. FAIL-CLOSED
 * por construção: o resultado é sempre um SUPERSET da política canônica —
 *   • `canonicalTestRunner` é fixado no valor canônico (override não o troca);
 *   • `incompatibleTestRunners` e `forbiddenBackendSources` são a UNIÃO do canônico
 *     com o override (só ENDURECEM; nunca removem uma invariante).
 * Assim um caller que passe listas vazias — ou tente desligar o gate — ainda recebe
 * as restrições canônicas (Vitest proibido, `entry.coderBackend` proibido). O
 * `harnessPolicy` do executor passa por aqui, então o caminho vivo não pode ser enfraquecido.
 */
export function resolveEffectiveCoderHarnessPolicy(
  override?: Partial<CoderHarnessPolicyV1> | null,
): CoderHarnessPolicyV1 {
  const canonical = CANONICAL_CODER_HARNESS_POLICY_V1;
  return {
    schemaVersion: 1,
    canonicalTestRunner: canonical.canonicalTestRunner,
    incompatibleTestRunners: dedupe([
      ...canonical.incompatibleTestRunners,
      ...(override?.incompatibleTestRunners ?? []),
    ]),
    forbiddenBackendSources: dedupe([
      ...canonical.forbiddenBackendSources,
      ...(override?.forbiddenBackendSources ?? []),
    ]),
  };
}

/** Uma fonte de backend proibida decomposta em objeto/propriedade (para a análise
 * estrutural). `entry.coderBackend` ⇒ `{ object: 'entry', property: 'coderBackend' }`.
 * Formas que não sejam `IDENT.IDENT` são ignoradas (a política canônica só usa esse
 * formato); o chamador pode validar com esta função. */
export interface ForbiddenBackendSourceRefV1 {
  readonly object: string;
  readonly property: string;
  readonly raw: string;
}
export function parseForbiddenBackendSource(expression: string): ForbiddenBackendSourceRefV1 | null {
  const match = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(expression.trim());
  if (match === null) return null;
  return { object: match[1]!, property: match[2]!, raw: expression.trim() };
}

/** Casa um especificador de import contra os runners incompatíveis (exato ou
 * subpath `runner/...`). Retorna o runner casado ou null. */
export function matchIncompatibleRunner(specifier: string, incompatible: readonly string[]): string | null {
  const spec = specifier.trim();
  for (const runner of incompatible) {
    if (spec === runner || spec.startsWith(`${runner}/`)) return runner;
  }
  return null;
}

export type CoderHarnessViolationV1 =
  | {
      readonly kind: 'incompatible_test_runner';
      readonly path: string;
      readonly importedRunner: string;
      readonly requiredRunner: CanonicalTestRunner;
      readonly line: number;
    }
  | {
      readonly kind: 'non_authoritative_backend_source';
      readonly path: string;
      readonly expression: string;
      readonly line: number;
    };

export interface CoderHarnessValidationV1 {
  readonly ok: boolean;
  readonly violations: readonly CoderHarnessViolationV1[];
}

/** Combina violações num veredito. `ok` só é verdadeiro sem nenhuma violação —
 * nunca há passagem silenciosa de uma violação detectada. */
export function combineCoderHarnessViolations(
  violations: readonly CoderHarnessViolationV1[],
): CoderHarnessValidationV1 {
  return { ok: violations.length === 0, violations };
}

/** Mensagem host-side curta, determinística e segura (só caminho:linha + tokens do
 * próprio contrato — nunca conteúdo do arquivo). */
export function describeCoderHarnessViolations(violations: readonly CoderHarnessViolationV1[]): string {
  return violations
    .map(v =>
      v.kind === 'incompatible_test_runner'
        ? `${v.path}:${v.line} importa runner de teste incompatível "${v.importedRunner}" (runner canônico: ${v.requiredRunner})`
        : `${v.path}:${v.line} lê o backend do coder de fonte não autoritativa "${v.expression}" (a autoridade é o intent do item)`,
    )
    .join('; ');
}

/**
 * Texto determinístico da política, injetado no contexto/request host-authored do
 * coder ANTES de qualquer inferência. É a FONTE ÚNICA compartilhada por todos os
 * backends aplicáveis (Ollama, OpenAI — que delega ao Ollama —, DeepSeek Harness),
 * não um prompt ad hoc por backend. Derivado da política (nada hardcoded solto).
 */
export function renderCoderHarnessPolicyInstructions(policy: CoderHarnessPolicyV1): string {
  const runners = policy.incompatibleTestRunners.length > 0
    ? policy.incompatibleTestRunners.join(', ')
    : '(nenhum)';
  const forbidden = policy.forbiddenBackendSources.length > 0
    ? policy.forbiddenBackendSources.join(', ')
    : '(nenhuma)';
  return [
    'CONTRATO DO HARNESS (obrigatório — o host valida e rejeita fail-closed):',
    `- Runner de teste canônico deste workspace: ${policy.canonicalTestRunner}. Escreva testes SOMENTE com ${policy.canonicalTestRunner} (globais do Jest ou import de '@jest/globals').`,
    `- Runners de teste incompatíveis/proibidos (NÃO importe, em nenhuma forma — import estático, dinâmico, require ou subpath): ${runners}.`,
    '- A autoridade sobre qual coder backend roda é o INTENT do item, materializado no contrato de execução.',
    '- Fontes VÁLIDas do backend: `contract.coderBackend` e/ou a decisão materializada equivalente (ex.: `computeDecision.selectedProvider`).',
    `- Fontes NÃO autoritativas do backend, proibidas (não leia, inclusive via optional chaining, bracket access, destructuring ou alias): ${forbidden}.`,
  ].join('\n');
}
