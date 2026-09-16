import {
  buildCapabilityGraph,
  dependencyClosure,
  findDependencyCycles,
  isFutureMaturity,
  isRealizedMaturity,
  longestDependencyPath,
  maturityRank,
  nextMaturity,
  summarizeByDomain,
  summarizeTargetProgress,
  validateCapabilityRegistry,
  type Capability,
} from './capability-map';

// Fixtures pequenos e legíveis — o registro real é testado em capability-registry.test.ts.
function cap(partial: Partial<Capability> & Pick<Capability, 'id'>): Capability {
  return {
    name: partial.id,
    description: 'x',
    domain: 'agency',
    maturity: 'implemented',
    dependsOn: [],
    ...partial,
  };
}

describe('escada de maturidade', () => {
  test('nextMaturity avança na escada e para em autonomous', () => {
    expect(nextMaturity('projected')).toBe('specified');
    expect(nextMaturity('implemented')).toBe('proven');
    expect(nextMaturity('operational')).toBe('autonomous');
    expect(nextMaturity('autonomous')).toBeNull();
  });

  test('degraded mira re-provar (proven), não avançar cegamente', () => {
    expect(nextMaturity('degraded')).toBe('proven');
    // regressão fica ao lado de implemented no rank (o código existe)
    expect(maturityRank('degraded')).toBe(maturityRank('implemented'));
  });

  test('realizada = existe como código; futura = só visão/design', () => {
    expect(isRealizedMaturity('projected')).toBe(false);
    expect(isRealizedMaturity('specified')).toBe(false);
    expect(isRealizedMaturity('implemented')).toBe(true);
    expect(isRealizedMaturity('degraded')).toBe(true);
    expect(isFutureMaturity('specified')).toBe(true);
    expect(isFutureMaturity('proven')).toBe(false);
  });
});

describe('validateCapabilityRegistry', () => {
  test('um registro íntegro não gera problemas', () => {
    const caps = [cap({ id: 'a' }), cap({ id: 'b', dependsOn: ['a'] })];
    expect(validateCapabilityRegistry(caps)).toEqual([]);
  });

  test('detecta id duplicado', () => {
    const issues = validateCapabilityRegistry([cap({ id: 'a' }), cap({ id: 'a' })]);
    expect(issues.map((i) => i.code)).toContain('duplicate_id');
  });

  test('detecta dependência para capacidade inexistente', () => {
    const issues = validateCapabilityRegistry([cap({ id: 'a', dependsOn: ['ghost'] })]);
    const missing = issues.find((i) => i.code === 'missing_dependency');
    expect(missing?.message).toContain('ghost');
  });

  test('detecta unlock e parent inexistentes', () => {
    const issues = validateCapabilityRegistry([cap({ id: 'a', unlocks: ['ghost'], parentId: 'nope' })]);
    expect(issues.map((i) => i.code)).toEqual(expect.arrayContaining(['missing_unlock', 'missing_parent']));
  });

  test('detecta auto-dependência e dependência duplicada', () => {
    const issues = validateCapabilityRegistry([cap({ id: 'a', dependsOn: ['a', 'b', 'b'] }), cap({ id: 'b' })]);
    expect(issues.map((i) => i.code)).toEqual(expect.arrayContaining(['self_dependency', 'duplicate_dependency']));
  });

  test('rejeita maturidade e domínio inválidos', () => {
    const bad = { ...cap({ id: 'a' }), maturity: 'wat', domain: 'nope' } as unknown as Capability;
    const issues = validateCapabilityRegistry([bad]);
    expect(issues.map((i) => i.code)).toEqual(expect.arrayContaining(['invalid_maturity', 'invalid_domain']));
  });
});

describe('ciclos (proibidos)', () => {
  test('detecta ciclo de dependência', () => {
    const caps = [cap({ id: 'a', dependsOn: ['b'] }), cap({ id: 'b', dependsOn: ['a'] })];
    const cycles = findDependencyCycles(caps);
    expect(cycles.length).toBeGreaterThan(0);
    expect(validateCapabilityRegistry(caps).some((i) => i.code === 'dependency_cycle')).toBe(true);
  });

  test('um DAG não tem ciclo', () => {
    const caps = [cap({ id: 'a' }), cap({ id: 'b', dependsOn: ['a'] }), cap({ id: 'c', dependsOn: ['a', 'b'] })];
    expect(findDependencyCycles(caps)).toEqual([]);
  });
});

describe('buildCapabilityGraph', () => {
  test('deriva unlocks como inverso de dependsOn', () => {
    const caps = [cap({ id: 'a' }), cap({ id: 'b', dependsOn: ['a'] }), cap({ id: 'c', dependsOn: ['a'] })];
    const graph = buildCapabilityGraph(caps);
    expect(graph.byId.get('a')?.unlocks.sort()).toEqual(['b', 'c']);
    expect(graph.byId.get('b')?.unlocks).toEqual([]);
  });

  test('calcula depth como maior caminho até uma raiz', () => {
    const caps = [cap({ id: 'a' }), cap({ id: 'b', dependsOn: ['a'] }), cap({ id: 'c', dependsOn: ['b'] })];
    const graph = buildCapabilityGraph(caps);
    expect(graph.byId.get('a')?.depth).toBe(0);
    expect(graph.byId.get('b')?.depth).toBe(1);
    expect(graph.byId.get('c')?.depth).toBe(2);
  });

  test('ignora arestas quebradas mas ainda constrói o grafo', () => {
    const graph = buildCapabilityGraph([cap({ id: 'a', dependsOn: ['ghost'] })]);
    expect(graph.byId.get('a')?.dependsOn).toEqual([]);
    expect(graph.issues.some((i) => i.code === 'missing_dependency')).toBe(true);
  });

  test('é robusto a ciclo no cálculo de depth (não estoura a pilha)', () => {
    const graph = buildCapabilityGraph([cap({ id: 'a', dependsOn: ['b'] }), cap({ id: 'b', dependsOn: ['a'] })]);
    expect(graph.nodes).toHaveLength(2);
    expect(Number.isFinite(graph.byId.get('a')?.depth ?? NaN)).toBe(true);
  });
});

describe('análise do grafo', () => {
  const caps = [
    cap({ id: 'root', maturity: 'operational', domain: 'memory' }),
    cap({ id: 'mid', maturity: 'proven', domain: 'agency', dependsOn: ['root'] }),
    cap({ id: 'spec', maturity: 'specified', domain: 'agency', dependsOn: ['mid'] }),
    cap({ id: 'future', maturity: 'projected', domain: 'agency', dependsOn: ['spec', 'root'] }),
  ];
  const graph = buildCapabilityGraph(caps);

  test('summarizeByDomain conta por domínio × maturidade sem porcentagem global', () => {
    const summary = summarizeByDomain(caps);
    const agency = summary.find((s) => s.domain === 'agency');
    expect(agency?.total).toBe(3);
    expect(agency?.byMaturity.proven).toBe(1);
    expect(agency?.byMaturity.projected).toBe(1);
    const memory = summary.find((s) => s.domain === 'memory');
    expect(memory?.byMaturity.operational).toBe(1);
  });

  test('dependencyClosure retorna o fecho transitivo', () => {
    expect(dependencyClosure(graph, 'future').sort()).toEqual(['mid', 'root', 'spec']);
  });

  test('summarizeTargetProgress conta existentes vs. ainda projetadas/especificadas', () => {
    const progress = summarizeTargetProgress(graph, 'future');
    expect(progress.found).toBe(true);
    expect(progress.totalDependencies).toBe(3);
    expect(progress.existing).toBe(2); // root (operational) + mid (proven)
    expect(progress.specified).toBe(1); // spec
    expect(progress.projected).toBe(0);
    expect(progress.missing).toEqual(['spec']);
  });

  test('summarizeTargetProgress para alvo inexistente é honesto', () => {
    const progress = summarizeTargetProgress(graph, 'ghost');
    expect(progress.found).toBe(false);
    expect(progress.totalDependencies).toBe(0);
  });

  test('longestDependencyPath mostra um caminho do presente até o futuro', () => {
    const path = longestDependencyPath(graph, 'future');
    expect(path).toEqual(['root', 'mid', 'spec', 'future']);
    expect(longestDependencyPath(graph, 'ghost')).toBeNull();
  });
});
