// Parser PURO de argumentos da CLI: `argv` (já sem node+script) → um comando
// tipado, ou uma recusa de USO. Sem I/O, sem process.exit, sem env — só a decisão
// estrutural do que o usuário pediu. Isolado para ser provado à exaustão e para
// que o entrypoint só faça I/O e dispatch.

import { parseComputePreference, type ComputePreferenceV1 } from '@anima/core';

export type ParsedCommand =
  | { readonly kind: 'help' }
  | { readonly kind: 'status'; readonly json: boolean }
  | { readonly kind: 'recovery-config-check'; readonly json: boolean }
  | { readonly kind: 'toolchain-check'; readonly json: boolean }
  | { readonly kind: 'budget-status'; readonly id: string; readonly json: boolean }
  | { readonly kind: 'work-list'; readonly json: boolean }
  | { readonly kind: 'work-show'; readonly id: string; readonly json: boolean }
  | { readonly kind: 'work-evidence'; readonly id: string; readonly json: boolean }
  | { readonly kind: 'work-executors'; readonly id: string; readonly json: boolean }
  | { readonly kind: 'work-request-changes'; readonly id: string; readonly reason: string; readonly json: boolean }
  | { readonly kind: 'work-correct'; readonly id: string; readonly requiredGates: readonly string[]; readonly json: boolean }
  | { readonly kind: 'work-replan'; readonly id: string; readonly diagnosisPath: string | null; readonly json: boolean }
  | { readonly kind: 'work-authorize-resume'; readonly id: string; readonly planPath: string | null; readonly json: boolean }
  | { readonly kind: 'work-supervise'; readonly id: string; readonly json: boolean }
  | { readonly kind: 'work-unsupervise'; readonly id: string; readonly json: boolean }
  | { readonly kind: 'work-approve'; readonly id: string; readonly json: boolean }
  | { readonly kind: 'work-accept'; readonly id: string; readonly json: boolean }
  | { readonly kind: 'work-withdraw'; readonly id: string; readonly reason: string; readonly json: boolean }
  | { readonly kind: 'work-resolve-pending'; readonly id: string; readonly decision: 'request_changes' | 'cancel'; readonly reason: string | null; readonly json: boolean }
  | { readonly kind: 'work-retry'; readonly id: string; readonly json: boolean }
  | { readonly kind: 'work-prepare-autonomous'; readonly id: string; readonly json: boolean }
  | { readonly kind: 'work-authorize-compute'; readonly id: string; readonly maxCostUsd: number; readonly maxMinutes: number; readonly validHours: number; readonly json: boolean }
  | { readonly kind: 'work-set-compute'; readonly id: string; readonly preference: ComputePreferenceV1; readonly json: boolean }
  | { readonly kind: 'work-recover-harness'; readonly id: string; readonly fixCommits: readonly string[]; readonly evidenceReference: string; readonly reason: string; readonly json: boolean };

export type ParseResult =
  | { readonly ok: true; readonly command: ParsedCommand }
  | { readonly ok: false; readonly error: string };

interface Extracted {
  readonly positionals: readonly string[];
  readonly json: boolean;
  readonly reason: string | null;
  readonly diagnosisPath: string | null;
  readonly planPath: string | null;
  readonly limits: Readonly<Record<'maxUsd' | 'maxMinutes' | 'validHours', string | null>>;
  readonly compute: Readonly<Record<'strategy' | 'provider' | 'model', string | null>>;
  readonly fixes: readonly string[];
  readonly evidence: string | null;
  readonly requiredGates: readonly string[];
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
  const limits: Record<'maxUsd' | 'maxMinutes' | 'validHours', string | null> = { maxUsd: null, maxMinutes: null, validHours: null };
  const compute: Record<'strategy' | 'provider' | 'model', string | null> = { strategy: null, provider: null, model: null };
  const fixes: string[] = [];
  let evidence: string | null = null;
  const requiredGates: string[] = [];
  let help = false;
  let unknownFlag: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === '--json') { json = true; continue; }
    if (token === '--diagnosis') { diagnosisPath = argv[++i] ?? ''; continue; }
    if (token === '--plan') { planPath = argv[++i] ?? ''; continue; }
    if (token === '--max-usd') { limits.maxUsd = argv[++i] ?? ''; continue; }
    if (token === '--max-minutes') { limits.maxMinutes = argv[++i] ?? ''; continue; }
    if (token === '--valid-hours') { limits.validHours = argv[++i] ?? ''; continue; }
    if (token === '--strategy') { compute.strategy = argv[++i] ?? ''; continue; }
    if (token === '--provider') { compute.provider = argv[++i] ?? ''; continue; }
    if (token === '--model') { compute.model = argv[++i] ?? ''; continue; }
    if (token === '--fix') { fixes.push(argv[++i] ?? ''); continue; }
    if (token === '--evidence') { evidence = argv[++i] ?? ''; continue; }
    if (token === '--require-gate') { requiredGates.push(argv[++i] ?? ''); continue; }
    if (token === '--help' || token === '-h') { help = true; continue; }
    if (token === '--reason' || token === '-m') { reason = argv[++i] ?? ''; continue; }
    if (token.startsWith('--reason=')) { reason = token.slice('--reason='.length); continue; }
    if (token.startsWith('-') && token !== '-') { if (unknownFlag === null) unknownFlag = token; continue; }
    positionals.push(token);
  }
  return { positionals, json, reason, diagnosisPath, planPath, limits, compute, fixes, evidence, requiredGates, help, unknownFlag };
}

/** Limites da authority paga: EXPLÍCITOS (sem default de dinheiro) e dentro de faixas sãs. */
export const COMPUTE_AUTHORITY_LIMIT_BOUNDS = {
  maxUsd: { min: 0.01, max: 50 },
  maxMinutes: { min: 1, max: 240 },
  validHours: { min: 0.1, max: 24 },
} as const;
const boundedNumber = (raw: string | null, bounds: { readonly min: number; readonly max: number }): number | null => {
  if (raw === null || !/^\d+(\.\d+)?$/.test(raw.trim())) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= bounds.min && value <= bounds.max ? value : null;
};

export function parseArgs(argv: readonly string[]): ParseResult {
  const { positionals, json, reason, diagnosisPath, planPath, limits, compute, fixes, evidence, requiredGates, help, unknownFlag } = extract(argv);

  if (help || positionals[0] === 'help' || positionals.length === 0) return { ok: true, command: { kind: 'help' } };
  if (unknownFlag !== null) return { ok: false, error: `Flag desconhecida: ${unknownFlag}` };

  const [group, sub, ...rest] = positionals;
  if (diagnosisPath !== null && (group !== 'work' || sub !== 'replan' || !diagnosisPath.trim())) {
    return { ok: false, error: '--diagnosis exige um arquivo e work replan.' };
  }
  if (planPath !== null && (group !== 'work' || sub !== 'authorize-resume' || !planPath.trim())) {
    return { ok: false, error: '--plan exige um arquivo e work authorize-resume.' };
  }
  const anyLimit = limits.maxUsd !== null || limits.maxMinutes !== null || limits.validHours !== null;
  if (anyLimit && (group !== 'work' || sub !== 'authorize-compute')) {
    return { ok: false, error: '--max-usd/--max-minutes/--valid-hours só valem para work authorize-compute.' };
  }
  if (requiredGates.length > 0 && (group !== 'work' || sub !== 'correct' || requiredGates.some(gate => !gate.trim()))) {
    return { ok: false, error: '--require-gate "<comando npm>" só vale para work correct.' };
  }
  if ((fixes.length > 0 || evidence !== null) && (group !== 'work' || sub !== 'recover-harness')) {
    return { ok: false, error: '--fix/--evidence só valem para work recover-harness.' };
  }
  const anyCompute = compute.strategy !== null || compute.provider !== null || compute.model !== null;
  if (anyCompute && (group !== 'work' || sub !== 'set-compute')) {
    return { ok: false, error: '--strategy/--provider/--model só valem para work set-compute.' };
  }

  if (group === 'status') {
    if (sub !== undefined) return { ok: false, error: `Argumento inesperado para "status": ${sub}` };
    return { ok: true, command: { kind: 'status', json } };
  }

  if (group === 'recovery-config') {
    if (sub !== 'check' || rest.length > 0 || reason !== null) return { ok: false, error: 'Uso: anima recovery-config check [--json]' };
    return { ok: true, command: { kind: 'recovery-config-check', json } };
  }

  if (group === 'toolchain') {
    if (sub !== 'check' || rest.length > 0 || reason !== null) return { ok: false, error: 'Uso: anima toolchain check [--json]' };
    return { ok: true, command: { kind: 'toolchain-check', json } };
  }

  if (group === 'budget') {
    if (sub !== 'status' || !rest[0] || rest.length !== 1) {
      return { ok: false, error: 'Uso: anima budget status <id>' };
    }
    return { ok: true, command: { kind: 'budget-status', id: rest[0], json } };
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
    if (sub === 'supervise' || sub === 'unsupervise') {
      if (!id || rest.length !== 1 || reason !== null) return { ok:false, error:`Uso: anima work ${sub} <id>` };
      return {ok:true,command:{kind:sub === 'supervise' ? 'work-supervise' : 'work-unsupervise',id,json}};
    }
    if (sub === 'show') {
      if (!id) return { ok: false, error: 'Uso: anima work show <id>' };
      return { ok: true, command: { kind: 'work-show', id, json } };
    }
    if (sub === 'evidence') {
      if (!id) return { ok: false, error: 'Uso: anima work evidence <id>' };
      return { ok: true, command: { kind: 'work-evidence', id, json } };
    }
    if (sub === 'executors') {
      if (!id || rest.length !== 1 || reason !== null) return { ok: false, error: 'Uso: anima work executors <id> [--json]' };
      return { ok: true, command: { kind: 'work-executors', id, json } };
    }
    if (sub === 'request-changes') {
      if (!id) return { ok: false, error: 'Uso: anima work request-changes <id> --reason "..."' };
      if (reason === null || reason.trim().length === 0) return { ok: false, error: 'request-changes exige --reason "<pedido>" não vazio.' };
      return { ok: true, command: { kind: 'work-request-changes', id, reason: reason.trim(), json } };
    }
    if (sub === 'correct') {
      if (!id) return { ok: false, error: 'Uso: anima work correct <id>' };
      return { ok: true, command: { kind: 'work-correct', id, requiredGates, json } };
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
    if (sub === 'resolve-pending') {
      const usage = 'Uso: anima work resolve-pending <id> request-changes --reason "..." | anima work resolve-pending <id> cancel [--reason "..."]';
      const action = rest[1];
      if (!id || rest.length !== 2 || (action !== 'request-changes' && action !== 'cancel')) return { ok: false, error: usage };
      if (reason !== null && reason.trim().length === 0) return { ok: false, error: '--reason não pode ser vazio.' };
      if (action === 'request-changes' && reason === null) return { ok: false, error: 'resolve-pending request-changes exige --reason "<pedido>" não vazio.' };
      return { ok: true, command: { kind: 'work-resolve-pending', id, decision: action === 'cancel' ? 'cancel' : 'request_changes', reason: reason === null ? null : reason.trim(), json } };
    }
    if (sub === 'prepare-autonomous') {
      if (!id || rest.length !== 1 || reason !== null) return { ok: false, error: 'Uso: anima work prepare-autonomous <id>' };
      return { ok: true, command: { kind: 'work-prepare-autonomous', id, json } };
    }
    if (sub === 'authorize-compute') {
      const usage = 'Uso: anima work authorize-compute <id> --max-usd <US$> --max-minutes <min> --valid-hours <h>';
      if (!id || rest.length !== 1 || reason !== null) return { ok: false, error: usage };
      const maxCostUsd = boundedNumber(limits.maxUsd, COMPUTE_AUTHORITY_LIMIT_BOUNDS.maxUsd);
      const maxMinutes = boundedNumber(limits.maxMinutes, COMPUTE_AUTHORITY_LIMIT_BOUNDS.maxMinutes);
      const validHours = boundedNumber(limits.validHours, COMPUTE_AUTHORITY_LIMIT_BOUNDS.validHours);
      if (maxCostUsd === null || maxMinutes === null || validHours === null) {
        return { ok: false, error: `${usage} — os três limites são obrigatórios (US$ 0,01–50; 1–240 min; 0,1–24 h).` };
      }
      return { ok: true, command: { kind: 'work-authorize-compute', id, maxCostUsd, maxMinutes, validHours, json } };
    }
    if (sub === 'set-compute') {
      // Preferência de compute da UNIDADE: NÃO carrega dinheiro (limites de authority são
      // recusados acima) e é validada pela mesma régua do RPC.
      const usage = 'Uso: anima work set-compute <id> --strategy provider_api --provider openai --model <modelo> | --strategy router_default';
      if (!id || rest.length !== 1 || reason !== null) return { ok: false, error: usage };
      const preference = parseComputePreference(compute.strategy === 'router_default'
        ? (compute.provider === null && compute.model === null ? { schemaVersion: 1, strategy: 'router_default' } : null)
        : { schemaVersion: 1, strategy: compute.strategy, provider: compute.provider, model: compute.model });
      if (!preference) return { ok: false, error: `${usage} — provider suportado: openai; modelo [A-Za-z0-9._:-].` };
      return { ok: true, command: { kind: 'work-set-compute', id, preference, json } };
    }
    if (sub === 'recover-harness') {
      const usage = 'Uso: anima work recover-harness <id> --fix <commit> [--fix <commit>] --evidence docs/registros/<registro>.md --reason "<motivo>"';
      if (!id || rest.length !== 1 || fixes.length === 0 || fixes.some(f => !f.trim()) || !evidence?.trim() || !reason?.trim()) {
        return { ok: false, error: usage };
      }
      return { ok: true, command: { kind: 'work-recover-harness', id, fixCommits: fixes, evidenceReference: evidence.trim(), reason: reason.trim(), json } };
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
  anima recovery-config check                 Prontidão da configuração recuperável (read-only, sem valores, sem rede)
  anima toolchain check                       Prontidão do toolchain (read-only; só comandos --version; nunca instala)
  anima budget status <id>                    Orçamento autônomo atual (somente leitura)
  anima work list                             Lista os trabalhos não terminais (retomáveis)
  anima work show <id>                        Estado, versão, tentativa, Verifier e cobertura
  anima work evidence <id>                    Critérios de aceite, provas e lacunas (Verifier)
  anima work executors <id>                   Executores de coding: prontos, elegíveis e recomendação (read-only; não escolhe nem inicia)
  anima work request-changes <id> --reason "" Registra REQUEST_CHANGES pelo fluxo canônico
  anima work correct <id> [--require-gate C]   Materializa o sucessor de correção (proposed); gates extras exigidos pela revisão
  anima work replan <id> [--diagnosis arquivo] Replaneja unidade mínima; sem diagnóstico, replay persistido
  anima work authorize-resume <id> [--plan f]  Autoridade humana: +1 tentativa após saldo esgotado (sucessor proposed)
  anima work supervise <id>                    Inicia/renova supervisão humana por 30 minutos
  anima work unsupervise <id>                  Revoga a supervisão humana vigente
  anima work approve <id>                     Aprova uma PROPOSTA (proposed → approved)
  anima work accept <id>                       Aceita o RESULTADO em review (review → completed)
  anima work withdraw <id> --reason "..."      Retira um plano APROVADO não iniciado (approved → cancelled)
  anima work resolve-pending <id> request-changes --reason "..." | cancel [--reason "..."]
                                               Encerra um resultado CANDIDATO retido pelo Verifier obrigatório (nunca verifica nem libera review)
  anima work retry <id>                        Solicita o retry governado de um item failed/RETRY_READY
  anima work prepare-autonomous <id>           Prepara a elegibilidade autônoma (classificação) de um plano aprovado
  anima work authorize-compute <id> --max-usd N --max-minutes M --valid-hours H
                                               Autoridade humana paga p/ uma unidade que o Router pôs em espera
  anima work set-compute <id> --strategy provider_api --provider openai --model M
                                               Preferência de compute da unidade (NÃO autoriza gasto)
  anima work recover-harness <id> --fix C --evidence docs/registros/R.md --reason "..."
                                               Recuperação após defeito de HARNESS corrigido: 1 sucessor proposed (sem aprovar/pagar)
  anima work set-compute <id> --strategy router_default
                                               Volta a unidade ao Router padrão (local-first)
  anima help                                  Esta ajuda

Flags:
  --json           Saída estável em JSON (para automação/self-dev)
  --reason "..."   Texto do pedido de correção (request-changes)
  --diagnosis f    Arquivo JSON do diagnóstico (work replan)
  --plan f         Arquivo JSON da autorização humana de retomada (work authorize-resume)
  --max-usd N      Teto de custo da authority paga (work authorize-compute)
  --max-minutes M  Duração máxima de compute (≥ o que o Router pede por volta)
  --valid-hours H  Janela de validade da authority
  --strategy S     provider_api | router_default (work set-compute)
  --provider P     Provider da preferência provider_api (openai)
  --model M        Modelo da preferência provider_api (ex.: gpt-5.6-sol)

Códigos de saída: 0 sucesso · 1 erro operacional · 2 uso inválido · 3 ação recusada por regra`;
