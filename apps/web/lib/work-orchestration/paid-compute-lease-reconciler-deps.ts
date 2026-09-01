import {
  NODE_LIFECYCLE_EVIDENCE_EVENT_TYPE,
  projectPaidComputeAudit,
  projectReconcilableLeases,
  type NodeLifecycleEvidenceEventLike,
  type NodeProvisioner,
  type PaidComputeAuditRecord,
} from '@anima/core';
import type { Database, Json } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LocalProcessNodeProvisioner } from './local-process-node-provisioner';
import { RunPodNodeProvisioner, readRunPodProvisionerConfig } from './runpod-node-provisioner';
import { nodeLifecycleEvidenceSinkFor } from './node-lifecycle-evidence';
import { reconcilePaidComputeLeases, type PaidComputeLeaseReconcilerDeps, type ReconcilerLease, type ReconcilerLeaseReadResult } from './paid-compute-lease-reconciler';
import type { LivePaidNodeCountResult } from './resident-on-demand-node';

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

    readLeases: async (): Promise<ReconcilerLeaseReadResult> => {
      const evidence = await client.from('work_events')
        .select('event_type,payload')
        .eq('event_type', NODE_LIFECYCLE_EVIDENCE_EVENT_TYPE)
        .order('seq', { ascending: true })
        .limit(2000);
      if (evidence.error) return { ok: false, reason: 'paid_lease_observation_unavailable' };
      const events: NodeLifecycleEvidenceEventLike[] = (evidence.data ?? []).map(row => ({
        type: row.event_type as string, payload: row.payload as Json,
      }));
      const summaries = projectReconcilableLeases(events);
      if (summaries.length === 0) return { ok: true, leases: [] };
      // Versão CORRENTE do item (a RPC de teardown exige expected_proposal_version == item).
      const ids = [...new Set(summaries.map(s => s.workItemId))];
      const items = await client.from('work_items').select('id,proposal_version').in('id', ids);
      if (items.error) return { ok: false, reason: 'paid_lease_observation_unavailable' };
      const versionOf = new Map((items.data ?? []).map(i => [i.id as string, i.proposal_version as number]));
      const leases: ReconcilerLease[] = [];
      for (const s of summaries) {
        const version = versionOf.get(s.workItemId);
        if (typeof version === 'number') leases.push({ ...s, proposalVersion: version });
      }
      return { ok: true, leases };
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

/** Lê os eventos de evidência de lifecycle do log durável (RLS). Base de projeções read-only. */
async function readLifecycleEvents(client: SupabaseClient<Database>): Promise<NodeLifecycleEvidenceEventLike[]> {
  const evidence = await client.from('work_events')
    .select('event_type,payload').eq('event_type', NODE_LIFECYCLE_EVIDENCE_EVENT_TYPE)
    .order('seq', { ascending: true }).limit(2000);
  if (evidence.error) return [];
  return (evidence.data ?? []).map(row => ({ type: row.event_type as string, payload: row.payload as Json }));
}

/** Conta os nodes PAGOS ainda vivos (do log durável) para o gate de concorrência. Distingue
 * explicitamente zero observado de indisponibilidade; a admission nega o segundo caso. */
export async function readLivePaidNodeCount(client: SupabaseClient<Database>): Promise<LivePaidNodeCountResult> {
  const evidence = await client.from('work_events')
    .select('event_type,payload').eq('event_type', NODE_LIFECYCLE_EVIDENCE_EVENT_TYPE)
    .order('seq', { ascending: true }).limit(2000);
  if (evidence.error) return { ok: false, reason: 'paid_node_count_unavailable' };
  const events: NodeLifecycleEvidenceEventLike[] = (evidence.data ?? []).map(row => ({ type: row.event_type as string, payload: row.payload as Json }));
  return { ok: true, count: projectReconcilableLeases(events).length };
}

/** Auditoria READ-ONLY de compute (Milestone J) para o humano: um registro por lease com
 * quem autorizou, node/provider/providerRef, marcos, desfecho, custo estimado e risco de órfão.
 * Nunca chama provider; nunca expõe segredo (a evidência já é livre de credencial). */
export async function readPaidComputeAudit(client: SupabaseClient<Database>): Promise<readonly PaidComputeAuditRecord[]> {
  return projectPaidComputeAudit(await readLifecycleEvents(client));
}

/** Atalho de composição: reconcilia leases pagas para um cliente já autenticado. */
export function reconcilePaidComputeLeasesFor(
  client: SupabaseClient<Database>,
  env: Record<string, string | undefined> = process.env,
): ReturnType<typeof reconcilePaidComputeLeases> {
  return reconcilePaidComputeLeases(buildPaidComputeLeaseReconcilerDeps(client, env));
}
