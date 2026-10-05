// Capability Map — modelo canônico das capacidades do próprio Anima.
//
// Este módulo é PURO: define o contrato de uma capacidade, valida um registro de
// capacidades e o projeta como um GRAFO (não apenas árvore). A UI de `/evolution`
// consome este modelo — ela é uma projeção do grafo, nunca uma tela hardcoded.
//
// Separação deliberada (ver docs/marcos/002-anima-constroi-anima.md):
//   - DEFINIÇÃO da capacidade (id, domínio, dependências, alvo futuro);
//   - PROVA de que a capacidade funciona (`proofRefs`, evidência real do repo).
// Uma capacidade pode existir como código sem estar comprovada. Estados fortes
// (`proven`/`operational`/`autonomous`) exigem evidência real; na dúvida, use um
// estágio inferior.
//
// Arquitetura para o futuro (item 10 do plano): hoje o registro é hand-authored
// (ver capability-registry.ts). Amanhã ele pode ser derivado de event log +
// attempts + verifier + observações de runtime por um Capability Proof Engine.
// Este módulo não conhece a origem dos dados — só o contrato e o grafo.

// ─── Maturidade ────────────────────────────────────────────────────────────────

export type CapabilityMaturity =
  | 'projected' //   existe apenas na visão futura
  | 'specified' //   contrato/design suficientemente definido, sem código
  | 'implemented' // código existe
  | 'proven' //      existe evidência concreta de funcionamento
  | 'operational' // comprovada/reproduzida de maneira confiável
  | 'autonomous' //  o Anima consegue usá-la sozinho dentro da authority
  | 'degraded'; //   antes comprovada, mas evidência recente indica regressão

// Ordem linear de amadurecimento. `degraded` fica fora da linha porque é um
// estado de regressão, não um degrau — é tratado à parte.
export const CAPABILITY_MATURITY_LADDER: readonly CapabilityMaturity[] = [
  'projected',
  'specified',
  'implemented',
  'proven',
  'operational',
  'autonomous',
] as const;

export const CAPABILITY_MATURITIES: readonly CapabilityMaturity[] = [
  ...CAPABILITY_MATURITY_LADDER,
  'degraded',
] as const;

export const CAPABILITY_MATURITY_LABEL_PT: Record<CapabilityMaturity, string> = {
  projected: 'Projetada',
  specified: 'Especificada',
  implemented: 'Implementada',
  proven: 'Comprovada',
  operational: 'Operacional',
  autonomous: 'Autônoma',
  degraded: 'Regredida',
};

// Rank na escada (degraded fica ao lado de implemented: o código existe, mas a
// prova regrediu). Usado só para ordenar/agrupar visualmente e para o cálculo
// objetivo de "existente" vs "ainda projetada".
export function maturityRank(maturity: CapabilityMaturity): number {
  if (maturity === 'degraded') return 2; // mesmo nível de "implemented"
  return CAPABILITY_MATURITY_LADDER.indexOf(maturity);
}

// "Existe como código" = implementada ou acima, ou regredida. `projected` e
// `specified` NÃO existem como código (só visão/design).
export function isRealizedMaturity(maturity: CapabilityMaturity): boolean {
  return maturity === 'degraded' || maturityRank(maturity) >= maturityRank('implemented');
}

export function isFutureMaturity(maturity: CapabilityMaturity): boolean {
  return maturity === 'projected' || maturity === 'specified';
}

// Próximo degrau na escada. `autonomous` não tem próximo. `degraded` volta a
// mirar `proven` (re-provar antes de reconquistar operação).
export function nextMaturity(maturity: CapabilityMaturity): CapabilityMaturity | null {
  if (maturity === 'degraded') return 'proven';
  const i = CAPABILITY_MATURITY_LADDER.indexOf(maturity);
  if (i < 0 || i >= CAPABILITY_MATURITY_LADDER.length - 1) return null;
  return CAPABILITY_MATURITY_LADDER[i + 1] ?? null;
}

// ─── Domínio ─────────────────────────────────────────────────────────────────

// `research` (Evolution V2): observar o mundo EXTERNO (web) sob governança. Não
// cabe em `understanding` (modelo do mundo do USUÁRIO) nem em `interaction`
// (superfícies do próprio Anima).
export type CapabilityDomain =
  | 'understanding'
  | 'memory'
  | 'agency'
  | 'governance'
  | 'compute'
  | 'interaction'
  | 'research';

export const CAPABILITY_DOMAINS: readonly CapabilityDomain[] = [
  'understanding',
  'memory',
  'agency',
  'governance',
  'compute',
  'interaction',
  'research',
] as const;

export const CAPABILITY_DOMAIN_LABEL_PT: Record<CapabilityDomain, string> = {
  understanding: 'Compreensão',
  memory: 'Memória',
  agency: 'Agência',
  governance: 'Governança',
  compute: 'Compute',
  interaction: 'Interação',
  research: 'Pesquisa externa',
};

// ─── Prova ───────────────────────────────────────────────────────────────────

// Tipos de evidência que o V0 aceita de forma declarativa. Cada `ref` deve
// apontar para algo REAL no repositório/histórico — nunca um id inventado.
// Tipos distintos e não confundíveis: work_item ≠ attempt ≠ commit ≠ marco ≠
// teste ≠ rota. A distinção importa para o usuário entender POR QUE uma
// capacidade é considerada comprovada.
export type CapabilityProofKind =
  | 'commit' //    hash de commit
  | 'work_item' // id de work item (unidade de trabalho, com lineage/sucessores)
  | 'attempt' //   id de attempt (uma tentativa de um work item)
  | 'test' //      caminho de arquivo de teste
  | 'verifier' //  parecer do Verifier
  | 'event' //     evento persistido (work_events, ledger)
  | 'route' //     rota/página do app (API route, page.tsx)
  | 'milestone' // docs/marcos/*
  | 'record' //    docs/registros/*
  | 'doc'; //      outra documentação/código (componente, PRD, arquitetura)

export interface CapabilityProofRef {
  kind: CapabilityProofKind;
  ref: string;
  note?: string;
}

// ─── Origem / reuso externo (Evolution V2) ────────────────────────────────────

// Princípio ADOPT → WRAP → FORK → BUILD: uma capacidade pode ser FORNECIDA por
// ferramenta externa e GOVERNADA pelo Anima. Ausência de `reuse` = capacidade
// interna. `undecided` = há candidato externo, mas a estratégia ainda depende de
// decisão humana (não se inventa uma).
export type CapabilityReuseStrategy = 'adopt' | 'wrap' | 'fork' | 'contribute_upstream' | 'build' | 'undecided';

// `integrated` = a ferramenta já é chamada por código do Anima.
// `candidate`  = só POC/arquitetura externa. Um POC externo que funcionou NÃO é
// capacidade do Anima: candidata nunca pode estar em maturidade realizada.
export type CapabilityReuseStatus = 'integrated' | 'candidate';

export interface CapabilityReuse {
  strategy: CapabilityReuseStrategy;
  /** Ferramenta externa (nome público do projeto). */
  tool: string;
  status: CapabilityReuseStatus;
  /**
   * Evidência EXTERNA (POC, arquitetura fora do repo). Mantida separada de
   * `proofRefs` de propósito: nunca conta como prova de funcionamento do Anima.
   */
  externalEvidence?: string;
}

// ─── História (Evolution V2 — semente; derivação completa = Evolution History V3) ──

// Registro DECLARATIVO e mínimo de mudanças da capacidade, sempre ancorado em
// refs reais. Não é derivado do git nem do event log: só registra o que uma
// reconciliação explícita auditou. Ausência de entrada ≠ ausência de história.
export type CapabilityHistoryChange = 'introduced' | 'maturity_changed' | 'proof_added' | 'relation_added';

export interface CapabilityHistoryEntry {
  /** Data (YYYY-MM-DD) do FATO subjacente (commit/prova), não da edição do registry. */
  at: string;
  change: CapabilityHistoryChange;
  from?: CapabilityMaturity;
  to?: CapabilityMaturity;
  note: string;
  refs: CapabilityProofRef[];
}

// ─── Capacidade ──────────────────────────────────────────────────────────────

export interface CapabilityTarget {
  description: string;
  milestone?: string;
}

export interface Capability {
  id: string;
  name: string;
  /** Uma linha: o que a capacidade é. */
  description: string;
  domain: CapabilityDomain;
  maturity: CapabilityMaturity;

  /** Agrupamento hierárquico opcional (árvore dentro do grafo). */
  parentId?: string;

  /** Dependências de grafo — podem cruzar domínios. Fonte única da verdade. */
  dependsOn: string[];

  /**
   * Desbloqueios explícitos (opcional). Em geral NÃO é preenchido à mão: o grafo
   * deriva `unlocks` como inverso de `dependsOn`. Mantido no contrato só para
   * override/forward-compat.
   */
  unlocks?: string[];

  /** Para onde esta capacidade aponta no futuro. */
  target?: CapabilityTarget;

  /** Explicação mais longa: "o que significa esta capacidade". */
  meaning?: string;

  /** "O que falta para chegar ao próximo estágio." */
  advancement?: string;

  /** Evidência real de funcionamento (separada da definição). */
  proofRefs?: CapabilityProofRef[];

  /** Origem externa (reuso). Ausente = capacidade interna. */
  reuse?: CapabilityReuse;

  /** Mudanças auditadas desta capacidade (ordem cronológica). */
  history?: CapabilityHistoryEntry[];

  /**
   * Fronteira / dependência humana CONHECIDA (Evolution Reconciliation V2, SDC-09):
   * limites declarados e ainda abertos, um por item. Não é maturidade nem prova:
   * representa o que hoje depende de ato humano ou ainda não existe, sem forçar
   * uma promoção para esconder a lacuna.
   */
  frontier?: string[];
}

// ─── Validação do registro ──────────────────────────────────────────────────

export type CapabilityRegistryIssueCode =
  | 'duplicate_id'
  | 'invalid_domain'
  | 'invalid_maturity'
  | 'self_dependency'
  | 'duplicate_dependency'
  | 'missing_dependency'
  | 'missing_parent'
  | 'self_parent'
  | 'missing_unlock'
  | 'dependency_cycle'
  // Evolution V2 — regras epistemológicas:
  | 'strong_maturity_without_proof' // proven/operational/autonomous sem proofRefs
  | 'external_candidate_realized' //  candidata externa marcada como já existente no Anima
  | 'invalid_history' //              data inválida ou maturity_changed incompleto/sem refs
  | 'history_maturity_mismatch'; //   último `to` (introduced/maturity_changed) ≠ maturidade atual

export interface CapabilityRegistryIssue {
  code: CapabilityRegistryIssueCode;
  capabilityId: string;
  message: string;
  /** Presente em `dependency_cycle`: o caminho do ciclo detectado. */
  cycle?: string[];
}

const MATURITY_SET = new Set<string>(CAPABILITY_MATURITIES);
const DOMAIN_SET = new Set<string>(CAPABILITY_DOMAINS);
const STRONG_MATURITIES = new Set<CapabilityMaturity>(['proven', 'operational', 'autonomous']);
const HISTORY_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidHistoryDate(value: string): boolean {
  return HISTORY_DATE.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

function validateHistory(cap: Capability): CapabilityRegistryIssue[] {
  const issues: CapabilityRegistryIssue[] = [];
  const entries = cap.history ?? [];
  let previousAt = '';
  let lastMaturityChange: CapabilityHistoryEntry | undefined;
  for (const entry of entries) {
    const problems: string[] = [];
    if (!isValidHistoryDate(entry.at)) problems.push(`data inválida "${entry.at}"`);
    else if (entry.at < previousAt) problems.push(`fora de ordem cronológica (${entry.at})`);
    if (entry.refs.length === 0) problems.push('sem refs');
    if (entry.change === 'maturity_changed') {
      if (!entry.from || !entry.to || entry.from === entry.to) problems.push('maturity_changed exige from ≠ to');
    }
    if ((entry.change === 'maturity_changed' || entry.change === 'introduced') && entry.to) lastMaturityChange = entry;
    for (const problem of problems) {
      issues.push({ code: 'invalid_history', capabilityId: cap.id, message: `história de ${cap.id}: ${problem}` });
    }
    if (isValidHistoryDate(entry.at)) previousAt = entry.at;
  }
  if (lastMaturityChange?.to && lastMaturityChange.to !== cap.maturity) {
    issues.push({
      code: 'history_maturity_mismatch',
      capabilityId: cap.id,
      message: `${cap.id}: última mudança registrada leva a ${lastMaturityChange.to}, mas a maturidade atual é ${cap.maturity}`,
    });
  }
  return issues;
}

/**
 * Valida um registro de capacidades e devolve TODAS as violações encontradas
 * (lista vazia = registro íntegro). Não lança — o chamador decide o que fazer.
 */
export function validateCapabilityRegistry(
  capabilities: readonly Capability[],
): CapabilityRegistryIssue[] {
  const issues: CapabilityRegistryIssue[] = [];
  const ids = new Set<string>();

  for (const cap of capabilities) {
    if (ids.has(cap.id)) {
      issues.push({ code: 'duplicate_id', capabilityId: cap.id, message: `id duplicado: ${cap.id}` });
    }
    ids.add(cap.id);
  }

  for (const cap of capabilities) {
    if (!DOMAIN_SET.has(cap.domain)) {
      issues.push({ code: 'invalid_domain', capabilityId: cap.id, message: `domínio inválido: ${cap.domain}` });
    }
    if (!MATURITY_SET.has(cap.maturity)) {
      issues.push({ code: 'invalid_maturity', capabilityId: cap.id, message: `maturidade inválida: ${cap.maturity}` });
    }

    const seenDeps = new Set<string>();
    for (const dep of cap.dependsOn) {
      if (dep === cap.id) {
        issues.push({ code: 'self_dependency', capabilityId: cap.id, message: `${cap.id} depende de si mesma` });
        continue;
      }
      if (seenDeps.has(dep)) {
        issues.push({ code: 'duplicate_dependency', capabilityId: cap.id, message: `dependência duplicada em ${cap.id}: ${dep}` });
      }
      seenDeps.add(dep);
      if (!ids.has(dep)) {
        issues.push({ code: 'missing_dependency', capabilityId: cap.id, message: `${cap.id} depende de capacidade inexistente: ${dep}` });
      }
    }

    if (cap.parentId !== undefined) {
      if (cap.parentId === cap.id) {
        issues.push({ code: 'self_parent', capabilityId: cap.id, message: `${cap.id} é pai de si mesma` });
      } else if (!ids.has(cap.parentId)) {
        issues.push({ code: 'missing_parent', capabilityId: cap.id, message: `parentId inexistente em ${cap.id}: ${cap.parentId}` });
      }
    }

    for (const unlock of cap.unlocks ?? []) {
      if (!ids.has(unlock)) {
        issues.push({ code: 'missing_unlock', capabilityId: cap.id, message: `${cap.id} desbloqueia capacidade inexistente: ${unlock}` });
      }
    }

    if (STRONG_MATURITIES.has(cap.maturity) && (cap.proofRefs?.length ?? 0) === 0) {
      issues.push({ code: 'strong_maturity_without_proof', capabilityId: cap.id, message: `${cap.id} declara ${cap.maturity} sem prova` });
    }
    if (cap.reuse?.status === 'candidate' && isRealizedMaturity(cap.maturity)) {
      issues.push({
        code: 'external_candidate_realized',
        capabilityId: cap.id,
        message: `${cap.id} é candidata externa (${cap.reuse.tool}) e não pode estar ${cap.maturity}`,
      });
    }
    issues.push(...validateHistory(cap));
  }

  for (const cycle of findDependencyCycles(capabilities)) {
    const head = cycle[0] ?? '';
    issues.push({
      code: 'dependency_cycle',
      capabilityId: head,
      message: `ciclo de dependência: ${cycle.join(' → ')}`,
      cycle,
    });
  }

  return issues;
}

/** Detecta ciclos em `dependsOn` (proibidos). Retorna cada ciclo como caminho. */
export function findDependencyCycles(capabilities: readonly Capability[]): string[][] {
  const deps = new Map<string, string[]>();
  for (const cap of capabilities) deps.set(cap.id, cap.dependsOn.filter((d) => d !== cap.id));

  const cycles: string[][] = [];
  const seenCycleKeys = new Set<string>();
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  const visit = (id: string): void => {
    state.set(id, 'visiting');
    stack.push(id);
    for (const dep of deps.get(id) ?? []) {
      if (!deps.has(dep)) continue; // dependência inexistente: reportada à parte
      const s = state.get(dep);
      if (s === 'visiting') {
        const start = stack.indexOf(dep);
        if (start >= 0) {
          const cycle = stack.slice(start);
          const key = [...cycle].sort().join('|');
          if (!seenCycleKeys.has(key)) {
            seenCycleKeys.add(key);
            cycles.push([...cycle, dep]);
          }
        }
      } else if (s === undefined) {
        visit(dep);
      }
    }
    stack.pop();
    state.set(id, 'done');
  };

  for (const cap of capabilities) {
    if (state.get(cap.id) === undefined) visit(cap.id);
  }
  return cycles;
}

// ─── Grafo ───────────────────────────────────────────────────────────────────

export interface CapabilityGraphNode {
  capability: Capability;
  /** Dependências existentes no registro (referências quebradas são omitidas). */
  dependsOn: string[];
  /** Desbloqueios derivados: inverso de `dependsOn`. */
  unlocks: string[];
  /** Camada = maior caminho de dependências até uma raiz. Útil para layout. */
  depth: number;
}

export interface CapabilityGraph {
  nodes: CapabilityGraphNode[];
  byId: Map<string, CapabilityGraphNode>;
  issues: CapabilityRegistryIssue[];
}

/**
 * Projeta o registro como grafo: valida, deriva `unlocks` (inverso de
 * `dependsOn`) e calcula `depth`. Constrói o melhor grafo possível mesmo com
 * problemas (usando só arestas válidas); os problemas vêm em `issues`.
 */
export function buildCapabilityGraph(capabilities: readonly Capability[]): CapabilityGraph {
  const issues = validateCapabilityRegistry(capabilities);
  const ids = new Set(capabilities.map((c) => c.id));

  const validDeps = new Map<string, string[]>();
  const unlocks = new Map<string, string[]>();
  for (const cap of capabilities) {
    unlocks.set(cap.id, []);
  }
  for (const cap of capabilities) {
    const deps = [...new Set(cap.dependsOn)].filter((d) => d !== cap.id && ids.has(d));
    validDeps.set(cap.id, deps);
    for (const dep of deps) {
      const list = unlocks.get(dep);
      if (list && !list.includes(cap.id)) list.push(cap.id);
    }
  }

  // depth memoizado, à prova de ciclo.
  const depthMemo = new Map<string, number>();
  const inProgress = new Set<string>();
  const depthOf = (id: string): number => {
    const cached = depthMemo.get(id);
    if (cached !== undefined) return cached;
    if (inProgress.has(id)) return 0; // corta ciclo (já reportado em issues)
    inProgress.add(id);
    let d = 0;
    for (const dep of validDeps.get(id) ?? []) {
      d = Math.max(d, depthOf(dep) + 1);
    }
    inProgress.delete(id);
    depthMemo.set(id, d);
    return d;
  };

  const nodes: CapabilityGraphNode[] = capabilities.map((cap) => ({
    capability: cap,
    dependsOn: validDeps.get(cap.id) ?? [],
    unlocks: unlocks.get(cap.id) ?? [],
    depth: depthOf(cap.id),
  }));

  const byId = new Map(nodes.map((n) => [n.capability.id, n]));
  return { nodes, byId, issues };
}

// ─── Análise ─────────────────────────────────────────────────────────────────

function emptyMaturityCounts(): Record<CapabilityMaturity, number> {
  const counts = {} as Record<CapabilityMaturity, number>;
  for (const m of CAPABILITY_MATURITIES) counts[m] = 0;
  return counts;
}

export interface DomainMaturitySummary {
  domain: CapabilityDomain;
  total: number;
  byMaturity: Record<CapabilityMaturity, number>;
}

/**
 * Contagem factual por domínio × maturidade. NÃO deriva porcentagem global —
 * não há base semântica para "Anima X% completo" (item 9 do plano).
 */
export function summarizeByDomain(capabilities: readonly Capability[]): DomainMaturitySummary[] {
  const byDomain = new Map<CapabilityDomain, DomainMaturitySummary>();
  for (const domain of CAPABILITY_DOMAINS) {
    byDomain.set(domain, { domain, total: 0, byMaturity: emptyMaturityCounts() });
  }
  for (const cap of capabilities) {
    const summary = byDomain.get(cap.domain);
    if (!summary) continue; // domínio inválido: reportado na validação
    summary.total += 1;
    summary.byMaturity[cap.maturity] += 1;
  }
  return CAPABILITY_DOMAINS.map((d) => byDomain.get(d)!);
}

/** Fecho transitivo das dependências de `id` (exclui o próprio `id`). */
export function dependencyClosure(graph: CapabilityGraph, id: string): string[] {
  const out = new Set<string>();
  const stack = [...(graph.byId.get(id)?.dependsOn ?? [])];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (out.has(cur) || cur === id) continue;
    out.add(cur);
    for (const dep of graph.byId.get(cur)?.dependsOn ?? []) stack.push(dep);
  }
  return [...out];
}

export interface TargetProgress {
  targetId: string;
  found: boolean;
  totalDependencies: number;
  /** Dependências que já existem como código (>= implementada, incl. regredida). */
  existing: number;
  /** Dependências apenas especificadas (design, sem código). */
  specified: number;
  /** Dependências apenas projetadas (visão futura). */
  projected: number;
  byMaturity: Record<CapabilityMaturity, number>;
  /** Ids das dependências ainda não realizadas (specified|projected). */
  missing: string[];
}

/**
 * Progresso OBJETIVO rumo a uma capacidade-alvo (tipicamente futura), derivado
 * do grafo: quantas dependências necessárias já existem vs. quantas faltam.
 * Sem porcentagem inventada — só contagens.
 */
export function summarizeTargetProgress(graph: CapabilityGraph, targetId: string): TargetProgress {
  const node = graph.byId.get(targetId);
  const byMaturity = emptyMaturityCounts();
  if (!node) {
    return { targetId, found: false, totalDependencies: 0, existing: 0, specified: 0, projected: 0, byMaturity, missing: [] };
  }
  const closure = dependencyClosure(graph, targetId);
  let existing = 0;
  let specified = 0;
  let projected = 0;
  const missing: string[] = [];
  for (const depId of closure) {
    const dep = graph.byId.get(depId);
    if (!dep) continue;
    const m = dep.capability.maturity;
    byMaturity[m] += 1;
    if (isRealizedMaturity(m)) {
      existing += 1;
    } else {
      missing.push(depId);
      if (m === 'specified') specified += 1;
      else projected += 1;
    }
  }
  return { targetId, found: true, totalDependencies: closure.length, existing, specified, projected, byMaturity, missing };
}

/**
 * Um caminho representativo do presente até `targetId`, seguindo `dependsOn`
 * pela cadeia mais profunda (item 8: enxergar um caminho presente → futuro).
 * Retorna ids da raiz até o alvo, ou null se o alvo não existe.
 */
export function longestDependencyPath(graph: CapabilityGraph, targetId: string): string[] | null {
  if (!graph.byId.has(targetId)) return null;
  const memo = new Map<string, string[]>();
  const inProgress = new Set<string>();
  const pathTo = (id: string): string[] => {
    const cached = memo.get(id);
    if (cached) return cached;
    if (inProgress.has(id)) return [id]; // corta ciclo
    inProgress.add(id);
    let best: string[] = [];
    for (const dep of graph.byId.get(id)?.dependsOn ?? []) {
      const candidate = pathTo(dep);
      if (candidate.length > best.length) best = candidate;
    }
    inProgress.delete(id);
    const full = [...best, id];
    memo.set(id, full);
    return full;
  };
  return pathTo(targetId);
}

// ─── Fronteira / dependência humana (SDC-09) ─────────────────────────────────

export interface FrontierEntry {
  capabilityId: string;
  items: string[];
}

/** Capacidades que declaram limites abertos (`frontier`), na ordem do registro. */
export function listFrontier(capabilities: readonly Capability[]): FrontierEntry[] {
  const out: FrontierEntry[] = [];
  for (const cap of capabilities) {
    const items = (cap.frontier ?? []).filter((item) => item.trim().length > 0);
    if (items.length > 0) out.push({ capabilityId: cap.id, items });
  }
  return out;
}

// ─── Evolução recente (Evolution V2) ─────────────────────────────────────────

export interface RecentEvolutionEntry {
  capabilityId: string;
  entry: CapabilityHistoryEntry;
}

/**
 * Mudanças registradas em `history` a partir de `since` (YYYY-MM-DD, inclusive),
 * da mais recente para a mais antiga. Só projeta o que o registry declara com
 * refs reais — nunca infere "recente" por timestamp de arquivo ou de git.
 */
export function listRecentEvolution(capabilities: readonly Capability[], since: string): RecentEvolutionEntry[] {
  const out: RecentEvolutionEntry[] = [];
  for (const cap of capabilities) {
    for (const entry of cap.history ?? []) {
      if (isValidHistoryDate(entry.at) && entry.at >= since) out.push({ capabilityId: cap.id, entry });
    }
  }
  return out.sort((a, b) => (a.entry.at === b.entry.at ? a.capabilityId.localeCompare(b.capabilityId) : a.entry.at < b.entry.at ? 1 : -1));
}
