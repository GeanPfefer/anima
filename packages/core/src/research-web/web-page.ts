// ============================================================
// research.web.open / navigate / extract — contratos (Research Web V1).
//
// O browser é o agent-browser (reuse): o ANIMA NÃO implementa Playwright/CDP.
// Aqui vivem só os contratos de evidência e a política de execução que o ANIMA
// impõe ao browser. O DOM inteiro nunca entra no domínio canônico: a evidência é
// a URL final, o título, o localizador e o HASH do conteúdo extraído.
// ============================================================

import type { ExternalExecutionPolicyV1, UntrustedExternalTextV1 } from './external-observation';
import { normalizeAllowedDomains } from './web-target-policy';

export type WebExtractionKindV1 = 'readable_text';

/** Evidência de uma página efetivamente aberta e examinada. */
export interface WebPageRefV1 {
  readonly schemaVersion: 1;
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly title: string;
  readonly observedAt: string;
  /** Sessão efêmera do agent-browser + alvo CDP; opaco, nunca reutilizado. */
  readonly sessionRef: string;
  readonly extraction: WebExtractionKindV1;
  readonly locator: string | null;
  /** `sha256:<hex>` do texto extraído (após normalização de fim de linha). */
  readonly contentHash: string;
  /** A allowlist bloqueou a navegação (o browser devolve página "Blocked" com sucesso). */
  readonly blocked: boolean;
  readonly artifactRef: string | null;
}

/** Resultado de open+extract: evidência + conteúdo rotulado como não confiável. */
export interface WebPageExtractionV1 {
  readonly page: WebPageRefV1;
  readonly content: UntrustedExternalTextV1;
}

/**
 * Finding futuro (compare/cite/persist ainda não implementados). O ponto do
 * contrato: a citação aponta para a PÁGINA ABERTA (`pageRef`), e o resultado de
 * busca fica só como trilha de "por que esta fonte".
 */
export interface WebExtractedFindingV1 {
  readonly claim: string;
  readonly pageRef: WebPageRefV1;
  readonly fromSearch: { readonly query: string; readonly rank: number; readonly engines: readonly string[] } | null;
}

export function webFindingCitation(finding: WebExtractedFindingV1): { url: string; contentHash: string; observedAt: string } {
  return {
    url: finding.pageRef.finalUrl,
    contentHash: finding.pageRef.contentHash,
    observedAt: finding.pageRef.observedAt,
  };
}

/**
 * Ações do agent-browser permitidas na V1, pelos NOMES REAIS do daemon (medidos em
 * 0.38.1). Atenção a dois comportamentos reais: (1) com `allow` VAZIO a policy não
 * restringe nada; (2) sem `close` na lista a sessão não consegue ser encerrada.
 * Fora da lista (negados): evaluate, click, fill/type, upload, download, cookies_*,
 * state, network, screenshot, scroll.
 */
export const RESEARCH_WEB_BROWSER_ACTIONS: readonly string[] = [
  'launch',
  'navigate',
  'waitforloadstate',
  'url',
  'title',
  'read',
  'close',
];

export interface ResearchWebBrowserPolicyInputV1 {
  readonly executablePath: string;
  readonly version: string | null;
  readonly allowedDomains: readonly string[];
  readonly timeoutMs: number;
  readonly maxOutputChars: number;
}

export function buildResearchWebBrowserPolicy(input: ResearchWebBrowserPolicyInputV1): ExternalExecutionPolicyV1 {
  return {
    tool: 'agent-browser',
    executable: { path: input.executablePath, version: input.version },
    isolation: { ephemeralSession: true, reuseSession: false, userProfile: false },
    network: {
      allowedDomains: normalizeAllowedDomains(input.allowedDomains),
      denyLocalhost: true,
      denyPrivateNetworks: true,
      denyFileScheme: true,
    },
    actions: { default: 'deny', allow: RESEARCH_WEB_BROWSER_ACTIONS },
    limits: { timeoutMs: input.timeoutMs, maxOutputChars: input.maxOutputChars },
    output: 'json',
    onViolation: 'fail_closed',
  };
}
