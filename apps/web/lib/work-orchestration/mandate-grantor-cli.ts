import { randomUUID } from 'node:crypto';
import type { AcceptanceMandateGrantRequestV1 } from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { grantAcceptanceMandate, mandateGrantorSinkFor } from './acceptance-mandate';

// ============================================================
// CLI do GRANTOR (lógica testável). Comandos: preview | grant | revoke.
//
// Separação de identidades:
//   - a senha do grantor é digitada num prompt OCULTO, nunca vem do ambiente, nunca é impressa nem gravada;
//   - o e-mail do grantor precisa ser DIFERENTE do residente e do Trusted System Writer;
//   - este processo NÃO deve ser iniciado com o `.env.local` do runner (o ponto de entrada documenta `--env-file` próprio
//     com apenas URL/anon key públicas + e-mail do grantor).
// Saída: uma linha JSON por comando, sem segredos.
// ============================================================

export const EXIT = { OK: 0, USAGE: 2, REFUSED: 3, FAILED: 4 } as const;

export interface MandateCliDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly promptHidden: (label: string) => Promise<string>;
  readonly signIn: (input: { readonly email: string; readonly password: string }) => Promise<{ readonly accessToken: string } | null>;
  readonly clientFor: (accessToken: string) => SupabaseClient<Database>;
  readonly now?: () => Date;
  readonly uuid?: () => string;
  readonly write: (line: string) => void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const flagsOf = (argv: readonly string[]): { positional: string[]; flags: Map<string, string> } => {
  const positional: string[] = []; const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) { const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) flags.set(a, ''); else { flags.set(a, v); i++; } }
    else positional.push(a);
  }
  return { positional, flags };
};

export const MANDATE_USAGE = [
  'anima mandate preview <item-uuid>',
  'anima mandate grant <item-uuid> --version <N> --hash <sha256> --base <sha1> --scope <a.ts,b.ts> --not-before <ISO> --expires <ISO> [--request-id <uuid>]',
  'anima mandate revoke <mandate-uuid> --reason "<texto>"',
].join('\n');

/** Valida o ambiente do grantor (puro): senha fora do ambiente, e-mail dedicado. */
export function checkGrantorEnvironment(env: Readonly<Record<string, string | undefined>>): { readonly ok: true; readonly email: string } | { readonly ok: false; readonly reason: string } {
  if (Object.keys(env).some(k => /^ANIMA_MANDATE_GRANTOR_(PASSWORD|TOKEN|ACCESS_TOKEN)/i.test(k) && env[k])) return { ok: false, reason: 'grantor_secret_in_environment' };
  // Qualquer senha de runner/writer no ambiente deste processo derrota a separação de identidades (casamento genérico por chave).
  if (Object.keys(env).some(k => /^ANIMA_[A-Z0-9_]*PASSWORD$/.test(k) && k !== 'ANIMA_MANDATE_GRANTOR_PASSWORD' && env[k])) return { ok: false, reason: 'runner_credentials_present_in_grantor_process' };
  const email = env.ANIMA_MANDATE_GRANTOR_EMAIL?.trim();
  if (!email) return { ok: false, reason: 'grantor_email_missing' };
  const lower = email.toLowerCase();
  if (lower === env.ANIMA_RESIDENT_EMAIL?.trim().toLowerCase() || lower === env.ANIMA_SYSTEM_WRITER_EMAIL?.trim().toLowerCase()) return { ok: false, reason: 'grantor_must_be_dedicated_identity' };
  return { ok: true, email };
}

export async function runMandateCli(argv: readonly string[], deps: MandateCliDeps): Promise<number> {
  const out = (value: Record<string, unknown>) => deps.write(JSON.stringify(value));
  const { positional, flags } = flagsOf(argv);
  const [command, target] = positional;
  if (!command || !['preview', 'grant', 'revoke'].includes(command) || !target) { out({ ok: false, error: 'usage', usage: MANDATE_USAGE }); return EXIT.USAGE; }
  if (!UUID.test(target)) { out({ ok: false, error: 'target_must_be_uuid' }); return EXIT.USAGE; }
  const env = checkGrantorEnvironment(deps.env);
  if (!env.ok) { out({ ok: false, error: env.reason }); return EXIT.REFUSED; }

  // Parse e validação ANTES de pedir a senha (nada de prompt para um comando inválido).
  let request: AcceptanceMandateGrantRequestV1 | null = null;
  let reason = '';
  if (command === 'grant') {
    const version = Number(flags.get('--version')); const scope = (flags.get('--scope') ?? '').split(',').map(s => s.trim()).filter(Boolean);
    if (!Number.isInteger(version) || !flags.get('--hash') || !flags.get('--base') || scope.length === 0 || !flags.get('--not-before') || !flags.get('--expires')) {
      out({ ok: false, error: 'usage', usage: MANDATE_USAGE }); return EXIT.USAGE;
    }
    request = {
      workItemId: target, proposalVersion: version, contractSha256: flags.get('--hash')!, baseSha: flags.get('--base')!, scopeFiles: scope,
      notBefore: flags.get('--not-before')!, expiresAt: flags.get('--expires')!, requestId: flags.get('--request-id') ?? (deps.uuid ?? randomUUID)(),
    };
  }
  if (command === 'revoke') {
    reason = flags.get('--reason')?.trim() ?? '';
    if (!reason) { out({ ok: false, error: 'revoke_requires_reason' }); return EXIT.USAGE; }
  }

  const password = await deps.promptHidden('Senha do grantor (oculta): ');
  if (!password) { out({ ok: false, error: 'empty_password' }); return EXIT.REFUSED; }
  const session = await deps.signIn({ email: env.email, password }).catch(() => null);
  if (!session) { out({ ok: false, error: 'grantor_sign_in_failed' }); return EXIT.FAILED; }
  const sink = mandateGrantorSinkFor(deps.clientFor(session.accessToken));

  if (command === 'preview') {
    const r = await sink.preview(target).catch((e: unknown) => ({ ok: false as const, message: e instanceof Error ? e.message : String(e) }));
    if (!r.ok) { out({ ok: false, error: 'preview_failed', message: r.message }); return EXIT.FAILED; }
    out({ ok: true, command: 'preview', preview: r.value, eligible: r.value.blockers.length === 0 });
    return r.value.blockers.length === 0 ? EXIT.OK : EXIT.REFUSED;
  }
  if (command === 'grant') {
    const r = await grantAcceptanceMandate(sink, request!, deps.now ?? (() => new Date()));
    if (!r.ok) { out({ ok: false, command: 'grant', stage: r.stage, reason: r.reason, defect: r.defect ?? null }); return r.stage === 'persist' ? EXIT.FAILED : EXIT.REFUSED; }
    out({ ok: true, command: 'grant', action: r.action, mandateId: r.mandateId, eventSeq: r.eventSeq, requestId: request!.requestId });
    return EXIT.OK;
  }
  const r = await sink.revoke(target, reason).catch((e: unknown) => ({ ok: false as const, message: e instanceof Error ? e.message : String(e) }));
  if (!r.ok) { out({ ok: false, command: 'revoke', error: 'revoke_failed', message: r.message }); return EXIT.FAILED; }
  out({ ok: true, command: 'revoke', action: r.value.action, mandateId: r.value.mandateId });
  return EXIT.OK;
}
