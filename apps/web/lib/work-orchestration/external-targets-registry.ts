import {
  isAbsoluteCanonicalPath, isAllowedExternalIntegrationTargetRef, isExternalTargetReference, isFullCommitSha,
} from '@anima/core';

// ============================================================
// Registro LOCAL de targets externos (Project Builder V1-02) — formato do arquivo, PURO.
//
// Substitui a limitação de UM `ANIMA_EXTERNAL_TARGET` por host. O arquivo é local, FORA do controle de versão, com localização
// EXPLÍCITA (`ANIMA_EXTERNAL_TARGETS_FILE`, caminho absoluto; não existe caminho padrão) e sem credenciais:
//
//   { "version": 1,
//     "targets": [ { "reference": "ext:<slug>", "repoRoot": "<abs>", "rootCommitSha": "<40 hex>",
//                    "integration": { "targetRef": "refs/heads/<nome>" } } ] }
//
// Rejeita: JSON inválido, versão ≠ 1, chaves desconhecidas (nenhum campo de comando/ambiente é aceito), referências fora de
// `ext:<slug>` ou duplicadas, caminhos não absolutos ou com `..`, SHA que não seja de 40 hex, destino de integração fora da
// política segura (`refs/heads/<nome>`, nunca `anima-work/*`). Este módulo só interpreta texto: não lê arquivos nem executa nada.
// A identidade física continua sendo comprovada pelo resolver (T1) e revalidada pelo executor (T5).
// ============================================================

export const EXTERNAL_TARGETS_FILE_ENV = 'ANIMA_EXTERNAL_TARGETS_FILE';
export const EXTERNAL_TARGETS_FILE_VERSION = 1 as const;
export const EXTERNAL_TARGETS_FILE_MAX_BYTES = 65_536;

export interface ExternalTargetEntry {
  readonly reference: string;
  readonly repoRoot: string;
  readonly rootCommitSha: string;
  /** Destino LOCAL autorizado para a integração (`refs/heads/<nome>`); ausente ⇒ integração não configurada para este target. */
  readonly integrationTargetRef?: string;
}

export type ExternalTargetsFileResult =
  | { readonly ok: true; readonly entries: readonly ExternalTargetEntry[] }
  | { readonly ok: false; readonly code: string; readonly message: string };

const fail = (code: string, message: string): ExternalTargetsFileResult => ({ ok: false, code, message });
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const sameKeys = (value: Record<string, unknown>, allowed: readonly string[], required: readonly string[]): boolean =>
  Object.keys(value).every(k => allowed.includes(k)) && required.every(k => k in value);

export function parseExternalTargetsFile(raw: string): ExternalTargetsFileResult {
  if (Buffer.byteLength(raw, 'utf8') > EXTERNAL_TARGETS_FILE_MAX_BYTES) return fail('external_targets_file_too_large', 'O registro de targets externos excede o limite de tamanho.');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return fail('external_targets_file_invalid', 'O registro de targets externos não é JSON válido.'); }
  if (!isRecord(parsed) || !sameKeys(parsed, ['version', 'targets'], ['version', 'targets'])) {
    return fail('external_targets_file_invalid', 'O registro deve ser um objeto com exatamente "version" e "targets".');
  }
  if (parsed['version'] !== EXTERNAL_TARGETS_FILE_VERSION) return fail('external_targets_file_version_unsupported', `Versão do registro não suportada (esperado ${EXTERNAL_TARGETS_FILE_VERSION}).`);
  const targets = parsed['targets'];
  if (!Array.isArray(targets)) return fail('external_targets_file_invalid', '"targets" deve ser uma lista.');
  const entries: ExternalTargetEntry[] = [];
  const seen = new Set<string>();
  for (const [index, item] of targets.entries()) {
    const where = `targets[${index}]`;
    if (!isRecord(item) || !sameKeys(item, ['reference', 'repoRoot', 'rootCommitSha', 'integration'], ['reference', 'repoRoot', 'rootCommitSha'])) {
      return fail('external_targets_file_invalid', `${where}: campos permitidos reference, repoRoot, rootCommitSha e integration (nenhum outro).`);
    }
    const { reference, repoRoot, rootCommitSha, integration } = item;
    if (!isExternalTargetReference(reference)) return fail('external_targets_file_invalid', `${where}: reference deve ser ext:<slug>.`);
    if (!isAbsoluteCanonicalPath(repoRoot)) return fail('external_targets_file_invalid', `${where} (${reference}): repoRoot deve ser um caminho absoluto sem "..".`);
    if (!isFullCommitSha(rootCommitSha)) return fail('external_targets_file_invalid', `${where} (${reference}): rootCommitSha deve ter 40 hex.`);
    if (seen.has(reference)) return fail('external_targets_duplicate_reference', `A referência ${reference} aparece mais de uma vez no registro.`);
    seen.add(reference);
    let integrationTargetRef: string | undefined;
    if (integration !== undefined) {
      if (!isRecord(integration) || !sameKeys(integration, ['targetRef'], ['targetRef']) || !isAllowedExternalIntegrationTargetRef(integration['targetRef'])) {
        return fail('external_targets_file_invalid', `${where} (${reference}): integration exige exatamente targetRef (refs/heads/<nome> fora de anima-work/).`);
      }
      integrationTargetRef = integration['targetRef'] as string;
    }
    entries.push({ reference, repoRoot, rootCommitSha, ...(integrationTargetRef !== undefined ? { integrationTargetRef } : {}) });
  }
  return { ok: true, entries };
}
