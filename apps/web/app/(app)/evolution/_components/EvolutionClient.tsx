'use client';

// EvolutionClient — projeção visual do modelo de capacidades do Anima.
//
// Esta tela NÃO é hardcoded: renderiza o grafo vindo de packages/core como um
// mapa de progressão (skill tree / constelação). O eixo horizontal são os
// DOMÍNIOS (faixas); o eixo vertical é a PROFUNDIDADE de dependência — fundações
// no topo, a capacidade futura mais distante no fundo. Assim o caminho do
// presente até o futuro (item 8) é literalmente de cima para baixo.
//
// Estado é comunicado por FORMA + COR + TEXTO (nunca só cor): cada maturidade
// tem um glifo, uma cor e um rótulo. Não há porcentagem global falsa — só
// contagens factuais derivadas do grafo.

import { useMemo, useState } from 'react';
import type {
  Capability,
  CapabilityDomain,
  CapabilityGraphNode,
  CapabilityMaturity,
  CapabilityProofRef,
  DomainMaturitySummary,
  TargetProgress,
} from '@anima/core';
import styles from './EvolutionClient.module.css';

// ─── Constantes de apresentação (valores puros; tipos vêm do core) ──────────────

const DOMAIN_ORDER: CapabilityDomain[] = [
  'understanding',
  'memory',
  'agency',
  'governance',
  'compute',
  'interaction',
];

const DOMAIN_LABEL: Record<CapabilityDomain, string> = {
  understanding: 'Compreensão',
  memory: 'Memória',
  agency: 'Agência',
  governance: 'Governança',
  compute: 'Compute',
  interaction: 'Interação',
};

// Escada linear de maturidade (degraded é tratado à parte).
const MATURITY_LADDER: CapabilityMaturity[] = [
  'projected',
  'specified',
  'implemented',
  'proven',
  'operational',
  'autonomous',
];

const MATURITY_LABEL: Record<CapabilityMaturity, string> = {
  projected: 'Projetada',
  specified: 'Especificada',
  implemented: 'Implementada',
  proven: 'Comprovada',
  operational: 'Operacional',
  autonomous: 'Autônoma',
  degraded: 'Regredida',
};

const MATURITY_COLOR: Record<CapabilityMaturity, string> = {
  projected: '#6b74a8',
  specified: '#38bdf8',
  implemented: '#a78bfa',
  proven: '#34d399',
  operational: '#22c55e',
  autonomous: '#f5b301',
  degraded: '#ef4444',
};

// Forma/glifo: sinal redundante à cor (acessibilidade + impressão P&B).
const MATURITY_GLYPH: Record<CapabilityMaturity, string> = {
  projected: '◌',
  specified: '○',
  implemented: '◐',
  proven: '◆',
  operational: '●',
  autonomous: '★',
  degraded: '⚠',
};

const MATURITY_MEANING: Record<CapabilityMaturity, string> = {
  projected: 'existe apenas na visão futura',
  specified: 'contrato/design definido, sem código',
  implemented: 'o código existe',
  proven: 'há evidência concreta de funcionamento',
  operational: 'comprovada de maneira confiável',
  autonomous: 'o Anima a usa sozinho dentro da authority',
  degraded: 'antes comprovada, com sinal recente de regressão',
};

function nextStage(m: CapabilityMaturity): CapabilityMaturity | null {
  if (m === 'degraded') return 'proven';
  const i = MATURITY_LADDER.indexOf(m);
  if (i < 0 || i >= MATURITY_LADDER.length - 1) return null;
  return MATURITY_LADDER[i + 1] ?? null;
}

function isFuture(m: CapabilityMaturity): boolean {
  return m === 'projected' || m === 'specified';
}

const PROOF_KIND_LABEL: Record<CapabilityProofRef['kind'], string> = {
  commit: 'commit',
  test: 'teste',
  attempt: 'attempt',
  verifier: 'verifier',
  event: 'evento',
  milestone: 'marco',
  record: 'registro',
  doc: 'doc',
};

// ─── Layout do grafo ────────────────────────────────────────────────────────────

const LANE_W = 208;
const CHIP_W = 168;
const CHIP_H = 54;
const V_GAP = 16;
const BAND_GAP = 44;
const HEADER_H = 46;

interface Placed {
  node: CapabilityGraphNode;
  x: number;
  y: number;
}

function wrapName(name: string, max = 22): string[] {
  const words = name.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const candidate = (cur + ' ' + w).trim();
    if (candidate.length <= max) cur = candidate;
    else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= 2) return lines;
  const rest = lines.slice(1).join(' ');
  return [lines[0] ?? '', rest.length > max ? rest.slice(0, max - 1) + '…' : rest];
}

interface Layout {
  placed: Placed[];
  posById: Map<string, Placed>;
  width: number;
  height: number;
}

function computeLayout(nodes: CapabilityGraphNode[]): Layout {
  const laneIndex = new Map<CapabilityDomain, number>(DOMAIN_ORDER.map((d, i) => [d, i]));
  const laneCenter = (d: CapabilityDomain): number => (laneIndex.get(d) ?? 0) * LANE_W + LANE_W / 2;

  const maxDepth = nodes.reduce((m, n) => Math.max(m, n.depth), 0);
  const posById = new Map<string, Placed>();
  const placed: Placed[] = [];

  let y = HEADER_H + 10;
  for (let depth = 0; depth <= maxDepth; depth++) {
    const atDepth = nodes.filter((n) => n.depth === depth);
    if (atDepth.length === 0) continue;

    const byLane = new Map<number, CapabilityGraphNode[]>();
    for (const n of atDepth) {
      const li = laneIndex.get(n.capability.domain) ?? 0;
      const list = byLane.get(li) ?? [];
      list.push(n);
      byLane.set(li, list);
    }
    // Ordem estável dentro da célula: maturidade mais forte primeiro, depois nome.
    for (const list of byLane.values()) {
      list.sort((a, b) => {
        const ra = MATURITY_LADDER.indexOf(a.capability.maturity);
        const rb = MATURITY_LADDER.indexOf(b.capability.maturity);
        if (ra !== rb) return rb - ra;
        return a.capability.name.localeCompare(b.capability.name);
      });
    }

    const maxStack = Math.max(...[...byLane.values()].map((l) => l.length), 1);
    const bandHeight = maxStack * CHIP_H + (maxStack - 1) * V_GAP;

    for (const [li, list] of byLane) {
      const domain = DOMAIN_ORDER[li] ?? 'understanding';
      const cx = laneCenter(domain);
      const stackH = list.length * CHIP_H + (list.length - 1) * V_GAP;
      const startY = y + (bandHeight - stackH) / 2;
      list.forEach((node, k) => {
        const p: Placed = { node, x: cx - CHIP_W / 2, y: startY + k * (CHIP_H + V_GAP) };
        posById.set(node.capability.id, p);
        placed.push(p);
      });
    }
    y += bandHeight + BAND_GAP;
  }

  return { placed, posById, width: DOMAIN_ORDER.length * LANE_W, height: y + 8 };
}

// ─── Componente ────────────────────────────────────────────────────────────────

export interface EvolutionClientProps {
  nodes: CapabilityGraphNode[];
  domainSummaries: DomainMaturitySummary[];
  featuredTargetId: string;
  featuredProgress: TargetProgress;
  featuredPath: string[];
}

export default function EvolutionClient({
  nodes,
  domainSummaries,
  featuredTargetId,
  featuredProgress,
  featuredPath,
}: EvolutionClientProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [showPath, setShowPath] = useState(true);

  const layout = useMemo(() => computeLayout(nodes), [nodes]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.capability.id, n])), [nodes]);
  const nameById = useMemo(
    () => new Map(nodes.map((n) => [n.capability.id, n.capability.name])),
    [nodes],
  );

  // Arestas do caminho em foco (pares consecutivos dep → dependente).
  const pathEdgeKeys = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < featuredPath.length - 1; i++) {
      set.add(`${featuredPath[i]}>${featuredPath[i + 1]}`);
    }
    return set;
  }, [featuredPath]);
  const pathNodeSet = useMemo(() => new Set(featuredPath), [featuredPath]);

  const activeId = hoveredId ?? selectedId;
  const activeNode = activeId ? byId.get(activeId) ?? null : null;
  const relatedIds = useMemo(() => {
    if (!activeNode) return new Set<string>();
    return new Set<string>([activeNode.capability.id, ...activeNode.dependsOn, ...activeNode.unlocks]);
  }, [activeNode]);

  const selectedNode = selectedId ? byId.get(selectedId) ?? null : null;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Evolução do Anima</h1>
          <p className={styles.subtitle}>
            Um mapa do que o Anima já sabe fazer, do que foi comprovado, do que ainda está sendo
            construído e dos caminhos até o sistema desejado. Cada nó é uma capacidade do modelo
            explícito — esta tela é uma projeção do grafo, não uma imagem fixa.
          </p>
        </div>
        <span className={styles.marker} title="Marco desta etapa">
          Capability Map V0
        </span>
      </header>

      {/* ─── Contagens factuais por domínio (item 9: sem % global) ─── */}
      <section className={styles.summaryStrip} aria-label="Resumo por domínio">
        {DOMAIN_ORDER.map((domain) => {
          const summary = domainSummaries.find((s) => s.domain === domain);
          if (!summary) return null;
          return (
            <div key={domain} className={styles.summaryCard}>
              <div className={styles.summaryHead}>
                <span className={styles.summaryDomain}>{DOMAIN_LABEL[domain]}</span>
                <span className={styles.summaryTotal}>{summary.total}</span>
              </div>
              <div className={styles.summaryCounts}>
                {MATURITY_LADDER.concat('degraded').map((m) => {
                  const count = summary.byMaturity[m];
                  if (!count) return null;
                  return (
                    <span key={m} className={styles.summaryCount} title={MATURITY_LABEL[m]}>
                      <span style={{ color: MATURITY_COLOR[m] }}>{MATURITY_GLYPH[m]}</span>
                      {count} {MATURITY_LABEL[m].toLowerCase()}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>

      {/* ─── Legenda de maturidade (forma + cor + texto) ─── */}
      <section className={styles.legend} aria-label="Legenda de maturidade">
        {MATURITY_LADDER.concat('degraded').map((m) => (
          <span key={m} className={styles.legendItem} title={MATURITY_MEANING[m]}>
            <span className={styles.legendGlyph} style={{ color: MATURITY_COLOR[m] }}>
              {MATURITY_GLYPH[m]}
            </span>
            {MATURITY_LABEL[m]}
          </span>
        ))}
        <label className={styles.pathToggle}>
          <input
            type="checkbox"
            checked={showPath}
            onChange={(e) => setShowPath(e.target.checked)}
          />
          Destacar caminho até o futuro
        </label>
      </section>

      <div className={styles.workspace}>
        {/* ─── Mapa (SVG) ─── */}
        <div className={styles.mapScroll}>
          <svg
            className={styles.svg}
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            role="group"
            aria-label="Mapa de capacidades do Anima"
          >
            {/* Faixas de domínio + cabeçalhos */}
            {DOMAIN_ORDER.map((domain, i) => (
              <g key={domain}>
                {i > 0 && (
                  <line
                    x1={i * LANE_W}
                    y1={HEADER_H}
                    x2={i * LANE_W}
                    y2={layout.height}
                    className={styles.laneSep}
                  />
                )}
                <text
                  x={i * LANE_W + LANE_W / 2}
                  y={HEADER_H / 2 + 5}
                  className={styles.laneLabel}
                  textAnchor="middle"
                >
                  {DOMAIN_LABEL[domain]}
                </text>
              </g>
            ))}

            {/* Arestas de dependência (dep está sempre acima do dependente) */}
            {layout.placed.map((p) =>
              p.node.dependsOn.map((depId) => {
                const dep = layout.posById.get(depId);
                if (!dep) return null;
                const x1 = dep.x + CHIP_W / 2;
                const y1 = dep.y + CHIP_H;
                const x2 = p.x + CHIP_W / 2;
                const y2 = p.y;
                const dy = Math.max((y2 - y1) / 2, 18);
                const isPath = showPath && pathEdgeKeys.has(`${depId}>${p.node.capability.id}`);
                const isActive =
                  !!activeId && (activeId === p.node.capability.id || activeId === depId);
                const cls = isPath
                  ? styles.edgePath
                  : isActive
                    ? styles.edgeActive
                    : activeId
                      ? styles.edgeDim
                      : styles.edge;
                return (
                  <path
                    key={`${depId}>${p.node.capability.id}`}
                    className={cls}
                    d={`M ${x1} ${y1} C ${x1} ${y1 + dy} ${x2} ${y2 - dy} ${x2} ${y2}`}
                    fill="none"
                  />
                );
              }),
            )}

            {/* Nós (chips) */}
            {layout.placed.map((p) => {
              const cap = p.node.capability;
              const color = MATURITY_COLOR[cap.maturity];
              const future = isFuture(cap.maturity);
              const selected = selectedId === cap.id;
              const dim = !!activeId && !relatedIds.has(cap.id);
              const inPath = showPath && pathNodeSet.has(cap.id);
              const lines = wrapName(cap.name);
              return (
                <g
                  key={cap.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${cap.name} — ${MATURITY_LABEL[cap.maturity]}`}
                  aria-pressed={selected}
                  className={`${styles.chip} ${dim ? styles.chipDim : ''} ${selected ? styles.chipSelected : ''}`}
                  transform={`translate(${p.x} ${p.y})`}
                  onClick={() => setSelectedId(selected ? null : cap.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedId(selected ? null : cap.id);
                    }
                  }}
                  onMouseEnter={() => setHoveredId(cap.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  <rect
                    width={CHIP_W}
                    height={CHIP_H}
                    rx={10}
                    className={styles.chipBg}
                    style={{
                      stroke: selected || inPath ? color : 'var(--border)',
                      strokeWidth: selected ? 2 : inPath ? 1.6 : 1,
                      strokeDasharray: future ? '5 4' : undefined,
                    }}
                  />
                  <rect width={5} height={CHIP_H} rx={2} style={{ fill: color }} />
                  <text x={16} y={20} className={styles.chipGlyph} style={{ fill: color }}>
                    {MATURITY_GLYPH[cap.maturity]}
                  </text>
                  {lines.map((line, li) => (
                    <text
                      key={li}
                      x={30}
                      y={18 + li * 15}
                      className={styles.chipName}
                    >
                      {line}
                    </text>
                  ))}
                  <text x={30} y={CHIP_H - 10} className={styles.chipMaturity} style={{ fill: color }}>
                    {MATURITY_LABEL[cap.maturity]}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* ─── Painel de detalhe ─── */}
        <aside className={styles.panel} aria-live="polite">
          {selectedNode ? (
            <CapabilityDetail
              node={selectedNode}
              nameById={nameById}
              onSelect={setSelectedId}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <FeaturedObjective
              targetId={featuredTargetId}
              node={byId.get(featuredTargetId) ?? null}
              progress={featuredProgress}
              path={featuredPath}
              nameById={nameById}
              byId={byId}
              onSelect={setSelectedId}
            />
          )}
        </aside>
      </div>

      <footer className={styles.footer}>
        Sem porcentagem global inventada: não existe base semântica para “Anima X% completo”. As
        contagens acima são derivadas objetivamente do grafo de capacidades.
      </footer>
    </main>
  );
}

// ─── Detalhe de capacidade (item 7) ─────────────────────────────────────────────

function ChipList({
  ids,
  nameById,
  onSelect,
  empty,
}: {
  ids: string[];
  nameById: Map<string, string>;
  onSelect: (id: string) => void;
  empty: string;
}) {
  if (ids.length === 0) return <p className={styles.detailEmpty}>{empty}</p>;
  return (
    <div className={styles.relChips}>
      {ids.map((id) => (
        <button key={id} type="button" className={styles.relChip} onClick={() => onSelect(id)}>
          {nameById.get(id) ?? id}
        </button>
      ))}
    </div>
  );
}

function CapabilityDetail({
  node,
  nameById,
  onSelect,
  onClose,
}: {
  node: CapabilityGraphNode;
  nameById: Map<string, string>;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const cap: Capability = node.capability;
  const color = MATURITY_COLOR[cap.maturity];
  const next = nextStage(cap.maturity);

  return (
    <div className={styles.detail}>
      <div className={styles.detailTop}>
        <span className={styles.detailDomain}>{DOMAIN_LABEL[cap.domain]}</span>
        <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Fechar detalhe">
          ×
        </button>
      </div>
      <h2 className={styles.detailName}>{cap.name}</h2>
      <div className={styles.maturityBadge} style={{ borderColor: color, color }}>
        <span>{MATURITY_GLYPH[cap.maturity]}</span> {MATURITY_LABEL[cap.maturity]}
        <span className={styles.maturityMeaning}>— {MATURITY_MEANING[cap.maturity]}</span>
      </div>

      <p className={styles.detailDesc}>{cap.description}</p>

      {cap.meaning && (
        <section className={styles.detailSection}>
          <h3 className={styles.detailLabel}>O que significa</h3>
          <p className={styles.detailText}>{cap.meaning}</p>
        </section>
      )}

      <section className={styles.detailSection}>
        <h3 className={styles.detailLabel}>Depende de</h3>
        <ChipList ids={node.dependsOn} nameById={nameById} onSelect={onSelect} empty="Fundação — não depende de nenhuma outra capacidade." />
      </section>

      <section className={styles.detailSection}>
        <h3 className={styles.detailLabel}>Desbloqueia</h3>
        <ChipList ids={node.unlocks} nameById={nameById} onSelect={onSelect} empty="Ainda não desbloqueia outra capacidade registrada." />
      </section>

      <section className={styles.detailSection}>
        <h3 className={styles.detailLabel}>Evidências conhecidas</h3>
        {(cap.proofRefs?.length ?? 0) === 0 ? (
          <p className={styles.detailEmpty}>Sem evidência declarada — coerente com um estado ainda não comprovado.</p>
        ) : (
          <ul className={styles.proofList}>
            {cap.proofRefs!.map((proof, i) => (
              <li key={i} className={styles.proofItem}>
                <span className={styles.proofKind}>{PROOF_KIND_LABEL[proof.kind]}</span>
                <code className={styles.proofRef}>{proof.ref}</code>
                {proof.note && <span className={styles.proofNote}>{proof.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {cap.target && (
        <section className={styles.detailSection}>
          <h3 className={styles.detailLabel}>Alvo futuro</h3>
          <p className={styles.detailText}>{cap.target.description}</p>
          {cap.target.milestone && <code className={styles.proofRef}>{cap.target.milestone}</code>}
        </section>
      )}

      <section className={styles.detailSection}>
        <h3 className={styles.detailLabel}>Próximo estágio</h3>
        <p className={styles.detailText}>
          {next ? (
            <>
              <span style={{ color: MATURITY_COLOR[next] }}>{MATURITY_GLYPH[next]}</span>{' '}
              {MATURITY_LABEL[next]}
            </>
          ) : (
            'Topo da escada — não há estágio seguinte.'
          )}
        </p>
      </section>

      <section className={styles.detailSection}>
        <h3 className={styles.detailLabel}>O que falta para o próximo estágio</h3>
        <p className={styles.detailText}>{cap.advancement ?? '—'}</p>
      </section>
    </div>
  );
}

// ─── Objetivo em foco (painel padrão, sem seleção) ──────────────────────────────

function FeaturedObjective({
  targetId,
  node,
  progress,
  path,
  nameById,
  byId,
  onSelect,
}: {
  targetId: string;
  node: CapabilityGraphNode | null;
  progress: TargetProgress;
  path: string[];
  nameById: Map<string, string>;
  byId: Map<string, CapabilityGraphNode>;
  onSelect: (id: string) => void;
}) {
  const cap = node?.capability;
  return (
    <div className={styles.detail}>
      <span className={styles.detailDomain}>Objetivo em foco</span>
      <h2 className={styles.detailName}>{cap?.name ?? targetId}</h2>
      {cap?.target && <p className={styles.detailDesc}>{cap.target.description}</p>}

      <section className={styles.detailSection}>
        <h3 className={styles.detailLabel}>Distância estrutural até aqui</h3>
        <p className={styles.detailText}>
          {progress.found ? (
            <>
              <strong>{progress.existing}</strong> das <strong>{progress.totalDependencies}</strong>{' '}
              capacidades necessárias já existem;{' '}
              <strong>{progress.specified}</strong> apenas especificadas e{' '}
              <strong>{progress.projected}</strong> ainda projetadas.
            </>
          ) : (
            'Alvo não encontrado no grafo.'
          )}
        </p>
      </section>

      <section className={styles.detailSection}>
        <h3 className={styles.detailLabel}>Um caminho do presente até o futuro</h3>
        <ol className={styles.pathList}>
          {path.map((id) => {
            const n = byId.get(id);
            const m = n?.capability.maturity;
            return (
              <li key={id}>
                <button type="button" className={styles.pathStep} onClick={() => onSelect(id)}>
                  {m && (
                    <span style={{ color: MATURITY_COLOR[m] }} title={MATURITY_LABEL[m]}>
                      {MATURITY_GLYPH[m]}
                    </span>
                  )}{' '}
                  {nameById.get(id) ?? id}
                </button>
              </li>
            );
          })}
        </ol>
      </section>

      <p className={styles.detailHint}>Clique em qualquer capacidade no mapa para ver seu estado, dependências e evidências.</p>
    </div>
  );
}
