// ============================================================
// Política de alvos web (Research Web V1): quais URLs o browser pode abrir.
//
// Conservadora de propósito (fail-closed): só http/https, sem credenciais na URL,
// sem porta fora do padrão, sem IP literal, sem localhost/nomes de rede interna.
// Complementa (não substitui) a allowlist do agent-browser e o isolamento de rede
// do processo: a verificação aqui acontece ANTES de qualquer chamada externa.
// ============================================================

export type WebTargetBlockReasonV1 =
  | 'invalid_url'
  | 'scheme_not_allowed'
  | 'credentials_in_url'
  | 'non_default_port'
  | 'ip_literal_host'
  | 'local_or_internal_host'
  | 'single_label_host';

export type WebTargetDecisionV1 =
  | { readonly allowed: true; readonly url: string; readonly hostname: string }
  | { readonly allowed: false; readonly reason: WebTargetBlockReasonV1 };

const INTERNAL_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home', '.home.arpa', '.intranet', '.corp'];

function isIpLiteral(hostname: string): boolean {
  if (hostname.startsWith('[') || hostname.includes(':')) return true; // IPv6
  if (/^\d+(\.\d+){0,3}$/.test(hostname)) return true; // IPv4 (inclui formas curtas como 127.1)
  if (/^0x[0-9a-f]+$/i.test(hostname)) return true; // inteiro hexadecimal
  return false;
}

export function isLocalOrInternalHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (h === 'localhost') return true;
  return INTERNAL_SUFFIXES.some(suffix => h.endsWith(suffix));
}

/** Decide se o browser pode abrir a URL. Não faz rede (DNS é verificado à parte). */
export function evaluateWebTarget(rawUrl: string): WebTargetDecisionV1 {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return { allowed: false, reason: 'invalid_url' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { allowed: false, reason: 'scheme_not_allowed' };
  if (url.username !== '' || url.password !== '') return { allowed: false, reason: 'credentials_in_url' };
  if (url.port !== '') return { allowed: false, reason: 'non_default_port' };
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (isIpLiteral(hostname)) return { allowed: false, reason: 'ip_literal_host' };
  if (isLocalOrInternalHostname(hostname)) return { allowed: false, reason: 'local_or_internal_host' };
  if (!hostname.includes('.')) return { allowed: false, reason: 'single_label_host' };
  return { allowed: true, url: url.toString(), hostname };
}

type Ipv4Octets = readonly [number, number, number, number];

function ipv4Octets(address: string): Ipv4Octets | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map(p => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  if (!octets.every(o => Number.isInteger(o) && o >= 0 && o <= 255)) return null;
  const [a = 0, b = 0, c = 0, d = 0] = octets;
  return [a, b, c, d];
}

function isNonPublicIpv4(o: Ipv4Octets): boolean {
  const [a, b] = o;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local / metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && o[2] === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast + reservado
  );
}

/**
 * `true` quando o endereço resolvido é roteável publicamente. Usado depois do DNS
 * para recusar domínios públicos que resolvem para rede local (rebinding).
 * Endereço não reconhecido conta como NÃO público (fail-closed).
 */
export function isPublicIpAddress(address: string): boolean {
  const v4 = ipv4Octets(address);
  if (v4) return !isNonPublicIpv4(v4);
  const a = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (!a.includes(':')) return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (mapped?.[1]) {
    const o = ipv4Octets(mapped[1]);
    return o !== null && !isNonPublicIpv4(o);
  }
  if (a === '::' || a === '::1') return false;
  if (/^f[cd][0-9a-f]{2}:/.test(a)) return false; // ULA fc00::/7
  if (/^fe[89ab][0-9a-f]:/.test(a)) return false; // link-local fe80::/10
  if (/^ff/.test(a)) return false; // multicast
  if (a.startsWith('2001:db8:') || a.startsWith('64:ff9b:')) return false;
  return true;
}

/**
 * Normaliza uma lista de domínios para a allowlist do browser. Só entram hosts que
 * passariam por `evaluateWebTarget`; o resto é descartado (nunca alargado).
 */
export function normalizeAllowedDomains(domains: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of domains) {
    const d = raw.trim().toLowerCase().replace(/\.$/, '');
    const wildcard = d.startsWith('*.');
    const host = wildcard ? d.slice(2) : d;
    if (host === '' || isIpLiteral(host) || isLocalOrInternalHostname(host) || !host.includes('.')) continue;
    if (!/^[a-z0-9.-]+$/.test(host)) continue;
    out.add(wildcard ? `*.${host}` : host);
  }
  return [...out];
}
