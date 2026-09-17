// ============================================================
// Sanitização COMPARTILHADA de saída de comando observada pelo host.
//
// SISTEMA ÚNICO de redaction (não há um segundo paralelo): o resumo de falha de gate
// para reparo (`summarizeGateFailureForRetry`) E a observabilidade EXEC/TEST/GIT do
// Coding Harness V3 usam estas mesmas primitivas. Bounded + redigido de segredos,
// com truncation explícita.
//
// Duas camadas, ambas centralizadas aqui:
//   - `redactMultilineSecrets`: pré-passe sobre o TEXTO INTEIRO (antes de fatiar em
//     linhas), para segredos que atravessam quebras de linha — blocos PEM/chave
//     privada e continuações "chave: \n valor". Colapsa o bloco a um marcador ANTES
//     de qualquer truncation, para o segredo nunca sobreviver a um corte de tail.
//   - `redactSecrets`: redaction por LINHA — fragmentos JSON/serializados, query
//     strings de URL, Bearer/JWT, atribuições `chave: valor` e caminhos absolutos.
//
// O validador residual de `coder-transcript.ts` permanece defesa em profundidade
// (fail-closed contra segredo bruto que escape), NUNCA o mecanismo normal de redaction.
// ============================================================

// Nomes de chave sensível (case-insensitive) reusados pelas primitivas centrais.
const SECRET_KEYS = 'password|passwd|secret|api[-_]?key|apikey|access[-_]?token|authorization';
const QUOTED_KEYS = `${SECRET_KEYS}|cookie|set-cookie|x-api-key|proxy-authorization`;

// (1) JSON / estrutura serializada com valor ENTRE ASPAS: {"password":"x"}, 'api_key':'x',
//     key="x". Preserva a CHAVE e as ASPAS (diagnóstico), apaga só o VALOR — sem exigir
//     parser JSON (dispara em fragmentos e texto misto de stdout/stderr/diff).
const QUOTED_SECRET = new RegExp(
  `(["']?\\b(?:${QUOTED_KEYS})\\b["']?\\s*[:=]\\s*)(["'])(?:\\\\.|(?!\\2)[^\\r\\n])*?\\2`,
  'gi',
);
// (1b) JSON com CHAVE entre aspas e valor NÃO entre aspas: {"secret":abc,"x":1} → só o
//      token do valor vira <redacted>; vírgula/chaves seguintes preservadas.
const JSON_BARE_SECRET = new RegExp(
  `(["']\\b(?:${SECRET_KEYS})\\b["']\\s*[:=]\\s*)(?!["'])([^\\s,}\\]]+)`,
  'gi',
);
// (2) URL / query params sensíveis: apaga só o VALOR, para no próximo &/#/aspas/espaço,
//     preservando host, path e params não sensíveis (e headers de diff `+++ b/...`).
//     Alternativas mais específicas primeiro para consumir o nome inteiro do param.
const URL_QUERY_SECRET = new RegExp(
  `([?&](?:access[_-]?token|api[_-]?key|apikey|authorization|password|passwd|signature|secret|token|auth|sig|key)=)[^&#\\s"'<>]*`,
  'gi',
);
// (3) Bearer / JWT — comportamento existente, revalidado (não regride).
const BEARER = /\bbearer\s+[a-z0-9._~+/-]{8,}=*/gi;
const JWT = /\beyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b/gi;
// (4) Atribuição de segredo de UMA linha `chave: valor`/`chave=valor` até o fim da linha.
//     Preserva a CHAVE, apaga o VALOR. O negative-lookbehind `(?<![?&])` cede o contexto
//     de query string ao handler de URL (senão o `.*$` guloso apagaria `&outro=param`).
const SECRET_ASSIGNMENT =
  /(?<![?&])\b([A-Za-z0-9_]*(?:password|passwd|secret|api[-_]?key|access[-_]?token)|authorization|cookie|set-cookie|x-api-key|proxy-authorization)\b\s*[:=]\s*.*$/gi;
const WINDOWS_PATH = /[A-Za-z]:[\\/][^\s'"<>|]*/g;
const POSIX_PATH = /(?:\/[A-Za-z0-9._@-]+){2,}/g;
// Rodapés de Jest/npm/Node descrevem o encerramento do comando, não a causa.
const OUTPUT_FOOTER =
  /^(?:Test Suites:|Tests:|Snapshots:|Time:|Ran all test suites\.?|Node\.js v\d+|npm (?:error|ERR!)\b)/i;

// --- Camada multiline (texto inteiro, antes de fatiar) ------------------------
// Bloco PEM completo (BEGIN…END), qualquer variante de PRIVATE KEY (RSA/EC/OPENSSH/…):
// colapsa a UM marcador, preservando o transcript em vez de perdê-lo no validador residual.
const PEM_BLOCK = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gi;
// Continuação bounded e conservadora: chave sensível SOZINHA numa linha terminada em `:`/`=`
// (valor vazio ali) + valor na PRÓXIMA linha. Só a âncora de chave dispara; redige apenas a
// primeira linha de valor (não apaga linhas arbitrárias sem âncora).
const MULTILINE_SECRET = new RegExp(
  `^([ \\t]*["']?\\b(?:${SECRET_KEYS})\\b["']?[ \\t]*[:=])[ \\t]*(\\r?\\n)([ \\t]*)(\\S[^\\r\\n]*)$`,
  'gim',
);

/**
 * Pré-passe multiline sobre o TEXTO INTEIRO: colapsa blocos PEM/chave privada a um
 * marcador e redige continuações "chave:\n valor" — ANTES de qualquer fatiamento em
 * linhas ou truncation, para que um segredo multi-linha nunca sobreviva a um corte.
 */
export function redactMultilineSecrets(text: string): string {
  return String(text ?? '')
    .replace(PEM_BLOCK, '<redacted-private-key>')
    .replace(MULTILINE_SECRET, (_m, keyLine: string, newline: string, indent: string) => `${keyLine}${newline}${indent}<redacted>`);
}

/** Redige segredos de UMA linha (sem newlines). `redactPaths` também colapsa caminhos
 * absolutos a `<path>` — deve ficar FALSE para diffs (o `+++ b/...` precisa sobreviver). */
export function redactSecrets(line: string, redactPaths = true): string {
  let out = line
    // JSON/serializado (valor entre aspas, depois valor nu) — antes do assignment guloso,
    // preservando a estrutura ao redor.
    .replace(QUOTED_SECRET, (_m, keyPrefix: string, quote: string) => `${keyPrefix}${quote}<redacted>${quote}`)
    .replace(JSON_BARE_SECRET, (_m, keyPrefix: string) => `${keyPrefix}<redacted>`)
    // Query string de URL — só o valor sensível, preservando os demais params.
    .replace(URL_QUERY_SECRET, (_m, paramPrefix: string) => `${paramPrefix}<redacted>`)
    .replace(BEARER, 'Bearer <redacted>')
    .replace(JWT, '<redacted>')
    // Atribuição genérica de uma linha (fora de contexto de query, por causa do lookbehind).
    .replace(SECRET_ASSIGNMENT, (_match, key: string) => `${key}=<redacted>`);
  if (redactPaths) out = out.replace(WINDOWS_PATH, '<path>').replace(POSIX_PATH, '<path>');
  return out;
}

export interface OutputSanitizeOptions {
  readonly maxChars: number;
  readonly maxLines: number;
  readonly dropFooters: boolean;
  readonly redactPaths: boolean;
}

/**
 * Resumo orientado à CAUSA (tail): combina stderr+stdout, remove rodapés conhecidos,
 * mantém as últimas `maxLines` linhas informativas, redige e trunca a `maxChars`.
 * `undefined` quando não sobra diagnóstico. É a régua do resumo de gate.
 */
export function summarizeCommandOutput(
  stdout: string,
  stderr: string,
  opts: OutputSanitizeOptions,
): string | undefined {
  const rawLines = redactMultilineSecrets(`${stderr}\n${stdout}`)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  if (rawLines.length === 0) return undefined;
  const informative = opts.dropFooters ? rawLines.filter(line => !OUTPUT_FOOTER.test(line)) : rawLines;
  const selected = informative.length > 0 ? informative : rawLines;
  const sanitized = selected
    .slice(-opts.maxLines)
    .map(line => redactSecrets(line, opts.redactPaths))
    .join('\n')
    .slice(0, opts.maxChars)
    .trim();
  return sanitized.length > 0 ? sanitized : undefined;
}

export interface BoundedOutput {
  readonly text: string;
  readonly truncated: boolean;
}

/**
 * Fluxo (stdout OU stderr) bounded, orientado ao TAIL (o erro do jest/tsc costuma
 * ficar no fim). Redige segredos e caminhos, marca truncation por linha OU por char.
 */
export function sanitizeStream(text: string, maxChars: number, maxLines: number): BoundedOutput {
  const lines = redactMultilineSecrets(text).split(/\r?\n/).map(line => line.replace(/\s+$/u, ''));
  const informative = lines.filter(line => line.trim().length > 0);
  const source = informative.length > 0 ? informative : lines;
  const lineTruncated = source.length > maxLines;
  const kept = source.slice(-maxLines).map(line => redactSecrets(line, true)).join('\n');
  const charTruncated = kept.length > maxChars;
  return { text: charTruncated ? kept.slice(0, maxChars) : kept, truncated: lineTruncated || charTruncated };
}

/**
 * Diff bounded, orientado ao HEAD (para reconstruir o patch de cima para baixo).
 * Redige segredos MAS preserva caminhos (`+++ b/...` precisa sobreviver p/ diagnóstico).
 */
export function sanitizeDiff(diff: string, maxChars: number, maxLines: number): BoundedOutput {
  const lines = redactMultilineSecrets(diff).split(/\r?\n/);
  const lineTruncated = lines.length > maxLines;
  const kept = lines.slice(0, maxLines).map(line => redactSecrets(line, false)).join('\n');
  const charTruncated = kept.length > maxChars;
  return { text: charTruncated ? kept.slice(0, maxChars) : kept, truncated: lineTruncated || charTruncated };
}
