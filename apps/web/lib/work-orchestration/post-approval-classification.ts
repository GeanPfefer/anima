import { deriveWorkClaimStatus, readCanonicalProvenanceFromIntent, type AutonomousQueueCandidate } from '@anima/core';
import { isInvestigationPreparationEnvelope } from './investigation-preparation';
import { ensurePlannedProjectClassification } from './planned-project-classification';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface PostApprovalClassificationConfig { readonly since: Date }
export type PostApprovalClassificationEnsure = (workItemId: string, proposalVersion: number) => ReturnType<typeof ensurePlannedProjectClassification>;

/** Fail-closed, timezone-bearing ISO timestamp; Date.parse alone accepts free text and rolled dates. */
export function readPostApprovalClassificationConfig(env: Readonly<Record<string, string | undefined>>): PostApprovalClassificationConfig | null {
  if (env.ANIMA_POST_APPROVAL_CLASSIFICATION !== '1') return null;
  const raw = env.ANIMA_POST_APPROVAL_CLASSIFICATION_SINCE;
  if (!raw) return null;
  const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$(?![\s\S])/.exec(raw);
  if (!match) return null;
  const calendar = new Date(`${match[1]}T00:00:00.000Z`);
  const since = new Date(raw);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== match[1] || !Number.isFinite(since.getTime())) return null;
  return { since };
}

export type PostApprovalSkipReason = 'state' | 'approval_absent' | 'approval_stale' | 'cutoff' | 'already_classified' | 'active_claim' | 'origin' | 'attempted' | 'max_items';
interface ItemVersion { readonly workItemId: string; readonly proposalVersion: number }
export interface PostApprovalClassificationSummary {
  readonly classified: ItemVersion[];
  readonly replayed: ItemVersion[];
  readonly skipped: (ItemVersion & { readonly reason: PostApprovalSkipReason })[];
  readonly failed: (ItemVersion & { readonly reason: 'ensure_rejected' | 'ensure_threw' })[];
}

/** Only recognizes T3 origins. Envelope policy and idempotent persistence remain in ensure. */
export async function classifyApprovedUnclassified(
  candidates: readonly AutonomousQueueCandidate[],
  options: { readonly since: Date; readonly maxItems?: number; readonly attempted: Set<string>; readonly now?: Date } & (
    { readonly ensure: PostApprovalClassificationEnsure; readonly client?: never }
    | { readonly ensure?: never; readonly client: SupabaseClient<Database> }
  ),
): Promise<PostApprovalClassificationSummary> {
  const summary: PostApprovalClassificationSummary = { classified: [], replayed: [], skipped: [], failed: [] };
  const now = options.now ?? new Date();
  const ensure = options.ensure !== undefined ? options.ensure : ensurePlannedProjectClassification.bind(null, options.client);
  const maxItems = Math.max(0, Math.floor(options.maxItems ?? 3));
  let calls = 0;
  const ordered = [...candidates].sort((a, b) => (a.approval?.seq ?? 0) - (b.approval?.seq ?? 0) || a.item.id.localeCompare(b.item.id));
  for (const candidate of ordered) {
    const { item, approval, currentClassification, openClaim } = candidate;
    const pair = { workItemId: item.id, proposalVersion: item.proposalVersion };
    const key = JSON.stringify([item.id, item.proposalVersion]);
    let reason: PostApprovalSkipReason | null = null;
    if (item.state !== 'approved') reason = 'state';
    else if (approval === null) reason = 'approval_absent';
    else if (approval.proposalVersion !== item.proposalVersion) reason = 'approval_stale';
    else if (!(approval.approvedAt.getTime() > options.since.getTime())) reason = 'cutoff';
    else if (currentClassification !== null) reason = 'already_classified';
    else if (openClaim !== null && deriveWorkClaimStatus(openClaim, now) === 'active') reason = 'active_claim';
    else if (readCanonicalProvenanceFromIntent(item.intent) === null && !isInvestigationPreparationEnvelope(item.intent)) reason = 'origin';
    else if (options.attempted.has(key)) reason = 'attempted';
    else if (calls >= maxItems || !Number.isFinite(maxItems)) reason = 'max_items';
    if (reason !== null) { summary.skipped.push({ ...pair, reason }); continue; }
    calls++;
    // Mark before awaiting: even duplicate snapshots cannot retry a failed pair in this turn.
    options.attempted.add(key);
    try {
      const result = await ensure(item.id, item.proposalVersion);
      if (result.ok) (result.replayed ? summary.replayed : summary.classified).push(pair);
      else summary.failed.push({ ...pair, reason: 'ensure_rejected' });
    } catch {
      summary.failed.push({ ...pair, reason: 'ensure_threw' });
    }
  }
  return summary;
}
