import type { MandateRecordView, WorkEvent } from '@anima/core';
import { mapWorkEvent } from '@anima/supabase';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  acceptUnderMandate,
  type AcceptanceReads,
  type AcceptUnderMandateOutcome,
  type GitRunner,
  type SinkResult,
} from './acceptance-mandate';
import { createTrustedGitRunner, resolveTrustedRepository, type TrustedRepository } from './trusted-git';
import type { TrustedSystemWriter } from './trusted-system-writer';

// ============================================================
// Composição OPERACIONAL do aceite sob mandato (A2-0, R2): leitura do ledger → Git confiável → Trusted System Writer.
//
//   LEITURA  — cliente da sessão do operador (RLS de dono). A leitura só ALIMENTA a pré-checagem e escolhe o commit a
//              inspecionar; quem decide é a RPC, que recalcula tudo e cruza o relatório com a evidência observada pelo host.
//              Um leitor que minta só consegue fazer o Git inspecionar o commit errado — e o banco recusa a divergência.
//   GIT      — `createTrustedGitRunner`: ambiente construído do zero, `--git-dir` explícito e confiável, sem replace/hooks.
//   ESCRITA  — SOMENTE `writer.mandatedAcceptance` (identidade `anima_system_writer`). Nunca o cliente de leitura.
//
// Este processo NÃO é o do runner: recusa-se a rodar com `ANIMA_EXECUTION_*` herdado (marca de filho do launcher) e com
// segredos do grantor no ambiente. Credenciais do grantor e do writer nunca se encontram no runner nem se misturam aqui.
// ============================================================

type Db = SupabaseClient<Database>;
const MAX_EVENTS = 5000;

export interface LedgerReader {
  read(workItemId: string, mandateId: string): Promise<SinkResult<AcceptanceReads>>;
}


/** Leitor sobre o cliente do operador. Qualquer lacuna (linha ausente, truncamento, item divergente) falha fechado. */
export const supabaseLedgerReader = (client: Db): LedgerReader => ({
  read: async (workItemId, mandateId) => {
    const itemRes = await client.from('work_items').select('id, state, proposal_version, impact_level, intent').eq('id', workItemId).maybeSingle();
    if (itemRes.error) return { ok: false, message: `item_read_failed: ${itemRes.error.message}` };
    if (!itemRes.data) return { ok: false, message: 'item_not_found' };
    const mandateRes = await client.from('work_acceptance_mandates').select('*').eq('id', mandateId).maybeSingle();
    if (mandateRes.error) return { ok: false, message: `mandate_read_failed: ${mandateRes.error.message}` };
    if (!mandateRes.data) return { ok: false, message: 'mandate_not_found' };
    if (mandateRes.data.work_item_id !== workItemId) return { ok: false, message: 'mandate_belongs_to_another_item' };
    const eventsRes = await client.from('work_events').select('*').eq('work_item_id', workItemId).order('seq', { ascending: true }).limit(MAX_EVENTS);
    if (eventsRes.error) return { ok: false, message: `events_read_failed: ${eventsRes.error.message}` };
    if (!eventsRes.data || eventsRes.data.length === 0 || eventsRes.data.length >= MAX_EVENTS) return { ok: false, message: 'events_unavailable_or_truncated' };
    const m = mandateRes.data;
    const mandate: MandateRecordView = {
      id: m.id, workItemId: m.work_item_id, proposalVersion: m.proposal_version, contractSha256: m.contract_sha256, baseSha: m.base_sha,
      scopeFiles: m.scope_files, notBefore: m.not_before, expiresAt: m.expires_at, allowedActions: m.allowed_actions, policyVersion: m.policy_version,
      revokedAt: m.revoked_at, consumedAt: m.consumed_at, grantedEventSeq: Number(m.granted_event_seq),
    };
    return { ok: true, value: {
      item: { state: String(itemRes.data.state), proposalVersion: Number(itemRes.data.proposal_version), impactLevel: String(itemRes.data.impact_level), intent: itemRes.data.intent },
      events: eventsRes.data.map(mapWorkEvent), mandate,
    } };
  },
});

/** Resultado corrente = último `result_submitted` do ledger (a RPC reconfere que é o mais recente). */
export const latestResultEventId = (events: readonly WorkEvent[]): string | null =>
  [...events].filter(e => e.type === 'result_submitted').sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)).at(-1)?.id ?? null;

// ---- CLI (lógica testável) ---------------------------------------------------------------------------------------
export const ACCEPT_EXIT = { OK: 0, USAGE: 2, REFUSED: 3, FAILED: 4 } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const ACCEPT_USAGE = 'anima accept-mandated <item-uuid> --mandate <mandate-uuid> --repo <caminho-absoluto-do-repositório-confiável> [--result <result-event-uuid>]';

export interface AcceptMandatedCliDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly writer: TrustedSystemWriter;
  readonly resolveReader: () => Promise<LedgerReader | null>;
  readonly runGitFor?: (gitDir: string) => GitRunner;
  readonly resolveRepository?: (repoRoot: string | undefined) => TrustedRepository;
  readonly now?: () => Date;
  readonly write: (line: string) => void;
}

/** O processo do aceite não pode ser filho do runner nem reunir a identidade do grantor. */
export function checkAcceptEnvironment(env: Readonly<Record<string, string | undefined>>): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (Object.keys(env).some(k => /^ANIMA_EXECUTION_/.test(k) && env[k])) return { ok: false, reason: 'runs_inside_runner_environment' };
  if (Object.keys(env).some(k => /^ANIMA_MANDATE_GRANTOR_(PASSWORD|TOKEN|ACCESS_TOKEN)/i.test(k) && env[k])) return { ok: false, reason: 'grantor_secret_in_acceptance_process' };
  return { ok: true };
}

function parseFlags(argv: readonly string[]): { positional: string[]; flags: Map<string, string> } {
  const positional: string[] = []; const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) { const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) flags.set(a, ''); else { flags.set(a, v); i++; } }
    else positional.push(a);
  }
  return { positional, flags };
}

export async function runAcceptMandatedCli(argv: readonly string[], deps: AcceptMandatedCliDeps): Promise<number> {
  const out = (value: Record<string, unknown>) => deps.write(JSON.stringify(value));
  const { positional, flags } = parseFlags(argv);
  const [itemId] = positional;
  const mandateId = flags.get('--mandate');
  const requestedResult = flags.get('--result');
  if (!itemId || !UUID.test(itemId) || !mandateId || !UUID.test(mandateId) || (requestedResult !== undefined && !UUID.test(requestedResult))) {
    out({ ok: false, error: 'usage', usage: ACCEPT_USAGE }); return ACCEPT_EXIT.USAGE;
  }
  const env = checkAcceptEnvironment(deps.env);
  if (!env.ok) { out({ ok: false, error: env.reason }); return ACCEPT_EXIT.REFUSED; }
  // Falha cedo e SEM efeito: sem writer não há por que ler, inspecionar Git ou preparar relatório.
  if (!deps.writer.available) { out({ ok: false, error: 'trusted_system_writer_unavailable' }); return ACCEPT_EXIT.REFUSED; }
  const repo = (deps.resolveRepository ?? resolveTrustedRepository)(flags.get('--repo') ?? deps.env.ANIMA_TRUSTED_REPO_ROOT);
  if (!repo.ok) { out({ ok: false, error: repo.reason }); return ACCEPT_EXIT.REFUSED; }
  const reader = await deps.resolveReader().catch(() => null);
  if (!reader) { out({ ok: false, error: 'ledger_reader_unavailable' }); return ACCEPT_EXIT.FAILED; }

  const first = await reader.read(itemId, mandateId).catch((e: unknown) => ({ ok: false as const, message: e instanceof Error ? e.message : String(e) }));
  if (!first.ok) { out({ ok: false, stage: 'read', reason: first.message }); return ACCEPT_EXIT.FAILED; }
  const resultId = requestedResult ?? latestResultEventId(first.value.events);
  if (!resultId) { out({ ok: false, stage: 'precheck', reason: 'no_submitted_result' }); return ACCEPT_EXIT.REFUSED; }

  const outcome: AcceptUnderMandateOutcome = await acceptUnderMandate({
    read: async () => first, // mesma fotografia para a pré-checagem e para a escolha do commit; a RPC relê tudo no banco
    runGit: (deps.runGitFor ?? ((gitDir: string) => createTrustedGitRunner({ gitDir, parentEnv: deps.env as NodeJS.ProcessEnv })))(repo.gitDir),
    sink: deps.writer.mandatedAcceptance,
    now: deps.now,
  }, { workItemId: itemId, mandateId, reviewedResultEventId: resultId });

  if (!outcome.ok) {
    out({ ok: false, command: 'accept-mandated', stage: outcome.stage, defects: outcome.defects ?? null, reason: outcome.reason ?? null });
    return outcome.stage === 'read' || outcome.stage === 'persist' ? ACCEPT_EXIT.FAILED : ACCEPT_EXIT.REFUSED;
  }
  out({ ok: true, command: 'accept-mandated', action: outcome.action, eventSeq: outcome.eventSeq, workItemId: itemId, mandateId, resultEventId: resultId });
  return ACCEPT_EXIT.OK;
}
