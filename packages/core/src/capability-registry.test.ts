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
    expect(get('agency.external-harness').history?.filter((h) => h.change === 'maturity_changed').at(-1)).toMatchObject({ change: 'maturity_changed', from: 'projected', to: 'implemented' });
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

describe('Evolution Reconciliation SDC-21', () => {
  const get = (id: string) => {
    const capability = ANIMA_CAPABILITY_REGISTRY_V0.find((c) => c.id === id);
    if (!capability) throw new Error(`capacidade ausente: ${id}`);
    return capability;
  };
  const text = (id: string) => {
    const c = get(id);
    return [c.description, c.meaning, c.advancement, ...(c.frontier ?? [])].join(' ');
  };
  const frontier = (id: string) => listFrontier(ANIMA_CAPABILITY_REGISTRY_V0)
    .find((entry) => entry.capabilityId === id)?.items.join(' ') ?? '';

  test('preserva todos os ids e maturities anteriores, sem autonomous; só um nó novo', () => {
    for (const [id, maturity] of Object.entries(SDC_09_MATURITIES)) {
      expect(get(id).maturity).toBe(maturity);
    }
    expect(ANIMA_CAPABILITY_REGISTRY_V0.filter((c) => c.maturity === 'autonomous')).toEqual([]);
    const added = ANIMA_CAPABILITY_REGISTRY_V0.filter((c) => !(c.id in SDC_09_MATURITIES));
    expect(added.map((c) => c.id)).toEqual(['agency.investigation-sessions']);
    expect(added[0]).toMatchObject({ domain: 'agency', maturity: 'implemented' });
    expect(ANIMA_CAPABILITY_REGISTRY_V0).toHaveLength(67);
    expect(validateCapabilityRegistry(ANIMA_CAPABILITY_REGISTRY_V0)).toEqual([]);
  });

  test('fixa maturities sensíveis e a comparação semântica de reuso da Investigation', () => {
    for (const id of ['compute.paid-settlement', 'governance.governed-integration', 'governance.candidate-recovery', 'agency.external-harness', 'agency.executor-discovery']) {
      expect(get(id).maturity).toBe('implemented');
    }
    expect(get('interaction.resident-host').maturity).toBe('operational');
    for (const id of ['agency.recovery-correction', 'agency.produce-change', 'governance.verifier']) {
      expect(get(id).maturity).toBe('proven');
    }
    const investigation = get('agency.investigation-sessions');
    for (const id of ['agency.produce-change', 'agency.external-harness', 'governance.verifier', 'interaction.action-cards', 'agency.executor-discovery', 'agency.supervised-self-development', 'agency.verify-change']) {
      expect(investigation.meaning).toContain(id);
    }
    expect(investigation.description).toMatch(/conhecimento read_only.*snapshot.*detached.*investigation-v1.*read-only\/ephemeral.*sem candidato/);
    expect(investigation.dependsOn).toEqual(['governance.authority']);
    expect(investigation.history?.[0]).toMatchObject({ change: 'introduced', to: 'implemented' });
    expect(investigation.history?.[0]?.note).toMatch(/Antes: nó ausente.*código e testes.*Sem prova canônica suficiente para proven/);
    // As hipóteses advisory não introduzem ciclos nem dependência de produção mutante.
    expect(get('governance.verifier').dependsOn).toEqual(['agency.run-tests']);
    expect(get('agency.external-harness').dependsOn).toEqual(['agency.produce-change', 'governance.authority']);
  });

  test('fronteiras humanas e capacidades missing/future sobrevivem nos nós certos', () => {
    for (const id of ['interaction.resident-host', 'agency.continuous-self-development']) {
      expect(frontier(id)).toMatch(/Classificação pós-aprovação pelo Resident Host.*missing/);
      expect(frontier(id)).toMatch(/Lifecycle autônomo.*future/);
      expect(frontier(id)).toMatch(/configuração\/autenticação/);
      expect(frontier(id)).toMatch(/executor/);
      expect(frontier(id)).toMatch(/sync.*push/);
    }
    expect(frontier('agency.continuous-self-development')).toMatch(/operador bootstrap/);
    for (const id of ['agency.investigation-sessions', 'agency.recovery-correction']) {
      expect(frontier(id)).toMatch(/Retry\/recovery genérico.*Investigation.*missing/);
      expect(frontier(id)).toContain('attempt_budget_exhausted');
      expect(frontier(id)).toContain('max_attempts=1');
      expect(frontier(id)).toMatch(/INV-08.*nova investigação.*não continuação de lineage/);
      for (const command of ['resume', 'replan', 'recover-harness', 'recover-candidate']) expect(frontier(id)).toContain(command);
    }
    for (const id of ['agency.executor-discovery', 'agency.external-harness']) {
      expect(frontier(id)).toMatch(/Descoberta durável.*Codex.*missing/);
      expect(frontier(id)).toContain('ANIMA_CODEX_CLI_PATH');
      expect(frontier(id)).toContain('PATH');
      expect(frontier(id)).toContain('versão/login');
    }
    expect(text('interaction.resident-host')).toContain('ensurePlannedProjectClassification');
    expect(text('interaction.resident-host')).toContain('work prepare-autonomous');
  });

  test('provas de integração pertencem ao primitive; Investigation não prova produção nem ciclo contínuo', () => {
    const integration = get('governance.governed-integration');
    expect(integration.proofRefs?.filter((p) => p.kind === 'commit').map((p) => p.ref))
      .toEqual(['f6117f7', '52a745e']);
    expect(integration.proofRefs?.filter((p) => p.kind === 'test').map((p) => p.ref))
      .toEqual(['apps/web/lib/work-orchestration/integration-effect.integration.test.ts', 'supabase/tests/integration_effect.test.sql']);
    expect(integration.history?.flatMap((h) => h.refs).some((p) => p.ref === '349a35e')).toBe(false);
    expect(integration.advancement).not.toContain('349a35e');
    expect(get('agency.produce-change').history?.filter((h) => h.change === 'proof_added') ?? []).toEqual([]);
    expect(get('agency.continuous-self-development').history?.filter((h) => h.change === 'proof_added')).toEqual([]);
    const verifierNote = get('governance.verifier').history?.find((h) => h.at === '2026-10-05')?.note;
    expect(verifierNote).toContain('A Investigation read_only não exige gates mutantes.');
  });

  test('Investigation justifica cada dependência candidata sem criar edges por proximidade', () => {
    const investigation = get('agency.investigation-sessions');
    const relation = investigation.history?.find((h) => h.change === 'relation_added');
    expect(investigation.dependsOn).toEqual(['governance.authority']);
    expect(relation?.note).toContain('governance.authority: request/envelope e snapshot autorizados são pré-condições');
    for (const candidate of ['agency.produce-change', 'agency.external-harness', 'governance.verifier', 'interaction.action-cards', 'agency.executor-discovery', 'agency.supervised-self-development', 'agency.verify-change', 'research.web.*']) {
      expect(relation?.note).toContain(candidate);
      expect(investigation.dependsOn).not.toContain(candidate);
    }
    expect(relation?.note).toContain('Sem edges automáticas');
  });

  test('settlement cita código canônico e preserva a barreira de prova paga', () => {
    const c = get('compute.paid-settlement');
    expect(c.advancement).not.toMatch(/pricing=null|migração.*não aplicada/);
    for (const token of ['provider-pricing-catalog.json', 'anima/provider-pricing-catalog@2026-09-28.1', 'gpt-5.6-terra', 'gpt-5.6-sol', 'provider-api-settlement.ts', 'settle', 'cost_unknown', 'fail-closed', '20260927000000', '20260927000001']) expect(c.advancement).toContain(token);
    expect(frontier(c.id)).toMatch(/Prova viva paga/);
    expect(frontier(c.id)).toContain('fora do ambiente local');
    expect(c.proofRefs?.some((p) => p.ref === 'anima-prd.md')).toBe(false);
  });

  test('integração ff_only existe, sem alegar prova local como maturity canônica', () => {
    const value = text('governance.governed-integration');
    expect(value).not.toMatch(/integration_completed[` ]*governado.*ausente|integration_completed.*esteve ausente/);
    for (const token of ['integration_effect_authorized', 'integration_completed', 'ff_only', 'CAS', 'mergeCommitSha null', 'Trusted System Writer']) expect(value).toContain(token);
    const limits = frontier('governance.governed-integration');
    for (const token of ['CLI/UX first-class', 'biblioteca', 'Clone dedicado', 'target_checked_out', 'Sync', 'manual', 'push governado', 'Modo W']) expect(limits).toContain(token);
    expect(get('governance.governed-integration').proofRefs?.some((p) => p.kind === 'event')).toBe(false);
  });

  test('reconcilia contratos, roteamento, criação oficial e diagnósticos sem prova viva fictícia', () => {
    for (const token of ['sem fallback', 'ausente/default', 'project:anima', '40 hex', 'investigation-v1']) expect(text('agency.executor-discovery')).toContain(token);
    for (const token of ['propose-investigation', 'INV-NN', 'cli_propose_investigation_v1', '1 attempt', '30 min', 'workspace_read', 'advisory', 'sem aprovar nem executar']) expect(text('interaction.action-cards')).toContain(token);
    for (const token of ['--json', 'thread.started', 'turn.failed', 'usage_limit_exceeded', 'heurística textual estreita', '401', 'unknown_native_cli_failure']) expect(text('agency.external-harness')).toContain(token);
    expect(text('governance.verifier')).toMatch(/investigation-verifier-v1 advisory.*A–E.*verified não certifica a verdade/);
    expect(text('governance.candidate-recovery')).toContain('ancestral distinto');
    expect(text('governance.candidate-recovery')).toContain('checkpoint→candidate');
    expect(text('governance.candidate-recovery')).toContain('observedChangedFilesSinceStart');
    const investigation = text('agency.investigation-sessions');
    for (const token of ['line_start_out_of_range', 'line_end_out_of_range', 'range_not_validated_file_too_large', 'antes de ler o blob', 'Ref inteira sem lines', 'transport/structure/evidence/post_rejection', 'evidence_file_too_large', 'derrubam resultado inteiro']) expect(investigation).toContain(token);
    expect(investigation).toMatch(/INV-08 só relatou mitigação de origem.*lines=null aceito sem rejeição; não exerceu ao vivo o ramo range_not_validated_file_too_large/);
    expect(get('agency.investigation-sessions').proofRefs?.find((p) => p.kind === 'test' && p.ref.endsWith('investigation-executor.worktree.test.ts'))?.note).toContain('não exercício vivo');
  });

  test('history e proofs têm refs não vazias, datas válidas, sem duplicação; evolução inclui os nós atualizados', () => {
    const updated = ['agency.recovery-correction', 'governance.candidate-recovery', 'governance.governed-integration', 'agency.continuous-self-development', 'agency.external-harness', 'agency.executor-discovery', 'governance.verifier', 'compute.paid-settlement', 'interaction.resident-host', 'interaction.action-cards', 'agency.investigation-sessions'];
    const recent = new Set(listRecentEvolution(ANIMA_CAPABILITY_REGISTRY_V0, EVOLUTION_BASELINE.date).map((r) => r.capabilityId));
    for (const id of updated) expect(recent.has(id)).toBe(true);
    for (const c of ANIMA_CAPABILITY_REGISTRY_V0) {
      const refs = (c.proofRefs ?? []).map((p) => `${p.kind}:${p.ref}`);
      expect(new Set(refs).size).toBe(refs.length);
      for (const p of c.proofRefs ?? []) expect(p.ref.trim()).not.toBe('');
      const history = c.history ?? [];
      expect(new Set(history.map((h) => JSON.stringify(h))).size).toBe(history.length);
      for (const h of history) {
        expect(h.at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(new Date(`${h.at}T00:00:00Z`).toISOString().slice(0, 10)).toBe(h.at);
        expect(h.refs.length).toBeGreaterThan(0);
        expect(new Set(h.refs.map((p) => `${p.kind}:${p.ref}`)).size).toBe(h.refs.length);
        for (const p of h.refs) expect(p.ref.trim()).not.toBe('');
      }
      // SDC-21 não adiciona nenhuma transição de maturity às capacidades existentes.
      if (c.id in SDC_09_MATURITIES) {
        expect(history.filter((h) => h.change === 'maturity_changed' && h.at >= '2026-10-05')).toEqual([]);
      }
    }
  });
});

function graph() {
  return getAnimaCapabilityGraph();
}

// Snapshot dos 66 ids/maturities do registry 44db504 (antes do SDC-21).
const SDC_09_MATURITIES: Readonly<Record<string, string>> = {
  'understanding.entities': 'operational',
  'understanding.pillars': 'operational',
  'understanding.pillar-inference': 'proven',
  'understanding.projects': 'proven',
  'understanding.world-model': 'projected',
  'understanding.github-attention': 'projected',
  'memory.persistence': 'operational',
  'memory.event-history': 'operational',
  'memory.context-recovery': 'proven',
  'memory.continuity': 'proven',
  'memory.narrative-memory': 'projected',
  'memory.durability': 'projected',
  'memory.evolution-history': 'projected',
  'memory.architectural-memory': 'projected',
  'memory.cross-harness': 'implemented',
  'agency.edit-file': 'operational',
  'agency.run-tests': 'operational',
  'agency.isolated-workspace': 'operational',
  'agency.produce-change': 'proven',
  'agency.verify-change': 'proven',
  'agency.recovery-correction': 'proven',
  'governance.candidate-recovery': 'implemented',
  'governance.governed-integration': 'implemented',
  'agency.supervised-self-development': 'proven',
  'agency.detect-deficiency': 'proven',
  'agency.formulate-improvement': 'implemented',
  'agency.validate-improvement': 'projected',
  'agency.continuous-self-development': 'projected',
  'agency.recovery-evidence': 'implemented',
  'agency.reuse-discovery': 'projected',
  'agency.external-harness': 'implemented',
  'agency.executor-discovery': 'implemented',
  'governance.authority': 'proven',
  'governance.attempt': 'operational',
  'governance.review': 'operational',
  'governance.verifier': 'proven',
  'governance.budgets': 'operational',
  'governance.recovery-authority': 'proven',
  'governance.harness-recovery': 'proven',
  'governance.differential-evidence': 'implemented',
  'governance.external-tool-boundary': 'implemented',
  'governance.progressive-autonomy': 'specified',
  'compute.local-execution': 'operational',
  'compute.external-provider': 'proven',
  'compute.selection': 'proven',
  'compute.unit-preference': 'proven',
  'compute.subscription-availability': 'projected',
  'compute.provisioning': 'proven',
  'compute.cloud-self-hosted': 'implemented',
  'compute.paid-settlement': 'implemented',
  'interaction.chat': 'operational',
  'interaction.web-interface': 'operational',
  'interaction.resident-host': 'operational',
  'interaction.action-cards': 'operational',
  'interaction.local-executor-arm': 'specified',
  'interaction.cognitive-proactivity': 'projected',
  'research.query-privacy': 'proven',
  'research.web.search': 'proven',
  'research.web.network-boundary': 'implemented',
  'research.web.isolated-runtime': 'projected',
  'research.web.open': 'proven',
  'research.web.extract': 'proven',
  'research.web.navigate': 'implemented',
  'research.web.cite': 'specified',
  'research.web.compare': 'projected',
  'research.web.persist-findings': 'projected',
};
