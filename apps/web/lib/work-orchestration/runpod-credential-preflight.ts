import { fetchHttpClient, type HttpClient } from './runpod-node-provisioner';

// ============================================================
// PREFLIGHT DE CREDENCIAL RunPod — ESTRITAMENTE READ-ONLY / NO-SPEND.
//
// Regra dura (aprendida em incidente 2026-09-09): um preflight de credencial NUNCA prova
// capacidade de WRITE através de uma operação FATURÁVEL. Criar um Pod (`POST /pods`) é faturável
// e cria recurso real — logo JAMAIS pode ser usado para "testar permissão". A capacidade de WRITE
// só é provada pela PRIMEIRA operação canônica governada (authority + budget + teardown).
//
// Este módulo só emite REQUISIÇÕES DE LEITURA (`GET /pods`). Não faz POST/DELETE, não cria recurso,
// não reserva compute, não altera estado do provider. A chave nunca é logada.
// ============================================================

export interface RunPodCredentialReadReport {
  /** `GET /pods` autenticou e respondeu 2xx (credencial válida para LEITURA na REST API). */
  readonly restReadable: boolean;
  readonly restStatus: number;
  /** Invariante estrutural: este preflight NUNCA prova WRITE (seria faturável). Sempre `false`. */
  readonly writeProbed: false;
  readonly note: string;
}

/** Confere, SÓ POR LEITURA, que a credencial RunPod autentica na REST API. Injeta `HttpClient`
 * para teste. Emite exclusivamente `GET`; qualquer outra coisa seria fora do contrato read-only. */
export async function assessRunPodCredentialReadOnly(
  config: { readonly apiBase: string; readonly apiKey: string },
  signal: AbortSignal,
  http: HttpClient = fetchHttpClient,
): Promise<RunPodCredentialReadReport> {
  const res = await http.send({
    method: 'GET',
    url: `${config.apiBase.replace(/\/+$/, '')}/pods`,
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    signal,
  });
  return {
    restReadable: res.status >= 200 && res.status < 300,
    restStatus: res.status,
    writeProbed: false,
    note: 'WRITE nunca e provado por preflight (POST /pods e faturavel); so pela 1a operacao canonica governada (authority+budget+teardown).',
  };
}
