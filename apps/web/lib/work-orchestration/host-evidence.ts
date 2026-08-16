import { buildHostObservedGitEvidence, type HostObservedEvidenceResult, type HostObservedGitEvidenceV1 } from '@anima/core';
import type { Database, Json } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runProcess } from './worktree';

// Produtor HOST-SIDE da evidência observada (independência real). Depois que o
// executor termina, a branch descartável `anima-work/<attemptId>` permanece no
// repositório (dispose preserva a branch). Este módulo INSPECIONA o Git dessa
// branch diretamente — commit, arquivos alterados vs a base, diff — sem confiar
// em nenhum campo do sinal do executor. O git é a fonte de verdade sobre o que
// foi commitado; um executor que minta no seu relato é contraditado por estes
// fatos.
//
// Escopo V0: só Git. Gates NÃO são reobservados aqui (a evidência marca
// coverage.gates=false); reobservá-los exigiria re-execução em sandbox (futuro).

const SHA = /^[a-f0-9]{40}$/;

export interface HostEvidenceObservationInput {
  readonly repoRoot: string;
  readonly baseSha: string;
  readonly branch: string;
  readonly workItemId: string;
  readonly attemptId: string;
  readonly approvedProposalVersion: number;
}

/** Executor de git injetável (facilita teste e isola o transporte). */
export type GitRunner = (args: readonly string[]) => Promise<{ readonly exitCode: number; readonly stdout: string }>;

const defaultGitRunner = (repoRoot: string): GitRunner => async (args) => {
  const result = await runProcess('git', ['-C', repoRoot, ...args], { cwd: repoRoot, timeoutMs: 30_000 }).catch(() => null);
  return result ? { exitCode: result.exitCode, stdout: result.stdout } : { exitCode: -1, stdout: '' };
};

const parseNameOnly = (stdout: string): string[] =>
  stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(path => path.replace(/\\/g, '/'));

const parseNumstat = (stdout: string): { path: string; insertions: number; deletions: number }[] => {
  const out: { path: string; insertions: number; deletions: number }[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('\t');
    if (parts.length < 3) continue;
    const [ins, del, ...rest] = parts;
    const path = rest.join('\t').replace(/\\/g, '/');
    const toCount = (value: string): number => (value === '-' ? -1 : (Number.isInteger(Number(value)) ? Number(value) : 0));
    out.push({ path, insertions: toCount(ins!), deletions: toCount(del!) });
  }
  return out;
};

/**
 * Observa independentemente, via git, os fatos da branch já persistida. Devolve a
 * evidência construída (fail-closed em base==commit, diff vazio etc.) ou um erro
 * tipado quando a branch não existe / o git está indisponível. Não tem efeito
 * colateral: só lê o git (`rev-parse`, `diff`), nunca escreve, faz commit ou push.
 */
export async function observeHostGitEvidence(
  input: HostEvidenceObservationInput,
  runGit: GitRunner = defaultGitRunner(input.repoRoot),
  now: () => Date = () => new Date(),
): Promise<HostObservedEvidenceResult> {
  if (!SHA.test(input.baseSha)) {
    return { ok: false, defect: 'invalid_git_reference', explanation: 'O SHA-base informado ao observador é inválido.' };
  }
  const head = await runGit(['rev-parse', '--verify', `${input.branch}^{commit}`]);
  const observedCommitSha = head.stdout.trim();
  if (head.exitCode !== 0 || !SHA.test(observedCommitSha)) {
    return { ok: false, defect: 'invalid_git_reference', explanation: 'A branch observada não existe ou não aponta um commit.' };
  }
  const range = `${input.baseSha}..${input.branch}`;
  const names = await runGit(['diff', '--name-only', range]);
  const numstat = await runGit(['diff', '--numstat', range]);
  if (names.exitCode !== 0 || numstat.exitCode !== 0) {
    return { ok: false, defect: 'invalid_diff', explanation: 'Não foi possível observar o diff da branch contra a base.' };
  }
  return buildHostObservedGitEvidence({
    workItemId: input.workItemId,
    attemptId: input.attemptId,
    approvedProposalVersion: input.approvedProposalVersion,
    baseSha: input.baseSha,
    observedCommitSha,
    observedChangedFiles: parseNameOnly(names.stdout),
    observedDiffFiles: parseNumstat(numstat.stdout),
    observedAt: now().toISOString(),
  });
}

// ============================================================
// Composição observe + persist (fecha o lado de escrita da cadeia)
// ============================================================
//
// O produtor (observeHostGitEvidence) só OBSERVA; a persistência mora atrás de
// uma porta injetada para manter o transporte (Supabase/RPC) fora da observação e
// testável sem banco. Uma execução persiste EXATAMENTE UMA evidência por
// tentativa: a idempotência real vive na RPC (mesmo git replaya, conteúdo
// divergente é conflito), então o produtor não precisa deduplicar.

/** Porta de persistência da evidência observada. O caller injeta a implementação
 * real (uma RPC); a composição não conhece o transporte nem o Supabase. */
export interface HostEvidenceSink {
  record(evidence: HostObservedGitEvidenceV1): Promise<
    | { readonly ok: true; readonly action: 'recorded' | 'replayed' }
    | { readonly ok: false; readonly message: string }
  >;
}

export type HostEvidenceOutcome =
  | { readonly ok: true; readonly action: 'recorded' | 'replayed'; readonly evidence: HostObservedGitEvidenceV1 }
  // `stage` distingue falha ao observar (git indisponível/branch ausente) de falha
  // ao persistir (RPC recusou). Ambas são NÃO-FATAIS para a volta do supervisor: a
  // ausência de evidência observada apenas faz o Verifier recair na atestação.
  | { readonly ok: false; readonly stage: 'observe' | 'persist'; readonly reason: string };

/**
 * Observa o git da branch persistida e, em sucesso, persiste a evidência pela
 * porta injetada. Fail-open por contrato: devolve um desfecho tipado, nunca lança;
 * o chamador (rota) trata qualquer `ok:false` como "sem evidência independente
 * nesta volta", jamais como erro que quebre a execução.
 */
export async function observeAndPersistHostGitEvidence(
  input: HostEvidenceObservationInput,
  sink: HostEvidenceSink,
  runGit?: GitRunner,
  now?: () => Date,
): Promise<HostEvidenceOutcome> {
  const observed = await observeHostGitEvidence(input, runGit, now);
  if (!observed.ok) return { ok: false, stage: 'observe', reason: observed.explanation };
  const persisted = await sink.record(observed.value).catch((error: unknown) =>
    ({ ok: false as const, message: error instanceof Error ? error.message : String(error) }));
  if (!persisted.ok) return { ok: false, stage: 'persist', reason: persisted.message };
  return { ok: true, action: persisted.action, evidence: observed.value };
}

/**
 * Sink real: persiste pela RPC `record_host_observed_evidence`. Os parâmetros
 * autoritativos vêm da PRÓPRIA evidência observada (nunca de um relato do
 * executor), e a RPC recarimba proveniência system/host e recorrelaciona contra a
 * tentativa real — o cliente não fabrica.
 */
export const hostEvidenceSinkFor = (client: SupabaseClient<Database>): HostEvidenceSink => ({
  record: async (evidence) => {
    const { data, error } = await client.rpc('record_host_observed_evidence', {
      work_item_id: evidence.workItemId,
      expected_proposal_version: evidence.approvedProposalVersion,
      attempt_id: evidence.attemptId,
      evidence: evidence as unknown as Json,
    });
    if (error) return { ok: false, message: error.message };
    const action = (data as { action?: string } | null)?.action === 'replayed' ? 'replayed' : 'recorded';
    return { ok: true, action };
  },
});
