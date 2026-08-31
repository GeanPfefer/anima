import type { NodeLifecycleEvidenceV1 } from '@anima/core';
import type { Database, Json } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface NodeLifecycleEvidenceSink {
  record(evidence: NodeLifecycleEvidenceV1, proposalVersion: number): Promise<
    { readonly ok: true; readonly action: 'recorded' | 'replayed' } |
    { readonly ok: false; readonly message: string }
  >;
}

export const nodeLifecycleEvidenceSinkFor = (client: SupabaseClient<Database>): NodeLifecycleEvidenceSink => ({
  record: async (evidence, proposalVersion) => {
    const { data, error } = await client.rpc('record_host_observed_node_lifecycle', {
      work_item_id: evidence.workItemId,
      expected_proposal_version: proposalVersion,
      evidence: evidence as unknown as Json,
    });
    if (error) return { ok: false, message: error.message };
    return { ok: true, action: (data as { action?: string } | null)?.action === 'replayed' ? 'replayed' : 'recorded' };
  },
});
