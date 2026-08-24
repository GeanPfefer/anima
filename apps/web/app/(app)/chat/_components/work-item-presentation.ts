import type { WorkPresentationView } from './WorkProposalCard';

export type WorkReencounter = {
  presentation: WorkPresentationView;
  dependencyIds: readonly string[];
  blockingDependencyIds: readonly string[];
  autonomousEligible: boolean;
  readinessLabel: string;
};

export function groupWorkPresentationsBySource(values: readonly WorkPresentationView[]) {
  return values.reduce<Record<string, WorkPresentationView[]>>((groups, value) => {
    const key = value.item.sourceMessageId;
    groups[key] = [...(groups[key] ?? []), value];
    return groups;
  }, {});
}

export function replaceWorkPresentation(values: readonly WorkPresentationView[], next: WorkPresentationView) {
  const found = values.some(value => value.item.id === next.item.id);
  return found ? values.map(value => value.item.id === next.item.id ? next : value) : [...values, next];
}

export function presentWorkReencounter(values: readonly WorkPresentationView[]): WorkReencounter[] {
  const states = new Map(values.map(value => [value.item.id, value.item.state]));
  return values.map(presentation => {
    const spec = presentation.item.intent['execution_spec'] as { depends_on_work_item_ids?: unknown } | undefined;
    const dependencyIds = Array.isArray(spec?.depends_on_work_item_ids)
      ? spec.depends_on_work_item_ids.filter((value): value is string => typeof value === 'string') : [];
    const blockingDependencyIds = dependencyIds.filter(id => states.get(id) !== 'completed');
    // A lista é uma projeção do servidor: `start` só existe quando estado e versão
    // permitem início. Dependências permanecem um gate adicional, nunca otimista.
    const contractEligible = presentation.availableActions.includes('start');
    const autonomousEligible = presentation.item.state === 'approved' && contractEligible && blockingDependencyIds.length === 0;
    const readinessLabel = blockingDependencyIds.length > 0
      ? `Aguardando conclusão de ${blockingDependencyIds.join(', ')}`
      : autonomousEligible ? 'Pronto para executar autonomamente' : 'Ainda não elegível para execução autônoma';
    return { presentation, dependencyIds, blockingDependencyIds, autonomousEligible, readinessLabel };
  });
}
