import { describeValidationOutcome, type WorkPresentation } from '@anima/core';

export interface MobileWorkResultContent {
  readonly accessibilityLabel: 'Resultado aceito' | 'Resultado para revisão';
  readonly title: string;
  readonly summary: string;
  readonly references: string;
  readonly validations: string;
  readonly limitations: string;
  readonly completionMessage: string | null;
}

export function presentMobileWorkResult(presentation: WorkPresentation): MobileWorkResultContent | null {
  const { item, latestResult, acceptedResult } = presentation;
  const result = item.state === 'review' ? latestResult : item.state === 'completed' ? acceptedResult : null;
  if (!result) return null;

  return {
    accessibilityLabel: item.state === 'completed' ? 'Resultado aceito' : 'Resultado para revisão',
    title: `${item.state === 'completed' ? 'Resultado aceito' : 'Resultado'} · v${result.proposalVersion} · ${result.author}`,
    summary: `Relato de ${result.author}, não verificado automaticamente: ${result.summary}`,
    references: result.references.length ? result.references.join(', ') : 'nenhuma referência informada',
    validations: result.validations?.length
      ? result.validations.map(validation => `${validation.label} — ${describeValidationOutcome(validation.outcome)}`).join('; ')
      : 'nenhuma validação registrada',
    limitations: result.limitations?.length ? result.limitations.join('; ') : 'nenhuma limitação declarada',
    completionMessage: item.state === 'completed'
      ? 'Resultado aceito e trabalho concluído; evidências preservadas acima.'
      : null,
  };
}

export function describeMissingCompletedResult(presentation: WorkPresentation): string | null {
  return presentation.item.state === 'completed' && !presentation.acceptedResult
    ? 'Trabalho concluído, mas as evidências do resultado aceito não puderam ser verificadas.'
    : null;
}
