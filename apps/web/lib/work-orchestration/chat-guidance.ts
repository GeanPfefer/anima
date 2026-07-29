export type WorkOrchestrationChatKind =
  | 'work_proposal'
  | 'work_unavailable'
  | 'none';

export function buildWorkOrchestrationReply(
  kind: WorkOrchestrationChatKind,
): string | null {
  if (kind === 'work_proposal') {
    return 'Preparei uma proposta para você revisar no cartão abaixo. Ainda não li nem executei o trabalho.';
  }

  if (kind === 'work_unavailable') {
    return 'Reconheci um pedido de trabalho, mas a Orquestração de Trabalho ainda não está habilitada para a sua conta. Não criei uma proposta nem executei o pedido.';
  }

  return null;
}
