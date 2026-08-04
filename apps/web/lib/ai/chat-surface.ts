// Fronteira de produto (pós-incidente da demo com o Mateus): o chat padrão do
// Anima é uma conversa PESSOAL. As ferramentas de repositório e as instruções de
// desenvolvimento só podem existir quando há um contexto de desenvolvimento
// EXPLÍCITO, PERSISTIDO e VERIFICÁVEL — nunca inferido do texto da mensagem.
//
// A condição exige DUAS coisas independentes; nenhuma isolada basta:
//   1. Ação explícita — o pedido traz `developmentMode: true`, vindo de uma
//      superfície dedicada de autodesenvolvimento. Frases como "implemente
//      upload" ou "monte uma proposta" NÃO ativam nada por si.
//   2. Autorização persistida — o id do usuário está no allowlist do servidor
//      `ANIMA_DEVELOPMENT_CHAT_USER_IDS`. É um allowlist DEDICADO à superfície de
//      desenvolvimento, separado de propósito do allowlist de orquestração de
//      trabalho: estar autorizado a executar trabalho NÃO torna toda conversa
//      uma conversa de desenvolvimento.
//
// Com o env ausente (o caso do produto normal e da demo), o modo de
// desenvolvimento é impossível para todos — o chat pessoal é limpo por padrão.

/** Ids autorizados a usar a superfície de chat de desenvolvimento. Vazio por padrão. */
export function developmentChatUserIds(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  return (env.ANIMA_DEVELOPMENT_CHAT_USER_IDS ?? '')
    .split(',')
    .map(id => id.trim())
    .filter(id => id.length > 0);
}

/** Autorização persistida e verificável no servidor: o usuário está no allowlist
 * dedicado de desenvolvimento? Fail-closed para id ausente/inválido. */
export function isDevelopmentChatAuthorized(userId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return typeof userId === 'string' && userId.length > 0 && developmentChatUserIds(env).includes(userId);
}

/**
 * Modo de desenvolvimento de um turno de chat: só quando a ação explícita
 * (`requested`) E a autorização persistida (`authorized`) coincidem. Pura e
 * testável; a única porta que habilita ferramentas de repositório.
 */
export function resolveChatDevelopmentMode(input: { readonly requested: boolean; readonly authorized: boolean }): boolean {
  return input.requested === true && input.authorized === true;
}
