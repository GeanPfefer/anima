// Códigos de saída previsíveis e documentados da CLI do Anima. Poucos, estáveis,
// para automação e self-dev. Mudar um número é mudança de contrato — não faça sem
// registrar. Documentados também em cli/README.md.
export const EXIT = {
  /** Sucesso. */
  OK: 0,
  /** Erro operacional: falha de identidade, rede, persistência, item ausente. */
  ERROR: 1,
  /** Uso inválido: comando/flag desconhecido, argumento obrigatório ausente. */
  USAGE: 2,
  /** Ação recusada por regra/governança (ex.: request_changes num estado que não permite). */
  REJECTED: 3,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
