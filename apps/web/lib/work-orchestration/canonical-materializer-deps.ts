import { readCanonicalSourceIdFromIntent, type CreateWorkProposalCommand, type WorkImpactLevel, type WorkCapability } from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createWorkOrchestrationService } from './server';
import {
  planExecutableProjectWork,
  createConfiguredProjectPlanner,
  type ProjectWorkPlanner,
} from '@/lib/ai/project-work-planner';
import type { CanonicalMaterializerDeps } from './canonical-materializer';

// ============================================================
// Portos REAIS do materializer canônico (composição). Reusa exatamente a maquinaria
// ratificada: a PLANNING BOUNDARY é `planExecutableProjectWork` (o host valida escopo/
// paths/execution_spec); a criação é o serviço `createProposal` (create_work_proposal). A
// correlação estável é lida do `intent.canonical_provenance.sourceId` de todos os
// work_items do usuário (RLS). A mensagem de origem é um INSERT em `ai_conversations` sob
// a identidade do usuário. NUNCA service_role; NUNCA aprova/executa.
// ============================================================

/** Base placeholder do comando: `planExecutableProjectWork` sobrescreve execution_spec e
 * proposal; `base.intent` é espalhado (vazio aqui) e o driver injeta a proveniência; o
 * sourceMessageId placeholder é substituído pelo real pelo driver. */
const basePlanningCommand = (): CreateWorkProposalCommand => ({
  sourceMessageId: 'canonical-placeholder' as CreateWorkProposalCommand['sourceMessageId'],
  impactLevel: 'low' as WorkImpactLevel,
  capability: 'programming' as WorkCapability,
  intent: {} as CreateWorkProposalCommand['intent'],
  proposal: {
    schemaVersion: 1,
    data: { summary: 'placeholder', objective: 'placeholder', includedScope: [], excludedScope: [], expectedEffects: [], risks: [] },
  } as CreateWorkProposalCommand['proposal'],
});

export function buildCanonicalMaterializerDeps(
  client: SupabaseClient<Database>,
  userId: string,
  planner: ProjectWorkPlanner = createConfiguredProjectPlanner(),
): CanonicalMaterializerDeps {
  const service = createWorkOrchestrationService(client);
  return {
    // Correlação REAL: sourceIds canônicos já ligados a QUALQUER work_item do usuário (RLS).
    // Conservador (V0): a existência de um work_item para o sourceId bloqueia re-materialização
    // (sequência de slices/parent chain é fronteira futura).
    readMaterializedSourceIds: async () => {
      const { data, error } = await client.from('work_items').select('intent');
      if (error) throw new Error(`work_items read failed: ${error.message}`);
      const ids = new Set<string>();
      for (const row of data ?? []) {
        const sid = readCanonicalSourceIdFromIntent((row as { intent: unknown }).intent);
        if (sid) ids.add(sid);
      }
      return ids;
    },
    // PLANNING BOUNDARY: o host valida a saída do planner e monta o execution_spec.
    planSlice: async ({ planningMessage }) => planExecutableProjectWork(planningMessage, basePlanningCommand(), planner),
    // Mensagem de origem (provenance auditável) sob a identidade do usuário.
    persistSourceMessage: async (content) => {
      const { data, error } = await client
        .from('ai_conversations')
        .insert({ user_id: userId, role: 'user', content })
        .select('id')
        .single();
      if (error || !data) return null;
      return (data as { id: string }).id;
    },
    // Criação da proposta pela via ratificada. Desfecho `proposed`; nunca aprova/executa.
    createProposal: async (command) => {
      const result = await service.createProposal(command);
      if (result.ok) return { ok: true, workItemId: result.value.id };
      return { ok: false, error: result.error.code };
    },
  };
}
