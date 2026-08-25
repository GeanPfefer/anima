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
  return values.map(presentation => {
    const spec = presentation.item.intent['execution_spec'] as { depends_on_work_item_ids?: unknown } | undefined;
    const dependencyIds = Array.isArray(spec?.depends_on_work_item_ids)
      ? spec.depends_on_work_item_ids.filter((value): value is string => typeof value === 'string') : [];
    const blockingDependencyIds = presentation.autonomousReadiness?.blockingDependencyIds??[];
    // Autoridade única: projeção server-side de autonomous_work_queue(). Ausência
    // da projeção nunca vira permissão no cliente.
    const autonomousEligible = presentation.autonomousReadiness?.eligible===true;
    const readinessLabel = blockingDependencyIds.length > 0
      ? `Aguardando conclusão de ${blockingDependencyIds.join(', ')}`
      : autonomousEligible ? 'Pronto para executar autonomamente' : 'Ainda não elegível para execução autônoma';
    return { presentation, dependencyIds, blockingDependencyIds, autonomousEligible, readinessLabel };
  });
}
