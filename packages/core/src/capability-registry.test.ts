import {
  CAPABILITY_DOMAINS,
  CAPABILITY_MATURITIES,
  isFutureMaturity,
  isRealizedMaturity,
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

  test('SearXNG e agent-browser são reuso INTEGRADO; candidatos permanecem futuros', () => {
    expect(get('research.web.search').reuse).toMatchObject({ tool: 'SearXNG', strategy: 'wrap', status: 'integrated' });
    expect(get('research.web.open').reuse).toMatchObject({ tool: 'agent-browser', strategy: 'wrap', status: 'integrated' });
    const candidates = ANIMA_CAPABILITY_REGISTRY_V0.filter((c) => c.reuse?.status === 'candidate');
    expect(candidates.map((c) => c.reuse?.tool).sort()).toEqual(['Claude Code', 'Claude Code / Codex CLI', 'ai-memory', 'ai-usagebar', 'ghpending']);
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

describe('Akita Baseline — direção não concede maturidade', () => {
  const get = (id: string) => ANIMA_CAPABILITY_REGISTRY_V0.find((c) => c.id === id)!;
  test('objetivo preserva sequência planejada e dependências sem ciclos', () => {
    const baseline = get('agency.akita-baseline-v1');
    expect(baseline.target?.steps?.map((step) => step.capabilityId)).toEqual([
      'agency.codex-cli', 'agency.claude-code', 'memory.cross-harness', 'agency.continuous-self-development',
    ]);
    expect(baseline.dependsOn).toEqual(['agency.codex-cli', 'agency.claude-code', 'memory.cross-harness']);
    expect(validateCapabilityRegistry(ANIMA_CAPABILITY_REGISTRY_V0)).toEqual([]);
  });
  test('WRAP e CURRENT FOCUS não promovem candidatos', () => {
    for (const id of ['agency.claude-code', 'memory.cross-harness', 'agency.external-harness']) {
      const capability = get(id);
      expect(capability.reuse?.strategy).toBe('wrap');
      expect(capability.reuse?.status).toBe('candidate');
      expect(capability.maturity).toBe('projected');
      expect(capability.proofRefs ?? []).toEqual([]);
      expect(capability.direction?.refs.length).toBeGreaterThan(0);
    }
    expect(get('agency.codex-cli').direction?.status).toBe('current_focus');
    expect(get('agency.claude-code').direction?.status).toBe('next');
    expect(get('memory.cross-harness').direction?.status).toBe('next');
  });
  test('pesquisa preserva provas sem bloquear baseline', () => {
    for (const id of ['agency.ollama-agentic-runtime', 'agency.deepseek-harness']) {
      expect(get(id).direction?.status).toBe('experimental');
      expect(get(id).maturity).toBe('proven');
      expect(get(id).proofRefs?.length).toBeGreaterThan(0);
      expect(get('agency.akita-baseline-v1').dependsOn).not.toContain(id);
    }
    expect(get('compute.cloud-self-hosted').direction?.status).toBe('parked');
    expect(get('compute.cloud-self-hosted').maturity).toBe('implemented');
    expect(get('agency.produce-change').maturity).toBe('proven');
    expect(get('governance.authority').maturity).toBe('proven');
  });
});

test('Codex integrado com prova técnica não governada preserva maturidade e não concede provas canônicas', () => {
  const codex = ANIMA_CAPABILITY_REGISTRY_V0.find((c) => c.id === 'agency.codex-cli')!;
  expect(codex.reuse).toMatchObject({ strategy: 'wrap', status: 'integrated' });
  expect(codex.direction?.status).toBe('current_focus');
  expect(codex.maturity).toBe('projected');
  expect(codex.proofRefs ?? []).toEqual([]);
  expect(codex.history?.[0]).toMatchObject({ change: 'proof_added', at: '2026-10-02' });
  expect(codex.history?.[0]?.note).toContain('governed proof not yet demonstrated');
  expect(codex.history?.[0]?.refs).toContainEqual(expect.objectContaining({ kind: 'record', ref: 'docs/registros/2026-10-02-akita-baseline-v1-codex-live-proof.md' }));
});
