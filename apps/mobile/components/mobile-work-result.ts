import { describeValidationOutcome, type WorkPresentation, type WorkVerificationVerdict } from '@anima/core';

export interface MobileWorkResultContent {
  readonly accessibilityLabel: 'Resultado aceito' | 'Resultado para revisão';
  readonly title: string;
  readonly summary: string;
  readonly references: string;
  readonly validations: string;
  readonly limitations: string;
  readonly handoff: string;
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
    handoff: result.handoffReference ?? 'nenhuma referência de handoff',
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

// Paridade do parecer advisory do Verifier (mesma projeção pura da web). Read-only:
// informa a revisão, não a substitui. Ausente ⇒ null (sem evidência durável a conferir).
export interface MobileWorkVerificationContent {
  readonly verdictLabel: string;
  readonly issues: readonly string[];
}

const MOBILE_VERDICT_LABEL: Record<WorkVerificationVerdict, string> = {
  verified: 'evidência suficiente e coerente com o contrato aprovado',
  inconclusive: 'evidência insuficiente para concluir automaticamente',
  rejected: 'evidência de violação ou incoerência com o contrato aprovado',
};

export function presentMobileWorkVerification(presentation: WorkPresentation): MobileWorkVerificationContent | null {
  const report = presentation.verification;
  if (!report) return null;
  return {
    verdictLabel: MOBILE_VERDICT_LABEL[report.verdict],
    issues: report.findings
      .filter(finding => finding.severity !== 'ok')
      .map(finding => `${finding.severity === 'violation' ? 'Violação' : 'Lacuna'}: ${finding.detail}`),
  };
}
