// Estado de turno do chat (correção 3 da demo). Uma mensagem de usuário
// persistida nunca pode ficar indefinidamente sem estado correspondente.
//
// Não há coluna de status em `ai_conversations`: o estado é DERIVADO da sequência
// da própria sessão — uma mensagem de usuário está "concluída" quando é seguida
// por uma mensagem do assistente; caso contrário está "interrompida" (órfã) e é
// retryável. Isso reaproveita o esquema atual sem migration.

export type TurnMessage = { readonly id?: string; readonly role: 'user' | 'assistant'; readonly content: string };
export type InterruptedTurn = { readonly id?: string; readonly content: string };

/**
 * Servidor — idempotência de retry: reaproveita uma mensagem de usuário ÓRFÃ
 * idêntica em vez de criar uma segunda. Se a última mensagem da sessão já é uma
 * mensagem do usuário (logo, sem resposta depois), um reenvio do mesmo conteúdo
 * (ou um retry explícito por id) aponta para ELA. Evita o duplicado observado na
 * demo (a mesma mensagem gravada duas vezes).
 */
export function shouldReuseOrphanUserMessage(input: {
  readonly latest: { readonly id: string; readonly role: string; readonly content: string } | null;
  readonly incomingContent: string;
  readonly retryMessageId?: string | null;
}): boolean {
  const { latest, incomingContent, retryMessageId } = input;
  // Sem órfã quando não há mensagem ou a última é do assistente (turno completo).
  if (!latest || latest.role !== 'user') return false;
  // Retry explícito: só reaproveita a órfã exata apontada.
  if (typeof retryMessageId === 'string' && retryMessageId.length > 0) return retryMessageId === latest.id;
  // Reenvio implícito do mesmo texto: idempotente sobre a órfã.
  return latest.content === incomingContent;
}

/**
 * Cliente — turno interrompido: uma mensagem de usuário sem resposta do
 * assistente depois (tipicamente a última, após um reload durante a geração).
 * `null` quando o turno está completo. Base para exibir "Tentar novamente" e
 * reconstruir o estado a partir do servidor.
 */
export function findInterruptedTurn(messages: readonly TurnMessage[]): InterruptedTurn | null {
  const last = messages.at(-1);
  if (!last || last.role !== 'user') return null;
  return last.id ? { id: last.id, content: last.content } : { content: last.content };
}
