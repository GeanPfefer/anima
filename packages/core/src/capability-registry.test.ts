import {
  CAPABILITY_DOMAINS,
  CAPABILITY_MATURITIES,
  isFutureMaturity,
  isRealizedMaturity,
  listFrontier,
  listRecentEvolution,
  longestDependencyPath,
  summarizeTargetProgress,
  validateCapabilityRegistry,
} from './capability-map';
import { ANIMA_CAPABILITY_REGISTRY_V0, EVOLUTION_BASELINE, getAnimaCapabilityGraph } from './capability-registry';

describe('Capability Registry V0 (Anima)', () => {
  const graph = getAnimaCapabilityGraph();

  test('o registro é um grafo íntegro (sem ids duplicados, refs quebradas ou ciclos)', () => {
    expect(validateCapabilityRegistry(ANIMA_CAPABILITY_REGISTRY_V0)).toEqual([]);
    expect(graph.issues).toEqual([]);
  });

  test('tem tamanho legível (Evolution V2: 40 da V0 + delta reconciliado)', () => {
    expect(ANIMA_CAPABILITY_REGISTRY_V0.length).toBeGreaterThanOrEqual(40);
    expect(ANIMA_CAPABILITY_REGISTRY_V0.length).toBeLessThanOrEqual(70);
  });

  test('todo domínio e toda maturidade são valores válidos', () => {
    for (const c of ANIMA_CAPABILITY_REGISTRY_V0) {
      expect(CAPABILITY_DOMAINS).toContain(c.domain);
      expect(CAPABILITY_MATURITIES).toContain(c.maturity);
    }
  });

  test('cobre todos os domínios canônicos (inclui research na V2)', () => {
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

describe('Evolution Reconciliation V2 — honestidade epistemológica do registro', () => {
  const byId = new Map(ANIMA_CAPABILITY_REGISTRY_V0.map((c) => [c.id, c]));
  const get = (id: string) => {
    const c = byId.get(id);
    if (!c) throw new Error(`capacidade ausente: ${id}`);
    return c;
  };

  test('nada é autônomo hoje', () => {
    expect(ANIMA_CAPABILITY_REGISTRY_V0.filter((c) => c.maturity === 'autonomous')).toEqual([]);
  });

  test('Research Web V1 aparece com a maturidade que a prova viva sustenta — e nada operacional', () => {
    expect(get('research.web.search').maturity).toBe('proven');
    expect(get('research.web.open').maturity).toBe('proven');
    expect(get('research.web.extract').maturity).toBe('proven');
    expect(get('research.query-privacy').maturity).toBe('proven');
    // navigate não teve prova própria; a política de rede não é boundary de segurança
    expect(get('research.web.navigate').maturity).toBe('implemented');
    expect(get('research.web.network-boundary').maturity).toBe('implemented');
    for (const c of ANIMA_CAPABILITY_REGISTRY_V0.filter((x) => x.domain === 'research')) {
      expect(['operational', 'autonomous']).not.toContain(c.maturity);
    }
  });

  test('composições de pesquisa ainda não construídas ficam no futuro', () => {
    for (const id of ['research.web.cite', 'research.web.compare', 'research.web.persist-findings', 'research.web.isolated-runtime', 'agency.reuse-discovery']) {
      expect(isFutureMaturity(get(id).maturity)).toBe(true);
    }
  });

  test('SearXNG e agent-browser são reuso INTEGRADO; os demais POCs são só candidatos futuros', () => {
    expect(get('research.web.search').reuse).toMatchObject({ tool: 'SearXNG', strategy: 'wrap', status: 'integrated' });
    expect(get('research.web.open').reuse).toMatchObject({ tool: 'agent-browser', strategy: 'wrap', status: 'integrated' });
    const candidates = ANIMA_CAPABILITY_REGISTRY_V0.filter((c) => c.reuse?.status === 'candidate');
    expect(candidates.map((c) => c.reuse?.tool).sort()).toEqual(['ai-usagebar', 'ghpending']);
    for (const c of candidates) {
      expect(isFutureMaturity(c.maturity)).toBe(true);
      // Evidência externa nunca vira prova de funcionamento do Anima.
      expect(c.proofRefs ?? []).toEqual([]);
    }
  });

  test('novas direções (durabilidade, história, memória arquitetural) são só visão', () => {
    for (const id of ['memory.durability', 'memory.evolution-history', 'memory.architectural-memory']) {
      expect(get(id).maturity).toBe('projected');
    }
    expect(get('agency.continuous-self-development').dependsOn).toContain('memory.architectural-memory');
  });

  test('toda promoção desde a baseline está registrada em history com refs reais', () => {
    const promoted: Record<string, string> = {
      'agency.run-tests': 'operational',
      'agency.detect-deficiency': 'proven',
      'agency.formulate-improvement': 'implemented',
    };
    for (const [id, to] of Object.entries(promoted)) {
      const change = get(id).history?.filter((h) => h.change === 'maturity_changed').at(-1);
      expect(change?.to).toBe(to);
      expect(change?.refs.length).toBeGreaterThan(0);
    }
  });

  test('capacidades com divergência declarado×derivado não foram promovidas sem critério', () => {
    // O Proof Engine deriva "operational" por contagem de ocasiões, mas o critério
    // declarado (confiabilidade / resistir à revisão humana) não foi atingido.
    for (const id of ['agency.produce-change', 'agency.verify-change', 'governance.verifier']) {
      expect(get(id).maturity).toBe('proven');
    }
  });

  test('"Evolução recente" desde a baseline cobre Research Web e recovery, e nada antes da baseline', () => {
    const recent = listRecentEvolution(ANIMA_CAPABILITY_REGISTRY_V0, EVOLUTION_BASELINE.date);
    const ids = new Set(recent.map((r) => r.capabilityId));
    expect(ids.has('research.web.search')).toBe(true);
    expect(ids.has('governance.harness-recovery')).toBe(true);
    expect(recent.every((r) => r.entry.at >= EVOLUTION_BASELINE.date)).toBe(true);
    expect(ids.has('interaction.chat')).toBe(false);
  });
});

describe('Evolution Reconciliation SDC-09 — ciclo SDC-01→SDC-08', () => {
  const byId = new Map(ANIMA_CAPABILITY_REGISTRY_V0.map((c) => [c.id, c]));
  const get = (id: string) => {
    const c = byId.get(id);
    if (!c) throw new Error(`capacidade ausente: ${id}`);
    return c;
  };
  const commitRefs = (id: string) => (get(id).proofRefs ?? []).filter((p) => p.kind === 'commit').map((p) => p.ref);

  test('capacidades recentes aparecem em `implemented`, não mais, ancoradas em commits reais', () => {
    const expected: Record<string, string[]> = {
      'agency.external-harness': ['9404bd4', 'cd73276', 'f518d0d', '6eb2dee'],
      'agency.executor-discovery': ['6f7577f'],
      'memory.cross-harness': ['2e153ed'],
      'governance.candidate-recovery': ['4bc07fa', 'd4db97f'],
      'governance.governed-integration': ['f6117f7', '52a745e'],
    };
    for (const [id, commits] of Object.entries(expected)) {
      expect(get(id).maturity).toBe('implemented');
      for (const commit of commits) expect(commitRefs(id)).toContain(commit);
    }
  });

  test('uso real reportado pelo operador não promove nada: o harness e a recuperação não são comprovados', () => {
    for (const id of ['agency.external-harness', 'governance.candidate-recovery', 'governance.governed-integration', 'memory.cross-harness']) {
      expect(['proven', 'operational', 'autonomous']).not.toContain(get(id).maturity);
    }
    expect(ANIMA_CAPABILITY_REGISTRY_V0.filter((c) => c.maturity === 'autonomous')).toEqual([]);
  });

  test('harness externo e ai-memory deixaram de ser candidatos externos (reuso integrado)', () => {
    expect(get('agency.external-harness').reuse).toMatchObject({ strategy: 'wrap', status: 'integrated' });
    expect(get('memory.cross-harness').reuse).toMatchObject({ tool: 'ai-memory', status: 'integrated' });
    expect(get('agency.external-harness').history?.at(-1)).toMatchObject({ change: 'maturity_changed', from: 'projected', to: 'implemented' });
  });

  test('o operador externo é fronteira, não capacidade: nenhum nó o modela', () => {
    expect(byId.has('agency.self-dev-operator')).toBe(false);
    for (const c of ANIMA_CAPABILITY_REGISTRY_V0) expect(c.dependsOn ?? []).not.toContain('agency.self-dev-operator');
    for (const id of ['agency.continuous-self-development', 'governance.progressive-autonomy']) {
      expect(get(id).maturity).not.toBe('autonomous');
    }
    const continuous = (get('agency.continuous-self-development').frontier ?? []).join(' ');
    expect(continuous).toMatch(/Claude Desktop/);
    expect(continuous).toMatch(/push/);
    expect(continuous).toMatch(/Migration e deploy/);
    expect(continuous).toMatch(/executor/);
  });

  test('memory.cross-harness: só o wrap opcional está implementado; a correlação com attempt/lineage é fronteira', () => {
    const c = get('memory.cross-harness');
    expect(c.maturity).toBe('implemented');
    expect(c.description).toMatch(/apenas o wrap opcional/);
    expect(c.description).toMatch(/NÃO está implementada a correlação automática/);
    expect((c.frontier ?? []).join(' ')).toMatch(/correlacionar automaticamente/);
  });

  test('limites conhecidos ficam visíveis como fronteira nas capacidades certas', () => {
    const frontier = listFrontier(ANIMA_CAPABILITY_REGISTRY_V0);
    const ids = frontier.map((f) => f.capabilityId);
    for (const id of ['governance.candidate-recovery', 'governance.governed-integration', 'agency.verify-change', 'agency.continuous-self-development']) {
      expect(ids).toContain(id);
    }
    const recovery = (get('governance.candidate-recovery').frontier ?? []).join(' ');
    expect(recovery).toMatch(/corrections/);
    expect(recovery).toMatch(/encade/);
    expect(recovery).toMatch(/Gates sequenciais/);
    expect((get('governance.governed-integration').frontier ?? []).join(' ')).toMatch(/integration_completed/);
  });

  test('correção por retomada ganhou prova de commit, mas segue comprovada (não operacional)', () => {
    const recovery = get('agency.recovery-correction');
    expect(recovery.maturity).toBe('proven');
    for (const commit of ['a15698f', '5aad729', '243b740']) expect(commitRefs('agency.recovery-correction')).toContain(commit);
  });

  test('a Evolução recente inclui o ciclo SDC-01→SDC-08', () => {
    const ids = new Set(listRecentEvolution(ANIMA_CAPABILITY_REGISTRY_V0, EVOLUTION_BASELINE.date).map((r) => r.capabilityId));
    for (const id of ['agency.external-harness', 'governance.candidate-recovery', 'governance.governed-integration', 'interaction.action-cards']) {
      expect(ids.has(id)).toBe(true);
    }
  });
});

function graph() {
  return getAnimaCapabilityGraph();
}
