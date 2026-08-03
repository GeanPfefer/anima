import { supabase } from './supabase';

// Canal autenticado mobile → host (Fase G, paridade). O mobile permanece apenas
// cliente: NÃO executa nada, NÃO duplica lógica do Supervisor. Após uma resposta
// de decisão com efeito `resume`, pede ao host EXATAMENTE uma volta do Supervisor
// (`runSupervisorTurn`) autenticando-se com o access token do Supabase — a mesma
// autoridade RLS/`auth.uid()` da sessão do usuário. Nunca service role.

export class HostConfigError extends Error {}
export class HostUnavailableError extends Error {}

/** Endereço do host, sem credenciais. Valida presença e formato http(s). */
export const resolveHostBaseUrl = (raw: string | undefined = process.env.EXPO_PUBLIC_ANIMA_WEB_URL): string | null => {
  if (!raw || !/^https?:\/\/.+/i.test(raw.trim())) return null;
  return raw.trim().replace(/\/+$/, '');
};

/**
 * Pede ao host uma volta do Supervisor para o item. O corpo carrega apenas
 * item e versão — nenhuma identidade: `auth.uid()` vem do bearer, não do corpo.
 * Lança tipado quando o host não está configurado, a sessão expirou ou o host
 * está indisponível — sem desfazer a decisão já persistida no banco.
 */
export async function callHostSupervisorTurn(workItemId: string, expectedProposalVersion: number): Promise<unknown> {
  const base = resolveHostBaseUrl();
  if (!base) throw new HostConfigError('O endereço do Anima não está configurado (EXPO_PUBLIC_ANIMA_WEB_URL).');
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new HostUnavailableError('Sua sessão expirou. Entre novamente para retomar o trabalho.');

  let response: Response;
  try {
    response = await fetch(`${base}/api/work-orchestration/supervisor-turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ workItemId, expectedProposalVersion }),
    });
  } catch {
    throw new HostUnavailableError('Não foi possível falar com o Anima para retomar o trabalho agora.');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.ok) {
    throw new HostUnavailableError(body?.error?.message ?? body?.value?.refusal?.message ?? 'O Anima não conseguiu retomar o trabalho agora.');
  }
  return body.value;
}
