// ============================================================
// Classificação de privacidade de consulta web (Research Web V1).
//
// Self-hosted ≠ privado: o SearXNG repassa a consulta INTEIRA para Google/Brave/etc.
// a partir do IP público do host. Por isso toda consulta é classificada ANTES de
// sair, e `private_blocked` nunca chega ao buscador.
//
// Não é DLP universal: são regras simples, conservadoras e explicáveis. Na dúvida,
// bloqueia (fail-closed). Cada bloqueio devolve os motivos verificáveis.
// ============================================================

import { evaluateWebTarget } from './web-target-policy';

export type WebQueryClassV1 = 'public' | 'project_public' | 'private_blocked';

export type WebQueryPrivacyReasonV1 =
  | 'empty'
  | 'too_long'
  | 'multiline'
  | 'secret_pattern'
  | 'env_assignment'
  | 'url_not_public'
  | 'private_ip'
  | 'local_path'
  | 'stack_trace'
  | 'email_address';

export interface WebQueryPrivacyDecisionV1 {
  readonly queryClass: WebQueryClassV1;
  readonly reasons: readonly WebQueryPrivacyReasonV1[];
  /** Termos públicos do projeto encontrados (só quando `project_public`). */
  readonly matchedProjectTerms: readonly string[];
}

export interface WebQueryPrivacyInputV1 {
  readonly query: string;
  /** Identificadores do projeto que já são PÚBLICOS (ex. nome do repo público). */
  readonly projectPublicTerms?: readonly string[];
}

export const MAX_WEB_QUERY_LENGTH = 256;

const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}\b/, // OpenAI / Anthropic
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/, // Slack
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, // JWT
  /\bbearer\s+[A-Za-z0-9._~+/-]{16,}/i,
  /\b(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)\s*[:=]\s*\S+/i,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i, // credencial em connection string
  /\b[A-Fa-f0-9]{32,}\b/, // hex longo (chaves, hashes de segredo)
  /\b[A-Za-z0-9+/_-]{40,}={0,2}(?=\s|$)/, // blob base64 longo
];

const ENV_ASSIGNMENT = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\s*=\s*\S+/; // FOO_BAR=valor
const PRIVATE_IP = /\b(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3}|0\.0\.0\.0)\b|(?:^|[\s[(])(?:::1|f[cd][0-9a-f]{2}:[0-9a-f:]+|fe80:[0-9a-f:]*)(?=$|[\s\])])/i;
const LOCAL_PATH = /(?:\b[A-Za-z]:\\[^\s]+|(?:^|\s)\/(?:home|Users|root|etc|var|opt|mnt|srv|tmp)\/[^\s]*|~\/[^\s]+|\\\\[^\s\\]+\\[^\s]+)/;
const STACK_TRACE = /(?:\bat\s+[\w$.<>]+\s*\([^)]*:\d+:\d+\)|Traceback \(most recent call last\)|\bFile "[^"]+", line \d+|\.(?:ts|js|py|rs|go|java):\d+:\d+)/;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
const URL_CANDIDATE = /\b(?:[a-z][a-z0-9+.-]*:\/\/[^\s]+|localhost(?::\d+)?(?:\/[^\s]*)?)/gi;

function urlReasons(query: string): WebQueryPrivacyReasonV1[] {
  const reasons: WebQueryPrivacyReasonV1[] = [];
  for (const match of query.match(URL_CANDIDATE) ?? []) {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(match) ? match : `http://${match}`;
    if (!evaluateWebTarget(candidate).allowed) reasons.push('url_not_public');
  }
  return reasons;
}

/** Classifica a consulta. `private_blocked` ⇒ nunca enviar ao buscador. */
export function classifyWebQuery(input: WebQueryPrivacyInputV1): WebQueryPrivacyDecisionV1 {
  const query = input.query;
  const trimmed = query.trim();
  const reasons = new Set<WebQueryPrivacyReasonV1>();

  if (trimmed === '') reasons.add('empty');
  if (trimmed.length > MAX_WEB_QUERY_LENGTH) reasons.add('too_long');
  if (/[\r\n]/.test(query)) reasons.add('multiline');
  if (SECRET_PATTERNS.some(p => p.test(query))) reasons.add('secret_pattern');
  if (ENV_ASSIGNMENT.test(query)) reasons.add('env_assignment');
  for (const r of urlReasons(query)) reasons.add(r);
  if (PRIVATE_IP.test(query)) reasons.add('private_ip');
  if (LOCAL_PATH.test(query)) reasons.add('local_path');
  if (STACK_TRACE.test(query)) reasons.add('stack_trace');
  if (EMAIL.test(query)) reasons.add('email_address');

  if (reasons.size > 0) {
    return { queryClass: 'private_blocked', reasons: [...reasons], matchedProjectTerms: [] };
  }

  const lower = trimmed.toLowerCase();
  const matchedProjectTerms = (input.projectPublicTerms ?? [])
    .map(t => t.trim())
    .filter(t => t !== '' && lower.includes(t.toLowerCase()));
  return {
    queryClass: matchedProjectTerms.length > 0 ? 'project_public' : 'public',
    reasons: [],
    matchedProjectTerms,
  };
}
