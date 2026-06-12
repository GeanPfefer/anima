import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import Svg, { Circle, G, Line, Text as SvgText } from 'react-native-svg';
import { supabase } from '@/lib/supabase';
import { colors, spacing } from '@/constants/theme';

// ─── Types ─────────────────────────────────────────────────────────────────────

type SimNode = {
  id: string;
  name: string;
  level: number;
  xpTotal: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
};

type SimEdge = {
  source: string;
  target: string;
  weight: number;
  kind: 'relation' | 'cooccurrence';
};

type Snapshot = { id: string; x: number; y: number };

// ─── Color ─────────────────────────────────────────────────────────────────────

function pillarColor(name: string): string {
  const n = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  if (n === 'saude')    return '#22c55e';
  if (n === 'mente')    return '#7c5cfc';
  if (n === 'relacoes') return '#f59e0b';
  let h = 5381;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) + h) ^ name.charCodeAt(i);
  }
  return `hsl(${Math.abs(h) % 360}, 78%, 60%)`;
}

// ─── Force simulation ──────────────────────────────────────────────────────────

const K_REP = 14000;
const K_ATT = 0.016;
const REST  = 130;
const K_CTR = 0.018;
const DAMP  = 0.82;

function simTick(
  nodes: SimNode[],
  edges: SimEdge[],
  halfW: number,
  halfH: number,
  alpha: number,
) {
  const cool = Math.max(0.05, alpha);
  const byId = new Map<string, SimNode>(nodes.map(n => [n.id, n]));

  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]!;
    a.vx += -a.x * K_CTR * cool;
    a.vy += -a.y * K_CTR * cool;

    for (let j = i + 1; j < nodes.length; j++) {
      const b  = nodes[j]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy + 1;
      const d  = Math.sqrt(d2);
      const f  = (K_REP / d2) * cool;
      const ux = dx / d;
      const uy = dy / d;
      a.vx -= f * ux; a.vy -= f * uy;
      b.vx += f * ux; b.vy += f * uy;
    }
  }

  for (const e of edges) {
    const a = byId.get(e.source);
    const b = byId.get(e.target);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d  = Math.sqrt(dx * dx + dy * dy) + 0.01;
    const f  = K_ATT * (d - REST) * Math.min(e.weight, 4) * cool;
    const ux = dx / d;
    const uy = dy / d;
    a.vx += f * ux; a.vy += f * uy;
    b.vx -= f * ux; b.vy -= f * uy;
  }

  for (const n of nodes) {
    n.vx *= DAMP; n.vy *= DAMP;
    n.x  += n.vx; n.y  += n.vy;
    const mx = halfW - n.radius - 20;
    const my = halfH - n.radius - 24;
    if (n.x >  mx) { n.x =  mx; n.vx *= -0.4; }
    if (n.x < -mx) { n.x = -mx; n.vx *= -0.4; }
    if (n.y >  my) { n.y =  my; n.vy *= -0.4; }
    if (n.y < -my) { n.y = -my; n.vy *= -0.4; }
  }
}

// ─── Screen ────────────────────────────────────────────────────────────────────

export default function GraphScreen() {
  const { top, bottom } = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const TAB_H  = 49 + bottom;
  const graphH = height - top - TAB_H;

  const nodesRef = useRef<SimNode[]>([]);
  const edgesRef = useRef<SimEdge[]>([]);
  const alphaRef = useRef<number>(1);

  const [loading, setLoading] = useState(true);
  const [stats, setStats]     = useState({ nodes: 0, edges: 0 });
  const [snap, setSnap]       = useState<Snapshot[]>([]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      let rafId  = 0;

      const halfW = width  / 2;
      const halfH = graphH / 2;

      function startLoop() {
        function loop() {
          if (!active) return;
          simTick(nodesRef.current, edgesRef.current, halfW, halfH, alphaRef.current);
          if (alphaRef.current > 0.04) alphaRef.current *= 0.992;
          setSnap(nodesRef.current.map(n => ({ id: n.id, x: n.x, y: n.y })));
          if (alphaRef.current > 0.01) {
            rafId = requestAnimationFrame(loop);
          }
        }
        rafId = requestAnimationFrame(loop);
      }

      async function doLoad() {
        setLoading(true);
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const user = session?.user;
          if (!user || !active) return;

          const { data: pillarsData } = await supabase
            .from('user_pillars')
            .select('id, name, xp_total, level')
            .eq('user_id', user.id)
            .eq('is_active', true)
            .order('level', { ascending: false });

          if (!active) return;

          const pillars = pillarsData ?? [];
          if (pillars.length === 0) return;

          const pillarIds = new Set(pillars.map(p => p.id));
          const ringR     = Math.min(100, Math.max(60, Math.min(width, graphH) * 0.2));

          const simNodes: SimNode[] = pillars.map((p, i) => {
            const angle  = (i / Math.max(1, pillars.length)) * Math.PI * 2;
            const radius = Math.min(38, 10 + (p.level ?? 1) * 2.4);
            return {
              id: p.id, name: p.name, level: p.level, xpTotal: p.xp_total,
              x: Math.cos(angle) * ringR,
              y: Math.sin(angle) * ringR,
              vx: 0, vy: 0, radius,
              color: pillarColor(p.name),
            };
          });

          const simEdges: SimEdge[] = [];
          const edgeKeys = new Set<string>();

          function addEdge(src: string, tgt: string, weight: number, kind: SimEdge['kind']) {
            if (!pillarIds.has(src) || !pillarIds.has(tgt)) return;
            const key = [src, tgt].sort().join('|');
            if (edgeKeys.has(key)) return;
            edgeKeys.add(key);
            simEdges.push({ source: src, target: tgt, weight, kind });
          }

          const since = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);

          const [relRes, xpRes] = await Promise.all([
            supabase
              .from('pillar_relationships')
              .select('parent_id, child_id')
              .in('parent_id', [...pillarIds]),
            supabase
              .from('xp_records')
              .select('pillar_id, activity_date')
              .eq('user_id', user.id)
              .gte('activity_date', since),
          ]);

          if (!active) return;

          for (const r of relRes.data ?? []) {
            addEdge(r.parent_id, r.child_id, 3, 'relation');
          }

          const byDate: Record<string, string[]> = {};
          for (const r of xpRes.data ?? []) {
            if (!pillarIds.has(r.pillar_id)) continue;
            (byDate[r.activity_date] ??= []).push(r.pillar_id);
          }

          const coCount: Record<string, number> = {};
          for (const pids of Object.values(byDate)) {
            const uniq = [...new Set(pids)];
            for (let i = 0; i < uniq.length; i++) {
              for (let j = i + 1; j < uniq.length; j++) {
                const key = [uniq[i]!, uniq[j]!].sort().join('|');
                coCount[key] = (coCount[key] ?? 0) + 1;
              }
            }
          }

          for (const [key, count] of Object.entries(coCount)) {
            if (count < 2) continue;
            const [src, tgt] = key.split('|');
            if (src && tgt) addEdge(src, tgt, Math.min(count, 10), 'cooccurrence');
          }

          // Pre-warm: run 200 ticks so the initial render is already stable
          for (let i = 0; i < 200; i++) {
            simTick(simNodes, simEdges, halfW, halfH, Math.max(0.05, 1 - i * 0.005));
          }

          if (!active) return;

          nodesRef.current = simNodes;
          edgesRef.current = simEdges;
          alphaRef.current = 0.3;

          setStats({ nodes: simNodes.length, edges: simEdges.length });
          setSnap(simNodes.map(n => ({ id: n.id, x: n.x, y: n.y })));
          startLoop();
        } catch {
          // falha silenciosa
        } finally {
          if (active) setLoading(false);
        }
      }

      doLoad();

      return () => {
        active = false;
        cancelAnimationFrame(rafId);
      };
    }, [width, graphH]),
  );

  const posById = new Map(snap.map(s => [s.id, s]));
  const cx = width  / 2;
  const cy = graphH / 2;

  if (loading) {
    return (
      <View style={[s.centered, { paddingTop: top }]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (snap.length === 0) {
    return (
      <View style={[s.centered, { paddingTop: top }]}>
        <Text style={s.empty}>
          Nenhum pilar encontrado.{'\n'}Comece uma conversa com a IA para criar seus pilares.
        </Text>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <Svg width={width} height={graphH} style={{ marginTop: top }}>
        {/* Arestas */}
        {edgesRef.current.map((e, i) => {
          const a = posById.get(e.source);
          const b = posById.get(e.target);
          if (!a || !b) return null;
          const opacity = e.kind === 'relation' ? 0.55 : 0.22;
          const sw      = e.kind === 'relation' ? 1.5  : 0.8;
          return (
            <Line
              key={`e-${i}`}
              x1={cx + a.x} y1={cy + a.y}
              x2={cx + b.x} y2={cy + b.y}
              stroke={`rgba(255,255,255,${opacity})`}
              strokeWidth={sw}
            />
          );
        })}
        {/* Nós */}
        {nodesRef.current.map(n => {
          const pos = posById.get(n.id);
          if (!pos) return null;
          const x = cx + pos.x;
          const y = cy + pos.y;
          return (
            <G key={n.id}>
              {/* Glow */}
              <Circle cx={x} cy={y} r={n.radius * 3.2} fill={n.color} opacity={0.06} />
              <Circle cx={x} cy={y} r={n.radius * 1.9} fill={n.color} opacity={0.14} />
              {/* Core */}
              <Circle cx={x} cy={y} r={n.radius} fill={n.color} opacity={0.9} />
              {/* Nível centralizado dentro do nó */}
              <SvgText
                x={x} y={y + 4}
                fill="rgba(0,0,0,0.75)"
                fontSize={9}
                fontWeight="700"
                textAnchor="middle"
              >
                {n.level}
              </SvgText>
              {/* Label abaixo */}
              <SvgText
                x={x} y={y + n.radius + 13}
                fill="rgba(255,255,255,0.88)"
                fontSize={10}
                fontWeight="600"
                textAnchor="middle"
              >
                {n.name}
              </SvgText>
            </G>
          );
        })}
      </Svg>
      {/* Contagem sobreposta */}
      <View style={[s.overlay, { top: top + 12 }]}>
        <Text style={s.overlayText}>
          {stats.nodes} pilares · {stats.edges} conexões
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#020408',
  },
  centered: {
    flex: 1,
    backgroundColor: '#020408',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlay: {
    position: 'absolute',
    right: 16,
  },
  overlayText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.3)',
  },
  empty: {
    color: colors.textMuted,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 24,
    paddingHorizontal: spacing.xl,
  },
});
