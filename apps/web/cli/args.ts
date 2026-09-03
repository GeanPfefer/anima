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
  | { readonly kind: 'work-correct'; readonly id: string; readonly json: boolean }
  | { readonly kind: 'work-replan'; readonly id: string; readonly diagnosisPath: string | null; readonly json: boolean }
  | { readonly kind: 'work-authorize-resume'; readonly id: string; readonly planPath: string | null; readonly json: boolean }
  | { readonly kind: 'work-approve'; readonly id: string; readonly json: boolean }
  | { readonly kind: 'work-accept'; readonly id: string; readonly json: boolean }
  | { readonly kind: 'work-withdraw'; readonly id: string; readonly reason: string; readonly json: boolean }
  | { readonly kind: 'work-retry'; readonly id: string; readonly json: boolean };

export type ParseResult =
  | { readonly ok: true; readonly command: ParsedCommand }
  | { readonly ok: false; readonly error: string };

interface Extracted {
  readonly positionals: readonly string[];
  readonly json: boolean;
  readonly reason: string | null;
  readonly diagnosisPath: string | null;
  readonly planPath: string | null;
  readonly help: boolean;
  readonly unknownFlag: string | null;
}

/** Separa flags conhecidas de posicionais. `--reason` aceita `--reason=x` e `--reason x`. */
function extract(argv: readonly string[]): Extracted {
  const positionals: string[] = [];
  let json = false;
  let reason: string | null = null;
  let diagnosisPath: string | null = null;
  let planPath: string | null = null;
  let help = false;
  let unknownFlag: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === '--json') { json = true; continue; }
    if (token === '--diagnosis') { diagnosisPath = argv[++i] ?? ''; continue; }
    if (token === '--plan') { planPath = argv[++i] ?? ''; continue; }
    if (token === '--help' || token === '-h') { help = true; continue; }
    if (token === '--reason' || token === '-m') { reason = argv[++i] ?? ''; continue; }
    if (token.startsWith('--reason=')) { reason = token.slice('--reason='.length); continue; }
    if (token.startsWith('-') && token !== '-') { if (unknownFlag === null) unknownFlag = token; continue; }
    positionals.push(token);
  }
  return { positionals, json, reason, diagnosisPath, planPath, help, unknownFlag };
}

export function parseArgs(argv: readonly string[]): ParseResult {
  const { positionals, json, reason, diagnosisPath, planPath, help, unknownFlag } = extract(argv);

  if (help || positionals[0] === 'help' || positionals.length === 0) return { ok: true, command: { kind: 'help' } };
  if (unknownFlag !== null) return { ok: false, error: `Flag desconhecida: ${unknownFlag}` };

  const [group, sub, ...rest] = positionals;
  if (diagnosisPath !== null && (group !== 'work' || sub !== 'replan' || !diagnosisPath.trim())) {
    return { ok: false, error: '--diagnosis exige um arquivo e work replan.' };
  }
  if (planPath !== null && (group !== 'work' || sub !== 'authorize-resume' || !planPath.trim())) {
    return { ok: false, error: '--plan exige um arquivo e work authorize-resume.' };
  }

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
    if (sub === 'replan') {
      if (!id || rest.length !== 1 || reason !== null) return { ok:false, error:'Uso: anima work replan <id> [--diagnosis arquivo.json]' };
      return {ok:true, command:{kind:'work-replan',id,diagnosisPath,json}};
    }
    if (sub === 'authorize-resume') {
      if (!id || rest.length !== 1 || reason !== null) return { ok:false, error:'Uso: anima work authorize-resume <id> [--plan arquivo.json]' };
      return {ok:true, command:{kind:'work-authorize-resume',id,planPath,json}};
    }
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
    if (sub === 'correct') {
      if (!id) return { ok: false, error: 'Uso: anima work correct <id>' };
      return { ok: true, command: { kind: 'work-correct', id, json } };
    }
    if (sub === 'approve') {
      if (!id) return { ok: false, error: 'Uso: anima work approve <id>' };
      return { ok: true, command: { kind: 'work-approve', id, json } };
    }
    if (sub === 'accept') {
      if (!id) return { ok: false, error: 'Uso: anima work accept <id>' };
      return { ok: true, command: { kind: 'work-accept', id, json } };
    }
    if (sub === 'withdraw') {
      if (!id) return { ok: false, error: 'Uso: anima work withdraw <id> --reason "..."' };
      if (reason === null || reason.trim().length === 0) return { ok: false, error: 'withdraw exige --reason "<motivo>" não vazio.' };
      return { ok: true, command: { kind: 'work-withdraw', id, reason: reason.trim(), json } };
    }
    if (sub === 'retry') {
      if (!id) return { ok: false, error: 'Uso: anima work retry <id>' };
      return { ok: true, command: { kind: 'work-retry', id, json } };
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
  anima work correct <id>                      Materializa o sucessor de correção (proposed)
  anima work replan <id> [--diagnosis arquivo] Replaneja unidade mínima; sem diagnóstico, replay persistido
  anima work authorize-resume <id> [--plan f]  Autoridade humana: +1 tentativa após saldo esgotado (sucessor proposed)
  anima work approve <id>                     Aprova uma PROPOSTA (proposed → approved)
  anima work accept <id>                       Aceita o RESULTADO em review (review → completed)
  anima work withdraw <id> --reason "..."      Retira um plano APROVADO não iniciado (approved → cancelled)
  anima work retry <id>                        Solicita o retry governado de um item failed/RETRY_READY
  anima help                                  Esta ajuda

Flags:
  --json           Saída estável em JSON (para automação/self-dev)
  --reason "..."   Texto do pedido de correção (request-changes)
  --diagnosis f    Arquivo JSON do diagnóstico (work replan)
  --plan f         Arquivo JSON da autorização humana de retomada (work authorize-resume)

Códigos de saída: 0 sucesso · 1 erro operacional · 2 uso inválido · 3 ação recusada por regra`;
