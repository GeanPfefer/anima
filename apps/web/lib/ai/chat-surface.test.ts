import { developmentChatUserIds, isDevelopmentChatAuthorized, resolveChatDevelopmentMode } from './chat-surface';

// Fronteira de produto: o chat pessoal nunca vira chat de desenvolvimento pelo
// texto da mensagem nem só pela autorização. Exige ação explícita E autorização.

describe('chat-surface — separação chat pessoal x desenvolvimento', () => {
  const authorized = '11111111-1111-1111-1111-111111111111';
  const other = '22222222-2222-2222-2222-222222222222';
  const env = { ANIMA_DEVELOPMENT_CHAT_USER_IDS: ` ${authorized} , 33333333-3333-3333-3333-333333333333 ` } as unknown as NodeJS.ProcessEnv;

  test('allowlist vazio/ausente = ninguém autorizado (chat pessoal limpo por padrão)', () => {
    expect(developmentChatUserIds({} as NodeJS.ProcessEnv)).toEqual([]);
    expect(isDevelopmentChatAuthorized(authorized, {} as NodeJS.ProcessEnv)).toBe(false);
  });

  test('allowlist é lido com trim e ignora entradas vazias', () => {
    expect(developmentChatUserIds(env)).toEqual([authorized, '33333333-3333-3333-3333-333333333333']);
  });

  test('usuário comum não é autorizado nem com id válido', () => {
    expect(isDevelopmentChatAuthorized(other, env)).toBe(false);
    expect(isDevelopmentChatAuthorized('', env)).toBe(false);
  });

  test('usuário no allowlist é autorizado', () => {
    expect(isDevelopmentChatAuthorized(authorized, env)).toBe(true);
  });

  test('modo de desenvolvimento exige ação explícita E autorização (nenhuma isolada basta)', () => {
    // Usuário comum: nunca, mesmo pedindo explicitamente.
    expect(resolveChatDevelopmentMode({ requested: true, authorized: false })).toBe(false);
    // Autorizado sem ação explícita: continua chat pessoal (allowlist sozinho não basta).
    expect(resolveChatDevelopmentMode({ requested: false, authorized: true })).toBe(false);
    // Só quando as duas coincidem.
    expect(resolveChatDevelopmentMode({ requested: true, authorized: true })).toBe(true);
    expect(resolveChatDevelopmentMode({ requested: false, authorized: false })).toBe(false);
  });
});
