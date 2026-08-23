import {
  planCanonicalBacklogMaterialization,
  buildCanonicalProvenance,
  buildCanonicalSlicePlanningMessage,
  buildCanonicalMaterializationMessage,
  CANONICAL_PROVENANCE_KEY,
  type CanonicalBacklogCandidate,
  type CanonicalMaterializationProvenance,
  type CreateWorkProposalCommand,
} from '@anima/core';
import type { ProjectWorkPlanningResult } from '@/lib/ai/project-work-planner';

// ============================================================
// Materializer V1 (Level 6): candidato canônico → work_item `proposed`.
//
// Fluxo (fail-closed em cada passo):
//   allCandidates → SELEÇÃO determinística (política pura, com correlação REAL) →
//   PLANNING BOUNDARY (planExecutableProjectWork: UM slice validado) → proveniência
//   durável no intent → mensagem de origem (provenance) → create_work_proposal → `proposed`.
//
// Invariantes: materialização ≠ aprovação (desfecho máximo `proposed`); NÃO duplica
// (correlação estável por `canonical_provenance.sourceId`); o planner recebe um candidato
// JÁ escolhido pelo domínio e sua saída passa pelos validadores existentes; nenhuma
// escrita parcial (correlação só existe quando o work_item é criado). Portos injetáveis
// para prova por doubles.
// ============================================================

export interface CanonicalMaterializerDeps {
  /** Correlação REAL: sourceIds já ligados a um work_item ativo (não duplicar). */
  readonly readMaterializedSourceIds: () => Promise<ReadonlySet<string>>;
  /** PLANNING BOUNDARY: candidato → comando validado (envolve `planExecutableProjectWork`).
   * O planner produz só argumentos brutos; o host valida escopo/paths/execution_spec. */
  readonly planSlice: (input: {
    readonly candidate: CanonicalBacklogCandidate;
    readonly planningGeneration: number;
    readonly planningMessage: string;
  }) => Promise<ProjectWorkPlanningResult>;
  /** Persiste a mensagem de origem (ai_conversations, role=user, sob a identidade do usuário)
   * → sourceMessageId. `null` em falha. */
  readonly persistSourceMessage: (content: string) => Promise<string | null>;
  /** Cria a proposta (create_work_proposal) → workItemId. NUNCA aprova/executa. */
  readonly createProposal: (command: CreateWorkProposalCommand) => Promise<
    { readonly ok: true; readonly workItemId: string } | { readonly ok: false; readonly error: string }
  >;
}

export type CanonicalMaterializationResult =
  | {
      readonly ok: true;
      readonly workItemId: string;
      readonly sourceId: string;
      readonly provenance: CanonicalMaterializationProvenance;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Materializa o PRÓXIMO candidato canônico elegível em UM work_item `proposed`. Roda a
 * seleção determinística com correlação REAL (defesa em profundidade), planeja um slice,
 * garante a proveniência durável no intent e cria a proposta. Fail-closed; sem escrita
 * parcial; idempotente (replay não duplica enquanto o sourceId estiver materializado).
 */
export async function materializeNextCanonicalCandidate(
  input: { readonly allCandidates: readonly CanonicalBacklogCandidate[] },
  deps: CanonicalMaterializerDeps,
): Promise<CanonicalMaterializationResult> {
  let materialized: ReadonlySet<string>;
  try {
    materialized = await deps.readMaterializedSourceIds();
  } catch (error) {
    return { ok: false, reason: `correlation_read_failed:${errText(error)}` };
  }

  // SELEÇÃO com correlação real — done/awaiting/unknown/dep-unresolved/já-ligado NÃO passam.
  const decision = planCanonicalBacklogMaterialization({
    candidates: input.allCandidates,
    materializedSourceIds: materialized,
  });
  if (decision.action === 'none') return { ok: false, reason: `no_candidate:${decision.reason}` };
  const candidate = decision.candidate;

  // PLANNING BOUNDARY — UM slice validado. planningGeneration=1 (o primeiro slice deste
  // sourceId; gerações seguintes/parent chain são fronteira futura).
  const planningGeneration = 1;
  const provenance = buildCanonicalProvenance({
    candidate,
    planningGeneration,
    materializationReason: 'selected_ready',
  });
  const planningMessage = buildCanonicalSlicePlanningMessage({ candidate, planningGeneration });

  let planned: ProjectWorkPlanningResult;
  try {
    planned = await deps.planSlice({ candidate, planningGeneration, planningMessage });
  } catch (error) {
    return { ok: false, reason: `planning_threw:${errText(error)}` };
  }
  if (!planned.ok) return { ok: false, reason: `planning_failed:${planned.message}` };

  // Mensagem de origem (provenance auditável) → sourceMessageId. Só depois do plano ok,
  // para minimizar mensagens órfãs.
  let sourceMessageId: string | null;
  try {
    sourceMessageId = await deps.persistSourceMessage(buildCanonicalMaterializationMessage(candidate));
  } catch (error) {
    return { ok: false, reason: `source_message_threw:${errText(error)}` };
  }
  if (!sourceMessageId) return { ok: false, reason: 'source_message_persist_failed' };

  // O DRIVER garante a proveniência canônica no intent (não confia só no planner).
  const command: CreateWorkProposalCommand = {
    ...planned.command,
    sourceMessageId,
    // A proveniência é JSON-serializável (só strings/números/optional string); o cast via
    // `unknown` só contorna o fato de a INTERFACE ter um campo opcional (não estrutura Json).
    intent: {
      ...(planned.command.intent as Record<string, unknown>),
      [CANONICAL_PROVENANCE_KEY]: provenance,
    } as unknown as CreateWorkProposalCommand['intent'],
  };

  let created: Awaited<ReturnType<CanonicalMaterializerDeps['createProposal']>>;
  try {
    created = await deps.createProposal(command);
  } catch (error) {
    return { ok: false, reason: `create_threw:${errText(error)}` };
  }
  if (!created.ok) return { ok: false, reason: `create_failed:${created.error}` };

  return { ok: true, workItemId: created.workItemId, sourceId: candidate.sourceId, provenance };
}

const errText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
