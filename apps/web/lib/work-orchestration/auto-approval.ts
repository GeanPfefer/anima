import {
  AUTONOMOUS_AUTHORIZATION_ENVELOPE_VERSION,
  evaluateAutonomousApprovalEnvelope,
  type AutonomousAuthorizationDecision,
} from '@anima/core';
import type { Database, Json } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdmissionVerdict } from '../resident-host/resident-host';

export type AutonomousApprovalAttempt =
  | { readonly action: 'approved' | 'replayed'; readonly eventSeq: number; readonly sourceId: string }
  | { readonly action: 'already_approved' }
  | { readonly action: 'human_required'; readonly reason: string };

type PersistedCandidate = Pick<
  Database['public']['Tables']['work_items']['Row'],
  'state' | 'impact_level' | 'capability' | 'intent' | 'proposal' | 'proposal_version'
>;

/**
 * Application seam da autorização autônoma: decide sobre o item PERSISTIDO e, somente
 * quando o envelope puro autoriza, persiste `work_approved author=system` pela RPC.
 * Qualquer leitura, policy ou persistência ambígua falha fechado na fronteira humana.
 */
export async function autoApproveAutonomousWork(
  input: {
    readonly client: SupabaseClient<Database>;
    readonly workItemId: string;
    readonly readGovernorVerdict: () => AdmissionVerdict | Promise<AdmissionVerdict>;
    readonly now?: () => Date;
  },
): Promise<AutonomousApprovalAttempt> {
  let item: PersistedCandidate;
  try {
    const { data, error } = await input.client
      .from('work_items')
      .select('state,impact_level,capability,intent,proposal,proposal_version')
      .eq('id', input.workItemId)
      .single();
    if (error || !data) return { action: 'human_required', reason: `item_read_failed:${error?.message ?? 'missing'}` };
    item = data;
  } catch (error) {
    return { action: 'human_required', reason: `item_read_threw:${errorText(error)}` };
  }

  // Item aprovado por qualquer autoridade já está além desta fronteira. Não cria evento.
  if (item.state === 'approved') return { action: 'already_approved' };

  let governorVerdict: AdmissionVerdict;
  try {
    governorVerdict = await input.readGovernorVerdict();
  } catch (error) {
    return { action: 'human_required', reason: `policy_error:${errorText(error)}` };
  }

  let decision: AutonomousAuthorizationDecision;
  try {
    decision = evaluateAutonomousApprovalEnvelope({
      state: item.state,
      impactLevel: item.impact_level,
      capability: item.capability,
      intent: item.intent,
      proposal: item.proposal,
      governorVerdict,
    });
  } catch (error) {
    return { action: 'human_required', reason: `policy_error:${errorText(error)}` };
  }
  if (!decision.authorized) return { action: 'human_required', reason: decision.failClosedReason };

  const envelope = {
    schema_version: 1,
    authority: 'autonomous_policy',
    envelope_version: AUTONOMOUS_AUTHORIZATION_ENVELOPE_VERSION,
    source_id: decision.sourceId,
    decision_reason: 'canonical_local_slice_within_authorized_envelope',
    execution_class: 'canonical_local_isolated_worktree',
    checks: [...decision.checks],
  } satisfies Json;

  // Ordem CAUSAL (INTEL-01): a classificação de inteligência é um FATO POST-APROVAÇÃO —
  // `record_work_intelligence_classification` exige que a versão da proposta já carregue um
  // `work_approved` (é gravada "contra a versão de proposta já aprovada"). Por isso
  // APROVAMOS primeiro (autoridade `system`/`autonomous_policy`) e só então derivamos e
  // persistimos a classificação que a fila autônoma exige (`autonomous_work_queue` + gate de
  // inteligência). A classificação vem do MESMO envelope estreito (não do planner). Se ela
  // falhar após a aprovação, o item fica aprovado-mas-não-classificado: seguro (o gate de
  // inteligência barra claim/execução) e recuperável na borda humana — nunca executa sem
  // classificação vigente.
  let approvalAction: 'approved' | 'replayed';
  let approvalSeq: number;
  try {
    const { data, error } = await input.client.rpc('auto_approve_autonomous_work', {
      work_item_id: input.workItemId,
      expected_proposal_version: item.proposal_version,
      envelope,
    });
    if (error) return { action: 'human_required', reason: `approval_persist_failed:${error.message}` };
    const value = data as { action?: unknown; event_seq?: unknown } | null;
    if ((value?.action !== 'approved' && value?.action !== 'replayed') || typeof value.event_seq !== 'number') {
      return { action: 'human_required', reason: 'approval_persist_ambiguous' };
    }
    approvalAction = value.action;
    approvalSeq = value.event_seq;
  } catch (error) {
    return { action: 'human_required', reason: `approval_persist_threw:${errorText(error)}` };
  }

  // Classificação exigida pela fila autônoma, agora que a versão está aprovada. Idempotente:
  // só grava se ainda não existir (replay/reentrada não duplica).
  try {
    const current = await input.client.rpc('current_work_intelligence_classification', {
      p_work_item_id: input.workItemId,
    });
    if (current.error) return { action: 'human_required', reason: `classification_read_failed:${current.error.message}` };
    const currentRoot = current.data as { classification?: unknown } | null;
    if (!currentRoot?.classification) {
      const classified = await input.client.rpc('record_work_intelligence_classification', {
        p_work_item_id: input.workItemId,
        p_expected_proposal_version: item.proposal_version,
        p_expected_classification_revision: 0,
        p_classification: {
          schemaVersion: 1,
          complexity: 'bounded',
          risk: 'low',
          reversibility: 'reversible',
          planClarity: 'clear',
          urgency: 'normal',
          provenance: {
            kind: 'system_assessed',
            classifiedAt: (input.now ?? (() => new Date()))().toISOString(),
            classifierId: 'autonomous-authorization-v1',
            policyVersion: 'canonical-local-isolated-v1',
          },
        },
      });
      if (classified.error) return { action: 'human_required', reason: `classification_persist_failed:${classified.error.message}` };
    }
  } catch (error) {
    return { action: 'human_required', reason: `classification_threw:${errorText(error)}` };
  }

  return { action: approvalAction, eventSeq: approvalSeq, sourceId: decision.sourceId };
}

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
