// CoderTaskSpecV1 — projeção semântica da versão APROVADA do trabalho para o coder.
//
// Antes: o contrato do coder carregava só `objective` + escopo + comandos parseados.
// `summary`, `expectedEffects` (os aceites), `risks`, a semântica dos critérios de
// validação (`covers`, `proof`, `claimKind`, `targetPaths`, critérios SEM comando) e
// o requisito do Verifier eram perdidos antes de qualquer backend (Ollama, OpenAI —
// que delega ao Ollama —, DeepSeek Harness). O coder era julgado por aceites que
// nunca viu.
//
// Esta projeção NÃO é persistida: é DERIVADA deterministicamente das estruturas
// canônicas já existentes — a proposta aprovada (`item.proposal.data` na
// `proposalVersion` aprovada), o `execution_spec` autorizado (já parseado em
// `AutonomousExecutionSpecV1`), o `verifier_requirement` do mesmo `execution_spec`
// e as referências do context snapshot. Não há segundo schema nem cópia gravada.
//
// Categorias mantidas DISTINTAS:
//   - semântica de aceite: `expectedEffects` + `validationCriteria` (o que prova o quê);
//   - comandos de validação: `validationCriteria[].command` (declarados) e, na
//     renderização, os comandos já AUTORIZADOS pelo host (parseados pela command
//     policy) — informativos; o host executa e julga os gates;
//   - permissões: NÃO fazem parte desta projeção (seguem em `permissions`,
//     `workspaceAccessPolicy`, `commandPolicy`);
//   - contexto informativo: `contextReferences` (proveniência; conteúdo não resolvido
//     aqui e nunca inventado).
// Nada aqui amplia autoridade: escopo de escrita, command policy e gates continuam
// vindo dos campos de autoridade do request. Puro.

import type { AutonomousExecutionSpecV1, AutonomousValidationCriterion, WorkClaimKind, WorkProofKind } from './eligibility';
import type { WorkContextReference, WorkItem, WorkProposal } from './types';
import { readVerifierRequirement, type VerifierRequirement } from './verifier-requirement';

export interface CoderTaskValidationCriterionV1 {
  readonly label: string;
  readonly command?: string;
  readonly covers?: readonly string[];
  readonly proof?: WorkProofKind;
  readonly claimKind?: WorkClaimKind;
  readonly targetPaths?: readonly string[];
}

export interface CoderTaskSpecV1 {
  readonly schemaVersion: 1;
  readonly workItemId: string;
  readonly approvedProposalVersion: number;
  readonly summary: string;
  readonly objective: string;
  readonly includedScope: readonly string[];
  readonly excludedScope: readonly string[];
  readonly expectedEffects: readonly string[];
  readonly risks: readonly string[];
  readonly validationCriteria: readonly CoderTaskValidationCriterionV1[];
  readonly verifierRequirement: VerifierRequirement;
  /** Proveniência informativa (snapshot de contexto/evidência herdada). Nunca autoridade. */
  readonly contextReferences: readonly WorkContextReference[];
}

/** Comando de validação já parseado e AUTORIZADO pelo host (command policy). Informativo. */
export interface CoderTaskAuthorizedValidationCommandV1 {
  readonly label: string;
  readonly program: string;
  readonly args: readonly string[];
}

export interface CoderTaskSpecInput {
  readonly workItemId: string;
  readonly approvedProposalVersion: number;
  readonly proposal: WorkProposal['data'];
  readonly spec: Pick<AutonomousExecutionSpecV1, 'validationCriteria'>;
  readonly verifierRequirement: VerifierRequirement;
  readonly contextReferences: readonly WorkContextReference[];
}

/** Cópia canônica de um critério: só os campos conhecidos, em ordem fixa (determinística). */
export const projectCoderTaskCriterion = (criterion: AutonomousValidationCriterion): CoderTaskValidationCriterionV1 => ({
  label: criterion.label,
  ...(criterion.command !== undefined ? { command: criterion.command } : {}),
  ...(criterion.covers !== undefined ? { covers: [...criterion.covers] } : {}),
  ...(criterion.proof !== undefined ? { proof: criterion.proof } : {}),
  ...(criterion.claimKind !== undefined ? { claimKind: criterion.claimKind } : {}),
  ...(criterion.targetPaths !== undefined ? { targetPaths: [...criterion.targetPaths] } : {}),
});

export function buildCoderTaskSpec(input: CoderTaskSpecInput): CoderTaskSpecV1 {
  const { proposal } = input;
  return {
    schemaVersion: 1,
    workItemId: input.workItemId,
    approvedProposalVersion: input.approvedProposalVersion,
    summary: proposal.summary,
    objective: proposal.objective,
    includedScope: [...proposal.includedScope],
    excludedScope: [...proposal.excludedScope],
    expectedEffects: [...proposal.expectedEffects],
    risks: [...proposal.risks],
    validationCriteria: input.spec.validationCriteria.map(projectCoderTaskCriterion),
    verifierRequirement: input.verifierRequirement,
    contextReferences: input.contextReferences.map(reference => ({ kind: reference.kind, id: reference.id })),
  };
}

/** Projeção a partir do Work Item aprovado + `execution_spec` já validado. */
export const buildCoderTaskSpecFromWorkItem = (
  item: Pick<WorkItem, 'id' | 'proposalVersion' | 'proposal' | 'intent'>,
  spec: Pick<AutonomousExecutionSpecV1, 'validationCriteria'>,
  contextReferences: readonly WorkContextReference[],
): CoderTaskSpecV1 => buildCoderTaskSpec({
  workItemId: item.id,
  approvedProposalVersion: item.proposalVersion,
  proposal: item.proposal.data,
  spec,
  verifierRequirement: readVerifierRequirement(item.intent),
  contextReferences,
});

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * Invariante de FIDELIDADE entre a projeção e os campos de autoridade do request do
 * executor: correlação, objetivo, escopo, critérios e referências precisam coincidir.
 * Divergência ⇒ razão (fail-closed); `null` ⇒ coerente. Impede que a seção semântica
 * mostre ao coder um escopo/critério diferente do que o host aplica.
 */
export function coderTaskSpecMismatch(
  taskSpec: CoderTaskSpecV1,
  request: {
    readonly workItemId: string;
    readonly approvedProposalVersion: number;
    readonly objective: string;
    readonly includedScope: readonly string[];
    readonly excludedScope: readonly string[];
    readonly validationCriteria: readonly AutonomousValidationCriterion[];
    readonly contextReferences: readonly WorkContextReference[];
  },
): string | null {
  if (taskSpec.schemaVersion !== 1) return 'Versão de CoderTaskSpec não suportada.';
  if (taskSpec.workItemId !== request.workItemId || taskSpec.approvedProposalVersion !== request.approvedProposalVersion) {
    return 'A especificação do coder perdeu a correlação com a versão aprovada.';
  }
  if (taskSpec.objective !== request.objective
    || !sameList(taskSpec.includedScope, request.includedScope)
    || !sameList(taskSpec.excludedScope, request.excludedScope)) {
    return 'A especificação do coder diverge do objetivo/escopo autorizado.';
  }
  if (JSON.stringify(taskSpec.validationCriteria) !== JSON.stringify(request.validationCriteria.map(projectCoderTaskCriterion))) {
    return 'A especificação do coder diverge dos critérios de validação autorizados.';
  }
  const refKey = (reference: WorkContextReference): string => `${reference.kind}:${reference.id}`;
  if (!sameList(taskSpec.contextReferences.map(refKey), request.contextReferences.map(refKey))) {
    return 'A especificação do coder diverge das referências de contexto.';
  }
  return null;
}

const VERIFIER_REQUIREMENT_TEXT: Readonly<Record<VerifierRequirement, string>> = {
  required_fail_closed: 'required_fail_closed — o resultado só pode ser aceito com parecer do Verifier `verified`, correlacionado a este resultado e apoiado em evidência git e gate observadas pelo host.',
  advisory: 'advisory — o parecer do Verifier é consultivo; os gates continuam executados e julgados pelo host.',
};

/**
 * Renderização determinística e COMPARTILHADA da especificação para todos os
 * backends. Fidelidade, não persuasão: lista o que foi aprovado, sem instruções
 * específicas de modelo. `covers` é renderizado por referência aos efeitos (`E<n>`);
 * um texto de `covers` sem efeito correspondente é preservado literalmente.
 */
export function renderCoderTaskSpec(
  spec: CoderTaskSpecV1,
  authorizedValidationCommands: readonly CoderTaskAuthorizedValidationCommandV1[] = [],
): string {
  const list = (values: readonly string[]): string[] =>
    values.length > 0 ? values.map(value => `  - ${value}`) : ['  (nenhum declarado)'];
  const effectIndex = new Map(spec.expectedEffects.map((effect, index) => [effect, `E${index + 1}`]));
  const lines: string[] = [
    `ESPECIFICAÇÃO APROVADA DO WORK ITEM (CoderTaskSpecV1; work item ${spec.workItemId}; versão aprovada ${spec.approvedProposalVersion})`,
    'Derivada da proposta aprovada e do execution_spec autorizado. Informativa: não amplia escopo, permissões nem comandos; o host executa e julga os gates.',
    `Resumo: ${spec.summary}`,
    `Objetivo: ${spec.objective}`,
    'Escopo permitido (escrita):',
    ...list(spec.includedScope),
    'Escopo excluído (não tocar):',
    ...list(spec.excludedScope),
    'Efeitos esperados (aceites da proposta aprovada):',
    ...(spec.expectedEffects.length > 0
      ? spec.expectedEffects.map((effect, index) => `  E${index + 1}. ${effect}`)
      : ['  (nenhum declarado)']),
    'Riscos declarados:',
    ...list(spec.risks),
    'Critérios de validação (o que cada prova cobre):',
  ];
  spec.validationCriteria.forEach((criterion, index) => {
    lines.push(
      `  V${index + 1}. ${criterion.label}`,
      `      comando: ${criterion.command ?? '(sem comando)'}`,
      `      prova: ${criterion.proof ?? '(não declarada)'}`,
      `      claimKind: ${criterion.claimKind ?? '(não declarado)'}`,
      `      alvos: ${criterion.targetPaths?.length ? criterion.targetPaths.join(', ') : '(não declarados)'}`,
      `      cobre: ${criterion.covers?.length
        ? criterion.covers.map(text => effectIndex.get(text) ?? `"${text}"`).join(', ')
        : '(não declarado)'}`,
    );
  });
  if (spec.validationCriteria.length === 0) lines.push('  (nenhum declarado)');
  lines.push('Comandos de validação autorizados pelo host (informativos; o host executa e julga):');
  lines.push(...(authorizedValidationCommands.length > 0
    ? authorizedValidationCommands.map(command => `  - ${command.label}: ${[command.program, ...command.args].join(' ')}`)
    : ['  (nenhum comando executável autorizado)']));
  lines.push(`Requisito do Verifier: ${VERIFIER_REQUIREMENT_TEXT[spec.verifierRequirement]}`);
  if (spec.contextReferences.length > 0) {
    lines.push(
      'Referências de contexto (proveniência; conteúdo não resolvido nesta seção, sem autoridade):',
      ...spec.contextReferences.map(reference => `  - ${reference.kind}:${reference.id}`),
    );
  }
  return lines.join('\n');
}
