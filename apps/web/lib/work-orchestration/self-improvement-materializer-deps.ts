import {
  readSelfDeficiencyIdFromIntent,
  type SelfDeficiencyCoverage,
  type SelfImprovementMaterializerDeps,
} from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createWorkOrchestrationService } from './server';

// ============================================================
// Portos REAIS do materializer de SELF-IMPROVEMENT (composição). Espelha exatamente
// `buildCanonicalMaterializerDeps`, mas para o loop de deficiência própria: a
// correlação estável é lida do `intent.self_deficiency_provenance.deficiencyId` de
// todos os work_items do usuário (RLS); a mensagem de origem é um INSERT em
// `ai_conversations` sob a identidade do usuário; a criação usa `create_work_proposal`
// (desfecho `proposed`).
//
// Diferença deliberada em relação ao canônico: a proposta de melhoria é SEMPRE de
// impacto `structural` e NÃO carrega `execution_spec` nem `canonical_provenance` — o
// envelope de autorização autônoma a recusa por construção. Por isso ESTE deps builder
// NÃO faz auto-aprovação: o desfecho máximo é `proposed`, sob fronteira humana. NUNCA
// service_role; NUNCA aprova/autoriza/reserva/executa.
// ============================================================

export function buildSelfImprovementMaterializerDeps(
  client: SupabaseClient<Database>,
  userId: string,
): SelfImprovementMaterializerDeps {
  const service = createWorkOrchestrationService(client);
  return {
    // Correlação REAL: deficiencyIds já ligados a QUALQUER work_item do usuário (RLS).
    // Mesmo padrão do read-model de /evolution e defesa em profundidade além do
    // lifecycle: qualquer work_item que carregue a proveniência de uma deficiência a
    // bloqueia contra re-materialização concorrente/replay.
    readDeficiencyCoverage: async (): Promise<readonly SelfDeficiencyCoverage[]> => {
      const { data, error } = await client
        .from('work_items')
        .select('id,state,updated_at,intent');
      if (error || data === null) {
        throw new Error(`work_items coverage read failed: ${error?.message ?? 'missing'}`);
      }
      const coverage: SelfDeficiencyCoverage[] = [];
      for (const row of data) {
        const deficiencyId = readSelfDeficiencyIdFromIntent((row as { intent: unknown }).intent);
        if (!deficiencyId) continue;
        coverage.push({
          deficiencyId,
          workItemId: (row as { id: string }).id,
          state: (row as { state: SelfDeficiencyCoverage['state'] }).state,
          updatedAt: (row as { updated_at: string }).updated_at,
        });
      }
      return coverage;
    },
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
