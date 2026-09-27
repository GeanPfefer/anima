// ============================================================
// Envelope comum de observação externa + política de execução externa.
//
// Nasce com o PRIMEIRO consumidor (Research Web V1: SearXNG + agent-browser),
// conforme a arquitetura reuse-first: nada de `ExternalToolAdapter` universal.
// Só os campos que este consumidor realmente usa existem aqui; ferramentas
// futuras estendem quando provarem necessidade.
//
// Invariantes:
//   - observação NUNCA autoriza nada; é dado externo com hora e origem;
//   - `degraded`/`error` nunca podem ser apagados para parecer cobertura completa;
//   - ausência de resultado ≠ inexistência.
// ============================================================

export type ExternalObservationStatusV1 = 'observed' | 'degraded' | 'unavailable' | 'error';

export type ExternalObservationErrorKindV1 =
  | 'invalid_request'
  | 'blocked_by_policy'
  | 'not_configured'
  | 'network'
  | 'timeout'
  | 'rate_limited'
  | 'captcha'
  | 'schema'
  | 'tool_failed'
  | 'unknown';

export interface ExternalObservationErrorV1 {
  readonly kind: ExternalObservationErrorKindV1;
  /** Mensagem curta e sanitizada; nunca o corpo cru de uma resposta externa. */
  readonly message: string;
}

export interface ExternalObservationDegradationV1 {
  /** Parte que falhou: engine do buscador, etapa do browser etc. */
  readonly part: string;
  readonly reason: string;
}

export interface ExternalObservationEnvelopeV1 {
  readonly source: string;
  readonly sourceVersion: string | null;
  readonly rawSchemaVersion?: number;
  /** Idade do DADO observado. */
  readonly observedAt: string;
  /** Quando o ANIMA pediu a observação. */
  readonly queriedAt: string;
  readonly status: ExternalObservationStatusV1;
  readonly degraded: readonly ExternalObservationDegradationV1[];
  readonly error: ExternalObservationErrorV1 | null;
}

/** Rótulo obrigatório de todo conteúdo que veio da web: dado, nunca instrução. */
export const UNTRUSTED_EXTERNAL_CONTENT = 'untrusted_external_content' as const;
export type UntrustedExternalContentLabel = typeof UNTRUSTED_EXTERNAL_CONTENT;

export interface UntrustedExternalTextV1 {
  readonly trust: UntrustedExternalContentLabel;
  readonly origin: string;
  readonly text: string;
  readonly truncated: boolean;
}

/**
 * Política de execução de uma ferramenta externa. Só o que a V1 usa:
 * executável, isolamento, rede, ações default-deny, limites, JSON e fail-closed.
 */
export interface ExternalExecutionPolicyV1 {
  readonly tool: string;
  readonly executable: { readonly path: string; readonly version: string | null };
  readonly isolation: { readonly ephemeralSession: true; readonly reuseSession: false; readonly userProfile: false };
  readonly network: {
    readonly allowedDomains: readonly string[];
    readonly denyLocalhost: true;
    readonly denyPrivateNetworks: true;
    readonly denyFileScheme: true;
  };
  /** Ações permitidas pelos NOMES REAIS da ferramenta; o resto é negado. */
  readonly actions: { readonly default: 'deny'; readonly allow: readonly string[] };
  readonly limits: { readonly timeoutMs: number; readonly maxOutputChars: number };
  readonly output: 'json';
  readonly onViolation: 'fail_closed';
}

export function externalError(kind: ExternalObservationErrorKindV1, message: string): ExternalObservationErrorV1 {
  return { kind, message: message.slice(0, 300) };
}
