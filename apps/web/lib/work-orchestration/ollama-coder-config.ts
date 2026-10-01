import { coderBackendId } from './coder-backend';

export interface OllamaCoderRuntimeConfig {
  readonly url: string;
  readonly backendId: string;
  readonly locality: 'local' | 'remote';
  readonly nodeId: string | null;
}

export type OllamaCoderRuntimeConfigResult =
  | { readonly ok: true; readonly value: OllamaCoderRuntimeConfig }
  | { readonly ok: false; readonly error: string };

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const NODE_ID = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

const parseTunnelUrl = (raw: string): string | null => {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== '/' && url.pathname !== '') return null;
    if (!url.port) return null;
    return url.origin;
  } catch {
    return null;
  }
};

/** Endpoint exclusivo do coder. O remoto V0 só existe atrás de túnel loopback. */
export function resolveOllamaCoderRuntimeConfig(
  model: string,
  env: Record<string, string | undefined> = process.env,
): OllamaCoderRuntimeConfigResult {
  const explicit = env.ANIMA_WORKTREE_OLLAMA_URL?.trim();
  if (!explicit) {
    return {
      ok: true,
      value: {
        url: (env.OLLAMA_URL?.trim() || 'http://127.0.0.1:11434').replace(/\/+$/, ''),
        backendId: coderBackendId('ollama', model),
        locality: 'local',
        nodeId: null,
      },
    };
  }

  const url = parseTunnelUrl(explicit);
  if (!url) return { ok: false, error: 'ANIMA_WORKTREE_OLLAMA_URL deve ser HTTP loopback, sem credenciais, path, query ou fragmento.' };
  if (env.ANIMA_WORKTREE_OLLAMA_LOCALITY?.trim() !== 'remote') {
    return { ok: false, error: 'Endpoint Ollama dedicado exige ANIMA_WORKTREE_OLLAMA_LOCALITY=remote.' };
  }
  const nodeId = env.ANIMA_WORKTREE_OLLAMA_NODE_ID?.trim() ?? '';
  if (!NODE_ID.test(nodeId)) {
    return { ok: false, error: 'Endpoint Ollama remoto exige ANIMA_WORKTREE_OLLAMA_NODE_ID não sensível em kebab-case.' };
  }

  return {
    ok: true,
    value: {
      url,
      backendId: `ollama:remote/${nodeId}:${model}`,
      locality: 'remote',
      nodeId,
    },
  };
}

/** Janela operacional histórica do coder LOCAL (num_ctx). */
export const DEFAULT_LOCAL_CODER_CONTEXT_LENGTH = 8192;
/** Piso do orçamento de contexto (`resolveContextBudget` nunca usa menos). */
const MIN_LOCAL_CODER_CONTEXT_LENGTH = 1024;

/**
 * `ANIMA_LOCAL_CODER_CONTEXT_LENGTH`: teto operacional (num_ctx) do coder Ollama LOCAL.
 * Ausente/vazio ⇒ 8192 (comportamento histórico). Só inteiro decimal positivo e
 * finito >= 1024; qualquer outra coisa FALHA FECHADO (o coder não é construído),
 * como os demais knobs deste módulo — nunca um valor silenciosamente diferente.
 * Não afeta planner, OpenAI nem nodes remotos; reserva de saída e guardas de
 * truncamento continuam as do `resolveContextBudget`.
 */
export function resolveLocalCoderContextLength(
  env: Record<string, string | undefined> = process.env,
): { readonly ok: true; readonly value: number } | { readonly ok: false; readonly error: string } {
  const raw = env.ANIMA_LOCAL_CODER_CONTEXT_LENGTH?.trim();
  if (!raw) return { ok: true, value: DEFAULT_LOCAL_CODER_CONTEXT_LENGTH };
  const value = /^[1-9][0-9]*$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < MIN_LOCAL_CODER_CONTEXT_LENGTH) {
    return { ok: false, error: `ANIMA_LOCAL_CODER_CONTEXT_LENGTH deve ser inteiro decimal >= ${MIN_LOCAL_CODER_CONTEXT_LENGTH}.` };
  }
  return { ok: true, value };
}
