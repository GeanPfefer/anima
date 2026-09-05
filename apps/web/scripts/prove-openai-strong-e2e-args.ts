const USAGE = 'Uso: prove-openai-strong-e2e.ts "<mensagem da tarefa>"';

/**
 * Obtém a única mensagem de tarefa aceita pela prova E2E.
 *
 * A validação é deliberadamente pura para que a mensagem persistida e entregue ao
 * planejador seja precisamente a entrada validada, sem fallback hardcoded.
 */
export function parseProveOpenaiStrongE2eArgs(args: readonly string[]): string {
  if (args.length !== 1) {
    throw new Error(USAGE);
  }

  const message = args[0];
  if (typeof message !== 'string' || message.trim().length === 0) {
    throw new Error(`${USAGE}. A mensagem da tarefa não pode estar vazia.`);
  }

  return message;
}
