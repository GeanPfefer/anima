import {
  buildCapabilityGraph,
  capabilityAchievement,
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
  listRecentEvolution,
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

describe('regras epistemológicas (Evolution V2)', () => {
  const proof = [{ kind: 'commit' as const, ref: 'abc1234' }];
  const codes = (caps: Capability[]) => validateCapabilityRegistry(caps).map((i) => i.code);

  test('estado forte sem prova é recusado; implemented sem prova é aceito', () => {
    expect(codes([cap({ id: 'a', maturity: 'proven' })])).toEqual(['strong_maturity_without_proof']);
    expect(codes([cap({ id: 'a', maturity: 'operational', proofRefs: proof })])).toEqual([]);
    expect(codes([cap({ id: 'a', maturity: 'implemented' })])).toEqual([]);
  });

  test('candidata externa (POC fora do Anima) nunca pode estar realizada', () => {
    const reuse = { strategy: 'wrap' as const, tool: 'x', status: 'candidate' as const };
    expect(codes([cap({ id: 'a', maturity: 'implemented', reuse })])).toEqual(['external_candidate_realized']);
    expect(codes([cap({ id: 'a', maturity: 'projected', reuse })])).toEqual([]);
    // reuso integrado pode estar realizado
    expect(codes([cap({ id: 'a', maturity: 'implemented', reuse: { ...reuse, status: 'integrated' } })])).toEqual([]);
  });

  test('história exige data válida, ordem, refs e maturity_changed com from ≠ to', () => {
    expect(codes([cap({ id: 'a', history: [{ at: '2026-13-40', change: 'proof_added', note: 'x', refs: proof }] })])).toEqual(['invalid_history']);
    expect(codes([cap({ id: 'a', history: [{ at: '2026-09-27', change: 'proof_added', note: 'x', refs: [] }] })])).toEqual(['invalid_history']);
    expect(
      codes([
        cap({
          id: 'a',
          history: [
            { at: '2026-09-27', change: 'proof_added', note: 'x', refs: proof },
            { at: '2026-09-20', change: 'proof_added', note: 'y', refs: proof },
          ],
        }),
      ]),
    ).toEqual(['invalid_history']);
    expect(
      codes([cap({ id: 'a', history: [{ at: '2026-09-27', change: 'maturity_changed', from: 'implemented', note: 'x', refs: proof }] })]),
    ).toContain('invalid_history');
  });

  test('a última mudança de maturidade registrada precisa bater com a maturidade atual', () => {
    const history = [{ at: '2026-09-27', change: 'maturity_changed' as const, from: 'implemented' as const, to: 'proven' as const, note: 'x', refs: proof }];
    expect(codes([cap({ id: 'a', maturity: 'implemented', history })])).toEqual(['history_maturity_mismatch']);
    expect(codes([cap({ id: 'a', maturity: 'proven', proofRefs: proof, history })])).toEqual([]);
    const introduced = [{ at: '2026-09-27', change: 'introduced' as const, to: 'projected' as const, note: 'x', refs: proof }];
    expect(codes([cap({ id: 'a', maturity: 'specified', history: introduced })])).toEqual(['history_maturity_mismatch']);
  });
});

describe('listRecentEvolution', () => {
  const ref = [{ kind: 'commit' as const, ref: 'abc1234' }];
  test('lista só entradas registradas desde a baseline, da mais recente para a mais antiga', () => {
    const caps = [
      cap({
        id: 'a',
        history: [
          { at: '2026-09-10', change: 'proof_added', note: 'antiga', refs: ref },
          { at: '2026-09-20', change: 'proof_added', note: 'meio', refs: ref },
        ],
      }),
      cap({ id: 'b', history: [{ at: '2026-09-27', change: 'introduced', to: 'implemented', note: 'nova', refs: ref }] }),
      cap({ id: 'c' }), // sem história ⇒ nunca "recente" por inferência
    ];
    const recent = listRecentEvolution(caps, '2026-09-16');
    expect(recent.map((r) => `${r.capabilityId}:${r.entry.note}`)).toEqual(['b:nova', 'a:meio']);
  });
});

describe('Direction safety advisory', () => {
  const { capabilityDirectionSignals } = jest.requireActual<typeof import('./capability-map')>('./capability-map');
  const capability: import('./capability-map').Capability = {
    id: 'example', name: 'Example', description: 'Example', domain: 'agency', maturity: 'projected', dependsOn: [],
    responsibility: 'reused_baseline', direction: { status: 'current_focus', rationale: 'Escolha humana', refs: [{ kind: 'doc', ref: 'plan.md' }] },
  };
  test('estratégia ausente não é inferida como BUILD', () => {
    expect(capabilityDirectionSignals(capability)).toEqual(['reuse decision missing', 'evidence needed', 'current path']);
  });
  test.each(['adopt', 'wrap', 'fork', 'build', 'undecided'] as const)('estratégia %s não altera maturidade', (strategy) => {
    const candidate = { ...capability, reuse: { strategy, tool: 'External', status: 'candidate' as const } };
    const signals = capabilityDirectionSignals(candidate);
    expect(signals).toContain('external candidate exists');
    expect(signals).toContain('evidence needed');
    expect(signals.includes('BUILD escolhido')).toBe(strategy === 'build');
    expect(signals.includes('reuse decision missing')).toBe(strategy === 'undecided');
    expect(candidate.maturity).toBe('projected');
  });
  test('validação exige referência de decisão e alvo existente', () => {
    const invalid = { ...capability, direction: { ...capability.direction!, refs: [] }, target: { description: 'Goal', steps: [{ capabilityId: 'missing', description: 'Step' }] } };
    expect(validateCapabilityRegistry([invalid]).map((issue) => issue.code)).toEqual(['invalid_direction', 'invalid_target_step']);
  });
});


test('conquista explícita não promove maturity nem nasce da integração sozinha', () => {
  const baseline = cap({id: 'baseline', maturity: 'projected', target: {achievement: 'complete', description: 'baseline'}});
  expect(capabilityAchievement(baseline)).toBe('COMPLETE / Conquistada');
  expect(baseline.maturity).toBe('projected');
  const executor = cap({id: 'executor', maturity: 'projected', reuse: {strategy: 'wrap', tool: 'CLI', status: 'integrated'}});
  expect(capabilityAchievement(executor)).toBeNull();
  executor.deliveryEvidence = {technical: {status: 'pass', label: 'Technical', refs: []}, governed: {status: 'not_demonstrated', label: 'Governed', refs: []}};
  expect(capabilityAchievement(executor)).toBe('Baseline técnico conquistado');
  executor.deliveryEvidence.governed.status = 'pass';
  expect(capabilityAchievement(executor)).toBe('Conquistada / em uso');
  expect(executor.maturity).toBe('projected');
});
