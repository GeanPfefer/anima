import { readInvestigationProvenanceFromIntent } from './investigation-preparation';
import { readCanonicalProvenanceFromIntent } from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface WorkReferenceCandidate {
  readonly workItemId: string;
  readonly state: string;
  readonly proposalVersion: number;
  readonly createdAt: string;
  readonly intent: unknown;
}
export interface WorkReferenceLookup {
  findByCanonicalSourceId(ref: string): Promise<readonly WorkReferenceCandidate[]>;
}
export type WorkReferenceAmbiguousCandidate = Omit<WorkReferenceCandidate, 'intent'> & { readonly document: string };
export type WorkReferenceResult =
  | { readonly ok: true; readonly workItemId: string }
  | { readonly ok: false; readonly code: 'invalid_work_reference' }
  | { readonly ok: false; readonly code: 'work_reference_not_found' }
  | { readonly ok: false; readonly code: 'work_reference_ambiguous'; readonly candidates: readonly WorkReferenceAmbiguousCandidate[] };

export function readWorkHumanReference(intent: unknown): { reference: string; title: string } | null {
  const provenance = readCanonicalProvenanceFromIntent(intent);
  if (provenance) return { reference: provenance.sourceId, title: provenance.canonicalObjective };
  const investigation = readInvestigationProvenanceFromIntent(intent);
  const root = intent as { investigation_question?: unknown };
  return investigation ? { reference: investigation.reference, title: typeof root.investigation_question === 'string' ? root.investigation_question.slice(0,160) : 'Investiga\u00e7\u00e3o' } : null;
}

export async function resolveWorkReference(lookup: WorkReferenceLookup, input: string): Promise<WorkReferenceResult> {
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$(?![\s\S])/.test(input)) {
    return { ok: true, workItemId: input };
  }
  if (!/^[A-Z]{2,6}-\d{2}$(?![\s\S])/.test(input)) return { ok: false, code: 'invalid_work_reference' };
  const candidates: WorkReferenceAmbiguousCandidate[] = [];
  for (const candidate of await lookup.findByCanonicalSourceId(input)) {
    const provenance = readCanonicalProvenanceFromIntent(candidate.intent);
    const investigation = readInvestigationProvenanceFromIntent(candidate.intent);
    if (provenance?.sourceId === input || investigation?.reference === input) {
      const { intent: _intent, ...facts } = candidate;
      candidates.push({ ...facts, document: provenance?.document ?? 'cli_propose_investigation_v1' });
    }
  }
  const [candidate] = candidates;
  if (!candidate) return { ok: false, code: 'work_reference_not_found' };
  if (candidates.length > 1) return { ok: false, code: 'work_reference_ambiguous', candidates };
  return { ok: true, workItemId: candidate.workItemId };
}

export function createSupabaseWorkReferenceLookup(client: SupabaseClient<Database>): WorkReferenceLookup {
  return {
    async findByCanonicalSourceId(ref) {
      if (!/^[A-Z]{2,6}-\d{2}$(?![\s\S])/.test(ref)) throw new Error('invalid_work_reference');
      // Paginate: a server row limit must never hide an ambiguous successor.
      const candidates: WorkReferenceCandidate[] = [];
      const pageSize = 1000;
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await client.from('work_items')
          .select('id,state,proposal_version,created_at,intent')
          .or(`intent->canonical_provenance->>sourceId.eq.${ref},intent->investigation_provenance->>reference.eq.${ref}`)
          .order('created_at', { ascending: true }).order('id', { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (error) throw new Error(`Falha ao consultar referência de trabalho: ${error.message}`);
        for (const row of data ?? []) candidates.push({ workItemId: row.id, state: row.state,
          proposalVersion: row.proposal_version, createdAt: row.created_at, intent: row.intent });
        if ((data ?? []).length < pageSize) return candidates;
      }
    },
  };
}
