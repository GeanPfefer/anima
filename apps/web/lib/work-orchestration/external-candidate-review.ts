import { createHash } from 'node:crypto';
import {
  EXTERNAL_CRITERION_REVIEW_KIND, evaluateExternalReviewGate, evaluateVerifierRequirement, findExternalPhysicalConflicts, humanReviewCriteria,
  isExternalWorkEnvelope, parseExternalCriterionReview, projectLatestWorkResult, readExternalCandidate,
  type ExternalCandidateFacts, type ExternalCriterionReviewV1, type ExternalItemSnapshot, type ExternalOpenClaim, type ExternalPhysicalConflict,
  type WorkEvent, type WorkItem, type WorkOrchestrationService,
} from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readExecutionContract } from './executor-selection';
import { verifyExternalTargetForContract } from './external-target-resolver';
import { createTrustedGitRunner, type GitRunner } from './trusted-git';

// ============================================================
// Revisão e aceite de CANDIDATO EXTERNO (Project Builder V0 — T4).
//
// `inspectExternalCandidate` é somente leitura: reverifica a identidade do repositório autorizado (T1), confirma que o parecer do
// Verifier é `verified` e correlacionado, que o commit candidato é o observado pelo host, que a branch da attempt o resolve, que a base
// é ancestral e que o diff real `base..candidato` fica dentro do escopo autorizado; recusa se houver execução em curso no MESMO
// repositório físico (qualquer referência). Devolve o diff e o digest dele.
// `recordExternalCriterionReview` grava a decisão HUMANA de UM critério `human_review`, ligada ao candidato e ao digest do diff.
// `externalAcceptanceRefusal` é o gate do aceite do resultado (CLI e rota web): sem revisão `accept` de cada critério pendente
// para ESTE candidato, o aceite é recusado. Nada aqui integra, publica, aceita ou escreve no repositório externo.
// ============================================================

export const EXTERNAL_DIFF_DISPLAY_MAX = 60_000;

export interface ExternalReviewDeps {
  readonly service: Pick<WorkOrchestrationService, 'getItem' | 'listEvents' | 'attachContext'>;
  readonly userId: string;
  readonly now: () => Date;
  /** Reverificação de identidade do target (T1); exige ANIMA_EXTERNAL_TARGET com a referência do item. */
  readonly verifyTarget: typeof verifyExternalTargetForContract;
  readonly gitFor: (gitDir: string) => GitRunner;
  readonly physical: {
    readonly listItems: () => Promise<readonly ExternalItemSnapshot[]>;
    readonly listOpenClaims: () => Promise<readonly ExternalOpenClaim[]>;
  };
  readonly messages: {
    readonly insert: (content: string) => Promise<string | null>;
    readonly load: (ids: readonly string[]) => Promise<readonly { readonly id: string; readonly userId: string; readonly content: string }[]>;
  };
}

export type ExternalReviewFailure = { readonly ok: false; readonly code: string; readonly message: string; readonly rejected: boolean };
const fail = (code: string, message: string, rejected = true): ExternalReviewFailure => ({ ok: false, code, message, rejected });

export interface ExternalCandidateInspection {
  readonly ok: true;
  readonly item: WorkItem;
  readonly facts: ExternalCandidateFacts;
  readonly repoRoot: string;
  readonly diff: { readonly sha256: string; readonly text: string; readonly truncated: boolean; readonly files: readonly string[] };
  readonly criteria: readonly { readonly position: number; readonly text: string; readonly status: 'pending' | 'accepted' | 'rejected' }[];
  readonly retainedConflicts: readonly ExternalPhysicalConflict[];
  readonly reviews: readonly ExternalCriterionReviewV1[];
}

const under = (path: string, scope: string): boolean => { const s = scope.replace(/\/+$/, ''); return path === s || path.startsWith(`${s}/`); };

async function load(deps: ExternalReviewDeps, workItemId: string): Promise<{ ok: true; item: WorkItem; events: readonly WorkEvent[] } | ExternalReviewFailure> {
  const item = await deps.service.getItem(workItemId as never);
  if (!item.ok) return fail('work_item_unavailable', item.error.message, false);
  const events = await deps.service.listEvents(workItemId as never);
  if (!events.ok) return fail('work_events_unavailable', events.error.message, false);
  return { ok: true, item: item.value, events: events.value };
}

/** Revisões persistidas (mensagens do OPERADOR dono do item, referenciadas por `context_attached`), em ordem cronológica. */
export async function loadExternalReviews(item: WorkItem, events: readonly WorkEvent[], deps: ExternalReviewDeps): Promise<readonly ExternalCriterionReviewV1[]> {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.type !== 'context_attached') continue;
    const refs = ((event.payload as { data?: { context_references?: unknown } } | null)?.data?.context_references);
    if (Array.isArray(refs)) for (const r of refs as Array<{ kind?: unknown; id?: unknown }>) if (r?.kind === 'message' && typeof r.id === 'string') ids.add(r.id);
  }
  if (ids.size === 0) return [];
  const rows = await deps.messages.load([...ids]);
  const reviews: ExternalCriterionReviewV1[] = [];
  for (const row of rows) {
    let parsed: unknown;
    try { parsed = JSON.parse(row.content); } catch { continue; }
    const review = parseExternalCriterionReview(parsed);
    // Autoria: a mensagem pertence ao operador dono do item e o registro declara o mesmo operador.
    if (review && review.workItemId === item.id && row.userId === deps.userId && review.reviewerUserId === row.userId) reviews.push(review);
  }
  return reviews.sort((a, b) => Date.parse(a.reviewedAt) - Date.parse(b.reviewedAt));
}

export async function inspectExternalCandidate(workItemId: string, deps: ExternalReviewDeps): Promise<ExternalCandidateInspection | ExternalReviewFailure> {
  const loaded = await load(deps, workItemId);
  if (!loaded.ok) return loaded;
  const { item, events } = loaded;
  if (!isExternalWorkEnvelope(item.intent)) return fail('not_external_work', 'Este comando só revisa trabalho externo materializado por `work external propose`.');
  if (item.state !== 'review') return fail('not_in_review', `O item está em "${item.state}", não em "review": não há candidato a revisar.`);

  const latest = projectLatestWorkResult(events);
  const verifier = evaluateVerifierRequirement(item, events, latest?.eventId);
  if (!verifier.satisfied) return fail('verifier_not_verified', `O parecer do Verifier não é "verified" correlacionado a este resultado (${'reason' in verifier ? verifier.reason : 'ausente'}).`);

  const candidate = readExternalCandidate(item, events);
  if (!candidate.ok) return fail(candidate.reason, `Candidato externo ilegível: ${candidate.reason}.`);
  const { facts } = candidate;

  // Identidade do repositório autorizado × repositório vivo (T1). Sem fallback para a raiz do Anima.
  const verified = await deps.verifyTarget(readExecutionContract(item.intent));
  if (!verified.ok) return fail(verified.code, verified.message);

  // Exclusividade FÍSICA: o banco serializa por referência; aqui vale o repositório, seja qual for a referência.
  const conflicts = findExternalPhysicalConflicts({ itemId: item.id, identity: verified.identity }, await deps.physical.listItems(), await deps.physical.listOpenClaims(), deps.now());
  const running = conflicts.filter(c => c.kind === 'running');
  if (running.length) return fail('external_physical_conflict_running', `Há execução em curso no mesmo repositório físico (${running.map(c => `${c.reference}:${c.workItemId}`).join(', ')}).`);

  const git = deps.gitFor(verified.identity.gitCommonDirCanonical);
  if (!/^anima-work\/[A-Za-z0-9-]+$/.test(facts.branch)) return fail('candidate_branch_invalid', 'A branch do candidato não pertence ao namespace de trabalho do Anima.');
  const tip = await git(['rev-parse', '--verify', `refs/heads/${facts.branch}^{commit}`]);
  if (tip.exitCode !== 0 || tip.stdout.trim() !== facts.candidateCommitSha) return fail('candidate_branch_mismatch', 'A branch da attempt não resolve para o commit candidato registrado.');
  const base = await git(['rev-parse', '--verify', `${facts.baseSha}^{commit}`]);
  if (base.exitCode !== 0 || base.stdout.trim() !== facts.baseSha) return fail('base_sha_missing', 'O SHA-base autorizado não existe no repositório externo.');
  const ancestor = await git(['merge-base', '--is-ancestor', facts.baseSha, facts.candidateCommitSha]);
  if (ancestor.exitCode !== 0) return fail('candidate_not_descendant_of_base', 'O commit candidato não descende do SHA-base autorizado.');

  const names = await git(['diff', '--no-ext-diff', '--no-textconv', '--name-only', facts.baseSha, facts.candidateCommitSha]);
  if (names.exitCode !== 0) return fail('diff_unreadable', 'Não foi possível ler o diff real do candidato.', false);
  const files = names.stdout.split('\n').map(l => l.trim()).filter(Boolean).sort();
  const declared = [...facts.changedFiles].sort();
  if (files.length === 0 || files.join('\n') !== declared.join('\n')) return fail('candidate_diff_mismatch', 'Os arquivos do diff real divergem dos registrados no handoff/evidência do host.');
  const included = item.proposal.data.includedScope, excluded = item.proposal.data.excludedScope;
  const outside = files.filter(f => !included.some(s => under(f, s)) || excluded.some(s => under(f, s)));
  if (outside.length) return fail('candidate_outside_authorized_scope', `O diff real toca arquivos fora do escopo autorizado: ${outside.join(', ')}.`);

  const diff = await git(['diff', '--no-ext-diff', '--no-textconv', '--no-color', facts.baseSha, facts.candidateCommitSha]);
  if (diff.exitCode !== 0) return fail('diff_unreadable', 'Não foi possível ler o diff real do candidato.', false);
  const sha256 = createHash('sha256').update(diff.stdout, 'utf8').digest('hex');

  const reviews = await loadExternalReviews(item, events, deps);
  const criteria = humanReviewCriteria(item).map(c => {
    const decisive = reviews.filter(r => r.criterion === c.text && r.candidateCommitSha === facts.candidateCommitSha && r.attemptId === facts.attemptId
      && r.resultEventId === facts.resultEventId && r.baseSha === facts.baseSha && r.reference === facts.reference && r.approvedProposalVersion === facts.approvedProposalVersion).at(-1);
    return { position: c.position, text: c.text, status: (!decisive ? 'pending' : decisive.decision === 'accept' ? 'accepted' : 'rejected') as 'pending' | 'accepted' | 'rejected' };
  });
  return {
    ok: true, item, facts, repoRoot: verified.repoRoot,
    diff: { sha256, text: diff.stdout.length > EXTERNAL_DIFF_DISPLAY_MAX ? diff.stdout.slice(0, EXTERNAL_DIFF_DISPLAY_MAX) : diff.stdout, truncated: diff.stdout.length > EXTERNAL_DIFF_DISPLAY_MAX, files },
    criteria, retainedConflicts: conflicts.filter(c => c.kind === 'retained'), reviews,
  };
}

export type RecordExternalReviewResult =
  | { readonly ok: true; readonly facts: ExternalCandidateFacts; readonly criterion: string; readonly decision: 'accept' | 'reject'; readonly remaining: readonly string[]; readonly messageId: string }
  | ExternalReviewFailure;

/** Registra a decisão humana de UM critério `human_review`, ligada ao candidato e ao digest do diff que o operador viu. */
export async function recordExternalCriterionReview(
  workItemId: string,
  input: { readonly position: number; readonly decision: 'accept' | 'reject'; readonly diffDigest: string; readonly reason?: string },
  deps: ExternalReviewDeps,
): Promise<RecordExternalReviewResult> {
  if (input.decision !== 'accept' && input.decision !== 'reject') return fail('decision_invalid', 'A decisão precisa ser accept ou reject.');
  if (!/^[0-9a-f]{64}$/.test(input.diffDigest)) return fail('diff_digest_invalid', 'Informe o digest sha256 do diff exibido pela revisão.');
  const inspected = await inspectExternalCandidate(workItemId, deps);
  if (!inspected.ok) return inspected;
  const criterion = inspected.criteria.find(c => c.position === input.position);
  if (!criterion) return fail('criterion_not_human_review', `O critério ${input.position} não é um critério de revisão humana deste contrato.`);
  if (input.diffDigest !== inspected.diff.sha256) return fail('diff_digest_mismatch', 'O digest informado não corresponde ao diff real atual do candidato; releia a revisão.');
  const record: ExternalCriterionReviewV1 = {
    schemaVersion: 1, kind: EXTERNAL_CRITERION_REVIEW_KIND, workItemId, approvedProposalVersion: inspected.facts.approvedProposalVersion,
    attemptId: inspected.facts.attemptId, resultEventId: inspected.facts.resultEventId, candidateCommitSha: inspected.facts.candidateCommitSha, baseSha: inspected.facts.baseSha,
    reference: inspected.facts.reference, criterion: criterion.text, decision: input.decision, diffSha256: inspected.diff.sha256, reviewerUserId: deps.userId,
    reviewedAt: deps.now().toISOString(), ...(input.reason ? { reason: input.reason.slice(0, 1000) } : {}),
  };
  if (!parseExternalCriterionReview(record)) return fail('review_record_invalid', 'O registro de revisão montado é inválido.');
  const messageId = await deps.messages.insert(JSON.stringify(record));
  if (!messageId) return fail('review_persist_failed', 'Falha ao persistir a mensagem do operador com a revisão.', false);

  // Mesma persistência do contexto do item: novo snapshot = referências anteriores + a nova mensagem.
  const events = await deps.service.listEvents(workItemId as never);
  if (!events.ok) return fail('work_events_unavailable', events.error.message, false);
  const previous = new Map<string, { kind: string; id: string }>();
  for (const event of events.value) {
    if (event.type !== 'context_attached') continue;
    const refs = ((event.payload as { data?: { context_references?: unknown } } | null)?.data?.context_references);
    if (Array.isArray(refs)) for (const r of refs as Array<{ kind?: unknown; id?: unknown }>) if (typeof r?.kind === 'string' && typeof r.id === 'string') previous.set(`${r.kind}:${r.id}`, { kind: r.kind, id: r.id });
  }
  previous.set(`message:${messageId}`, { kind: 'message', id: messageId });
  const attached = await deps.service.attachContext({ workItemId: workItemId as never, expectedProposalVersion: inspected.item.proposalVersion as never, references: [...previous.values()] });
  if (!attached.ok) return fail('review_attach_failed', `${attached.error.code}: ${attached.error.message}; mensagem órfã possível: ${messageId}.`, false);

  const remaining = inspected.criteria.filter(c => c.position !== input.position && c.status !== 'accepted').map(c => c.text);
  return { ok: true, facts: inspected.facts, criterion: criterion.text, decision: input.decision, remaining: input.decision === 'accept' ? remaining : [criterion.text, ...remaining], messageId };
}

export interface ExternalAcceptanceRefusal { readonly code: string; readonly message: string }

/**
 * Gate do aceite do resultado (`review → completed`). Só atua em trabalho EXTERNO com critério `human_review`; o fluxo interno do
 * Anima e os externos sem revisão humana passam intactos. Não acessa o repositório externo: o vínculo é pelo commit candidato.
 */
export async function externalAcceptanceRefusal(workItemId: string, deps: Pick<ExternalReviewDeps, 'service' | 'userId' | 'messages'>): Promise<ExternalAcceptanceRefusal | null> {
  const item = await deps.service.getItem(workItemId as never);
  if (!item.ok) return { code: 'work_item_unavailable', message: item.error.message };
  if (!isExternalWorkEnvelope(item.value.intent) || humanReviewCriteria(item.value).length === 0) return null;
  const events = await deps.service.listEvents(workItemId as never);
  if (!events.ok) return { code: 'work_events_unavailable', message: events.error.message };
  const reviews = await loadExternalReviews(item.value, events.value, { ...deps, now: () => new Date() } as ExternalReviewDeps);
  const gate = evaluateExternalReviewGate(item.value, events.value, reviews);
  if (gate.ok) return null;
  const list = gate.criteria.join(' | ');
  return gate.reason === 'external_human_review_rejected'
    ? { code: gate.reason, message: `A revisão humana REJEITOU o critério: ${list}. O aceite está bloqueado; use "request-changes".` }
    : gate.reason === 'external_human_review_missing'
      ? { code: gate.reason, message: `Falta a revisão humana, para ESTE candidato, de: ${list}. Rode "work external review ${workItemId} --version N" e registre a decisão.` }
      : { code: gate.reason, message: `O candidato externo não pôde ser lido para o aceite (${gate.detail ?? 'sem detalhe'}).` };
}

// ─── Portas reais (Supabase user-scoped, RLS) ─────────────────────────────────

export function createExternalReviewDeps(
  client: SupabaseClient<Database>, userId: string, service: ExternalReviewDeps['service'],
  options: { readonly env?: Readonly<Record<string, string | undefined>>; readonly now?: () => Date } = {},
): ExternalReviewDeps {
  const env = options.env ?? process.env;
  return {
    service, userId, now: options.now ?? (() => new Date()),
    verifyTarget: (contract, e = env, d) => verifyExternalTargetForContract(contract, e, d),
    gitFor: gitDir => createTrustedGitRunner({ gitDir }),
    physical: {
      listItems: async () => {
        const rows: ExternalItemSnapshot[] = [];
        for (let from = 0; ; from += 1000) {
          const page = await client.from('work_items').select('id,state,intent').range(from, from + 999);
          if (page.error) throw new Error(page.error.message);
          for (const r of page.data ?? []) rows.push({ id: r.id, state: r.state, intent: r.intent });
          if ((page.data ?? []).length < 1000) return rows;
        }
      },
      listOpenClaims: async () => {
        const res = await client.from('work_claims').select('work_item_id,expires_at').is('released_at', null);
        if (res.error) throw new Error(res.error.message);
        return (res.data ?? []).map(c => ({ workItemId: c.work_item_id, expiresAt: c.expires_at }));
      },
    },
    messages: {
      insert: async content => {
        const { data, error } = await client.from('ai_conversations').insert({ user_id: userId, role: 'user', content }).select('id').single();
        return error || !data ? null : data.id;
      },
      load: async ids => {
        const { data, error } = await client.from('ai_conversations').select('id,user_id,content').in('id', [...ids]);
        if (error) throw new Error(error.message);
        return (data ?? []).map(r => ({ id: r.id, userId: r.user_id, content: r.content }));
      },
    },
  };
}
