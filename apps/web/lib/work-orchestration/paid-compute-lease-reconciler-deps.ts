import {
  NODE_LIFECYCLE_EVIDENCE_EVENT_TYPE,
  projectReconcilableLeases,
  type NodeLifecycleEvidenceEventLike,
  type NodeProvisioner,
} from '@anima/core';
import type { Database, Json } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LocalProcessNodeProvisioner } from './local-process-node-provisioner';
import { RunPodNodeProvisioner, readRunPodProvisionerConfig } from './runpod-node-provisioner';
import { nodeLifecycleEvidenceSinkFor } from './node-lifecycle-evidence';
import { reconcilePaidComputeLeases, type PaidComputeLeaseReconcilerDeps, type ReconcilerLease } from './paid-compute-lease-reconciler';

// ============================================================
// Composição REAL das dependências do reconciler de leases pagas (Bearer/RLS, sem service_role).
// Lê o log durável (work_events) e a validade da autorização (paid_compute_authorizations),
// resolve o provisioner por providerId a partir da CONFIG (credencial só via env), e persiste
// evidência de teardown pela RPC. NENHUMA credencial em banco/log. Provider pago só é
// instanciado para reconciliar um recurso que JÁ existe (parar gasto ≠ novo gasto).
// ============================================================

export function buildPaidComputeLeaseReconcilerDeps(
  client: SupabaseClient<Database>,
  env: Record<string, string | undefined> = process.env,
): PaidComputeLeaseReconcilerDeps {
  return {
    resolveProvisioner: (providerId): NodeProvisioner | null => {
      if (providerId === 'runpod') {
        const cfg = readRunPodProvisionerConfig(env);
        return cfg ? new RunPodNodeProvisioner(cfg) : null;
      }
      if (providerId === 'local-process') {
        // Recurso local morre com o host: locate→found:false. Sem launch relevante (não provisiona).
        return new LocalProcessNodeProvisioner({ command: process.execPath, args: [] });
      }
      return null;
    },

    readLeases: async (): Promise<readonly ReconcilerLease[]> => {
      const evidence = await client.from('work_events')
        .select('event_type,payload')
        .eq('event_type', NODE_LIFECYCLE_EVIDENCE_EVENT_TYPE)
        .order('seq', { ascending: true })
        .limit(2000);
      if (evidence.error) return [];
      const events: NodeLifecycleEvidenceEventLike[] = (evidence.data ?? []).map(row => ({
        type: row.event_type as string, payload: row.payload as Json,
      }));
      const summaries = projectReconcilableLeases(events);
      if (summaries.length === 0) return [];
      // Versão CORRENTE do item (a RPC de teardown exige expected_proposal_version == item).
      const ids = [...new Set(summaries.map(s => s.workItemId))];
      const items = await client.from('work_items').select('id,proposal_version').in('id', ids);
      if (items.error) return [];
      const versionOf = new Map((items.data ?? []).map(i => [i.id as string, i.proposal_version as number]));
      const leases: ReconcilerLease[] = [];
      for (const s of summaries) {
        const version = versionOf.get(s.workItemId);
        if (typeof version === 'number') leases.push({ ...s, proposalVersion: version });
      }
      return leases;
    },

    readAuthorityValid: async (authorizationRef, now): Promise<boolean> => {
      if (!authorizationRef) return false;
      const row = await client.from('paid_compute_authorizations')
        .select('revoked_at,valid_until').eq('id', authorizationRef).maybeSingle();
      if (row.error || !row.data) return false;
      return row.data.revoked_at === null && now < new Date(row.data.valid_until);
    },

    recordEvidence: async (evidence, proposalVersion) => {
      const saved = await nodeLifecycleEvidenceSinkFor(client).record(evidence, proposalVersion);
      return { ok: saved.ok };
    },
  };
}

/** Atalho de composição: reconcilia leases pagas para um cliente já autenticado. */
export function reconcilePaidComputeLeasesFor(
  client: SupabaseClient<Database>,
  env: Record<string, string | undefined> = process.env,
): ReturnType<typeof reconcilePaidComputeLeases> {
  return reconcilePaidComputeLeases(buildPaidComputeLeaseReconcilerDeps(client, env));
}
