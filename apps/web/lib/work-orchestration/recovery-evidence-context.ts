import type { RecoveryEvidenceContextV1, RecoveryEvidenceItemV1, WorkContextReference } from '@anima/core';
import type { Database, Json } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sanitizeDiff, summarizeCommandOutput } from './output-sanitization';

const MAX_ANCESTORS = 8;
const MAX_ITEMS = 4;
const MAX_FAILURE_CHARS = 700;
const MAX_PATCH_CHARS = 1_200;
const MAX_PATCH_LINES = 24;

const object = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const strings = (value: unknown): readonly string[] => Array.isArray(value)
  ? value.filter((entry): entry is string => typeof entry === 'string') : [];

export interface PersistedCoderEvidenceRow {
  readonly eventId: string;
  readonly workItemId: string;
  readonly payload: Json;
  readonly createdAt: string;
}

export interface RecoveryEvidenceStore {
  parentOf(successorWorkItemId: string): Promise<string | null>;
  evidenceFor(workItemIds: readonly string[]): Promise<readonly PersistedCoderEvidenceRow[]>;
}

interface Observation {
  readonly round: number;
  readonly editRevision: number;
  readonly command: string;
  readonly kind: string;
  readonly outcome: string;
  readonly stdout: string;
  readonly stderr: string;
}

const observations = (payload: Json): { attemptId: string; entries: readonly Record<string, unknown>[]; commands: readonly Observation[] } | null => {
  const root = object(payload); const data = object(root?.data); const evidence = object(data?.evidence);
  const transcript = Array.isArray(evidence?.transcripts) ? object(evidence.transcripts[0]) : null;
  const attemptId = typeof data?.attempt_id === 'string' ? data.attempt_id : '';
  if (!transcript || !attemptId) return null;
  const commands = (Array.isArray(transcript.commandObservations) ? transcript.commandObservations : [])
    .map(object).filter((entry): entry is Record<string, unknown> => entry !== null)
    .map(entry => ({
      round: typeof entry.round === 'number' ? entry.round : -1,
      editRevision: typeof entry.editRevision === 'number' ? entry.editRevision : -1,
      command: typeof entry.command === 'string' ? entry.command : '',
      kind: typeof entry.kind === 'string' ? entry.kind : '',
      outcome: typeof entry.outcome === 'string' ? entry.outcome : '',
      stdout: typeof entry.stdout === 'string' ? entry.stdout : '',
      stderr: typeof entry.stderr === 'string' ? entry.stderr : '',
    }));
  const entries = (Array.isArray(transcript.entries) ? transcript.entries : [])
    .map(object).filter((entry): entry is Record<string, unknown> => entry !== null);
  return { attemptId, entries, commands };
};

const refsFor = (row: PersistedCoderEvidenceRow, attemptId: string): readonly WorkContextReference[] => [
  { kind: 'work_item', id: row.workItemId },
  { kind: 'attempt', id: attemptId },
  { kind: 'work_event', id: row.eventId },
];

/** Deriva apenas fatos observados pelo host: comandos, saídas sanitizadas, edits aplicados
 * e diff observado. Respostas textuais/raciocínio do provider nunca são lidos. */
export function deriveRecoveryEvidenceContext(input: {
  readonly rows: readonly PersistedCoderEvidenceRow[];
  readonly relevantCommands: readonly string[];
  readonly includedScope: readonly string[];
}): RecoveryEvidenceContextV1 | null {
  const relevant = new Set(input.relevantCommands);
  const scope = new Set(input.includedScope.map(path => path.replace(/\\/g, '/')));
  const candidates: RecoveryEvidenceItemV1[] = [];
  for (const row of input.rows) {
    const parsed = observations(row.payload); if (!parsed) continue;

    for (let passIndex = 0; passIndex < parsed.commands.length; passIndex += 1) {
      const pass = parsed.commands[passIndex]!;
      if (pass.kind !== 'test' || pass.outcome !== 'exit0' || !relevant.has(pass.command)) continue;
      const failure = parsed.commands.slice(0, passIndex).reverse()
        .find(candidate => candidate.command === pass.command
          && candidate.outcome === 'exit_nonzero'
          && candidate.editRevision >= 0
          && pass.editRevision > candidate.editRevision);
      if (!failure) continue;
      const changedFiles = [...new Set(parsed.entries
        .filter(entry => entry.phase === 'application'
          && entry.result === 'applied'
          && typeof entry.path === 'string'
          && typeof entry.round === 'number'
          && entry.round > failure.round
          && entry.round <= pass.round)
        .map(entry => String(entry.path).replace(/\\/g, '/')).filter(path => scope.has(path)))];
      if (changedFiles.length === 0) continue;
      const observedFailure = summarizeCommandOutput(failure.stdout, failure.stderr, {
        maxChars: MAX_FAILURE_CHARS, maxLines: 8, dropFooters: true, redactPaths: true,
      });
      if (!observedFailure) continue;
      const diff = parsed.commands.slice(passIndex + 1).find(candidate => candidate.kind === 'git_diff' && candidate.stdout);
      const patch = diff ? sanitizeDiff(diff.stdout, MAX_PATCH_CHARS, MAX_PATCH_LINES).text.trim() : '';
      const references = refsFor(row, parsed.attemptId);
      candidates.push({
        sourceWorkItemId: row.workItemId, sourceAttemptId: parsed.attemptId, sourceEventId: row.eventId,
        failedCommand: failure.command, observedFailure,
        provenCorrection: { passedCommand: pass.command, changedFiles, ...(patch ? { patchExcerpt: patch } : {}) },
        references,
      });
    }
  }
  if (candidates.length === 0) return null;
  const items = candidates.slice(0, MAX_ITEMS);
  const references = items.flatMap(item => item.references)
    .filter((ref, index, all) => all.findIndex(other => other.kind === ref.kind && other.id === ref.id) === index);
  return { schemaVersion: 1, items, truncated: candidates.length > MAX_ITEMS, references };
}

/** Reconstitui a lineage a cada volta: restart não depende de memória de processo. */
export async function loadRecoveryEvidenceContextFromStore(
  store: RecoveryEvidenceStore,
  input: { readonly workItemId: string; readonly relevantCommands: readonly string[]; readonly includedScope: readonly string[] },
): Promise<RecoveryEvidenceContextV1 | null> {
  const ancestors: string[] = [];
  let cursor = input.workItemId;
  for (let depth = 0; depth < MAX_ANCESTORS; depth += 1) {
    const parent = await store.parentOf(cursor);
    if (!parent || ancestors.includes(parent)) break;
    ancestors.push(parent); cursor = parent;
  }
  if (ancestors.length === 0) return null;
  return deriveRecoveryEvidenceContext({
    rows: await store.evidenceFor(ancestors),
    relevantCommands: input.relevantCommands, includedScope: input.includedScope,
  });
}

export async function loadRecoveryEvidenceContext(
  client: SupabaseClient<Database>,
  input: { readonly workItemId: string; readonly relevantCommands: readonly string[]; readonly includedScope: readonly string[] },
): Promise<RecoveryEvidenceContextV1 | null> {
  const store: RecoveryEvidenceStore = {
    parentOf: async successorWorkItemId => {
      const lineage = await client.from('work_recovery_lineage').select('original_work_item_id')
        .eq('successor_work_item_id', successorWorkItemId).maybeSingle();
      if (lineage.error) throw new Error(`recovery_evidence_lineage_read_failed:${lineage.error.message}`);
      return lineage.data?.original_work_item_id ?? null;
    },
    evidenceFor: async workItemIds => {
      const events = await client.from('work_events').select('id,work_item_id,payload,created_at')
        .in('work_item_id', [...workItemIds]).eq('event_type', 'host_observed_coder_evidence_recorded')
        .order('created_at', { ascending: false });
      if (events.error) throw new Error(`recovery_evidence_event_read_failed:${events.error.message}`);
      return (events.data ?? []).map(row => ({ eventId: row.id, workItemId: row.work_item_id, payload: row.payload, createdAt: row.created_at }));
    },
  };
  return loadRecoveryEvidenceContextFromStore(store, input);
}
