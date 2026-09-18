'use client';

// EvolutionClient — o MAPA DE EVOLUÇÃO do próprio Anima (Evolution UX V1).
//
// Não é um "grafo técnico de capabilities": é uma superfície explorável que
// responde, à primeira vista, o que o Anima já conquistou, o que sabe fazer
// hoje, onde está a fronteira e o que falta para chegar a um objetivo futuro.
//
// Layout: colunas = DOMÍNIOS; faixas horizontais = REGIÕES DE MATURIDADE
// (Fundações operacionais → Capacidades atuais → [FRONTEIRA] → Próximas
// evoluções → Visão futura). A fronteira é DERIVADA da maturidade, não da
// posição. Estado por FORMA + COR + TEXTO + OPACIDADE (nunca só cor).
//
// A superfície tem viewport própria: pan por arraste, zoom por roda/botões,
// Ajustar (fit) e Resetar. O modelo canônico de Capability (packages/core) NÃO
// é reescrito; esta camada é só UX/visualização/linguagem.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  Capability,
  CapabilityDomain,
  CapabilityGraphNode,
  CapabilityMaturity,
  CapabilityProofRef,
  DomainMaturitySummary,
  TargetProgress,
} from '@anima/core';
import type { CapabilityAssessmentProjection } from '@anima/core';
import { explainCapabilityAssessment } from '@anima/core';
import styles from './EvolutionClient.module.css';

// ─── Vocabulário de produto / apresentação (valores puros; tipos vêm do core) ───

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
  proven: 'há prova concreta de que funcionou',
  operational: 'comprovada de maneira confiável',
  autonomous: 'o Anima a usa sozinho dentro da authority',
  degraded: 'antes comprovada, com sinal recente de regressão',
};

const PROOF_KIND_LABEL: Record<CapabilityProofRef['kind'], string> = {
  commit: 'COMMIT',
  work_item: 'WORK ITEM',
  attempt: 'ATTEMPT',
  test: 'TESTE',
  verifier: 'VERIFIER',
  event: 'EVENTO',
  route: 'ROTA',
  milestone: 'MARCO',
  record: 'REGISTRO',
  doc: 'DOC',
};

function isFuture(m: CapabilityMaturity): boolean {
  return m === 'projected' || m === 'specified';
}

function nextStage(m: CapabilityMaturity): CapabilityMaturity | null {
  if (m === 'degraded') return 'proven';
  const i = MATURITY_LADDER.indexOf(m);
  if (i < 0 || i >= MATURITY_LADDER.length - 1) return null;
  return MATURITY_LADDER[i + 1] ?? null;
}

function maturityRank(m: CapabilityMaturity): number {
  if (m === 'degraded') return 2;
  return MATURITY_LADDER.indexOf(m);
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

// ─── Layout em regiões de maturidade × domínios ─────────────────────────────────

const LANE_W = 212;
const CHIP_W = 172;
const CHIP_H = 58;
const V_GAP = 14;
const REGION_HEADER_H = 30;
const REGION_GAP = 30;
const HEADER_H = 40;

const REGIONS: { key: string; title: string; maturities: CapabilityMaturity[]; future: boolean }[] = [
  { key: 'operational', title: 'FUNDAÇÕES OPERACIONAIS', maturities: ['operational', 'autonomous'], future: false },
  { key: 'current', title: 'CAPACIDADES ATUAIS', maturities: ['proven', 'implemented', 'degraded'], future: false },
  { key: 'specified', title: 'PRÓXIMAS EVOLUÇÕES', maturities: ['specified'], future: true },
  { key: 'projected', title: 'VISÃO FUTURA', maturities: ['projected'], future: true },
];

interface Placed {
  node: CapabilityGraphNode;
  x: number;
  y: number;
}

interface Band {
  key: string;
  title: string;
  top: number;
  bottom: number;
  future: boolean;
}

interface Layout {
  placed: Placed[];
  posById: Map<string, Placed>;
  bands: Band[];
  frontierY: number | null;
  width: number;
  height: number;
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

function computeLayout(nodes: CapabilityGraphNode[]): Layout {
  const laneOf = new Map<CapabilityDomain, number>(DOMAIN_ORDER.map((d, i) => [d, i]));
  const posById = new Map<string, Placed>();
  const placed: Placed[] = [];
  const bands: Band[] = [];

  let y = HEADER_H;
  for (const region of REGIONS) {
    const inRegion = nodes.filter((n) => region.maturities.includes(n.capability.maturity));
    if (inRegion.length === 0) continue;

    const bandTop = y;
    const contentTop = y + REGION_HEADER_H;

    const byLane = new Map<number, CapabilityGraphNode[]>();
    for (const n of inRegion) {
      const li = laneOf.get(n.capability.domain) ?? 0;
      const list = byLane.get(li) ?? [];
      list.push(n);
      byLane.set(li, list);
    }
    for (const list of byLane.values()) {
      list.sort((a, b) => {
        const r = maturityRank(b.capability.maturity) - maturityRank(a.capability.maturity);
        return r !== 0 ? r : a.capability.name.localeCompare(b.capability.name);
      });
    }

    const maxStack = Math.max(...[...byLane.values()].map((l) => l.length), 1);
    for (const [li, list] of byLane) {
      const cx = li * LANE_W + LANE_W / 2;
      list.forEach((node, k) => {
        const p: Placed = { node, x: cx - CHIP_W / 2, y: contentTop + k * (CHIP_H + V_GAP) };
        posById.set(node.capability.id, p);
        placed.push(p);
      });
    }

    const bandContentH = maxStack * CHIP_H + (maxStack - 1) * V_GAP;
    const bandBottom = contentTop + bandContentH;
    bands.push({ key: region.key, title: region.title, top: bandTop, bottom: bandBottom, future: region.future });
    y = bandBottom + REGION_GAP;
  }

  const lastRealized = [...bands].reverse().find((b) => !b.future);
  const firstFuture = bands.find((b) => b.future);
  const frontierY = lastRealized && firstFuture ? (lastRealized.bottom + firstFuture.top) / 2 : null;

  return { placed, posById, bands, frontierY, width: DOMAIN_ORDER.length * LANE_W, height: y + 8 };
}

// Fecho transitivo de dependências (up) ou de desbloqueios (down).
function closure(byId: Map<string, CapabilityGraphNode>, startId: string, dir: 'up' | 'down'): Set<string> {
  const out = new Set<string>();
  const start = byId.get(startId);
  if (!start) return out;
  const stack = [...(dir === 'up' ? start.dependsOn : start.unlocks)];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (out.has(cur) || cur === startId) continue;
    out.add(cur);
    const n = byId.get(cur);
    if (n) for (const next of dir === 'up' ? n.dependsOn : n.unlocks) stack.push(next);
  }
  return out;
}

function edgePath(a: Placed, b: Placed): string {
  const ax = a.x + CHIP_W / 2;
  const bx = b.x + CHIP_W / 2;
  const aAbove = a.y <= b.y;
  const ay = a.y + (aAbove ? CHIP_H : 0);
  const by = b.y + (aAbove ? 0 : CHIP_H);
  const dy = Math.max(Math.abs(by - ay) / 2, 20) * (aAbove ? 1 : -1);
  return `M ${ax} ${ay} C ${ax} ${ay + dy} ${bx} ${by - dy} ${bx} ${by}`;
}

// ─── Componente ────────────────────────────────────────────────────────────────

export interface EvolutionObjective {
  id: string;
  name: string;
  progress: TargetProgress;
  path: string[];
}

export type EvolutionCapabilityAssessmentState =
  | {
      readonly status: 'available';
      readonly eventCount: number;
      readonly projection: CapabilityAssessmentProjection;
    }
  | {
      readonly status: 'unavailable';
      readonly reason:
        | 'event_history_read_failed'
        | 'event_history_invalid'
        | 'canonical_contract_incompatibility';
    };
export interface EvolutionClientProps {
  nodes: CapabilityGraphNode[];
  domainSummaries: DomainMaturitySummary[];
  objectives: EvolutionObjective[];
  featuredTargetId: string;
  capabilityAssessment: EvolutionCapabilityAssessmentState;
}

interface View {
  tx: number;
  ty: number;
  k: number;
}

export default function EvolutionClient({
  nodes,
  domainSummaries,
  objectives,
  featuredTargetId,
  capabilityAssessment,
}: EvolutionClientProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [domainFilter, setDomainFilter] = useState<CapabilityDomain | null>(null);
  const [objectiveId, setObjectiveId] = useState<string>(featuredTargetId);
  const [view, setView] = useState<View>({ tx: 0, ty: 0, k: 1 });

  const layout = useMemo(() => computeLayout(nodes), [nodes]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.capability.id, n])), [nodes]);
  const nameById = useMemo(() => new Map(nodes.map((n) => [n.capability.id, n.capability.name])), [nodes]);

  const currentObjective = useMemo(
    () => objectives.find((o) => o.id === objectiveId) ?? objectives[0] ?? null,
    [objectives, objectiveId],
  );
  const objectivePath = useMemo(() => currentObjective?.path ?? [], [currentObjective]);
  const objectivePathSet = useMemo(() => new Set(objectivePath), [objectivePath]);
  const objectiveEdgeKeys = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < objectivePath.length - 1; i++) set.add(`${objectivePath[i]}>${objectivePath[i + 1]}`);
    return set;
  }, [objectivePath]);

  // Foco de relações: cadeia ascendente (dependências) + descendente (desbloqueios).
  const focus = useMemo(() => {
    if (!selectedId) return null;
    const node = byId.get(selectedId);
    if (!node) return null;
    const ancestors = closure(byId, selectedId, 'up');
    const descendants = closure(byId, selectedId, 'down');
    const chain = new Set<string>([selectedId, ...ancestors, ...descendants]);
    const direct = new Set<string>([selectedId, ...node.dependsOn, ...node.unlocks]);
    return { chain, direct };
  }, [selectedId, byId]);

  const selectedNode = selectedId ? byId.get(selectedId) ?? null : null;

  const containerRef = useRef<HTMLDivElement>(null);
  const pan = useRef({ active: false, sx: 0, sy: 0, ox: 0, oy: 0, moved: false, fromChip: false });

  const fitView = useCallback(() => {
    const r = containerRef.current?.getBoundingClientRect();
    if (!r || r.width < 2 || r.height < 2 || layout.width < 2 || layout.height < 2) {
      setView({ tx: 0, ty: 0, k: 1 });
      return;
    }
    const pad = 28;
    const k = clamp(Math.min((r.width - pad * 2) / layout.width, (r.height - pad * 2) / layout.height), 0.35, 2.4);
    const tx = (r.width - layout.width * k) / 2;
    const ty = Math.max(pad, (r.height - layout.height * k) / 2);
    setView({ tx, ty, k });
  }, [layout.width, layout.height]);

  // Fit inicial (e quando o layout muda). Em jsdom o rect é 0 → cai no fallback.
  useLayoutEffect(() => {
    fitView();
  }, [fitView]);

  // Wheel não-passivo para poder previnir o scroll da página ao dar zoom.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      setView((v) => {
        const nk = clamp(v.k * factor, 0.35, 2.4);
        const wx = (x - v.tx) / v.k;
        const wy = (y - v.ty) / v.k;
        return { k: nk, tx: x - wx * nk, ty: y - wy * nk };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const r = containerRef.current?.getBoundingClientRect();
    const cx = r ? r.width / 2 : 400;
    const cy = r ? r.height / 2 : 300;
    setView((v) => {
      const nk = clamp(v.k * factor, 0.35, 2.4);
      const wx = (cx - v.tx) / v.k;
      const wy = (cy - v.ty) / v.k;
      return { k: nk, tx: cx - wx * nk, ty: cy - wy * nk };
    });
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    pan.current = { active: true, sx: e.clientX, sy: e.clientY, ox: view.tx, oy: view.ty, moved: false, fromChip: pan.current.fromChip };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pan.current.active) return;
    const dx = e.clientX - pan.current.sx;
    const dy = e.clientY - pan.current.sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) pan.current.moved = true;
    setView((v) => ({ ...v, tx: pan.current.ox + dx, ty: pan.current.oy + dy }));
  };
  const onPointerUp = () => {
    // Clique em área vazia (sem arrastar) limpa a seleção.
    if (pan.current.active && !pan.current.moved && !pan.current.fromChip) setSelectedId(null);
    pan.current.active = false;
    pan.current.fromChip = false;
  };

  const selectCapability = (id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
  };

  const totalCount = domainSummaries.reduce((s, d) => s + d.total, 0);

  // Estado visual de uma capacidade (prioridade: seleção > filtro > objetivo).
  const chipState = (cap: Capability): 'selected' | 'strong' | 'related' | 'path' | 'normal' | 'dim' => {
    if (focus) {
      if (cap.id === selectedId) return 'selected';
      if (focus.direct.has(cap.id)) return 'strong';
      if (focus.chain.has(cap.id)) return 'related';
      return 'dim';
    }
    if (domainFilter) return cap.domain === domainFilter ? 'strong' : 'dim';
    if (objectivePathSet.has(cap.id)) return 'path';
    return 'normal';
  };

  const edgeState = (depId: string, tgtId: string): 'active' | 'related' | 'path' | 'normal' | 'dim' => {
    if (focus) {
      if (depId === selectedId || tgtId === selectedId) return 'active';
      if (focus.chain.has(depId) && focus.chain.has(tgtId)) return 'related';
      return 'dim';
    }
    if (domainFilter) {
      const a = byId.get(depId)?.capability.domain;
      const b = byId.get(tgtId)?.capability.domain;
      return a === domainFilter && b === domainFilter ? 'normal' : 'dim';
    }
    if (objectiveEdgeKeys.has(`${depId}>${tgtId}`)) return 'path';
    return 'normal';
  };

  const edgeClass: Record<string, string> = {
    active: styles.edgeActive ?? '',
    related: styles.edgeRelated ?? '',
    path: styles.edgePath ?? '',
    normal: styles.edge ?? '',
    dim: styles.edgeDim ?? '',
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headTop}>
          <div>
            <h1 className={styles.title}>Mapa de Evolução do Anima</h1>
            <p className={styles.subtitle}>
              O que o Anima já conquistou, o que sabe fazer hoje, onde está a fronteira e o que
              falta para chegar a um objetivo futuro. Projeção do modelo de capacidades — não uma
              imagem fixa.
            </p>
          </div>
          <span className={styles.marker}>Evolution UX V1</span>
        </div>

        <div className={styles.controls}>
          <div className={styles.filterRow} role="group" aria-label="Focar por domínio">
            <button
              type="button"
              className={`${styles.filterChip} ${domainFilter === null ? styles.filterActive : ''}`}
              aria-pressed={domainFilter === null}
              onClick={() => setDomainFilter(null)}
            >
              Todos <span className={styles.filterCount}>{totalCount}</span>
            </button>
            {DOMAIN_ORDER.map((d) => {
              const total = domainSummaries.find((s) => s.domain === d)?.total ?? 0;
              return (
                <button
                  key={d}
                  type="button"
                  className={`${styles.filterChip} ${domainFilter === d ? styles.filterActive : ''}`}
                  aria-pressed={domainFilter === d}
                  onClick={() => setDomainFilter((prev) => (prev === d ? null : d))}
                >
                  {DOMAIN_LABEL[d]} <span className={styles.filterCount}>{total}</span>
                </button>
              );
            })}
          </div>

          <label className={styles.objectivePicker}>
            <span>Objetivo</span>
            <select value={objectiveId} onChange={(e) => setObjectiveId(e.target.value)} aria-label="Escolher objetivo futuro">
              {objectives.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className={styles.legend} aria-label="Legenda de maturidade">
          {MATURITY_LADDER.concat('degraded').map((m) => (
            <span key={m} className={styles.legendItem} title={MATURITY_MEANING[m]}>
              <span className={styles.legendGlyph} style={{ color: MATURITY_COLOR[m] }}>
                {MATURITY_GLYPH[m]}
              </span>
              {MATURITY_LABEL[m]}
            </span>
          ))}
          <span className={styles.legendItem} title="Limite entre o que já existe e o que ainda é futuro">
            <span className={styles.legendFrontier} /> Fronteira atual
          </span>
        </div>
      </header>

      <div className={styles.workspace}>
        <div className={styles.mapContainer} ref={containerRef} data-testid="evolution-map">
          <svg
            className={styles.svg}
            width="100%"
            height="100%"
            role="group"
            aria-label="Mapa de capacidades do Anima"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          >
            <g data-testid="map-canvas" transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
              {/* Faixas de região (maturidade) */}
              {layout.bands.map((b) => (
                <g key={b.key}>
                  <rect
                    x={0}
                    y={b.top}
                    width={layout.width}
                    height={b.bottom - b.top}
                    className={b.future ? styles.bandFuture : styles.band}
                  />
                  <text x={12} y={b.top + 19} className={styles.bandTitle}>
                    {b.title}
                  </text>
                </g>
              ))}

              {/* Fronteira atual */}
              {layout.frontierY !== null && (
                <g>
                  <line x1={0} y1={layout.frontierY} x2={layout.width} y2={layout.frontierY} className={styles.frontier} />
                  <rect x={layout.width / 2 - 74} y={layout.frontierY - 11} width={148} height={22} rx={11} className={styles.frontierPill} />
                  <text x={layout.width / 2} y={layout.frontierY + 4} textAnchor="middle" className={styles.frontierLabel}>
                    FRONTEIRA ATUAL
                  </text>
                </g>
              )}

              {/* Faixas de domínio (colunas) */}
              {DOMAIN_ORDER.map((domain, i) => (
                <g key={domain}>
                  {i > 0 && <line x1={i * LANE_W} y1={HEADER_H} x2={i * LANE_W} y2={layout.height} className={styles.laneSep} />}
                  <text
                    x={i * LANE_W + LANE_W / 2}
                    y={HEADER_H / 2 + 5}
                    textAnchor="middle"
                    className={`${styles.laneLabel} ${domainFilter && domainFilter !== domain ? styles.laneLabelDim : ''}`}
                  >
                    {DOMAIN_LABEL[domain]}
                  </text>
                </g>
              ))}

              {/* Arestas de dependência */}
              {layout.placed.map((p) =>
                p.node.dependsOn.map((depId) => {
                  const dep = layout.posById.get(depId);
                  if (!dep) return null;
                  const st = edgeState(depId, p.node.capability.id);
                  const future = isFuture(p.node.capability.maturity);
                  return (
                    <path
                      key={`${depId}>${p.node.capability.id}`}
                      className={`${edgeClass[st]} ${future ? styles.edgeFuture : ''}`}
                      d={edgePath(dep, p)}
                      fill="none"
                    />
                  );
                }),
              )}

              {/* Capacidades (chips) */}
              {layout.placed.map((p) => {
                const cap = p.node.capability;
                const color = MATURITY_COLOR[cap.maturity];
                const future = isFuture(cap.maturity);
                const state = chipState(cap);
                const lines = wrapName(cap.name);
                const cls = [
                  styles.chip,
                  state === 'dim' ? styles.chipDim : '',
                  state === 'selected' ? styles.chipSelected : '',
                  state === 'strong' || state === 'related' ? styles.chipStrong : '',
                ].join(' ');
                const stroke =
                  state === 'selected' || state === 'strong'
                    ? color
                    : state === 'path'
                      ? '#f5b301'
                      : 'var(--border)';
                return (
                  <g
                    key={cap.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${cap.name} — ${MATURITY_LABEL[cap.maturity]}${future ? ' (a conquistar)' : ''}`}
                    aria-pressed={state === 'selected'}
                    data-capid={cap.id}
                    data-state={state}
                    data-future={future ? 'true' : 'false'}
                    className={cls}
                    transform={`translate(${p.x} ${p.y})`}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      pan.current.fromChip = true;
                    }}
                    onClick={() => selectCapability(cap.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        selectCapability(cap.id);
                      }
                    }}
                  >
                    <rect
                      width={CHIP_W}
                      height={CHIP_H}
                      rx={10}
                      className={styles.chipBg}
                      style={{
                        stroke,
                        strokeWidth: state === 'selected' ? 2.4 : state === 'strong' || state === 'path' ? 1.8 : 1,
                        strokeDasharray: future ? '5 4' : undefined,
                        opacity: future ? 0.92 : 1,
                      }}
                    />
                    <rect width={5} height={CHIP_H} rx={2} style={{ fill: color, opacity: future ? 0.75 : 1 }} />
                    <text x={16} y={22} className={styles.chipGlyph} style={{ fill: color }}>
                      {MATURITY_GLYPH[cap.maturity]}
                    </text>
                    {lines.map((line, li) => (
                      <text key={li} x={30} y={19 + li * 15} className={styles.chipName}>
                        {line}
                      </text>
                    ))}
                    <text x={30} y={CHIP_H - 10} className={styles.chipMaturity} style={{ fill: color }}>
                      {MATURITY_LABEL[cap.maturity]}
                      {future ? ' · a conquistar' : ''}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>

          <div className={styles.mapControls} role="group" aria-label="Controles do mapa">
            <button type="button" onClick={() => zoomBy(1.2)} aria-label="Aproximar" title="Aproximar">
              +
            </button>
            <button type="button" onClick={() => zoomBy(1 / 1.2)} aria-label="Afastar" title="Afastar">
              −
            </button>
            <button type="button" onClick={fitView} aria-label="Ajustar" title="Ajustar à tela">
              Ajustar
            </button>
            <button type="button" onClick={fitView} aria-label="Resetar visão" title="Resetar visão">
              Resetar
            </button>
          </div>

          <span className={styles.zoomBadge} aria-hidden="true">
            {Math.round(view.k * 100)}%
          </span>
        </div>

        <aside className={styles.panel} aria-live="polite">
          {selectedNode ? (
            <CapabilityDetail
              capabilityAssessment={capabilityAssessment}
              node={selectedNode}
              nameById={nameById}
              onSelect={selectCapability}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <ObjectiveSummary
              objective={currentObjective}
              node={currentObjective ? byId.get(currentObjective.id) ?? null : null}
              byId={byId}
              nameById={nameById}
              onSelect={selectCapability}
            />
          )}
        </aside>
      </div>

      <footer className={styles.footer}>
        Sem porcentagem global inventada — não existe base semântica para “Anima X% completo”. As
        contagens e a distância até um objetivo são derivadas objetivamente do grafo de capacidades.
      </footer>
    </main>
  );
}

// ─── Provas / relações (blocos reutilizados) ────────────────────────────────────

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
  capabilityAssessment,
  node,
  nameById,
  onSelect,
  onClose,
}: {
  capabilityAssessment: EvolutionCapabilityAssessmentState;
  node: CapabilityGraphNode;
  nameById: Map<string, string>;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const cap: Capability = node.capability;
  const color = MATURITY_COLOR[cap.maturity];
  const next = nextStage(cap.maturity);

  const dynamicAssessment =
    capabilityAssessment.status === 'available'
      ? capabilityAssessment.projection.assessments.find(
          (entry) => entry.capabilityId === cap.id,
        ) ?? null
      : null;

  // A explicação é a PROJEÇÃO humana da conclusão do Proof Engine (core, pura):
  // por que a capacidade está no nível derivado e QUAIS provas o sustentam. A
  // régua vive no core; aqui só se renderiza.
  const dynamicExplanation = dynamicAssessment
    ? explainCapabilityAssessment(dynamicAssessment)
    : null;

  return (
    <div className={styles.detail}>
      <div className={styles.detailTop}>
        <span className={styles.detailKicker}>Capacidade selecionada · {DOMAIN_LABEL[cap.domain]}</span>
        <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Fechar capacidade">
          ×
        </button>
      </div>
      <h2 className={styles.detailName}>{cap.name}</h2>
      <div className={styles.maturityBadge} style={{ borderColor: color, color }}>
        <span>{MATURITY_GLYPH[cap.maturity]}</span> {MATURITY_LABEL[cap.maturity]}
        <span className={styles.maturityMeaning}>— {MATURITY_MEANING[cap.maturity]}</span>
      </div>

      <section className={styles.detailSection}>
        <h3 className={styles.detailLabel}>Avaliação dinâmica</h3>

        {capabilityAssessment.status === 'unavailable' ? (
          <p className={styles.detailEmpty}>
            {capabilityAssessment.reason === 'canonical_contract_incompatibility'
              ? 'Indisponível: o histórico contém um contrato de evidência que esta versão do app ainda não reconhece (formato de uma linha divergente/mais nova). É incompatibilidade de contrato, não corrupção — requer reconciliação. O estado declarado continua visível sem inferência dinâmica.'
              : capabilityAssessment.reason === 'event_history_invalid'
              ? 'Indisponível: o histórico de evidências está inconsistente. O estado declarado continua visível sem inferência dinâmica.'
              : 'Indisponível: não foi possível ler o histórico de evidências. O estado declarado continua visível sem inferência dinâmica.'}
          </p>
        ) : dynamicAssessment === null ? (
          <p className={styles.detailEmpty}>
            Sem avaliação dinâmica para esta capacidade — ausência de telemetria não implica rebaixamento.
          </p>
        ) : (
          <>
            <p className={styles.detailText}>
              Declarado: {MATURITY_LABEL[dynamicAssessment.declaredMaturity]}
            </p>
            <p className={styles.detailText}>
              Base: {MATURITY_LABEL[dynamicAssessment.definitionMaturity]}
            </p>
            <p className={styles.detailText}>
              Derivado: {MATURITY_LABEL[dynamicAssessment.derivedMaturity]}
            </p>
            <p className={styles.detailEmpty}>
              Evidências usadas: {dynamicAssessment.evidence.length} · eventos lidos: {capabilityAssessment.eventCount}. O derivado não substitui o estado declarado.
            </p>

            {dynamicExplanation && (
              <div className={styles.dynamicWhy}>
                <p className={styles.detailText}>
                  <span className={styles.whyLabel}>Por que:</span> {dynamicExplanation.rationale}
                </p>

                {dynamicExplanation.decisiveProofRefs.length > 0 && (
                  <>
                    <p className={styles.detailHint}>Provas que sustentam este nível</p>
                    <ul className={styles.proofList}>
                      {dynamicExplanation.decisiveProofRefs.map((proof, i) => (
                        <li key={`decisive-${i}`} className={styles.proofItem}>
                          <span className={styles.proofKind}>{PROOF_KIND_LABEL[proof.kind]}</span>
                          <code className={styles.proofRef}>{proof.ref}</code>
                          {proof.note && <span className={styles.proofNote}>{proof.note}</span>}
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {dynamicExplanation.contradictingProofRefs.length > 0 && (
                  <>
                    <p className={styles.detailHint}>Provas que contradizem (regressão)</p>
                    <ul className={styles.proofList}>
                      {dynamicExplanation.contradictingProofRefs.map((proof, i) => (
                        <li key={`contra-${i}`} className={styles.proofItem}>
                          <span className={styles.proofKind}>{PROOF_KIND_LABEL[proof.kind]}</span>
                          <code className={styles.proofRef}>{proof.ref}</code>
                          {proof.note && <span className={styles.proofNote}>{proof.note}</span>}
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {dynamicExplanation.nextProof && (
                  <p className={styles.detailText}>
                    <span className={styles.whyLabel}>Próxima prova:</span> {dynamicExplanation.nextProof}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </section>

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
        <h3 className={styles.detailLabel}>Provas</h3>
        {(cap.proofRefs?.length ?? 0) === 0 ? (
          <p className={styles.detailEmpty}>Sem prova declarada — coerente com um estado ainda não comprovado.</p>
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
              <span style={{ color: MATURITY_COLOR[next] }}>{MATURITY_GLYPH[next]}</span> {MATURITY_LABEL[next]}
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

function ObjectiveSummary({
  objective,
  node,
  byId,
  nameById,
  onSelect,
}: {
  objective: EvolutionObjective | null;
  node: CapabilityGraphNode | null;
  byId: Map<string, CapabilityGraphNode>;
  nameById: Map<string, string>;
  onSelect: (id: string) => void;
}) {
  if (!objective) return <div className={styles.detail}>Nenhum objetivo disponível.</div>;
  const cap = node?.capability;
  const progress = objective.progress;

  return (
    <div className={styles.detail}>
      <span className={styles.detailKicker}>Objetivo em foco</span>
      <h2 className={styles.detailName}>{cap?.name ?? objective.name}</h2>
      {cap?.target && <p className={styles.detailDesc}>{cap.target.description}</p>}

      <section className={styles.detailSection}>
        <h3 className={styles.detailLabel}>O que falta para o Anima chegar aqui</h3>
        <p className={styles.detailText}>
          {progress.found ? (
            <>
              <strong>{progress.existing}</strong> das <strong>{progress.totalDependencies}</strong> capacidades
              necessárias já existem; <strong>{progress.specified}</strong> apenas especificadas e{' '}
              <strong>{progress.projected}</strong> ainda projetadas.
            </>
          ) : (
            'Objetivo não encontrado no grafo.'
          )}
        </p>
      </section>

      <section className={styles.detailSection}>
        <h3 className={styles.detailLabel}>Um caminho relevante do presente até aqui</h3>
        <p className={styles.detailHint}>
          Um entre vários — o objetivo depende de múltiplas capacidades, não de uma única sequência.
        </p>
        <ol className={styles.pathList}>
          {objective.path.map((id) => {
            const m = byId.get(id)?.capability.maturity;
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

      <p className={styles.detailHint}>Clique em qualquer capacidade no mapa para ver seu estado, dependências e provas.</p>
    </div>
  );
}
