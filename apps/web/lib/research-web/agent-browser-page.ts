// ============================================================
// research.web.open / navigate / extract — borda Node sobre o agent-browser (reuse).
//
// O ANIMA NÃO implementa browser/CDP: invoca a CLI do agent-browser com `--json`.
// Aqui só vive a governança do ANIMA sobre essa invocação:
//   - pré-validação da URL (sem localhost/IP/file/porta/credencial) e do DNS
//     (domínio público que resolve para rede local é recusado);
//   - host precisa estar na allowlist explícita da operação;
//   - sessão EFÊMERA por operação (nome aleatório, socket dir temporário), sem
//     profile, sem restore/state, sem CDP externo;
//   - policy do agent-browser default-deny com os NOMES REAIS das ações
//     (sem evaluate/click/fill/download/upload/cookies);
//   - `--allowed-domains` + content boundaries + max-output no daemon;
//   - `close` sempre, e morte do daemon por PID se o close falhar;
//   - conteúdo devolvido rotulado `untrusted_external_content`.
//
// "navigate" na V1 = abrir uma URL validada (ex. link de uma extração anterior)
// numa NOVA sessão efêmera; não há clique/seguimento dentro da mesma sessão.
// ============================================================

import { createHash, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildResearchWebBrowserPolicy,
  evaluateWebTarget,
  externalError,
  isPublicIpAddress,
  UNTRUSTED_EXTERNAL_CONTENT,
  type ExternalExecutionPolicyV1,
  type ExternalObservationErrorV1,
  type WebPageExtractionV1,
} from '@anima/core';
import type { ResearchWebConfig } from './config';
import { minimalChildEnv, runJsonCli, type JsonCliResult, type JsonCliRunner } from './json-cli';

export interface OpenWebPageRequest {
  readonly url: string;
  /** Domínios que esta operação pode tocar (normalmente só o do resultado escolhido). */
  readonly allowedDomains: readonly string[];
}

export type OpenWebPageResult =
  | { readonly ok: true; readonly extraction: WebPageExtractionV1; readonly policy: ExternalExecutionPolicyV1 }
  | { readonly ok: false; readonly error: ExternalObservationErrorV1; readonly policy: ExternalExecutionPolicyV1 | null };

export interface OpenWebPageDeps {
  readonly config: ResearchWebConfig;
  readonly runCli?: JsonCliRunner;
  readonly resolveHost?: (hostname: string) => Promise<readonly string[]>;
  readonly now?: () => Date;
  readonly newSessionId?: () => string;
  readonly killProcess?: (pid: number) => void;
  readonly tempRoot?: string;
}

const BLOCKED_PAGE = /navigation to .+ is not allowed by domain filter/i;

export function webContentHash(text: string): string {
  return `sha256:${createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex')}`;
}

function hostAllowed(hostname: string, allowed: readonly string[]): boolean {
  return allowed.some(d => (d.startsWith('*.') ? hostname === d.slice(2) || hostname.endsWith(d.slice(1)) : hostname === d));
}

async function defaultResolveHost(hostname: string): Promise<readonly string[]> {
  const records = await lookup(hostname, { all: true });
  return records.map(r => r.address);
}

function dataOf(result: JsonCliResult): Record<string, unknown> | null {
  const json = result.json;
  if (typeof json !== 'object' || json === null) return null;
  const r = json as { success?: unknown; data?: unknown };
  if (r.success !== true || typeof r.data !== 'object' || r.data === null) return null;
  return r.data as Record<string, unknown>;
}

function cliError(result: JsonCliResult, step: string): ExternalObservationErrorV1 {
  if (result.spawnError) return externalError('not_configured', `agent-browser não executou (${step}): ${result.spawnError}`);
  if (result.timedOut) return externalError('timeout', `agent-browser excedeu o tempo em ${step}`);
  if (result.stdoutTruncated) return externalError('schema', `saída do agent-browser acima do limite em ${step}`);
  if (result.parseError) return externalError('schema', `agent-browser não devolveu JSON em ${step}`);
  const err = (result.json as { error?: unknown } | null)?.error;
  return externalError('tool_failed', `agent-browser falhou em ${step}: ${typeof err === 'string' ? err : 'erro desconhecido'}`);
}

/** Abre UMA página sob política restritiva e extrai texto legível. Nunca lança. */
export async function openAndExtractWebPage(request: OpenWebPageRequest, deps: OpenWebPageDeps): Promise<OpenWebPageResult> {
  const { config } = deps;
  const now = deps.now ?? (() => new Date());

  // 1. Pré-validação pura (antes de qualquer processo ou rede).
  const target = evaluateWebTarget(request.url);
  if (!target.allowed) return { ok: false, error: externalError('blocked_by_policy', `URL recusada: ${target.reason}`), policy: null };
  if (!config.agentBrowserPath || config.browserRuntime === null) {
    return { ok: false, error: externalError('not_configured', 'agent-browser não configurado (ANIMA_RESEARCH_AGENT_BROWSER_BIN / runtime)'), policy: null };
  }
  const policy = buildResearchWebBrowserPolicy({
    executablePath: config.agentBrowserPath,
    version: null,
    allowedDomains: request.allowedDomains,
    timeoutMs: config.timeoutMs,
    maxOutputChars: config.browserMaxOutputChars,
  });
  const allowed = policy.network.allowedDomains;
  if (allowed.length === 0) return { ok: false, error: externalError('blocked_by_policy', 'allowlist de domínios vazia'), policy };
  if (!hostAllowed(target.hostname, allowed)) {
    return { ok: false, error: externalError('blocked_by_policy', `host ${target.hostname} fora da allowlist`), policy };
  }

  // 2. DNS: domínio público que resolve para rede local/privada é recusado.
  try {
    const addresses = await (deps.resolveHost ?? defaultResolveHost)(target.hostname);
    if (addresses.length === 0 || addresses.some(a => !isPublicIpAddress(a))) {
      return { ok: false, error: externalError('blocked_by_policy', `host ${target.hostname} resolve para endereço não público`), policy };
    }
  } catch {
    return { ok: false, error: externalError('network', `DNS falhou para ${target.hostname}`), policy };
  }

  // 3. Sessão efêmera isolada.
  const runCli = deps.runCli ?? runJsonCli;
  const session = `anima-rw-${(deps.newSessionId ?? randomUUID)().replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)}`;
  const workDir = await mkdtemp(join(deps.tempRoot ?? tmpdir(), 'anima-research-web-'));
  const policyPath = join(workDir, 'action-policy.json');
  await writeFile(policyPath, JSON.stringify({ default: policy.actions.default, allow: policy.actions.allow }), 'utf8');
  const env = minimalChildEnv({
    AGENT_BROWSER_SESSION: session,
    AGENT_BROWSER_SOCKET_DIR: workDir,
    AGENT_BROWSER_ALLOWED_DOMAINS: allowed.join(','),
    AGENT_BROWSER_ACTION_POLICY: policyPath,
    AGENT_BROWSER_CONTENT_BOUNDARIES: '1',
    AGENT_BROWSER_MAX_OUTPUT: String(policy.limits.maxOutputChars),
    AGENT_BROWSER_IDLE_TIMEOUT_MS: String(Math.max(policy.limits.timeoutMs * 4, 60_000)),
  });
  const run = (args: readonly string[]): Promise<JsonCliResult> =>
    runCli({
      command: policy.executable.path,
      args: [...args, '--json'],
      env,
      cwd: workDir,
      timeoutMs: policy.limits.timeoutMs,
      maxStdoutChars: policy.limits.maxOutputChars * 2 + 16_384,
    });

  try {
    const opened = await run(['open', target.url]);
    const openData = dataOf(opened);
    if (!openData) return { ok: false, error: cliError(opened, 'open'), policy };
    const targetId = typeof openData.targetId === 'string' ? openData.targetId : 'unknown';

    const urlRes = await run(['get', 'url']);
    const titleRes = await run(['get', 'title']);
    const readRes = await run(['read']);
    const urlData = dataOf(urlRes);
    const readData = dataOf(readRes);
    if (!urlData || typeof urlData.url !== 'string') return { ok: false, error: cliError(urlRes, 'get url'), policy };
    if (!readData) return { ok: false, error: cliError(readRes, 'read'), policy };
    const finalUrl = urlData.url;
    const title = typeof dataOf(titleRes)?.title === 'string' ? (dataOf(titleRes)?.title as string) : '';
    const text = typeof readData.content === 'string' ? readData.content : '';

    // 4. Redirect para fora da política ou página "Blocked" do filtro ⇒ bloqueado.
    const finalTarget = evaluateWebTarget(finalUrl);
    const blocked = !finalTarget.allowed || !hostAllowed(finalTarget.hostname, allowed) || BLOCKED_PAGE.test(text);
    const observedAt = now().toISOString();
    const content = blocked ? '' : text;
    return {
      ok: true,
      policy,
      extraction: {
        page: {
          schemaVersion: 1,
          requestedUrl: target.url,
          finalUrl,
          title: blocked ? '' : title.slice(0, 300),
          observedAt,
          sessionRef: `${session}:${targetId}`,
          extraction: 'readable_text',
          locator: null,
          contentHash: webContentHash(content),
          blocked,
          artifactRef: null,
        },
        content: {
          trust: UNTRUSTED_EXTERNAL_CONTENT,
          origin: finalUrl,
          text: content.slice(0, policy.limits.maxOutputChars),
          truncated: content.length >= policy.limits.maxOutputChars,
        },
      },
    };
  } finally {
    // 5. Nada de daemon persistente: close e, se falhar, morte por PID.
    const closed = await run(['close']).catch(() => null);
    if (!closed || dataOf(closed) === null) {
      try {
        const pid = Number((await readFile(join(workDir, `${session}.pid`), 'utf8')).trim());
        if (Number.isInteger(pid) && pid > 0) (deps.killProcess ?? (p => process.kill(p)))(pid);
      } catch {
        // sem pid file: não havia daemon
      }
    }
    // No Windows o daemon ainda regrava arquivos da sessão enquanto encerra: retentar.
    await rm(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => undefined);
  }
}
