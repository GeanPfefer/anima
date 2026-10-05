import {
  deriveResumeCorrectionSuccessor,
  classifyCumulativeCorrectionFiles,
  validateStructuredReworkPaths,
  projectHostObservedEvidence,
  type RootAuthorityScope,
  type RecoverySuccessorCandidate,
  type RecoverySuccessorGap,
  type ResumeCorrectionRefusal,
  type WorkEvent,
  type WorkItem,
} from '@anima/core';
import { safeValidationCommand } from '@/lib/ai/project-work-planner-shared';
import { parseGateCommand } from './worktree';
import type { Database, Json } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { uuidFromSeed } from './decomposition-orchestration';
import { proposeCorrectionSuccessor } from './recovery-successor';
import { createWorkOrchestrationService } from './server';
import { worktreeBranchFor } from './worktree-executor';

// ============================================================
// Ligação de produção da CORREÇÃO GOVERNADA POR RETOMADA. Fecha a lacuna entre o
// primitive puro (deriveResumeCorrectionSuccessor → validateCorrectionSuccessor →
// proposeCorrectionSuccessor) e o estado real: dado um work item em
// `changes_requested` cuja revisão pede um complemento que cabe no escopo AINDA
// NÃO tocado, monta os fatos DETERMINÍSTICOS já persistidos — o pedido da revisão
// e o checkpoint git observado da tentativa REVISADA (base, commit, arquivos
// preservados) — e materializa, idempotente, a menor unidade sucessora `proposed`
// que RETOMA do checkpoint reduzindo o escopo ao restante, ligada por lineage.
//
// NÃO aprova, classifica, executa nem amplia autoridade. Desfecho máximo:
// `proposed` (a validação de envelope roda em proposeCorrectionSuccessor).
// Fail-closed em toda lacuna. A DECISÃO é PURA (`planCorrectionFromReview`,
// testável sem banco); a cola de I/O (`correctReviewedWorkItem`) só busca e persiste.
// ============================================================

export type ReviewCorrectionBlock =
  | 'item_unavailable'
  | 'events_unavailable'
  | 'review_request_missing'
  | 'reviewed_result_missing'
  | 'checkpoint_evidence_missing'
  | 'lineage_read_failed'
  | 'derivation_refused'
  | 'candidate_invalid'
  | 'persistence_failed';

export interface ReviewCorrectionFacts {
  readonly rootAuthority?: RootAuthorityScope;
  readonly reworkPaths?: readonly string[];
  readonly original: WorkItem;
  readonly events: readonly WorkEvent[];
  /** Sequências de lineage já existentes para o original (append-only). */
  readonly existingRecoverySequences: readonly number[];
  /** Sequência não terminal já materializada. Quando existe, a operação deve
   * replayar essa unidade em vez de criar uma concorrente. */
  readonly activeRecoverySequence?: number;
  /** Gates ADICIONAIS exigidos pelo humano no ato de correção (só acrescentam prova). */
  readonly additionalValidations?: readonly { readonly label: string; readonly command: string }[];
}

/** Gate exigido na revisão: precisa caber na allowlist de validação do planner E na do
 * executor de gates. Fora dela ⇒ recusa (nunca vira comando arbitrário). */
export function requiredReviewGate(command: string): { readonly label: string; readonly command: string } | null {
  const trimmed = command.trim();
  if (!safeValidationCommand(trimmed) || !parseGateCommand(trimmed)) return null;
  return { label: `Gate exigido pela revisão: ${trimmed}`, command: trimmed };
}

export type ReviewCorrectionPlanResult =
  | { readonly ok: true; readonly candidate: RecoverySuccessorCandidate; readonly recoverySequence: number; readonly idempotencyKey: string }
  | { readonly ok: false; readonly reason: ReviewCorrectionBlock; readonly refusals?: readonly ResumeCorrectionRefusal[] };

const asObject = (value: Json | undefined): Record<string, Json | undefined> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, Json | undefined> : null;
const dataOf = (event: WorkEvent): Record<string, Json | undefined> | null => {
  const root = asObject(event.payload);
  return root ? asObject(root['data']) : null;
};
const readString = (record: Record<string, Json | undefined> | null, key: string): string =>
  typeof record?.[key] === 'string' ? record[key] as string : '';

const REWORK_DIRECTIVE = /\b(?:corrija|corrigir|retrabalh(?:e|ar)|alter(?:e|ar)|modifi(?:que|car)|reescrev(?:a|er)|ajust(?:e|ar)|atualiz(?:e|ar))\b/i;
const PRESERVATION_DIRECTIVE = /\b(?:preserv(?:e|ar)|mantenh(?:a|er)|não\s+(?:altere|modifique|reescreva|retrabalhe)|está\s+corret[oa]|continua\s+corret[oa]|atende)\b/i;

/** Extrai somente paths explicitamente nomeados em uma CLÁUSULA que realmente
 * autoriza retrabalho. O restante da correção vem de evidência estruturada
 * (`includedScope - observedChangedFiles`); texto livre só pode REABRIR um arquivo
 * do checkpoint quando contém uma diretiva positiva e inequívoca. Mera menção,
 * descrição do estado atual ou diretiva de preservação não concede escrita.
 * Basename é aceito apenas quando identifica uma única entrada do escopo. */
export function deriveExplicitReworkScope(requestedChanges: string, approvedScope: readonly string[]): readonly string[] {
  const basenameCounts = new Map<string, number>();
  for (const path of approvedScope) {
    const basename = path.toLowerCase().replace(/\\/g, '/').split('/').at(-1) ?? '';
    basenameCounts.set(basename, (basenameCounts.get(basename) ?? 0) + 1);
  }
  const clauses = requestedChanges
    .replace(/\\/g, '/')
    // Ponto dentro de path (`levels.test.ts`) não é separador. Um ponto só
    // encerra cláusula quando é seguido por espaço/fim; `;`, quebra e
    // adversativas sempre separam intenções potencialmente distintas.
    .split(/(?:[;!?\n]+|\.(?=\s|$)|\b(?:mas|porém|contudo|entretanto)\b)/i)
    .map(value => value.trim())
    .filter(Boolean);
  const explicitlyReworked = new Set<string>();
  for (const clause of clauses) {
    if (!REWORK_DIRECTIVE.test(clause) || PRESERVATION_DIRECTIVE.test(clause)) continue;
    const normalizedClause = clause.toLowerCase();
    for (const path of approvedScope) {
      const normalized = path.toLowerCase().replace(/\\/g, '/');
      const basename = normalized.split('/').at(-1) ?? '';
      if (normalizedClause.includes(normalized)
          || (basename.length > 0 && basenameCounts.get(basename) === 1 && normalizedClause.includes(basename))) {
        explicitlyReworked.add(normalized);
      }
    }
  }
  return approvedScope.filter(path => explicitlyReworked.has(path.toLowerCase().replace(/\\/g, '/')));
}

/**
 * PURA e fail-closed. Deriva o candidato de correção por retomada a partir dos
 * fatos observados: o pedido da última revisão + o checkpoint git da tentativa
 * REVISADA (correlacionado pelo `reviewed_result_event_id` → `attempt_id`). Não
 * toca o banco.
 */
export function planCorrectionFromReview(facts: ReviewCorrectionFacts): ReviewCorrectionPlanResult {
  const { original, events } = facts;
  if (original.state !== 'changes_requested') return { ok: false, reason: 'item_unavailable' };

  // Última revisão solicitada: o pedido do humano + qual resultado foi revisado.
  const review = [...events].reverse().find(event => event.type === 'changes_requested');
  const reviewData = review ? dataOf(review) : null;
  const requestedChanges = readString(reviewData, 'requested_changes');
  const reviewedResultEventId = readString(reviewData, 'reviewed_result_event_id');
  if (!requestedChanges.trim() || !reviewedResultEventId) return { ok: false, reason: 'review_request_missing' };

  // A tentativa cujo resultado foi revisado — âncora do checkpoint a retomar.
  const reviewedResult = events.find(event => event.id === reviewedResultEventId);
  const reviewedAttemptId = reviewedResult ? readString(dataOf(reviewedResult), 'attempt_id') : '';
  if (!reviewedAttemptId) return { ok: false, reason: 'reviewed_result_missing' };

  // Checkpoint durável observado pelo host DA tentativa revisada (nunca de outra).
  const gitEvidence = projectHostObservedEvidence(events);
  if (!gitEvidence || gitEvidence.attemptId !== reviewedAttemptId) return { ok: false, reason: 'checkpoint_evidence_missing' };

  const recoverySequence = facts.activeRecoverySequence
    ?? facts.existingRecoverySequences.reduce((max, value) => Math.max(max, value), 0) + 1;
  // A primeira sequência mantém compatibilidade com a chave já publicada. Após
  // um successor terminal, cada nova unidade governada recebe chave própria;
  // enquanto estiver ativa, o mesmo número replaya estritamente a mesma linha.
  const keySeed = `review-correction:${original.id.toLowerCase()}:${gitEvidence.observedCommitSha.toLowerCase()}`
    + (recoverySequence === 1 ? '' : `:${recoverySequence}`);
  const idempotencyKey = uuidFromSeed(keySeed);

  const structured = facts.reworkPaths === undefined ? undefined
    : validateStructuredReworkPaths(facts.reworkPaths, original.proposal.data.includedScope, original.proposal.data.excludedScope, facts.rootAuthority);
  if (structured && !structured.ok) return { ok: false, reason: 'derivation_refused', refusals: structured.refusals };

  const correctionScope = asObject(asObject(original.intent['execution_spec'] as Json | undefined)?.['correction_scope']);
  const classified = classifyCumulativeCorrectionFiles({
    observedChangedFiles: gitEvidence.observedChangedFiles,
    includedScope: original.proposal.data.includedScope,
    excludedScope: original.proposal.data.excludedScope,
    reopenedFiles: structured?.ok ? structured.reopenedFiles ?? [] : [],
    rootAuthority: facts.rootAuthority,
    isCorrectionHop: correctionScope !== null,
  });
  if (classified.unexplained.length) return { ok: false, reason: 'derivation_refused', refusals: ['preserved_files_out_of_scope'] };
  const derivation = deriveResumeCorrectionSuccessor({
    original,
    requestedChanges,
    checkpoint: { baseSha: gitEvidence.baseSha, branch: worktreeBranchFor(reviewedAttemptId), commitSha: gitEvidence.observedCommitSha },
    preservedFiles: classified.preserved,
    inheritedPreservedFiles: classified.inherited,
    reworkFiles: structured?.ok ? structured.reworkFiles : deriveExplicitReworkScope(requestedChanges, original.proposal.data.includedScope),
    ...(structured?.ok && structured.reopenedFiles?.length ? { reopenedFiles: structured.reopenedFiles } : {}),
    ...(structured ? { reworkSource: 'structured' as const } : {}),
    recoverySequence,
    idempotencyKey,
    ...(facts.additionalValidations?.length ? { additionalValidations: facts.additionalValidations } : {}),
  });
  if (!derivation.ok) return { ok: false, reason: 'derivation_refused', refusals: derivation.refusals };
  return { ok: true, candidate: derivation.candidate, recoverySequence, idempotencyKey };
}

/** Leitura injetável: erros devem rejeitar a promise; null significa ausência de linha/item. */
export interface CorrectionRootAuthorityPort {
  readonly readPredecessor: (successorWorkItemId: string) => Promise<string | null>;
  readonly readItem: (workItemId: string) => Promise<WorkItem | null>;
}

/** Só percorre corrections, no máximo 16 hops; toda incerteza fecha a reabertura. */
export async function resolveCorrectionRootAuthority(
  current: WorkItem, port: CorrectionRootAuthorityPort,
): Promise<RootAuthorityScope | null> {
  const visited = new Set<string>();
  let item = current;
  let depth = 0;
  try {
    for (;;) {
      const id = item.id.toLowerCase();
      if (visited.has(id)) return null;
      visited.add(id);
      const predecessor = await port.readPredecessor(item.id);
      if (predecessor === null) return {
        includedScope: item.proposal.data.includedScope,
        excludedScope: item.proposal.data.excludedScope,
      };
      if (++depth > 16) return null;
      const spec = asObject(item.intent['execution_spec'] as Json | undefined);
      if (!asObject(spec?.['correction_scope'])) return null;
      const parent = await port.readItem(predecessor);
      if (!parent || parent.id.toLowerCase() !== predecessor.toLowerCase()) return null;
      item = parent;
    }
  } catch {
    return null;
  }
}

export type ReviewCorrectionResult =
  | { readonly ok: true; readonly successorWorkItemId: string; readonly lineageId: string; readonly recoverySequence: number; readonly replayed: boolean }
  | { readonly ok: false; readonly reason: ReviewCorrectionBlock; readonly refusals?: readonly ResumeCorrectionRefusal[]; readonly gaps?: readonly RecoverySuccessorGap[]; readonly message?: string };

/**
 * Materializa (ou replaya) a correção governada por retomada de um item em
 * `changes_requested`. Chamável por um usuário autenticado (RLS): lê apenas as
 * próprias linhas; a RPC recarimba proveniência. Puro efeito local.
 */
export async function correctReviewedWorkItem(
  client: SupabaseClient<Database>,
  workItemId: string,
  options: { readonly requiredGates?: readonly string[]; readonly reworkPaths?: readonly string[] } = {},
): Promise<ReviewCorrectionResult> {
  const additionalValidations = (options.requiredGates ?? []).map(requiredReviewGate);
  if (additionalValidations.some(gate => gate === null)) {
    return { ok: false, reason: 'derivation_refused', refusals: ['additional_validation_invalid'], message: 'Gate exigido fora da allowlist de validação (npm test | npm run typecheck | npm run build, com --workspace opcional).' };
  }
  const service = createWorkOrchestrationService(client);
  const [itemResult, eventsResult] = await Promise.all([
    service.getItem(workItemId),
    service.listEvents(workItemId),
  ]);
  if (!itemResult.ok || itemResult.value.state !== 'changes_requested') return { ok: false, reason: 'item_unavailable' };
  if (!eventsResult.ok) return { ok: false, reason: 'events_unavailable' };

  const lineage = await client
    .from('work_recovery_lineage')
    .select('recovery_sequence,successor_work_item_id')
    .eq('original_work_item_id', workItemId);
  if (lineage.error) return { ok: false, reason: 'lineage_read_failed', message: lineage.error.message };
  const existingRecoverySequences = (lineage.data ?? []).map(row => row.recovery_sequence ?? 0);
  const successorIds = (lineage.data ?? []).map(row => row.successor_work_item_id);
  let activeRecoverySequence: number | undefined;
  if (successorIds.length > 0) {
    const successors = await client.from('work_items').select('id,state').in('id', successorIds);
    if (successors.error) return { ok: false, reason: 'lineage_read_failed', message: successors.error.message };
    const activeStates = new Set(['proposed', 'approved', 'in_progress', 'blocked', 'review', 'changes_requested']);
    activeRecoverySequence = (lineage.data ?? [])
      .filter(row => successors.data?.some(item => item.id === row.successor_work_item_id && activeStates.has(item.state)))
      .reduce<number | undefined>((max, row) => max === undefined || row.recovery_sequence > max ? row.recovery_sequence : max, undefined);
  }

  const pathKey = (value: string): string => value.trim().toLowerCase().replace(/\\/g, '/');
  const currentScope = new Set(itemResult.value.proposal.data.includedScope.map(pathKey));
  let rootAuthority: RootAuthorityScope | undefined;
  const observedChangedFiles = projectHostObservedEvidence(eventsResult.value)?.observedChangedFiles;
  if (observedChangedFiles?.some(path => !currentScope.has(pathKey(path))) || options.reworkPaths?.some(path => !currentScope.has(pathKey(path.trim().replace(/\\/g, '/').replace(/^\.\//, ''))))) {
    rootAuthority = await resolveCorrectionRootAuthority(itemResult.value, {
      readPredecessor: async id => {
        const result = await client.from('work_recovery_lineage').select('original_work_item_id')
          .eq('successor_work_item_id', id).maybeSingle();
        if (result.error) throw new Error(result.error.message);
        return result.data?.original_work_item_id ?? null;
      },
      readItem: async id => {
        const result = await service.getItem(id);
        if (!result.ok) throw new Error('item_unavailable');
        return result.value;
      },
    }) ?? undefined;
  }

  const planned = planCorrectionFromReview({
    ...(rootAuthority ? { rootAuthority } : {}),
    ...(options.reworkPaths !== undefined ? { reworkPaths: options.reworkPaths } : {}),
    original: itemResult.value,
    events: eventsResult.value,
    existingRecoverySequences,
    activeRecoverySequence,
    additionalValidations: additionalValidations as readonly { label: string; command: string }[],
  });
  if (!planned.ok) return { ok: false, reason: planned.reason, refusals: planned.refusals };

  const persisted = await proposeCorrectionSuccessor(client, itemResult.value, planned.candidate, { rootAuthority, observedChangedFiles });
  if (!persisted.ok) {
    if (persisted.code === 'candidate_invalid') return { ok: false, reason: 'candidate_invalid', gaps: persisted.gaps };
    return { ok: false, reason: 'persistence_failed', message: persisted.message };
  }
  return {
    ok: true,
    successorWorkItemId: persisted.successorWorkItemId,
    lineageId: persisted.lineageId,
    recoverySequence: persisted.recoverySequence,
    replayed: persisted.replayed,
  };
}
