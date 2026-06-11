'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export type GraphNode = {
  id: string;
  name: string;
  xpTotal: number;
  level: number;
  isRoot: boolean;
};

export type GraphEdge = {
  source: string;
  target: string;
  weight: number;
  type: 'relation' | 'cooccurrence' | 'note';
};

// ─── Window manager ───────────────────────────────────────────────────────────

const WM_KEY = 'anima_graph_windows';
type WinEntry = { x: number; y: number; w: number; h: number; ts: number };

class WindowManager {
  readonly id = Math.random().toString(36).slice(2, 10);

  tick() {
    const all = this.read();
    const now = Date.now();
    for (const k of Object.keys(all)) {
      if (now - (all[k]?.ts ?? 0) > 2000) delete all[k];
    }
    all[this.id] = {
      x: window.screenX, y: window.screenY,
      w: window.innerWidth, h: window.innerHeight,
      ts: now,
    };
    try { localStorage.setItem(WM_KEY, JSON.stringify(all)); } catch { /* quota */ }
  }

  read(): Record<string, WinEntry> {
    try { return JSON.parse(localStorage.getItem(WM_KEY) ?? '{}') as Record<string, WinEntry>; }
    catch { return {}; }
  }

  dispose() {
    const all = this.read();
    delete all[this.id];
    try { localStorage.setItem(WM_KEY, JSON.stringify(all)); } catch { /* quota */ }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nodeColor(name: string): THREE.Color {
  const n = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (n === 'saude') return new THREE.Color(0x22c55e);
  if (n === 'mente') return new THREE.Color(0x7c5cfc);
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

export default function GraphClient({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const mountRef = useRef<HTMLDivElement>(null);

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
    scene.fog = new THREE.FogExp2(0x020408, 0.0004);

    // ── Orthographic camera (1 unit = 1 CSS pixel) ────────────────
    const makeCamera = () => {
      const w = window.innerWidth, h = window.innerHeight;
      const cam = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, -10000, 10000);
      cam.position.z = 2;
      return cam;
    };
    const camera = makeCamera();

    // ── World group — shifted by window position ───────────────────
    const world = new THREE.Group();
    scene.add(world);
    scene.add(new THREE.AmbientLight(0x223344, 3));

    // ── Window manager ────────────────────────────────────────────
    const wm = new WindowManager();

    // Nodes are initialised at the current viewport centre so they're
    // always visible, even on non-maximised windows. The gravity target
    // tracks the viewport centre each frame, so the multi-window effect
    // still works: each window pulls nodes toward its own screen position.
    const initCX = () => window.screenX + window.innerWidth  / 2;
    const initCY = () => window.screenY + window.innerHeight / 2;
    const SPREAD = Math.max(160, Math.min(window.screen.width, window.screen.height) * 0.15);

    // ── Build simulation nodes ────────────────────────────────────
    const simNodes: SimNode[] = nodes.map((n, i) => {
      const angle  = (i / nodes.length) * Math.PI * 2;
      const r      = SPREAD * (0.5 + Math.random() * 0.6);
      const color  = nodeColor(n.name);
      const radius = Math.min(42, 12 + n.level * 2.5);

      const geo = new THREE.SphereGeometry(radius, 32, 20);
      const mat = new THREE.MeshStandardMaterial({
        color: color.clone().multiplyScalar(0.15),
        emissive: color,
        emissiveIntensity: 2.0,
        roughness: 0.25,
        metalness: 0.5,
      });
      const mesh = new THREE.Mesh(geo, mat);

      const haloMat = new THREE.SpriteMaterial({
        map: makeHaloTexture(color),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      });
      const halo = new THREE.Sprite(haloMat);
      halo.scale.set(radius * 8, radius * 8, 1);

      const light = new THREE.PointLight(color.getHex(), 2.5, radius * 22);

      const labelMat = new THREE.SpriteMaterial({
        map: makeLabelTexture(n.name),
        transparent: true,
        depthWrite: false,
        opacity: 0.9,
      });
      const label = new THREE.Sprite(labelMat);
      label.scale.set(160, 30, 1);

      world.add(mesh, halo, light, label);

      const cx = initCX(), cy = initCY();
      return {
        ...n,
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
        z: (Math.random() - 0.5) * SPREAD * 0.35,
        vx: 0, vy: 0, vz: 0,
        radius,
        mesh, halo, light, label,
      };
    });

    const nodeById   = new Map(simNodes.map(n => [n.id, n]));
    const meshToNode = new Map(simNodes.map(n => [n.mesh.id, n]));

    // ── Edge geometries ───────────────────────────────────────────
    type EdgeEntry = { line: THREE.Line; src: string; tgt: string };
    const edgeMeshes: EdgeEntry[] = [];

    for (const e of edges) {
      const a = nodeById.get(e.source);
      const b = nodeById.get(e.target);
      if (!a || !b) continue;

      const opacity =
        e.type === 'relation'     ? 0.75 :
        e.type === 'cooccurrence' ? 0.42 : 0.24;
      const w = Math.min(1, e.weight / 5);
      const mid = new THREE.Color().lerpColors(nodeColor(a.name), nodeColor(b.name), 0.5);

      const positions = new Float32Array(6);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      const mat = new THREE.LineBasicMaterial({
        color: mid,
        transparent: true,
        opacity: opacity * w,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const line = new THREE.Line(geo, mat);
      world.add(line);
      edgeMeshes.push({ line, src: e.source, tgt: e.target });
    }

    // ── Force simulation constants ─────────────────────────────────
    const K_REP = 90000;
    const K_ATT = 0.0020;
    const REST  = 260;
    const K_CTR = 0.00035;
    const DAMP  = 0.87;

    function simTick() {
      // Gravity toward current viewport centre (in screen coords)
      const cx = window.screenX + window.innerWidth  / 2;
      const cy = window.screenY + window.innerHeight / 2;

      for (let i = 0; i < simNodes.length; i++) {
        const a = simNodes[i]!;
        a.vx += (cx - a.x) * K_CTR;
        a.vy += (cy - a.y) * K_CTR;
        a.vz += (-a.z) * K_CTR;

        for (let j = i + 1; j < simNodes.length; j++) {
          const b  = simNodes[j]!;
          const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
          const d2 = dx * dx + dy * dy + dz * dz + 1;
          const d  = Math.sqrt(d2);
          const f  = K_REP / d2;
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
        const f  = K_ATT * (d - REST) * e.weight;
        const ux = dx / d, uy = dy / d, uz = dz / d;
        a.vx += f * ux; a.vy += f * uy; a.vz += f * uz;
        b.vx -= f * ux; b.vy -= f * uy; b.vz -= f * uz;
      }

      for (const n of simNodes) {
        n.vx *= DAMP; n.vy *= DAMP; n.vz *= DAMP;
        n.x  += n.vx; n.y  += n.vy; n.z  += n.vz;
      }
    }

    // ── Raycaster + tooltip ───────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const mouse     = new THREE.Vector2(-99, -99); // off-screen by default
    let   hoveredId: number | null = null;

    // Tooltip DOM element — created imperatively to avoid React re-render on every mouse move
    const tooltip = document.createElement('div');
    tooltip.style.cssText = [
      'position:fixed',
      'pointer-events:none',
      'display:none',
      'background:rgba(5,8,20,0.88)',
      'border:1px solid rgba(255,255,255,0.12)',
      'border-radius:10px',
      'padding:10px 14px',
      'font-family:system-ui,sans-serif',
      'font-size:13px',
      'color:#e2e8f0',
      'line-height:1.6',
      'z-index:20',
      'backdrop-filter:blur(8px)',
      'box-shadow:0 4px 24px rgba(0,0,0,0.5)',
      'max-width:220px',
    ].join(';');
    mount.appendChild(tooltip);

    const onMouseMove = (e: MouseEvent) => {
      mouse.x =  (e.clientX / window.innerWidth)  * 2 - 1;
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

      // Tooltip follows mouse — actual hit-test happens in the render loop
      tooltip.style.left = `${e.clientX + 16}px`;
      tooltip.style.top  = `${e.clientY - 8}px`;

      // Keep tooltip inside viewport on the right edge
      const rect = tooltip.getBoundingClientRect();
      if (rect.right > window.innerWidth - 20) {
        tooltip.style.left = `${e.clientX - rect.width - 16}px`;
      }
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

      world.position.x = -(window.screenX + window.innerWidth  / 2);
      world.position.y =   window.screenY + window.innerHeight / 2;
      wm.tick();

      simTick();

      // Update mesh positions
      for (const n of simNodes) {
        const tx = n.x;
        const ty = -n.y;  // screen y-down → THREE y-up
        const tz = n.z;

        const isHovered = n.mesh.id === hoveredId;
        const phase = t * 1.6 + n.id.charCodeAt(0) * 0.31;
        const pulse = isHovered
          ? 1.35
          : 1 + 0.055 * Math.sin(phase);

        n.mesh.position.set(tx, ty, tz);
        n.mesh.scale.setScalar(pulse);

        const hs = n.radius * 8 * (isHovered
          ? 1.5
          : 1 + 0.13 * Math.sin(phase * 0.7));
        n.halo.position.set(tx, ty, tz - 2);
        n.halo.scale.set(hs, hs, 1);

        n.light.position.set(tx, ty, tz);
        n.label.position.set(tx, ty - n.radius * 2.2 - 18, tz);
        // Fade label out when a different node is hovered
        (n.label.material as THREE.SpriteMaterial).opacity =
          hoveredId === null ? 0.9 : (isHovered ? 1 : 0.2);
      }

      for (const em of edgeMeshes) {
        const a = nodeById.get(em.src), b = nodeById.get(em.tgt);
        if (!a || !b) continue;
        const attr = em.line.geometry.getAttribute('position') as THREE.BufferAttribute;
        const arr  = attr.array as Float32Array;
        arr[0] = a.x;  arr[1] = -a.y; arr[2] = a.z;
        arr[3] = b.x;  arr[4] = -b.y; arr[5] = b.z;
        attr.needsUpdate = true;
      }

      // ── Raycast (done after mesh positions are updated) ──────────
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(simNodes.map(n => n.mesh));

      if (hits.length > 0) {
        const hit  = hits[0]!;
        const node = meshToNode.get(hit.object.id);
        if (node) {
          hoveredId = hit.object.id;
          mount!.style.cursor = 'pointer';
          tooltip.style.display = 'block';
          tooltip.innerHTML =
            `<div style="font-weight:700;font-size:14px;margin-bottom:4px">${node.name}</div>` +
            `<div style="color:rgba(255,255,255,0.55);font-size:12px">` +
              `Nível <b style="color:#e2e8f0">${node.level}</b>&nbsp;&nbsp;` +
              `${node.xpTotal.toLocaleString('pt-BR')} XP` +
            `</div>` +
            (node.isRoot
              ? `<div style="margin-top:4px;font-size:11px;color:rgba(255,255,255,0.3)">pilar raiz</div>`
              : `<div style="margin-top:4px;font-size:11px;color:rgba(255,255,255,0.3)">pilar emergente</div>`);
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
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('mousemove', onMouseMove);
      renderer.domElement.removeEventListener('mouseleave', onMouseLeave);
      if (mount.contains(tooltip)) mount.removeChild(tooltip);
      wm.dispose();
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

      {/* Node/edge count */}
      <div style={{
        position: 'fixed', top: 64, right: 20, zIndex: 10,
        color: 'rgba(255,255,255,0.3)', fontSize: 11,
        fontFamily: 'monospace', pointerEvents: 'none',
      }}>
        {nodes.length} pilares · {edges.length} conexões
      </div>

      {/* Legend */}
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
        <div style={{ opacity: 0.3, fontSize: 11 }}>
          tamanho dos nós ∝ nível · abra em múltiplas janelas para o efeito de espaço compartilhado
        </div>
      </div>
    </>
  );
}
