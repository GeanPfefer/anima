// Parser PURO de argumentos da CLI: `argv` (já sem node+script) → um comando
// tipado, ou uma recusa de USO. Sem I/O, sem process.exit, sem env — só a decisão
// estrutural do que o usuário pediu. Isolado para ser provado à exaustão e para
// que o entrypoint só faça I/O e dispatch.

export type ParsedCommand =
  | { readonly kind: 'help' }
  | { readonly kind: 'status'; readonly json: boolean }
  | { readonly kind: 'work-list'; readonly json: boolean }
  | { readonly kind: 'work-show'; readonly id: string; readonly json: boolean }
  | { readonly kind: 'work-evidence'; readonly id: string; readonly json: boolean }
  | { readonly kind: 'work-request-changes'; readonly id: string; readonly reason: string; readonly json: boolean }
  | { readonly kind: 'work-approve'; readonly id: string; readonly json: boolean };

export type ParseResult =
  | { readonly ok: true; readonly command: ParsedCommand }
  | { readonly ok: false; readonly error: string };

interface Extracted {
  readonly positionals: readonly string[];
  readonly json: boolean;
  readonly reason: string | null;
  readonly help: boolean;
  readonly unknownFlag: string | null;
}

/** Separa flags conhecidas de posicionais. `--reason` aceita `--reason=x` e `--reason x`. */
function extract(argv: readonly string[]): Extracted {
  const positionals: string[] = [];
  let json = false;
  let reason: string | null = null;
  let help = false;
  let unknownFlag: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === '--json') { json = true; continue; }
    if (token === '--help' || token === '-h') { help = true; continue; }
    if (token === '--reason' || token === '-m') { reason = argv[++i] ?? ''; continue; }
    if (token.startsWith('--reason=')) { reason = token.slice('--reason='.length); continue; }
    if (token.startsWith('-') && token !== '-') { if (unknownFlag === null) unknownFlag = token; continue; }
    positionals.push(token);
  }
  return { positionals, json, reason, help, unknownFlag };
}

export function parseArgs(argv: readonly string[]): ParseResult {
  const { positionals, json, reason, help, unknownFlag } = extract(argv);

  if (help || positionals[0] === 'help' || positionals.length === 0) return { ok: true, command: { kind: 'help' } };
  if (unknownFlag !== null) return { ok: false, error: `Flag desconhecida: ${unknownFlag}` };

  const [group, sub, ...rest] = positionals;

  if (group === 'status') {
    if (sub !== undefined) return { ok: false, error: `Argumento inesperado para "status": ${sub}` };
    return { ok: true, command: { kind: 'status', json } };
  }

  if (group === 'work') {
    if (sub === 'list') {
      if (rest.length > 0) return { ok: false, error: `Argumento inesperado para "work list": ${rest[0]}` };
      return { ok: true, command: { kind: 'work-list', json } };
    }
    const id = rest[0];
    if (sub === 'show') {
      if (!id) return { ok: false, error: 'Uso: anima work show <id>' };
      return { ok: true, command: { kind: 'work-show', id, json } };
    }
    if (sub === 'evidence') {
      if (!id) return { ok: false, error: 'Uso: anima work evidence <id>' };
      return { ok: true, command: { kind: 'work-evidence', id, json } };
    }
    if (sub === 'request-changes') {
      if (!id) return { ok: false, error: 'Uso: anima work request-changes <id> --reason "..."' };
      if (reason === null || reason.trim().length === 0) return { ok: false, error: 'request-changes exige --reason "<pedido>" não vazio.' };
      return { ok: true, command: { kind: 'work-request-changes', id, reason: reason.trim(), json } };
    }
    if (sub === 'approve') {
      if (!id) return { ok: false, error: 'Uso: anima work approve <id>' };
      return { ok: true, command: { kind: 'work-approve', id, json } };
    }
    return { ok: false, error: `Subcomando de "work" desconhecido: ${sub ?? '(vazio)'}` };
  }

  return { ok: false, error: `Comando desconhecido: ${group}` };
}

export const USAGE = `anima — CLI operacional do Anima (adapter sobre os mesmos application services da web)

Uso:
  anima status                                Identidade, conexão e resumo do trabalho
  anima work list                             Lista os trabalhos não terminais (retomáveis)
  anima work show <id>                        Estado, versão, tentativa, Verifier e cobertura
  anima work evidence <id>                    Critérios de aceite, provas e lacunas (Verifier)
  anima work request-changes <id> --reason "" Registra REQUEST_CHANGES pelo fluxo canônico
  anima work approve <id>                     Aceita o resultado em review (accept_result)
  anima help                                  Esta ajuda

Flags:
  --json           Saída estável em JSON (para automação/self-dev)
  --reason "..."   Texto do pedido de correção (request-changes)

Códigos de saída: 0 sucesso · 1 erro operacional · 2 uso inválido · 3 ação recusada por regra`;
