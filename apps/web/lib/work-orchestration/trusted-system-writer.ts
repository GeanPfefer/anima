import { createGoTrueIdentityProvider } from '../resident-host/ports';
import { createBearerClient } from '../supabase/bearer';
import { coderEvidenceSinkFor, type CoderEvidenceSink } from './coder-evidence';
import { gateEvidenceSinkFor, type GateEvidenceSink } from './gate-evidence';
import { hostEvidenceSinkFor, type HostEvidenceSink } from './host-evidence';
import { supabaseIntegrationReceiptPersistence, type PersistIntegrationReceipt } from './integration-effect';
import { verifierOpinionSinkFor, type VerifierOpinionSink } from './verifier-opinion';

// ============================================================
// Trusted System Writer V0 (2026-09-28) — `author=system` é FRONTEIRA DE CONFIANÇA.
//
// Única porta server-side para persistir fatos que significam "o Anima observou/produziu
// isto como sistema": evidência git, de gate e do coder observada pelo host, parecer do
// Verifier e receipt de integração. As RPCs correspondentes só executam para o papel
// Postgres `anima_system_writer` (migração 20260928000003) — a sessão humana é recusada.
//
// Identidade: um usuário GoTrue DEDICADO (não o residente, nunca o humano), cujo
// `auth.users.role` = `anima_system_writer`. O GoTrue emite esse papel no JWT e o PostgREST
// faz SET ROLE para ele. Sem service_role (decisão ratificada do runtime), sem PKI, sem
// auth nova: reusa `createGoTrueIdentityProvider` + `createBearerClient`.
//
// Este módulo NÃO exporta cliente algum: só os cinco sinks estreitos. Credenciais vêm
// exclusivamente do ambiente do SERVIDOR (`ANIMA_SYSTEM_WRITER_EMAIL`/`_PASSWORD`, nunca
// NEXT_PUBLIC); nenhuma função aceita credencial do chamador. Sem configuração, todo sink
// falha fechado (`trusted_system_writer_unavailable`): nenhum fato de sistema é gravado —
// no lane com Verifier obrigatório, o candidato fica retido.
// ============================================================

export interface TrustedSystemWriter {
  readonly available: boolean;
  readonly hostEvidence: HostEvidenceSink;
  readonly gateEvidence: GateEvidenceSink;
  readonly coderEvidence: CoderEvidenceSink;
  readonly verifierOpinion: VerifierOpinionSink;
  readonly integrationReceipt: PersistIntegrationReceipt;
}

export const TRUSTED_SYSTEM_WRITER_UNAVAILABLE = 'trusted_system_writer_unavailable';

type WriterIdentity = () => Promise<{ readonly accessToken: string } | null>;
type WriterClient = ReturnType<typeof createBearerClient>;

/** Compõe os sinks sobre uma identidade de writer. Um cliente por operação (token renovado). */
export function createTrustedSystemWriter(
  identity: WriterIdentity,
  clientFor: (accessToken: string) => WriterClient = createBearerClient,
): TrustedSystemWriter {
  const withClient = async <T>(unavailable: T, use: (client: WriterClient) => Promise<T>): Promise<T> => {
    const session = await identity().catch(() => null);
    if (!session) return unavailable;
    return use(clientFor(session.accessToken));
  };
  const down = { ok: false as const, message: TRUSTED_SYSTEM_WRITER_UNAVAILABLE };
  return {
    available: true,
    hostEvidence: { record: (evidence) => withClient(down, (c) => hostEvidenceSinkFor(c).record(evidence)) },
    gateEvidence: { record: (evidence) => withClient(down, (c) => gateEvidenceSinkFor(c).record(evidence)) },
    coderEvidence: { record: (evidence) => withClient(down, (c) => coderEvidenceSinkFor(c).record(evidence)) },
    verifierOpinion: { record: (opinion) => withClient(down, (c) => verifierOpinionSinkFor(c).record(opinion)) },
    integrationReceipt: async (auth, receipt) => {
      const session = await identity().catch(() => null);
      if (!session) throw new Error(TRUSTED_SYSTEM_WRITER_UNAVAILABLE);
      return supabaseIntegrationReceiptPersistence(clientFor(session.accessToken))(auth, receipt);
    },
  };
}

/** Writer ausente: todo sink recusa. Nunca cai para a sessão humana. */
export const UNAVAILABLE_TRUSTED_SYSTEM_WRITER: TrustedSystemWriter = {
  ...createTrustedSystemWriter(async () => null),
  available: false,
};

/**
 * Writer a partir do ambiente do SERVIDOR. Ausente/incompleto ⇒ writer indisponível
 * (fail-closed). Nunca lê variáveis `NEXT_PUBLIC_*` para credencial.
 */
export function trustedSystemWriterFromEnvironment(env: NodeJS.ProcessEnv = process.env): TrustedSystemWriter {
  const email = env.ANIMA_SYSTEM_WRITER_EMAIL?.trim();
  const password = env.ANIMA_SYSTEM_WRITER_PASSWORD;
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!email || !password || !supabaseUrl || !anonKey) return UNAVAILABLE_TRUSTED_SYSTEM_WRITER;
  // A identidade do writer precisa ser DISTINTA da residente/humana.
  if (email.toLowerCase() === env.ANIMA_RESIDENT_EMAIL?.trim().toLowerCase()) return UNAVAILABLE_TRUSTED_SYSTEM_WRITER;
  return createTrustedSystemWriter(createGoTrueIdentityProvider({ supabaseUrl, anonKey, email, password }));
}

let processWriter: TrustedSystemWriter | null = null;
/** Writer do processo (sessão GoTrue cacheada e renovada pelo provider). */
export function defaultTrustedSystemWriter(): TrustedSystemWriter {
  processWriter ??= trustedSystemWriterFromEnvironment();
  return processWriter;
}
