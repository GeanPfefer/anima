// Redação de segredos para logs/evidência das provas E2E fortes. Extraído para um
// módulo puro e sem efeitos colaterais para poder ser testado por jest de forma
// isolada (e serve de âncora da convenção de teste em apps/web/scripts).

/** Substitui qualquer segredo estilo OpenAI (`sk-…`) por um marcador redigido, para
 * que nenhuma chave/token vaze em log ou evidência, mesmo por acidente. Puro. */
export function redactSecrets(value: string): string {
  return value.replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***REDACTED***');
}
