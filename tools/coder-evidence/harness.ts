// ============================================================
// Harness VERSIONÁVEL de evidência do coder local (R3).
//
// Reconstrói, de forma recomputável e auditável, a campanha do registro
// 2026-08-12. Exercita a CLASSE DE PRODUÇÃO `OllamaCoderBackend` SEM modificá-la
// (importada por caminho relativo via resolve-hook), com um `fetchImpl`
// OBSERVADOR que fala com o Ollama real e mede cada chamada sem alterar o
// payload. Config de produção vem dos DEFAULTS do construtor (não os
// reescrevemos): maxReadRounds=3, num_ctx=8192, num_predict=1536, temperature=0.
//
// NÃO altera contrato/prompt/rounds/modelo/roteamento/gates. NÃO promove piso de
// modelo. NÃO toca o repositório fora deste diretório. Sem rede externa além do
// Ollama local. Uso:
//   node --experimental-transform-types --import ./tools/coder-evidence/register.mjs \
//        tools/coder-evidence/harness.ts --reps 5 --models qwen2.5-coder:7b,qwen2.5-coder:14b,qwen3-coder:30b
// ============================================================
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OllamaCoderBackend } from '../../apps/web/lib/work-orchestration/ollama-coder.ts';
import { OllamaProtocolError } from '../../apps/web/lib/work-orchestration/ollama-protocol.ts';
import { FIXTURES, FIXTURE_IDS, type Fixture } from './fixtures.ts';

// ---- Args ----
function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1]! : fallback;
}
const REPS = Math.max(1, parseInt(arg('reps', '5'), 10) || 5);
const MODELS = arg('models', 'qwen2.5-coder:7b,qwen2.5-coder:14b,qwen3-coder:30b').split(',').map(s => s.trim()).filter(Boolean);
const CLASSES = arg('classes', FIXTURE_IDS.join(',')).split(',').map(s => s.trim()).filter(Boolean);
const SEED = parseInt(arg('seed', '20260813'), 10) || 20260813;

type R2CyclePolicy = 'per-protocol' | 'shared';

const R2_CYCLE_POLICY_RAW = arg('r2-cycle-policy', 'per-protocol');

if (
  R2_CYCLE_POLICY_RAW !== 'per-protocol' &&
  R2_CYCLE_POLICY_RAW !== 'shared'
) {
  throw new Error('--r2-cycle-policy precisa ser per-protocol ou shared');
}

const R2_CYCLE_POLICY: R2CyclePolicy = R2_CYCLE_POLICY_RAW;

type ProtocolVariant = 'current' | 'r2' | 'r2-narrow' | 'r2-after-scope';

const PROTOCOLS = arg('protocols', 'current')
  .split(',')
  .map(s => s.trim())
  .filter((s): s is ProtocolVariant =>
    s === 'current' ||
    s === 'r2' ||
    s === 'r2-narrow' ||
    s === 'r2-after-scope'
  );

if (PROTOCOLS.length === 0) {
  throw new Error('--protocols precisa conter current, r2, r2-narrow e/ou r2-after-scope');
}
const URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT_DIR = arg('out', join('tools', 'coder-evidence', 'runs', STAMP));

// ---- RNG determinístico (mulberry32) para ordem reprodutível ----
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// ---- Observador: tee do fetch real, sem alterar o payload ----
interface CallRecord {
  idx: number;
  ms: number;
  userPrompt: string;
  respContent: string;
  promptEvalCount: number | null;
  evalCount: number | null;
  doneReason: string | null;
}
function makeObserver(): { fetchImpl: typeof fetch; records: CallRecord[] } {
  const records: CallRecord[] = [];
  const real = globalThis.fetch;
  let idx = 0;
  const fetchImpl = (async (input: unknown, init: { body?: string } = {}) => {
    const t0 = performance.now();
    const resp = await real(input as Parameters<typeof fetch>[0], init as Parameters<typeof fetch>[1]);
    const ms = performance.now() - t0;
    let userPrompt = '';
    try {
      const body = JSON.parse(init.body ?? '{}') as { messages?: { role: string; content: string }[] };
      const user = (body.messages ?? []).filter(m => m.role === 'user').pop();
      userPrompt = user?.content ?? '';
    } catch { /* ignore */ }
    let respContent = '', promptEvalCount: number | null = null, evalCount: number | null = null, doneReason: string | null = null;
    try {
      const data = await resp.clone().json() as { message?: { content?: unknown }; prompt_eval_count?: unknown; eval_count?: unknown; done_reason?: unknown };
      respContent = typeof data?.message?.content === 'string' ? data.message.content : '';
      promptEvalCount = typeof data?.prompt_eval_count === 'number' ? data.prompt_eval_count : null;
      evalCount = typeof data?.eval_count === 'number' ? data.eval_count : null;
      doneReason = typeof data?.done_reason === 'string' ? data.done_reason : null;
    } catch { /* corpo não-json */ }
    records.push({ idx: idx++, ms, userPrompt, respContent, promptEvalCount, evalCount, doneReason });
    return resp;
  }) as unknown as typeof fetch;
  return { fetchImpl, records };
}

// ---- Derivação de métricas a partir das chamadas observadas ----
const extractJson = (raw: string): unknown | null => {
  const text = (raw ?? '').trim();
  const cand = text.startsWith('{') ? text : (text.match(/\{[\s\S]*\}/)?.[0] ?? '');
  if (!cand) return null;
  try { return JSON.parse(cand); } catch { return null; }
};
const actionOf = (raw: string): 'read' | 'edit' | 'other' => {
  const p = extractJson(raw) as { action?: unknown } | null;
  return p?.action === 'read' ? 'read' : p?.action === 'edit' ? 'edit' : 'other';
};

type ReadRequestShape =
  | 'lineRange-only'
  | 'search-only'
  | 'search+lineRange'
  | 'default';

type EffectiveReadMode = 'search' | 'lineRange' | 'head';

interface ReadRequestObservation {
  readonly shape: ReadRequestShape;
  readonly effectiveMode: EffectiveReadMode;
}

const readRequestObservationsOf = (raw: string): ReadRequestObservation[] => {
  const parsed = extractJson(raw) as { action?: unknown; reads?: unknown } | null;

  if (parsed?.action !== 'read' || !Array.isArray(parsed.reads)) return [];

  const observations: ReadRequestObservation[] = [];

  for (const candidate of parsed.reads) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      continue;
    }

    const read = candidate as Record<string, unknown>;
    const hasSearch =
      typeof read.search === 'string'
      && read.search.trim().length > 0;

    const hasLineRange =
      Array.isArray(read.lineRange)
      && read.lineRange.length === 2;

    const shape: ReadRequestShape =
      hasSearch && hasLineRange
        ? 'search+lineRange'
        : hasSearch
          ? 'search-only'
          : hasLineRange
            ? 'lineRange-only'
            : 'default';

    // Espelha a precedencia real de extractSlice():
    // search > lineRange > começo do arquivo.
    const effectiveMode: EffectiveReadMode =
      hasSearch
        ? 'search'
        : hasLineRange
          ? 'lineRange'
          : 'head';

    observations.push({ shape, effectiveMode });
  }

  return observations;
};

const roundsLeftOf = (userPrompt: string): number | null => {
  if (/0 rodadas de leitura restantes/.test(userPrompt) || /DEVE responder agora/.test(userPrompt)) return 0;
  const m = userPrompt.match(/(\d+) rodadas? de leitura restantes?/);
  return m ? parseInt(m[1]!, 10) : null;
};
const countOcc = (hay: string, needle: string): number => {
  if (!needle) return 0;
  let c = 0, from = 0;
  for (;;) { const i = hay.indexOf(needle, from); if (i === -1) break; c++; from = i + needle.length; }
  return c;
};

interface RunResult {
  model: string; protocol: ProtocolVariant; class: string; rep: number; order: number;
  outcome: 'accepted' | 'failed';
  failureCode: string | null;
  achieved: boolean;
  calls: number;
  readResponses: number;
  readRequests: number;
  readRequestShapes: ReadRequestShape[];
  effectiveReadModes: EffectiveReadMode[];
  hybridReadRequests: number;
  editRound: number | null;         // idx da chamada onde veio a ação edit
  roundsLeftAtEdit: number | null;  // orçamento restante nessa chamada
  editOpKinds: string[];            // kinds das operações da edição
  beforeOccurrences: number[];      // ocorrências de cada `before` no arquivo original
  touched: string[];
  totalMs: number;
  perCallMs: number[];
  promptEvalCounts: (number | null)[];
  evalCounts: (number | null)[];

  // Evidência forense auditável. Esses campos são adicionais e retrocompatíveis:
  // runs históricos que não os possuem continuam válidos.
  callsRaw: CallRecord[];
  finalFiles: Record<string, string>;
}

function memoryWorkspace(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    readFile: async (p: string) => files.get(p.replace(/\\/g, '/')) ?? null,
    writeFile: async (p: string, c: string) => { files.set(p.replace(/\\/g, '/'), c); return true; },
  };
}

function experimentalCycleId(
  protocol: ProtocolVariant,
  model: string,
  fixtureId: string,
  rep: number,
): string {
  if (R2_CYCLE_POLICY === 'shared') {
    return `r2-c-shared-${model}-${fixtureId}-${rep}`;
  }

  return `r2-c-${protocol}-${model}-${fixtureId}-${rep}`;
}

async function runOne(
  model: string,
  protocol: ProtocolVariant,
  fixture: Fixture,
  rep: number,
  order: number,
): Promise<RunResult> {
  const { fetchImpl, records } = makeObserver();
  const workspace = memoryWorkspace({ ...fixture.files });

  // A = defaults vigentes. B = MESMOS defaults + unico opt-in experimental R2.
  // Nenhum outro parametro de modelo/contexto/rounds/temperatura e variado.
  const backend = new OllamaCoderBackend({
    model,
    fetchImpl,
    ...(protocol === 'r2' ||
    protocol === 'r2-narrow' ||
    protocol === 'r2-after-scope'
      ? {
          experimentalAnchorMode: {
            kind: 'r2-host-mediated-v1' as const,
            cycleId: experimentalCycleId(protocol, model, fixture.id, rep),
            ...(protocol === 'r2-narrow'
              ? { readGuidance: 'narrow-target-v1' as const }
              : protocol === 'r2-after-scope'
                ? { readGuidance: 'after-scope-v1' as const }
                : {}),
          },
        }
      : {}),
  });
  let outcome: 'accepted' | 'failed' = 'failed';
  let failureCode: string | null = null;
  let touched: string[] = [];
  try {
    const res = await backend.edit(
      { objective: fixture.objective, includedScope: fixture.includedScope, excludedScope: fixture.excludedScope },
      workspace, new AbortController().signal,
    );
    outcome = 'accepted';
    touched = [...res.touchedResources];
  } catch (e) {
    outcome = 'failed';
    failureCode = e instanceof OllamaProtocolError ? e.code : `harness_unexpected:${e instanceof Error ? e.message.slice(0, 80) : String(e)}`;
  }

  // Deriva métricas das chamadas observadas.
  let editRound: number | null = null;
  let roundsLeftAtEdit: number | null = null;
  const editOpKinds: string[] = [];
  const beforeOccurrences: number[] = [];
  const readRequestShapes: ReadRequestShape[] = [];
  const effectiveReadModes: EffectiveReadMode[] = [];
  let readResponses = 0;
  let readRequests = 0;
  let hybridReadRequests = 0;

  for (const call of records) {
    const act = actionOf(call.respContent);

    if (act === 'read') {
      readResponses++;

      const observations = readRequestObservationsOf(call.respContent);
      readRequests += observations.length;

      for (const observation of observations) {
        readRequestShapes.push(observation.shape);
        effectiveReadModes.push(observation.effectiveMode);

        if (observation.shape === 'search+lineRange') {
          hybridReadRequests++;
        }
      }
    }

    if (act === 'edit' && editRound === null) {
      editRound = call.idx;
      roundsLeftAtEdit = roundsLeftOf(call.userPrompt);
      const parsed = extractJson(call.respContent) as { operations?: unknown[] } | null;
      for (const raw of parsed?.operations ?? []) {
        const op = raw as { kind?: string; path?: string; before?: string };
        editOpKinds.push(typeof op.kind === 'string' ? op.kind : 'unknown');
        if (op.kind === 'replace_exact' && typeof op.path === 'string' && typeof op.before === 'string') {
          const original = fixture.files[op.path.replace(/\\/g, '/')] ?? '';
          beforeOccurrences.push(countOcc(original, op.before));
        }
      }
    }
  }
  const achieved = outcome === 'accepted' && fixture.achieved(workspace.files);

  return {
    model, protocol, class: fixture.id, rep, order,
    outcome, failureCode, achieved,
    calls: records.length,
    readResponses,
    readRequests,
    readRequestShapes,
    effectiveReadModes,
    hybridReadRequests,
    editRound, roundsLeftAtEdit,
    editOpKinds, beforeOccurrences,
    touched,
    totalMs: Math.round(records.reduce((a, c) => a + c.ms, 0)),
    perCallMs: records.map(c => Math.round(c.ms)),
    promptEvalCounts: records.map(c => c.promptEvalCount),
    evalCounts: records.map(c => c.evalCount),

    // Preserva exatamente o que o observador viu e o estado semântico final
    // da fixture. Não altera payload, prompt, backend nem decisão do host.
    callsRaw: records.map(record => ({ ...record })),
    finalFiles: Object.fromEntries(workspace.files.entries()),
  };
}

async function fetchMeta(): Promise<{ ollamaVersion: string | null; tags: unknown }> {
  try {
    const v = await (await fetch(`${URL}/api/version`)).json() as { version?: string };
    const t = await (await fetch(`${URL}/api/tags`)).json();
    return { ollamaVersion: v?.version ?? null, tags: t };
  } catch { return { ollamaVersion: null, tags: null }; }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const rawPath = join(OUT_DIR, 'raw.jsonl');
  const selected = FIXTURES.filter(f => CLASSES.includes(f.id));
  const meta = await fetchMeta();
  const config = {
    startedAt: new Date().toISOString(),
    node: process.version, ollamaUrl: URL, ollamaVersion: meta.ollamaVersion,
    models: MODELS, protocols: PROTOCOLS, classes: selected.map(f => f.id), reps: REPS, seed: SEED,
    productionConfig: 'current=defaults; r2=mesmos defaults + experimentalAnchorMode; r2-narrow=r2 + narrow-target-v1; r2-after-scope=r2 + after-scope-v1. Todos preservam maxReadRounds=3, num_ctx=8192, num_predict=1536, temperature=0',
    r2CyclePolicy: R2_CYCLE_POLICY,
    note: 'A/B pareado: a ordem fixture×rep é randomizada uma vez por modelo/seed e reutilizada IDENTICA para cada protocolo; blocos de protocolo ficam dentro do mesmo bloco de modelo para preservar hardware/modelo carregado. Fixtures são proxies sintéticos.',
  };
  writeFileSync(join(OUT_DIR, 'meta.json'), JSON.stringify({ config, tags: meta.tags }, null, 2));
  console.log(`[harness] out=${OUT_DIR} models=${MODELS.join(',')} protocols=${PROTOCOLS.join(',')} classes=${selected.length} reps=${REPS} seed=${SEED} r2CyclePolicy=${R2_CYCLE_POLICY}`);

  const results: RunResult[] = [];
  let modelIdx = 0;
  for (const model of MODELS) {
    // Ordem randomizada (class × rep) dentro do bloco do modelo; seed varia por modelo.
    const rng = mulberry32(SEED + modelIdx * 1000);
    const plan: { fixture: Fixture; rep: number }[] = [];
    for (const fixture of selected) for (let r = 0; r < REPS; r++) plan.push({ fixture, rep: r });
    const order = shuffle(plan, rng);
    console.log(`\n[${model}] ${order.length} pares-base × ${PROTOCOLS.length} protocolo(s)`);

    for (const protocol of PROTOCOLS) {
      console.log(`  tratamento=${protocol}`);
      let n = 0;
      for (const { fixture, rep } of order) {
        const res = await runOne(model, protocol, fixture, rep, n);
        results.push(res);
        appendFileSync(rawPath, JSON.stringify(res) + '\n');
        const tag = res.outcome === 'accepted' ? (res.achieved ? 'OK' : 'ACEITA/semânt≠') : (res.failureCode ?? 'FAIL');
        console.log(`    [${protocol}] #${String(n).padStart(2, '0')} ${fixture.id.padEnd(16)} → ${tag} (${res.totalMs}ms, ${res.calls} chamadas; ops=${res.editOpKinds.join(',') || '-'})`);
        n++;
      }
    }
    modelIdx++;
  }

  // ---- Agregação: matriz sucesso(host-aceito)/total e achieved/total por célula ----
  const cellKey = (m: string, p: string, c: string) => `${m}|${p}|${c}`;
  const cells = new Map<string, {
    total: number;
    accepted: number;
    achieved: number;
    codes: Record<string, number>;
    readRequestShapes: Record<string, number>;
    effectiveReadModes: Record<string, number>;
    hybridReadRequests: number;
  }>();

  for (const r of results) {
    const k = cellKey(r.model, r.protocol, r.class);
    const cell = cells.get(k) ?? {
      total: 0,
      accepted: 0,
      achieved: 0,
      codes: {},
      readRequestShapes: {},
      effectiveReadModes: {},
      hybridReadRequests: 0,
    };

    cell.total++;

    if (r.outcome === 'accepted') cell.accepted++;
    if (r.achieved) cell.achieved++;

    if (r.failureCode) {
      cell.codes[r.failureCode] = (cell.codes[r.failureCode] ?? 0) + 1;
    }

    for (const shape of r.readRequestShapes) {
      cell.readRequestShapes[shape] =
        (cell.readRequestShapes[shape] ?? 0) + 1;
    }

    for (const mode of r.effectiveReadModes) {
      cell.effectiveReadModes[mode] =
        (cell.effectiveReadModes[mode] ?? 0) + 1;
    }

    cell.hybridReadRequests += r.hybridReadRequests;
    cells.set(k, cell);
  }
  const matrix = {
    config,
    finishedAt: new Date().toISOString(),
    cells: [...cells.entries()].map(([k, v]) => {
      const [model, protocol, cls] = k.split('|');
      return { model, protocol, class: cls, ...v };
    }),
  };
  writeFileSync(join(OUT_DIR, 'matrix.json'), JSON.stringify(matrix, null, 2));

  // Matriz A/B: uma linha por classe × modelo × protocolo.
  const mdRows: string[] = [];
  for (const fixture of selected) {
    for (const model of MODELS) {
      for (const protocol of PROTOCOLS) {
        const cell = cells.get(cellKey(model, protocol, fixture.id));
        if (!cell) continue;
        const codes = Object.entries(cell.codes)
          .map(([code, n]) => `${code.replace('ollama_', '')}×${n}`)
          .join(', ');
        const shapeText = Object.entries(cell.readRequestShapes)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([shape, count]) => `${shape}×${count}`)
          .join(', ') || '—';

        const modeText = Object.entries(cell.effectiveReadModes)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([mode, count]) => `${mode}×${count}`)
          .join(', ') || '—';

        mdRows.push(
          `| \`${fixture.id}\` | \`${model}\` | \`${protocol}\` | ${cell.accepted}/${cell.total} | ${cell.achieved}/${cell.total} | ${codes || '—'} | ${shapeText} | ${modeText} | ${cell.hybridReadRequests} |`,
        );
      }
    }
  }

  const md = [
    `# Matriz da campanha A/B — ${config.startedAt}`,
    '',
    `Config: ${config.productionConfig}. Node ${config.node}, Ollama ${config.ollamaVersion ?? '?'}. Seed ${SEED}, reps ${REPS}.`,
    `${config.note}`,
    '',
    '| Classe | Modelo | Protocolo | Host-aceito | Achieved | Falhas | Read request shapes | Modo efetivo | Híbridas |',
    '|---|---|---|---:|---:|---|---|---|---:|',
    ...mdRows,
    '',
  ].join('\n');
  writeFileSync(join(OUT_DIR, 'matrix.md'), md);
  console.log(`\n[harness] concluído. matrix.md, matrix.json, raw.jsonl e meta.json em ${OUT_DIR}`);
  console.log('\n' + md);
}

main().catch(e => { console.error('[harness] erro fatal:', e); process.exit(1); });
