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
