// ============================================================
// Recuperação governada após DEFEITO DE HARNESS já corrigido.
//
// Uma unidade `failed` com o orçamento de tentativas esgotado, cuja causa classificada
// foi o harness do ANIMA (não o modelo nem o plano), recebe — por ato humano — exatamente
// UM sucessor `proposed` com a mesma proposta e `max_attempts = 1`. A autoridade registra
// os commits do fix e o registro de evidência. Não aprova, não define preferência de
// compute, não cria authority paga e não executa (RPC `authorize_harness_fix_recovery`).
// ============================================================

export interface HarnessDefectRecoveryAuthorization {
  readonly schemaVersion: 1;
  readonly kind: 'harness_defect_fixed_v1';
  readonly requestId: string;
  readonly reason: string;
  readonly failureClass: 'harness';
  readonly fixCommits: readonly string[];
  readonly evidenceReference: string;
  readonly additionalAttempts: 1;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{40}$/;
const EVIDENCE = /^docs\/registros\/[A-Za-z0-9_-]+\.md$/;
const KEYS = ['schemaVersion', 'kind', 'requestId', 'reason', 'failureClass', 'fixCommits', 'evidenceReference', 'additionalAttempts'];

/** Mesma régua de `private.validate_harness_recovery_authorization`. */
export function readHarnessDefectRecoveryAuthorization(value: unknown): HarnessDefectRecoveryAuthorization | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== KEYS.length || !KEYS.every(key => key in v)) return null;
  if (v.schemaVersion !== 1 || v.kind !== 'harness_defect_fixed_v1' || v.failureClass !== 'harness' || v.additionalAttempts !== 1) return null;
  if (typeof v.requestId !== 'string' || !UUID.test(v.requestId)) return null;
  if (typeof v.reason !== 'string' || v.reason.trim().length < 10 || v.reason.length > 500) return null;
  if (typeof v.evidenceReference !== 'string' || !EVIDENCE.test(v.evidenceReference)) return null;
  const commits = v.fixCommits;
  if (!Array.isArray(commits) || commits.length < 1 || commits.length > 4
    || commits.some(sha => typeof sha !== 'string' || !SHA.test(sha)) || new Set(commits).size !== commits.length) return null;
  return v as unknown as HarnessDefectRecoveryAuthorization;
}
