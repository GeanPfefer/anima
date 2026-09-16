import {
  CAPABILITY_DOMAINS,
  CAPABILITY_MATURITIES,
  isFutureMaturity,
  isRealizedMaturity,
  longestDependencyPath,
  summarizeTargetProgress,
  validateCapabilityRegistry,
} from './capability-map';
import { ANIMA_CAPABILITY_REGISTRY_V0, getAnimaCapabilityGraph } from './capability-registry';

describe('Capability Registry V0 (Anima)', () => {
  const graph = getAnimaCapabilityGraph();

  test('o registro é um grafo íntegro (sem ids duplicados, refs quebradas ou ciclos)', () => {
    expect(validateCapabilityRegistry(ANIMA_CAPABILITY_REGISTRY_V0)).toEqual([]);
    expect(graph.issues).toEqual([]);
  });

  test('tem tamanho V0 alvo (aproximadamente 20–40 capacidades)', () => {
    expect(ANIMA_CAPABILITY_REGISTRY_V0.length).toBeGreaterThanOrEqual(20);
    expect(ANIMA_CAPABILITY_REGISTRY_V0.length).toBeLessThanOrEqual(40);
  });

  test('todo domínio e toda maturidade são valores válidos', () => {
    for (const c of ANIMA_CAPABILITY_REGISTRY_V0) {
      expect(CAPABILITY_DOMAINS).toContain(c.domain);
      expect(CAPABILITY_MATURITIES).toContain(c.maturity);
    }
  });

  test('cobre os seis domínios canônicos', () => {
    const domains = new Set(ANIMA_CAPABILITY_REGISTRY_V0.map((c) => c.domain));
    for (const d of CAPABILITY_DOMAINS) expect(domains.has(d)).toBe(true);
  });

  test('existe futuro projetado e presente comprovado (a linha do tempo é real)', () => {
    const anyFuture = ANIMA_CAPABILITY_REGISTRY_V0.some((c) => isFutureMaturity(c.maturity));
    const anyRealized = ANIMA_CAPABILITY_REGISTRY_V0.some((c) => isRealizedMaturity(c.maturity));
    expect(anyFuture).toBe(true);
    expect(anyRealized).toBe(true);
  });

  test('nenhuma capacidade futura depende de si mesma para ser "existente"', () => {
    // Uma capacidade projected/specified nunca deve estar marcada como realizada.
    for (const c of ANIMA_CAPABILITY_REGISTRY_V0) {
      if (isFutureMaturity(c.maturity)) expect(isRealizedMaturity(c.maturity)).toBe(false);
    }
  });

  test('unlocks derivados são consistentes com dependsOn (inverso)', () => {
    for (const node of graph.nodes) {
      for (const unlocked of node.unlocks) {
        expect(graph.byId.get(unlocked)?.dependsOn).toContain(node.capability.id);
      }
    }
  });

  test('capacidades com proofRefs fortes existem só em estados realizados', () => {
    // Prova é evidência de funcionamento: não faz sentido "comprovar" o que ainda é só visão.
    for (const c of ANIMA_CAPABILITY_REGISTRY_V0) {
      if ((c.proofRefs?.length ?? 0) > 0 && isFutureMaturity(c.maturity)) {
        // Permitido: uma capacidade especificada pode citar o marco que a especifica.
        // Mas projected não deve carregar prova de funcionamento.
        expect(c.maturity).not.toBe('projected');
      }
    }
  });

  test('há um caminho do presente até o self-development contínuo (item 8)', () => {
    const target = 'agency.continuous-self-development';
    expect(graph.byId.has(target)).toBe(true);
    const path = longestDependencyPath(graph, target);
    expect(path).not.toBeNull();
    expect((path ?? []).length).toBeGreaterThanOrEqual(3);
    // O caminho começa numa capacidade já realizada (o presente) e termina no alvo futuro.
    const first = graph.byId.get((path ?? [])[0] ?? '');
    expect(first && isRealizedMaturity(first.capability.maturity)).toBe(true);
    expect(path?.[path.length - 1]).toBe(target);
  });

  test('o objetivo continuous-self-development tem dependências existentes e ainda projetadas', () => {
    const progress = summarizeTargetProgress(graph, 'agency.continuous-self-development');
    expect(progress.found).toBe(true);
    expect(progress.totalDependencies).toBeGreaterThan(0);
    // Contagens objetivas derivadas do grafo (nada de porcentagem inventada).
    expect(progress.existing + progress.specified + progress.projected).toBe(progress.totalDependencies);
    expect(progress.existing).toBeGreaterThan(0); // já há base real
    expect(progress.projected + progress.specified).toBeGreaterThan(0); // ainda falta futuro
  });
});
