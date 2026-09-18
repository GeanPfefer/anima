// ============================================================
// SELF-IMPROVEMENT PROPOSAL V0 — de uma deficiência FORTE a uma proposta de
// melhoria GOVERNADA, na ENTRADA do pipeline existente (PURO, sem LLM).
//
// Separa explicitamente as três coisas do loop:
//   DEFICIÊNCIA (diagnóstico) → PROPOSTA DE MELHORIA (hipótese de como melhorar)
//   → WORK ITEM (unidade governada, criada pela via canônica `create_work_proposal`).
//
// A formulação V0 é DETERMINÍSTICA (templates por tipo de deficiência): NÃO usa
// LLM/provider. Ela descreve "o que precisa melhorar e como saberemos que
// melhorou" — objetivo + critérios de aceite —, NÃO o execution_spec detalhado
// (edite a linha X do arquivo Y). O execution_spec é responsabilidade do PLANNER,
// na PLANNING BOUNDARY já ratificada, DEPOIS da decisão humana — fronteira que
// este V0 PARA antes de cruzar.
//
// A saída máxima é um `CreateWorkProposalCommand` (a MESMA via do
// canonical-materializer): desfecho `proposed`, sob fronteira humana. NUNCA
// aprova, autoriza, reserva compute nem inicia attempt. A proveniência
// (`self_deficiency_provenance`) vai no intent — correlação estável que impede
// duplicar a proposta da mesma deficiência (espelha `canonical_provenance`).
// ============================================================

import { selfDeficienciesAwaitingProposal, type SelfDeficiencyKind, type SelfDeficiencyV0, type SelfDeficiencyEvidenceRef } from './self-deficiency';
import type {
  CreateWorkProposalCommand,
  SourceMessageId,
  WorkCapability,
  WorkImpactLevel,
  WorkIntent,
  WorkProposal,
} from './work-orchestration';

/**
 * Proposta de melhoria — hipótese estruturada derivada de UMA deficiência. Diz o
 * QUE melhorar e COMO saberemos que melhorou; não colapsa diagnóstico em solução
 * cirúrgica.
 */
export interface ImprovementProposalV0 {
  readonly schemaVersion: 1;
  readonly deficiencyId: string;
  readonly kind: SelfDeficiencyKind;
  readonly subject: string;
  /** Objetivo da melhoria (o resultado pretendido). */
  readonly objective: string;
  /** Problema observado (o diagnóstico, em uma frase). */
  readonly problem: string;
  readonly evidenceRefs: readonly SelfDeficiencyEvidenceRef[];
  /** Resultado esperado se a melhoria funcionar. */
  readonly expectedOutcome: string;
  /** Critérios de aceite iniciais (como saberemos que melhorou). */
  readonly acceptanceCriteria: readonly string[];
  readonly constraints: readonly string[];
  readonly risk: string;
  /** Escopo sugerido (fronteiras da mudança, não paths exatos). */
  readonly suggestedScope: readonly string[];
  readonly rationale: string;
  /** Capacidade afetada, quando a deficiência é sobre uma capability. */
  readonly affectedCapabilityId: string | null;
  readonly impactLevel: WorkImpactLevel;
  readonly capability: WorkCapability;
}

interface KindTemplate {
  readonly objective: (d: SelfDeficiencyV0) => string;
  readonly expectedOutcome: (d: SelfDeficiencyV0) => string;
  readonly acceptanceCriteria: (d: SelfDeficiencyV0) => readonly string[];
  readonly suggestedScope: (d: SelfDeficiencyV0) => readonly string[];
  readonly risk: string;
  readonly affectsCapability: boolean;
}

// Templates DETERMINÍSTICOS por classe de deficiência. Conservadores: descrevem
// intenção e critério de aceite, deixando o COMO técnico para o planner/humano.
const TEMPLATES: Record<SelfDeficiencyKind, KindTemplate> = {
  repeated_failure: {
    objective: d => `Eliminar a causa estrutural de falha "${d.subject}" que recorre entre múltiplas tarefas.`,
    expectedOutcome: d => `Novas execuções deixam de falhar por "${d.subject}"; a causa não reaparece entre tarefas distintas.`,
    acceptanceCriteria: d => [
      `A causa "${d.subject}" não é mais reproduzível no fluxo que a origina.`,
      'Existe cobertura de teste determinística que falha antes da correção e passa depois.',
      'O caminho de recovery para essa causa é revisado ou tornado desnecessário.',
    ],
    suggestedScope: () => [
      'Investigar a origem comum da causa nos work_items afetados.',
      'Corrigir a raiz estrutural (não apenas mitigar um caso).',
    ],
    risk: 'A correção pode ser mais ampla que um work_item; decompor se necessário. Não mascarar a causa com retry.',
    affectsCapability: false,
  },
  capability_regression: {
    objective: d => `Recuperar a capacidade "${d.subject}", que regrediu após ter sido comprovada.`,
    expectedOutcome: d => `A capacidade "${d.subject}" volta a produzir evidência forte positiva (re-comprovada), sem nova regressão.`,
    acceptanceCriteria: d => [
      `Uma execução verificada independente demonstra "${d.subject}" novamente.`,
      'A evidência negativa que caracterizou a regressão deixa de ocorrer.',
      'O Proof Engine deixa de classificar a capacidade como degraded.',
    ],
    suggestedScope: () => [
      'Localizar a mudança/condição que contradisse a capacidade.',
      'Restabelecer o comportamento e re-comprovar por evidência independente.',
    ],
    risk: 'Recuperação exige re-prova por observação independente; definição/afirmação não substitui prova.',
    affectsCapability: true,
  },
  verifier_recurrent_issue: {
    objective: d => `Fechar a lacuna de qualidade em "${d.subject}" que a verificação automática não captura e a revisão humana rejeita.`,
    expectedOutcome: d => `Auto-modificações de "${d.subject}" passam a sustentar a revisão humana, sem o padrão de falso-positivo verificado.`,
    acceptanceCriteria: d => [
      'A verificação passa a detectar o tipo de problema que a revisão humana vinha apontando.',
      `Uma nova auto-modificação de "${d.subject}" é aceita na revisão humana sem changes_requested pela mesma causa.`,
      'O critério que separava "verificado" de "aprovável" é tornado explícito e testável.',
    ],
    suggestedScope: () => [
      'Caracterizar o que a revisão humana apontou nas ocasiões rejeitadas.',
      'Fortalecer o critério/verificador para capturar essa classe antes da revisão.',
    ],
    risk: 'Não transformar preferência subjetiva em gate rígido; capturar apenas o padrão recorrente comprovado.',
    affectsCapability: true,
  },
};

/**
 * Formula uma proposta de melhoria a partir de UMA deficiência — PURA e
 * determinística (mesma deficiência → mesma proposta). Auto-modificação é sempre
 * tratada como impacto ESTRUTURAL (nunca um caminho de baixo impacto): a
 * governança humana decide, com barra alta.
 */
export function formulateImprovementProposal(deficiency: SelfDeficiencyV0): ImprovementProposalV0 {
  const template = TEMPLATES[deficiency.kind];
  return {
    schemaVersion: 1,
    deficiencyId: deficiency.id,
    kind: deficiency.kind,
    subject: deficiency.subject,
    objective: template.objective(deficiency),
    problem: deficiency.summary,
    evidenceRefs: deficiency.evidenceRefs,
    expectedOutcome: template.expectedOutcome(deficiency),
    acceptanceCriteria: template.acceptanceCriteria(deficiency),
    constraints: [
      'Mudança no próprio ANIMA sob supervisão humana — sem autoaprovação.',
      'Sem compute pago / provider externo sem autorização humana explícita.',
    ],
    risk: template.risk,
    suggestedScope: template.suggestedScope(deficiency),
    rationale: deficiency.rationale,
    affectedCapabilityId: template.affectsCapability ? deficiency.subject : null,
    impactLevel: 'structural',
    capability: 'programming',
  };
}

// ---------- Proveniência durável no intent (espelha canonical_provenance) ----------

export const SELF_DEFICIENCY_PROVENANCE_KEY = 'self_deficiency_provenance';

/** Correlação estável deficiência ↔ work_item, no `intent`. Impede duplicar a
 * proposta da mesma deficiência. */
export interface SelfDeficiencyProvenance {
  readonly kind: 'self_deficiency';
  readonly deficiencyId: string;
  readonly deficiencyKind: SelfDeficiencyKind;
  readonly subject: string;
}

export function buildSelfDeficiencyProvenance(deficiency: SelfDeficiencyV0): SelfDeficiencyProvenance {
  return {
    kind: 'self_deficiency',
    deficiencyId: deficiency.id,
    deficiencyKind: deficiency.kind,
    subject: deficiency.subject,
  };
}

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const SELF_DEFICIENCY_KINDS: ReadonlySet<string> = new Set<SelfDeficiencyKind>([
  'repeated_failure', 'capability_regression', 'verifier_recurrent_issue',
]);

/** Lê a proveniência de deficiência do intent — pura, fail-safe. `null` quando
 * ausente/malformada. Base da dedup contra work existente. */
export function readSelfDeficiencyProvenanceFromIntent(intent: unknown): SelfDeficiencyProvenance | null {
  const root = asObject(intent);
  const prov = root ? asObject(root[SELF_DEFICIENCY_PROVENANCE_KEY]) : null;
  if (!prov) return null;
  if (prov.kind !== 'self_deficiency') return null;
  const deficiencyId = prov.deficiencyId;
  const deficiencyKind = prov.deficiencyKind;
  const subject = prov.subject;
  if (typeof deficiencyId !== 'string' || deficiencyId.length === 0) return null;
  if (typeof deficiencyKind !== 'string' || !SELF_DEFICIENCY_KINDS.has(deficiencyKind)) return null;
  if (typeof subject !== 'string' || subject.length === 0) return null;
  return { kind: 'self_deficiency', deficiencyId, deficiencyKind: deficiencyKind as SelfDeficiencyKind, subject };
}

/** Atalho: só o `deficiencyId` do intent (para correlação), ou `null`. */
export function readSelfDeficiencyIdFromIntent(intent: unknown): string | null {
  return readSelfDeficiencyProvenanceFromIntent(intent)?.deficiencyId ?? null;
}

// ---------- Mensagem de origem + comando canônico ----------

/** Mensagem de origem (provenance auditável) da materialização — sob a
 * identidade do usuário, marcada como gatilho de self-development, NÃO chat
 * fingido. */
export function buildSelfImprovementMessage(deficiency: SelfDeficiencyV0): string {
  return [
    `[self-deficiency ${deficiency.id}] Propor melhoria governada para uma deficiência própria observada.`,
    `Deficiência (${deficiency.kind} — ${deficiency.subject}): ${deficiency.summary}`,
    `Evidência: ${deficiency.occurrences} sinais em ${deficiency.occasions} ocasiões (${deficiency.firstObservedAt} … ${deficiency.lastObservedAt}).`,
  ].join('\n');
}

/** Monta a WorkProposalV1 a partir da proposta de melhoria — determinística. */
export function buildSelfImprovementWorkProposal(proposal: ImprovementProposalV0): WorkProposal {
  return {
    schemaVersion: 1,
    data: {
      summary: proposal.problem,
      objective: proposal.objective,
      includedScope: proposal.suggestedScope,
      excludedScope: [
        'Aprovar, autorizar, reservar compute ou iniciar execução automaticamente.',
        'Formular o execution_spec detalhado antes da decisão humana.',
      ],
      expectedEffects: [proposal.expectedOutcome, ...proposal.acceptanceCriteria],
      risks: [proposal.risk],
    },
  };
}

/**
 * Constrói o `CreateWorkProposalCommand` canônico — determinístico, sem planner.
 * O intent carrega a PROVENIÊNCIA da deficiência (dedup) e o resumo da melhoria,
 * mas NÃO um execution_spec (deferido à PLANNING BOUNDARY após decisão humana).
 * O desfecho da via `create_work_proposal` é `proposed`: NUNCA aprova/autoriza/
 * reserva/executa.
 */
export function buildSelfImprovementProposalCommand(input: {
  readonly proposal: ImprovementProposalV0;
  readonly deficiency: SelfDeficiencyV0;
  readonly sourceMessageId: string;
}): CreateWorkProposalCommand {
  const { proposal, deficiency, sourceMessageId } = input;
  const provenance = buildSelfDeficiencyProvenance(deficiency);
  const intent: WorkIntent = {
    [SELF_DEFICIENCY_PROVENANCE_KEY]: provenance as unknown as WorkIntent[string],
    improvement: {
      objective: proposal.objective,
      problem: proposal.problem,
      expectedOutcome: proposal.expectedOutcome,
      acceptanceCriteria: [...proposal.acceptanceCriteria],
      constraints: [...proposal.constraints],
      suggestedScope: [...proposal.suggestedScope],
      affectedCapabilityId: proposal.affectedCapabilityId,
    } as unknown as WorkIntent[string],
  };
  return {
    sourceMessageId: sourceMessageId as SourceMessageId,
    impactLevel: proposal.impactLevel,
    capability: proposal.capability,
    intent,
    proposal: buildSelfImprovementWorkProposal(proposal),
  };
}

// ---------- Materializer: candidato → work_item `proposed` (via canônica) ----------
//
// Espelha `materializeNextCanonicalCandidate`: seleciona no MÁXIMO UMA
// deficiência forte e não coberta, formula a melhoria, persiste a mensagem de
// origem e cria a proposta. Fail-closed; sem escrita parcial; idempotente
// (replay não duplica enquanto o deficiencyId estiver materializado). Os portos
// de EFEITO são injetáveis: só `createProposal` escreve, e apenas um work_item
// `proposed` — NUNCA approval, authority, reservation nem attempt.

export interface SelfImprovementMaterializerDeps {
  /** Correlação REAL: deficiencyIds já ligados a QUALQUER work_item (via
   * `readSelfDeficiencyIdFromIntent`). Defesa em profundidade além do lifecycle. */
  readonly readMaterializedDeficiencyIds: () => Promise<ReadonlySet<string>>;
  /** Persiste a mensagem de origem (role=user, sob a identidade do usuário) →
   * sourceMessageId. `null` em falha. */
  readonly persistSourceMessage: (content: string) => Promise<string | null>;
  /** Cria a proposta (`create_work_proposal`) → workItemId. NUNCA aprova/executa. */
  readonly createProposal: (command: CreateWorkProposalCommand) => Promise<
    { readonly ok: true; readonly workItemId: string } | { readonly ok: false; readonly error: string }
  >;
}

export type SelfImprovementMaterializationResult =
  | {
      readonly ok: true;
      readonly workItemId: string;
      readonly deficiencyId: string;
      readonly proposal: ImprovementProposalV0;
    }
  | { readonly ok: false; readonly reason: string };

const errText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Seleção determinística da deficiência mais forte a propor: sinal ativo
 * (open/reopened), não já materializada; ordena por ocasiões desc, ocorrências
 * desc, id asc. */
export function selectSelfDeficiencyToPropose(
  candidates: readonly SelfDeficiencyV0[],
  alreadyMaterialized: ReadonlySet<string>,
): SelfDeficiencyV0 | null {
  const eligible = selfDeficienciesAwaitingProposal(candidates)
    .filter(d => !alreadyMaterialized.has(d.id));
  if (eligible.length === 0) return null;
  return [...eligible].sort((a, b) =>
    b.occasions - a.occasions || b.occurrences - a.occurrences || a.id.localeCompare(b.id),
  )[0]!;
}

/**
 * Materializa NO MÁXIMO UMA proposta de melhoria a partir das deficiências
 * candidatas (já com lifecycle resolvido). Fail-closed em cada passo; sem escrita
 * parcial. O desfecho máximo é um work_item `proposed`.
 */
export async function materializeSelfImprovementProposal(
  input: { readonly candidates: readonly SelfDeficiencyV0[] },
  deps: SelfImprovementMaterializerDeps,
): Promise<SelfImprovementMaterializationResult> {
  let materialized: ReadonlySet<string>;
  try {
    materialized = await deps.readMaterializedDeficiencyIds();
  } catch (error) {
    return { ok: false, reason: `correlation_read_failed:${errText(error)}` };
  }

  const deficiency = selectSelfDeficiencyToPropose(input.candidates, materialized);
  if (!deficiency) return { ok: false, reason: 'no_candidate' };

  const proposal = formulateImprovementProposal(deficiency);

  let sourceMessageId: string | null;
  try {
    sourceMessageId = await deps.persistSourceMessage(buildSelfImprovementMessage(deficiency));
  } catch (error) {
    return { ok: false, reason: `source_message_threw:${errText(error)}` };
  }
  if (!sourceMessageId) return { ok: false, reason: 'source_message_persist_failed' };

  const command = buildSelfImprovementProposalCommand({ proposal, deficiency, sourceMessageId });

  let created: Awaited<ReturnType<SelfImprovementMaterializerDeps['createProposal']>>;
  try {
    created = await deps.createProposal(command);
  } catch (error) {
    return { ok: false, reason: `create_threw:${errText(error)}` };
  }
  if (!created.ok) return { ok: false, reason: `create_failed:${created.error}` };

  return { ok: true, workItemId: created.workItemId, deficiencyId: deficiency.id, proposal };
}
