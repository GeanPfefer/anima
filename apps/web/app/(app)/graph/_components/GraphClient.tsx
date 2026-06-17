'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import * as THREE from 'three';

function chipStyle(active: boolean, inactiveColor = 'rgba(255,255,255,0.55)'): CSSProperties {
  return {
    fontSize: 11, fontFamily: 'system-ui, sans-serif',
    padding: '4px 9px', borderRadius: 7, cursor: 'pointer', whiteSpace: 'nowrap',
    background: active ? 'rgba(34,197,94,0.18)' : 'transparent',
    color: active ? '#86efac' : inactiveColor,
    border: `1px solid ${active ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.15)'}`,
  };
}

export type GraphNode = {
  id: string;
  name: string;
  kind: 'pillar' | 'entity';
  // pilares
  xpTotal?: number;
  level?: number;
  isRoot?: boolean;
  // entidades
  entityType?: string;
  occurrences?: number;
};

export type GraphEdge = {
  source: string;
  target: string;
  weight: number;
  type: 'relation' | 'cooccurrence' | 'note' | 'entity';
};

const ENTITY_TYPE_LABEL: Record<string, string> = {
  pessoa: 'pessoa', lugar: 'lugar', projeto: 'projeto',
  ferramenta: 'ferramenta', habito: 'hábito', conceito: 'conceito',
};

function entityColor(type?: string): THREE.Color {
  switch (type) {
    case 'pessoa':     return new THREE.Color(0xec4899);
    case 'lugar':      return new THREE.Color(0x14b8a6);
    case 'projeto':    return new THREE.Color(0x3b82f6);
    case 'ferramenta': return new THREE.Color(0xf97316);
    case 'habito':     return new THREE.Color(0x84cc16);
    default:           return new THREE.Color(0x94a3b8);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nodeColor(name: string): THREE.Color {
  const n = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (n === 'saude')    return new THREE.Color(0x22c55e);
  if (n === 'mente')    return new THREE.Color(0x7c5cfc);
  if (n === 'relacoes') return new THREE.Color(0xf59e0b);
  let h = 5381;
  for (let i = 0; i < name.length; i++) h = ((h << 5) + h) ^ name.charCodeAt(i);
  return new THREE.Color().setHSL((Math.abs(h) % 1000) / 1000, 0.8, 0.62);
}

function makeHaloTexture(color: THREE.Color): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const hex = '#' + color.getHexString();
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0,   hex + 'cc');
  g.addColorStop(0.3, hex + '77');
  g.addColorStop(0.7, hex + '22');
  g.addColorStop(1,   hex + '00');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(c);
}

function makeLabelTexture(text: string): THREE.CanvasTexture {
  const W = 320, H = 60;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.font = '600 26px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = '#000';
  ctx.shadowBlur = 10;
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.fillText(text, W / 2, H / 2, W - 16);
  return new THREE.CanvasTexture(c);
}

// ─── Sim node ─────────────────────────────────────────────────────────────────

interface SimNode extends GraphNode {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  radius: number;
  mesh: THREE.Mesh;
  halo: THREE.Sprite;
  light: THREE.PointLight;
  label: THREE.Sprite;
}

// ─── Component ────────────────────────────────────────────────────────────────
//
// Coordenadas ancoradas na VIEWPORT: a origem (0,0) é o centro da tela.
// Nada depende da posição da janela no monitor — cada nó é mantido dentro
// dos limites visíveis por um clamp rígido, então nunca some da tela.

const colorOf = (n: GraphNode): THREE.Color =>
  n.kind === 'entity' ? entityColor(n.entityType) : nodeColor(n.name);

export default function GraphClient({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const hasEntities = nodes.some(n => n.kind === 'entity');
  const pillarNodes = nodes.filter(n => n.kind === 'pillar');
  const [showEntities, setShowEntities] = useState(true);
  const showEntitiesRef = useRef(true);
  // Foco: id do pilar isolado (mostra só ele + vizinhos diretos) ou null = todos.
  const [focusPillar, setFocusPillar] = useState<string | null>(null);
  const focusRef = useRef<string | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // ── Renderer ──────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    mount.appendChild(renderer.domElement);

    // ── Scene ─────────────────────────────────────────────────────
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020408);
    scene.add(new THREE.AmbientLight(0x223344, 3));

    // ── Orthographic camera (origem = centro da viewport) ─────────
    const w0 = window.innerWidth, h0 = window.innerHeight;
    const camera = new THREE.OrthographicCamera(-w0 / 2, w0 / 2, h0 / 2, -h0 / 2, -10000, 10000);
    camera.position.z = 10;

    // ── Build simulation nodes ────────────────────────────────────
    const ringR = Math.min(180, Math.max(90, Math.min(w0, h0) * 0.18));
    const simNodes: SimNode[] = nodes.map((n, i) => {
      const angle    = (i / Math.max(1, nodes.length)) * Math.PI * 2;
      const isEntity = n.kind === 'entity';
      const color    = colorOf(n);
      const radius   = isEntity
        ? Math.min(13, 6 + (n.occurrences ?? 1) * 1.2)
        : Math.min(42, 12 + (n.level ?? 1) * 2.5);

      const geo = new THREE.SphereGeometry(radius, isEntity ? 18 : 32, isEntity ? 12 : 20);
      const mat = new THREE.MeshStandardMaterial({
        color: color.clone().multiplyScalar(0.15),
        emissive: color,
        emissiveIntensity: isEntity ? 1.4 : 2.0,
        roughness: 0.25,
        metalness: 0.5,
      });
      const mesh = new THREE.Mesh(geo, mat);

      const haloMat = new THREE.SpriteMaterial({
        map: makeHaloTexture(color),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: isEntity ? 0.5 : 1,
      });
      const halo = new THREE.Sprite(haloMat);
      const haloScale = radius * (isEntity ? 5 : 8);
      halo.scale.set(haloScale, haloScale, 1);

      const light = new THREE.PointLight(color.getHex(), isEntity ? 1 : 2.5, radius * 22);

      const labelMat = new THREE.SpriteMaterial({
        map: makeLabelTexture(n.name),
        transparent: true,
        depthWrite: false,
        opacity: isEntity ? 0.65 : 0.9,
      });
      const label = new THREE.Sprite(labelMat);
      label.scale.set(isEntity ? 110 : 160, isEntity ? 22 : 30, 1);

      scene.add(mesh, halo, light, label);

      return {
        ...n,
        x: Math.cos(angle) * ringR * (0.7 + Math.random() * 0.5),
        y: Math.sin(angle) * ringR * (0.7 + Math.random() * 0.5),
        z: (Math.random() - 0.5) * 60,
        vx: 0, vy: 0, vz: 0,
        radius,
        mesh, halo, light, label,
      };
    });

    const nodeById   = new Map(simNodes.map(n => [n.id, n]));
    const meshToNode = new Map(simNodes.map(n => [n.mesh.id, n]));

    // Vizinhos diretos de cada nó (para o foco por pilar).
    const neighbors = new Map<string, Set<string>>();
    for (const e of edges) {
      (neighbors.get(e.source) ?? neighbors.set(e.source, new Set()).get(e.source)!).add(e.target);
      (neighbors.get(e.target) ?? neighbors.set(e.target, new Set()).get(e.target)!).add(e.source);
    }

    // ── Edge geometries ───────────────────────────────────────────
    type EdgeEntry = { line: THREE.Line; src: string; tgt: string; isEntity: boolean };
    const edgeMeshes: EdgeEntry[] = [];

    for (const e of edges) {
      const a = nodeById.get(e.source);
      const b = nodeById.get(e.target);
      if (!a || !b) continue;

      const opacity =
        e.type === 'relation'     ? 0.75 :
        e.type === 'cooccurrence' ? 0.42 :
        e.type === 'entity'       ? 0.30 : 0.24;
      const ww  = Math.min(1, e.weight / 5);
      const mid = new THREE.Color().lerpColors(colorOf(a), colorOf(b), 0.5);

      const positions = new Float32Array(6);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      const mat = new THREE.LineBasicMaterial({
        color: mid,
        transparent: true,
        opacity: opacity * ww,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const line = new THREE.Line(geo, mat);
      scene.add(line);
      edgeMeshes.push({ line, src: e.source, tgt: e.target, isEntity: e.type === 'entity' });
    }

    // ── Força (amornada + cooling) ────────────────────────────────
    const K_REP = 26000;   // repulsão node↔node
    const K_ATT = 0.012;   // mola das arestas
    const REST  = 150;     // comprimento de repouso da aresta
    const K_CTR = 0.015;   // gravidade pro centro
    const DAMP  = 0.82;
    let   alpha = 1;        // esfria ao longo do tempo pra assentar

    function simTick() {
      const cool = Math.max(0.04, alpha);

      for (let i = 0; i < simNodes.length; i++) {
        const a = simNodes[i]!;
        // gravidade pro centro (origem)
        a.vx += (-a.x) * K_CTR * cool;
        a.vy += (-a.y) * K_CTR * cool;
        a.vz += (-a.z) * K_CTR;

        for (let j = i + 1; j < simNodes.length; j++) {
          const b  = simNodes[j]!;
          const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
          const d2 = dx * dx + dy * dy + dz * dz + 1;
          const d  = Math.sqrt(d2);
          const f  = (K_REP / d2) * cool;
          const ux = dx / d, uy = dy / d, uz = dz / d;
          a.vx -= f * ux; a.vy -= f * uy; a.vz -= f * uz;
          b.vx += f * ux; b.vy += f * uy; b.vz += f * uz;
        }
      }

      for (const e of edges) {
        const a = nodeById.get(e.source), b = nodeById.get(e.target);
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const d  = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.01;
        const f  = K_ATT * (d - REST) * Math.min(e.weight, 4) * cool;
        const ux = dx / d, uy = dy / d, uz = dz / d;
        a.vx += f * ux; a.vy += f * uy; a.vz += f * uz;
        b.vx -= f * ux; b.vy -= f * uy; b.vz -= f * uz;
      }

      // Limites da viewport — nós nunca saem da tela
      const halfW = window.innerWidth  / 2;
      const halfH = window.innerHeight / 2;

      for (const n of simNodes) {
        n.vx *= DAMP; n.vy *= DAMP; n.vz *= DAMP;
        n.x  += n.vx; n.y  += n.vy; n.z  += n.vz;

        const mx = halfW - n.radius - 30;
        const my = halfH - n.radius - 50; // espaço extra embaixo pro label
        if (n.x >  mx) { n.x =  mx; n.vx *= -0.4; }
        if (n.x < -mx) { n.x = -mx; n.vx *= -0.4; }
        if (n.y >  my) { n.y =  my; n.vy *= -0.4; }
        if (n.y < -my) { n.y = -my; n.vy *= -0.4; }
      }

      if (alpha > 0.04) alpha *= 0.99;
    }

    // ── Raycaster + tooltip ───────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const mouse     = new THREE.Vector2(-99, -99);
    let   hoveredId: number | null = null;

    const tooltip = document.createElement('div');
    tooltip.style.cssText = [
      'position:fixed', 'pointer-events:none', 'display:none',
      'background:rgba(5,8,20,0.88)', 'border:1px solid rgba(255,255,255,0.12)',
      'border-radius:10px', 'padding:10px 14px',
      'font-family:system-ui,sans-serif', 'font-size:13px',
      'color:#e2e8f0', 'line-height:1.6', 'z-index:20',
      'backdrop-filter:blur(8px)', 'box-shadow:0 4px 24px rgba(0,0,0,0.5)',
      'max-width:220px',
    ].join(';');
    mount.appendChild(tooltip);

    const onMouseMove = (e: MouseEvent) => {
      mouse.x =  (e.clientX / window.innerWidth)  * 2 - 1;
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
      tooltip.style.left = `${e.clientX + 16}px`;
      tooltip.style.top  = `${e.clientY - 8}px`;
      const rect = tooltip.getBoundingClientRect();
      if (rect.right > window.innerWidth - 20) {
        tooltip.style.left = `${e.clientX - rect.width - 16}px`;
      }
      // qualquer interação reaquece um pouco a simulação
      alpha = Math.max(alpha, 0.2);
    };

    const onMouseLeave = () => {
      mouse.set(-99, -99);
      tooltip.style.display = 'none';
      hoveredId = null;
      mount.style.cursor = '';
    };

    renderer.domElement.addEventListener('mousemove', onMouseMove);
    renderer.domElement.addEventListener('mouseleave', onMouseLeave);

    // ── Render loop ───────────────────────────────────────────────
    let raf = 0;
    let t   = 0;

    function loop() {
      raf = requestAnimationFrame(loop);
      t  += 0.012;

      simTick();

      const showEnt = showEntitiesRef.current;
      const focus   = focusRef.current;
      const focusSet = focus ? neighbors.get(focus) : null;

      for (const n of simNodes) {
        let visible = n.kind !== 'entity' || showEnt;
        if (visible && focus) {
          visible = n.id === focus || (focusSet?.has(n.id) ?? false);
        }
        n.mesh.visible = visible; n.halo.visible = visible;
        n.label.visible = visible; n.light.visible = visible;
        if (!visible) continue;

        const tx = n.x;
        const ty = -n.y;  // screen y-down → THREE y-up
        const tz = n.z;

        const isHovered = n.mesh.id === hoveredId;
        const phase = t * 1.6 + n.id.charCodeAt(0) * 0.31;
        const pulse = isHovered ? 1.35 : 1 + 0.055 * Math.sin(phase);

        n.mesh.position.set(tx, ty, tz);
        n.mesh.scale.setScalar(pulse);

        const hs = n.radius * 8 * (isHovered ? 1.5 : 1 + 0.13 * Math.sin(phase * 0.7));
        n.halo.position.set(tx, ty, tz - 2);
        n.halo.scale.set(hs, hs, 1);

        n.light.position.set(tx, ty, tz);
        n.label.position.set(tx, ty - n.radius * 2.2 - 18, tz);
        (n.label.material as THREE.SpriteMaterial).opacity =
          hoveredId === null ? 0.9 : (isHovered ? 1 : 0.2);
      }

      for (const em of edgeMeshes) {
        const a = nodeById.get(em.src), b = nodeById.get(em.tgt);
        if (!a || !b) continue;
        // visível só se ambos os nós estão visíveis (respeita toggle + foco)
        em.line.visible = a.mesh.visible && b.mesh.visible;
        if (!em.line.visible) continue;
        const attr = em.line.geometry.getAttribute('position') as THREE.BufferAttribute;
        const arr  = attr.array as Float32Array;
        arr[0] = a.x;  arr[1] = -a.y; arr[2] = a.z;
        arr[3] = b.x;  arr[4] = -b.y; arr[5] = b.z;
        attr.needsUpdate = true;
      }

      // raycast precisa das matrizes atualizadas antes do render
      scene.updateMatrixWorld(true);
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(simNodes.map(n => n.mesh));

      if (hits.length > 0) {
        const node = meshToNode.get(hits[0]!.object.id);
        if (node) {
          hoveredId = hits[0]!.object.id;
          mount!.style.cursor = 'pointer';
          tooltip.style.display = 'block';
          if (node.kind === 'entity') {
            tooltip.innerHTML =
              `<div style="font-weight:700;font-size:14px;margin-bottom:4px">${node.name}</div>` +
              `<div style="color:rgba(255,255,255,0.55);font-size:12px">` +
                `${ENTITY_TYPE_LABEL[node.entityType ?? ''] ?? 'entidade'} · ${node.occurrences ?? 1}× mencionado` +
              `</div>` +
              `<div style="margin-top:4px;font-size:11px;color:rgba(255,255,255,0.3)">entidade</div>`;
          } else {
            tooltip.innerHTML =
              `<div style="font-weight:700;font-size:14px;margin-bottom:4px">${node.name}</div>` +
              `<div style="color:rgba(255,255,255,0.55);font-size:12px">` +
                `Nível <b style="color:#e2e8f0">${node.level ?? 1}</b>&nbsp;&nbsp;` +
                `${(node.xpTotal ?? 0).toLocaleString('pt-BR')} XP` +
              `</div>` +
              (node.isRoot
                ? `<div style="margin-top:4px;font-size:11px;color:rgba(255,255,255,0.3)">pilar raiz</div>`
                : `<div style="margin-top:4px;font-size:11px;color:rgba(255,255,255,0.3)">pilar emergente</div>`);
          }
        }
      } else {
        hoveredId = null;
        mount!.style.cursor = '';
        tooltip.style.display = 'none';
      }

      renderer.render(scene, camera);
    }

    loop();

    // ── Resize ────────────────────────────────────────────────────
    const onResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h);
      camera.left   = -w / 2; camera.right  = w / 2;
      camera.top    =  h / 2; camera.bottom = -h / 2;
      camera.updateProjectionMatrix();
      alpha = Math.max(alpha, 0.3); // reassenta dentro dos novos limites
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('mousemove', onMouseMove);
      renderer.domElement.removeEventListener('mouseleave', onMouseLeave);
      if (mount.contains(tooltip)) mount.removeChild(tooltip);
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (nodes.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', flexDirection: 'column', gap: 12 }}>
        <p style={{ color: 'var(--text-muted)', fontSize: 16 }}>Nenhum pilar encontrado.</p>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          Comece uma conversa com a IA para criar seus pilares.
        </p>
      </div>
    );
  }

  return (
    <>
      <div ref={mountRef} style={{ position: 'fixed', inset: 0, zIndex: 0 }} />

      <div style={{
        position: 'fixed', top: 64, right: 20, zIndex: 10,
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8,
      }}>
        <div style={{
          color: 'rgba(255,255,255,0.3)', fontSize: 11, fontFamily: 'monospace',
        }}>
          {nodes.filter(n => n.kind === 'pillar').length} pilares
          {hasEntities && ` · ${nodes.filter(n => n.kind === 'entity').length} entidades`}
          {' · '}{edges.length} conexões
        </div>
        {hasEntities && (
          <button
            onClick={() => setShowEntities(v => { showEntitiesRef.current = !v; return !v; })}
            style={{
              fontSize: 12, fontFamily: 'system-ui, sans-serif',
              padding: '5px 12px', borderRadius: 8, cursor: 'pointer',
              background: showEntities ? 'rgba(124,92,252,0.18)' : 'transparent',
              color: showEntities ? '#c4b5fd' : 'rgba(255,255,255,0.45)',
              border: `1px solid ${showEntities ? 'rgba(124,92,252,0.5)' : 'rgba(255,255,255,0.15)'}`,
            }}
          >
            {showEntities ? '● entidades' : '○ entidades'}
          </button>
        )}

        {pillarNodes.length > 1 && (
          <div style={{
            display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end',
            gap: 6, maxWidth: 260,
          }}>
            {focusPillar && (
              <button
                onClick={() => { focusRef.current = null; setFocusPillar(null); }}
                style={chipStyle(false, 'rgba(255,255,255,0.5)')}
              >
                ✕ todos
              </button>
            )}
            {pillarNodes.map(p => {
              const active = focusPillar === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => {
                    const next = active ? null : p.id;
                    focusRef.current = next;
                    setFocusPillar(next);
                  }}
                  style={chipStyle(active)}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div style={{
        position: 'fixed', bottom: 24, left: 24, zIndex: 10,
        color: 'rgba(255,255,255,0.4)', fontSize: 12, lineHeight: 1.8,
        fontFamily: 'system-ui, sans-serif', pointerEvents: 'none', userSelect: 'none',
      }}>
        <div style={{ marginBottom: 2 }}>
          <span style={{ opacity: 0.8 }}>─</span> relação direta &nbsp;
          <span style={{ opacity: 0.55 }}>─</span> co-ocorrência &nbsp;
          <span style={{ opacity: 0.35 }}>─</span> correlação de notas
        </div>
        {hasEntities && (
          <div style={{ marginBottom: 2, opacity: 0.5, fontSize: 11 }}>
            nós menores = entidades (pessoas, lugares, projetos) ligadas aos pilares onde aparecem
          </div>
        )}
        <div style={{ opacity: 0.3, fontSize: 11 }}>
          tamanho dos nós ∝ nível · passe o mouse para ver detalhes
        </div>
      </div>
    </>
  );
}
