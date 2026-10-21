import { existsSync } from 'fs';
import { join } from 'path';
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

  test('"Evolução recente" desde a baseline cobre as sete capacidades V6, e nada antes da baseline', () => {
    const recent = listRecentEvolution(ANIMA_CAPABILITY_REGISTRY_V0, EVOLUTION_BASELINE.date);
    const ids = new Set(recent.map((r) => r.capabilityId));
    for (const id of V6_CAPABILITY_IDS) expect(ids.has(id)).toBe(true);
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

  test('a Evolução recente inclui as sete capacidades reconciliadas em V6', () => {
    const ids = new Set(listRecentEvolution(ANIMA_CAPABILITY_REGISTRY_V0, EVOLUTION_BASELINE.date).map((r) => r.capabilityId));
    for (const id of V6_CAPABILITY_IDS) {
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
    expect(text('interaction.resident-host')).toMatch(/work prepare-autonomous.*fallback manual/);
  });

  test('SDC-23 descreve classificação T3 opt-in e prova viva parcial sem promoção', () => {
    const host = text('interaction.resident-host');
    for (const term of ['SDC-22', 'T3', 'canonical_backlog_v1', 'cli_propose_investigation_v1', 'fila do host-turn', 'ANIMA_POST_APPROVAL_CLASSIFICATION=1', 'ANIMA_POST_APPROVAL_CLASSIFICATION_SINCE', 'ISO-8601 com fuso']) {
      expect(host).toContain(term);
    }
    expect(host).toMatch(/INV-09.*UMA ocasião viva.*só no ramo Investigation.*sem prepare-autonomous.*user_attempt_budget_exhausted.*zero attempts.*sem promoção/);
    expect(host).toMatch(/canonical_backlog_v1.*código e testes.*sem prova viva equivalente/);
    expect(host).toMatch(/controles negativos só.*testes/);
    for (const id of ['interaction.resident-host', 'agency.continuous-self-development']) {
      const current = text(id);
      for (const term of ['opt-in', 'flag', 'cutoff', 'default off', 'planners/chat', 'sucessores de recovery/correção', 'approve', 'supervise', 'humanos']) {
        expect(current.toLowerCase()).toContain(term.toLowerCase());
      }
      expect(current).toMatch(/work prepare-autonomous.*fallback manual.*demais origens/);
      expect(current).not.toMatch(/default[- ]on|habilitad[ao] por padrão/);
    }
    expect(frontier('agency.continuous-self-development')).toMatch(/Retry\/recovery genérico.*Investigation.*missing/);
    expect(frontier('agency.continuous-self-development')).toMatch(/Migration e deploy.*humanos/);
    expect(frontier('interaction.resident-host')).toMatch(/Recovery\/rework/);
    for (const c of ANIMA_CAPABILITY_REGISTRY_V0) {
      const claims = [c.description, c.meaning, c.advancement, ...(c.frontier ?? []), ...(c.history ?? []).map((h) => h.note)];
      // Uma claim não pode atravessar outra frontier nem outra frase do mesmo item.
      for (const claim of claims) {
        expect(claim ?? '').not.toMatch(/Classificação pós-aprovação pelo Resident Host[^.!?]*?é missing|Host não classifica aprovados não classificados/);
      }
    }
    expect(get('agency.continuous-self-development').maturity).toBe('projected');
    expect(get('agency.investigation-sessions').maturity).toBe('implemented');
    expect(ANIMA_CAPABILITY_REGISTRY_V0.filter((c) => isRealizedMaturity(c.maturity))).toHaveLength(50);
    expect(ANIMA_CAPABILITY_REGISTRY_V0.filter((c) => isFutureMaturity(c.maturity))).toHaveLength(17);
    expect(EVOLUTION_BASELINE).toEqual({ commit: 'e2fa7a8', date: '2026-10-20', label: 'Evolution Reconciliation V6' });
    const resident = get('interaction.resident-host');
    const added = resident.history?.filter((h) => h.at === '2026-10-07') ?? [];
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ change: 'proof_added' });
    expect(added[0]?.note).toMatch(/SDC-22.*T3.*INV-09.*uma ocasião viva.*operational preservada/);
    expect(added[0]?.refs).toEqual([
      { kind: 'commit', ref: '534a1bd' },
      { kind: 'commit', ref: '6efcc68' },
      { kind: 'record', ref: 'docs/registros/2026-10-07-sdc22-post-approval-classification-live-proof.md' },
    ]);
    expect(resident.proofRefs).toEqual(expect.arrayContaining([
      { kind: 'commit', ref: '534a1bd', note: expect.any(String) },
      ...['post-approval-classification', 'backlog-host-turn-run'].flatMap((name) => [
        { kind: 'doc', ref: `apps/web/lib/work-orchestration/${name}.ts` },
        { kind: 'test', ref: `apps/web/lib/work-orchestration/${name}.test.ts` },
      ]),
    ]));
  });

  test('provas de integração pertencem ao primitive; Investigation não prova produção nem ciclo contínuo', () => {
    const integration = get('governance.governed-integration');
    expect(integration.proofRefs?.filter((p) => p.kind === 'commit').map((p) => p.ref))
      .toEqual(['1a18fc8', '1f4b052', '3c7aab8', '828f2d1', '51a7919', 'c7a5571', '64270c8', '038cc62', '4060390', 'a7d0ca4', '704e959', 'af9c557', 'f6117f7', '52a745e']);
    expect(integration.proofRefs?.filter((p) => p.kind === 'test').map((p) => p.ref))
      .toEqual(['apps/web/lib/work-orchestration/integration-effect.integration.test.ts', 'supabase/tests/integration_effect.test.sql']);
    expect(integration.history?.flatMap((h) => h.refs).some((p) => p.ref === '349a35e')).toBe(false);
    expect(integration.advancement).not.toContain('349a35e');
    const produceChangeProofRefs = get('agency.produce-change').proofRefs?.map((p) => p.ref) ?? [];
    for (const ref of ['3bfa619', '2d8546f', 'apps/web/lib/work-orchestration/executor-selection.ts']) {
      expect(produceChangeProofRefs).not.toContain(ref);
    }
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
    const updated = V6_CAPABILITY_IDS;
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

// Universo fechado autorizado para as novas entradas V6 (kind:ref).
const V6_ALLOWED_REFS = new Set([
  ...['2e153ed', 'd32a902', '1d6a7bb', '901a774', 'a6ebfa6', 'eb1f3eb', '7d3cf0e', 'e2fa7a8',
    '2888118', '921634d', '7863c01', 'd72ddf5'].map((ref) => `commit:${ref}`),
  ...['499b6222', '38e39912'].map((ref) => `work_item:${ref}`),
  ...['2026-10-21-evolution-reconciliation-v6', '2026-10-20-l1-codex-wsl-perfil-nativo',
    '2026-10-15-a1-v2-prova-execucao-independente-congelada', '2026-10-17-a2-0-r1-prova-operacional-a2r1-proof',
    '2026-10-17-a2-0-r2-composicao-operacional', '2026-10-20-ux-trabalhos-incremento-1']
    .map((name) => `record:docs/registros/${name}.md`),
  'doc:docs/arquitetura/gate-isolation-prototype.md',
]);

// Dependências congeladas dos sete nós V6: a reconciliação não altera relações.
const V6_DEPENDS_ON: Record<(typeof V6_CAPABILITY_IDS)[number], string[]> = {
  'memory.cross-harness': ['agency.external-harness', 'memory.continuity'],
  'agency.external-harness': ['agency.produce-change', 'governance.authority'],
  'agency.isolated-workspace': [],
  'governance.governed-integration': ['governance.review', 'agency.supervised-self-development'],
  'agency.supervised-self-development': ['agency.produce-change', 'agency.verify-change', 'governance.review', 'interaction.resident-host'],
  'governance.authority': ['memory.persistence'],
  'interaction.web-interface': ['memory.persistence'],
};

describe('Evolution Reconciliation V6', () => {
  const get = (id: string) => {
    const capability = ANIMA_CAPABILITY_REGISTRY_V0.find((c) => c.id === id);
    if (!capability) throw new Error(`capacidade ausente: ${id}`);
    return capability;
  };
  const frontier = (id: string) => (get(id).frontier ?? []).join(' ');
  const v6Entries = (id: string) => (get(id).history ?? []).filter((entry) => entry.at === '2026-10-21');

  test('baseline V6 é e2fa7a8 de 2026-10-20 e nenhuma entrada V6 antecede a baseline', () => {
    expect(EVOLUTION_BASELINE).toEqual({ commit: 'e2fa7a8', date: '2026-10-20', label: 'Evolution Reconciliation V6' });
    for (const id of V6_CAPABILITY_IDS) expect(v6Entries(id).every((entry) => entry.at >= EVOLUTION_BASELINE.date)).toBe(true);
  });

  test('maturity conservadora: nada promovido, nada autônomo, mesma distribuição e relações congeladas', () => {
    const maturities: Record<(typeof V6_CAPABILITY_IDS)[number], string> = {
      'memory.cross-harness': 'implemented',
      'agency.external-harness': 'implemented',
      'agency.isolated-workspace': 'operational',
      'governance.governed-integration': 'implemented',
      'agency.supervised-self-development': 'proven',
      'governance.authority': 'proven',
      'interaction.web-interface': 'operational',
    };
    for (const id of V6_CAPABILITY_IDS) {
      expect(get(id).maturity).toBe(maturities[id]);
      expect(get(id).dependsOn).toEqual(V6_DEPENDS_ON[id]);
    }
    expect(ANIMA_CAPABILITY_REGISTRY_V0).toHaveLength(67);
    expect(ANIMA_CAPABILITY_REGISTRY_V0.filter((c) => c.maturity === 'autonomous')).toEqual([]);
    const counts: Record<string, number> = {};
    for (const capability of ANIMA_CAPABILITY_REGISTRY_V0) counts[capability.maturity] = (counts[capability.maturity] ?? 0) + 1;
    expect(counts).toEqual({ operational: 15, proven: 21, projected: 14, implemented: 14, specified: 3 });
  });

  test('cada nó V6 tem uma única entrada proof_added sem transição, com refs do universo autorizado', () => {
    for (const id of V6_CAPABILITY_IDS) {
      const entries = v6Entries(id);
      expect(entries).toHaveLength(1);
      const entry = entries[0];
      if (!entry) throw new Error(`history V6 ausente: ${id}`);
      expect(entry.change).toBe('proof_added');
      expect(entry.from).toBeUndefined();
      expect(entry.to).toBeUndefined();
      expect(entry.refs.length).toBeGreaterThan(0);
      for (const ref of entry.refs) {
        expect(ref.kind).not.toBe('event');
        expect(V6_ALLOWED_REFS.has(`${ref.kind}:${ref.ref}`)).toBe(true);
      }
    }
    expect(v6Entries('compute.subscription-availability')).toEqual([]);
  });

  test('registros, documentos e testes citados pelas entradas e provas V6 existem no repositório', () => {
    const root = join(__dirname, '..', '..', '..');
    for (const id of [...V6_CAPABILITY_IDS, 'compute.subscription-availability']) {
      const refs = [...(get(id).proofRefs ?? []), ...v6Entries(id).flatMap((entry) => entry.refs)];
      for (const ref of refs) {
        if (['record', 'doc', 'test'].includes(ref.kind) && /\.(md|ts|tsx|sql|ps1)$/.test(ref.ref)) {
          expect({ ref: ref.ref, exists: existsSync(join(root, ref.ref)) }).toEqual({ ref: ref.ref, exists: true });
        }
      }
    }
  });

  test('prova de laboratório do ai-memory não promove nem afirma compatibilidade com Codex WSL/L1', () => {
    const cross = get('memory.cross-harness');
    expect(cross.maturity).toBe('implemented');
    expect(cross.reuse).toMatchObject({ tool: 'ai-memory', status: 'integrated' });
    expect(v6Entries('memory.cross-harness')[0]?.note).toMatch(/LABORATÓRIO.*Não é prova no residente.*não cobre Codex WSL\/L1.*não promove a maturity/);
    expect(frontier('memory.cross-harness')).toMatch(/Não suportado no Codex WSL\/L1/);
    expect(frontier('memory.cross-harness')).toMatch(/Compatibilidade com Codex WSL\/L1 não é afirmada/);
    expect(frontier('memory.cross-harness')).toMatch(/correlacionar automaticamente/);
    expect(cross.advancement).toMatch(/LABORATÓRIO/);
    expect(cross.advancement).toMatch(/Sem prova no residente/);
  });

  test('provas de laboratório e do residente ficam distinguidas nos nós de autonomia e execução', () => {
    expect(frontier('governance.authority')).toMatch(/DESCARTÁVEL/);
    expect(frontier('governance.authority')).toContain('20261017000000/1 não estão aplicadas no residente');
    expect(frontier('governance.authority')).toContain('ANIMA_TRUSTED_REPO_ROOT');
    expect(frontier('governance.authority')).toMatch(/nunca vira unattended_verified/);
    expect(v6Entries('governance.authority')[0]?.note).toMatch(/Prova de LABORATÓRIO.*não há prova no residente/);
    expect(frontier('agency.supervised-self-development')).toMatch(/autonomia não comprovada/);
    expect(frontier('agency.supervised-self-development')).toMatch(/unattended_verified permanece 0/);
    expect(frontier('agency.supervised-self-development')).toMatch(/RESIDENTE/);
    expect(frontier('agency.external-harness')).toMatch(/LABORATÓRIO/);
    expect(frontier('agency.external-harness')).toMatch(/ai-memory não é suportado no Codex WSL\/L1/);
    expect(frontier('agency.external-harness')).toMatch(/quota/);
    expect(frontier('compute.subscription-availability')).toMatch(/decisão humana aberta/);
    expect(frontier('agency.isolated-workspace')).toMatch(/não no residente/);
  });

  test('integração: um recibo versionado não vira prova canônica geral; UX I2 fica fora da baseline', () => {
    expect(frontier('governance.governed-integration')).toMatch(/apenas UMA integração/);
    expect(get('governance.governed-integration').proofRefs?.some((p) => p.kind === 'event')).toBe(false);
    expect(frontier('interaction.web-interface')).toMatch(/UX I2.*NÃO integrado/);
    for (const capability of ANIMA_CAPABILITY_REGISTRY_V0) {
      for (const ref of capability.proofRefs ?? []) expect(ref.ref).not.toContain('34ccf85');
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

const V5_CAPABILITY_IDS = [
  'governance.verifier', 'agency.verify-change', 'agency.supervised-self-development',
  'governance.governed-integration', 'governance.budgets', 'agency.external-harness',
  'interaction.resident-host',
] as const;

const V6_CAPABILITY_IDS = [
  'memory.cross-harness', 'agency.external-harness', 'agency.isolated-workspace',
  'governance.governed-integration', 'agency.supervised-self-development',
  'governance.authority', 'interaction.web-interface',
] as const;

// Universo fechado autorizado para as novas entradas V5 (kind:ref).
const V5_ALLOWED_REFS = new Set([
  ...['1a18fc8', '1f4b052', '3c7aab8', '828f2d1', '51a7919', 'c7a5571',
    '64270c8', '038cc62', '4060390', 'a7d0ca4', '704e959', 'af9c557',
    'db75ce0', 'bbb9c0e', 'a4f46f8', 'fcb8243', '6226324'].map((ref) => `commit:${ref}`),
  ...['d795e414', '8e24f4a8', 'fc3b841c', '8013c5e2', 'b972846e', '46b23286',
    '42053b69', 'aa3a860c', '9a7503ec', '5f573801', '4c47e9e3', 'c42ccb12']
    .map((ref) => `work_item:${ref}`),
  'event:86647',
  ...['2026-10-13-single-item-gate-integracao', '2026-10-13-single-item-promocao-residente',
    '2026-10-10-single-item-integracao-wsl', '2026-10-10-single-item-terminal-prova']
    .map((name) => `record:docs/registros/${name}.md`),
  'doc:supabase/migrations/20260905000004_human_supervised_work.sql',
  'doc:supabase/migrations/20261008000000_single_item_work_claim.sql',
]);

describe('Evolution Reconciliation V5', () => {
  const get = (id: string) => {
    const capability = ANIMA_CAPABILITY_REGISTRY_V0.find((c) => c.id === id);
    if (!capability) throw new Error(`capacidade ausente: ${id}`);
    return capability;
  };

  test('congela maturities, distribuição e todos os 67 ids', () => {
    const maturities = ['proven', 'proven', 'proven', 'implemented', 'operational', 'implemented', 'operational'];
    V5_CAPABILITY_IDS.forEach((id, index) => expect(get(id).maturity).toBe(maturities[index]));
    expect(ANIMA_CAPABILITY_REGISTRY_V0).toHaveLength(67);
    expect(ANIMA_CAPABILITY_REGISTRY_V0.map((c) => c.id).sort())
      .toEqual([...Object.keys(SDC_09_MATURITIES), 'agency.investigation-sessions'].sort());
    const counts: Record<string, number> = {};
    for (const capability of ANIMA_CAPABILITY_REGISTRY_V0) {
      counts[capability.maturity] = (counts[capability.maturity] ?? 0) + 1;
    }
    expect(counts).toEqual({ operational: 15, proven: 21, projected: 14, implemented: 14, specified: 3 });
  });

  test('cada capacidade tem uma entrada proof_added V5 com refs do universo autorizado', () => {
    for (const id of V5_CAPABILITY_IDS) {
      const entries = get(id).history?.filter((entry) => entry.at === '2026-10-14') ?? [];
      expect(entries).toHaveLength(1);
      const entry = entries[0];
      if (!entry) throw new Error(`history V5 ausente: ${id}`);
      expect(entry.change).toBe('proof_added');
      expect(entry.from).toBeUndefined();
      expect(entry.to).toBeUndefined();
      expect(entry.refs.length).toBeGreaterThan(0);
      for (const ref of entry.refs) {
        expect(ref.ref.trim()).not.toBe('');
        expect(V5_ALLOWED_REFS.has(`${ref.kind}:${ref.ref}`)).toBe(true);
      }
    }
  });

  test('janela recente exclui todo nó sem history desde a baseline', () => {
    const recent = listRecentEvolution(ANIMA_CAPABILITY_REGISTRY_V0, EVOLUTION_BASELINE.date);
    const ids = new Set(recent.map((entry) => entry.capabilityId));
    for (const id of V6_CAPABILITY_IDS) expect(ids.has(id)).toBe(true);
    for (const capability of ANIMA_CAPABILITY_REGISTRY_V0) {
      if (!(capability.history ?? []).some((entry) => entry.at >= EVOLUTION_BASELINE.date)) {
        expect(ids.has(capability.id)).toBe(false);
      }
    }
    expect(ids.has('interaction.chat')).toBe(false);
    expect(recent.every((entry) => entry.entry.at >= EVOLUTION_BASELINE.date)).toBe(true);
  });

  test('integração não usa event como proofRef e self-development explicita limite de autonomia', () => {
    expect(get('governance.governed-integration').proofRefs?.some((ref) => ref.kind === 'event')).toBe(false);
    expect(get('agency.supervised-self-development').frontier?.join(' ')).toContain('autonomia não comprovada');
  });
});
