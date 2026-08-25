// Analisador recomputável de um `runs/<stamp>/raw.jsonl`. Deriva os FATOS da
// campanha sem re-executar nada: matriz host-aceito/total e achieved/total,
// histograma de códigos de falha, determinismo vs. estocasticidade por célula
// (reps concordam a temperature=0?), monotonicidade de capacidade entre modelos
// por classe, distribuição de ocorrências do `before` (unicidade da âncora) e da
// rodada em que a edição ocorreu. Uso:
//   node tools/coder-evidence/analyze.mjs tools/coder-evidence/runs/<stamp>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('uso: node analyze.mjs <run-dir>'); process.exit(1); }
const rows = readFileSync(join(dir, 'raw.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));

const models = meta.config.models;
const classes = meta.config.classes;
const protocols = meta.config.protocols ?? ['current'];
const protocolOf = r => r.protocol ?? 'current';
const cell = (m, p, c) => rows.filter(r => r.model === m && protocolOf(r) === p && r.class === c);

const pct = (n, d) => d ? `${Math.round((100 * n) / d)}%` : '—';
const hist = arr => arr.reduce((a, x) => (a[x] = (a[x] ?? 0) + 1, a), {});

const extractJson = raw => {
  const text = String(raw ?? '').trim();
  const candidate = text.startsWith('{')
    ? text
    : (text.match(/\{[\s\S]*\}/)?.[0] ?? '');

  if (!candidate) return null;

  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
};

const readObservabilityFromCalls = row => {
  if (!Array.isArray(row.callsRaw)) return null;

  const shapes = [];
  const effectiveModes = [];

  for (const call of row.callsRaw) {
    const parsed = extractJson(call?.respContent);

    if (parsed?.action !== 'read' || !Array.isArray(parsed.reads)) {
      continue;
    }

    for (const candidate of parsed.reads) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        continue;
      }

      const hasSearch =
        typeof candidate.search === 'string'
        && candidate.search.trim().length > 0;

      const hasLineRange =
        Array.isArray(candidate.lineRange)
        && candidate.lineRange.length === 2;

      const shape =
        hasSearch && hasLineRange
          ? 'search+lineRange'
          : hasSearch
            ? 'search-only'
            : hasLineRange
              ? 'lineRange-only'
              : 'default';

      const effectiveMode =
        hasSearch
          ? 'search'
          : hasLineRange
            ? 'lineRange'
            : 'head';

      shapes.push(shape);
      effectiveModes.push(effectiveMode);
    }
  }

  return {
    shapes,
    effectiveModes,
    hybridReadRequests: shapes.filter(shape => shape === 'search+lineRange').length,
  };
};

const readObservabilityOf = row => {
  const fromCalls = readObservabilityFromCalls(row);

  if (fromCalls) return fromCalls;

  if (
    Array.isArray(row.readRequestShapes)
    && Array.isArray(row.effectiveReadModes)
  ) {
    return {
      shapes: row.readRequestShapes,
      effectiveModes: row.effectiveReadModes,
      hybridReadRequests:
        typeof row.hybridReadRequests === 'number'
          ? row.hybridReadRequests
          : row.readRequestShapes.filter(shape => shape === 'search+lineRange').length,
    };
  }

  return null;
};

/**
 * Assinatura observacional de um rep.
 *
 * "accepted" sozinho nao prova equivalencia entre reps: uma edicao pode ser
 * aceita pelo host e ainda falhar a semantica da fixture.
 *
 * A+ACH = host aceitou e achieved=true
 * A+SEM = host aceitou e achieved=false
 * A     = run historico sem campo achieved
 * F:x   = falha tipada
 */
const resultSignature = r => {
  if (r.outcome !== 'accepted') return `F:${r.failureCode ?? 'unknown'}`;
  if (typeof r.achieved !== 'boolean') return 'A';
  return r.achieved ? 'A+ACH' : 'A+SEM';
};

console.log(`# Análise — ${dir}`);
console.log(`Modelos: ${models.join(', ')} | Protocolos: ${protocols.join(', ')} | Classes: ${classes.length} | reps: ${meta.config.reps} | seed: ${meta.config.seed}`);
console.log(`Config: ${meta.config.productionConfig}\n`);

// ---- Matriz host-aceito/total + achieved/total + códigos ----
console.log('## Por célula (modelo × protocolo × classe)');
for (const c of classes) {
  console.log(`\n### ${c}`);
  for (const m of models) {
    for (const p of protocols) {
      const rs = cell(m, p, c);
      const acc = rs.filter(r => r.outcome === 'accepted').length;
      const ach = rs.filter(r => r.achieved).length;
      const codes = hist(rs.filter(r => r.failureCode).map(r => r.failureCode));
      const signatures = [...new Set(rs.map(resultSignature))].sort();
      const deterministic = signatures.length <= 1;
      const codesStr = Object.entries(codes).map(([k, v]) => `${k}×${v}`).join(', ') || '—';
      console.log(
        `  ${m.padEnd(20)} ${p.padEnd(9)} aceito ${acc}/${rs.length} (${pct(acc, rs.length)}) · achieved ${ach}/${rs.length} · [${codesStr}] · ${deterministic ? 'determinístico' : `ESTOCÁSTICO (${signatures.join(' | ')})`}`
      );
    }
  }
}

// ---- Monotonicidade de capacidade entre modelos, por protocolo e classe ----
console.log('\n## Monotonicidade de capacidade (taxa de aceite por protocolo × classe, na ordem dos modelos)');
console.log('(monotônico = taxa não-decrescente entre os modelos fornecidos; caso contrário, capacidade NÃO é monotônica no tamanho)');

let anyNonMono = false;

for (const p of protocols) {
  for (const c of classes) {
    const rates = models.map(m => {
      const rs = cell(m, p, c);

      return rs.length
        ? rs.filter(r => r.outcome === 'accepted').length / rs.length
        : null;
    });

    let mono = true;

    for (let i = 1; i < rates.length; i++) {
      if (
        rates[i - 1] !== null &&
        rates[i] !== null &&
        rates[i] < rates[i - 1] - 1e-9
      ) {
        mono = false;
      }
    }

    if (!mono) anyNonMono = true;

    console.log(
      `  ${p.padEnd(9)} / ${c.padEnd(18)} ${rates
        .map(r => r === null ? '—' : (r * 100).toFixed(0).padStart(3) + '%')
        .join(' → ')}  ${mono ? '' : '⟵ NÃO-monotônico'}`
    );
  }
}

console.log(
  `\n→ Capacidade ${anyNonMono ? 'NÃO é' : 'é'} monotônica no tamanho neste conjunto.`
);

// ---- Estocasticidade global ----
console.log('\n## Estocasticidade (modelo × protocolo × classe cujos reps discordam a temperature=0)');

let stoch = 0;
let total = 0;

for (const p of protocols) {
  for (const c of classes) {
    for (const m of models) {
      const rs = cell(m, p, c);

      if (!rs.length) continue;

      total++;

      const signatures = [...new Set(rs.map(resultSignature))].sort();

      if (signatures.length > 1) {
        stoch++;

        console.log(
          `  ${m} / ${p} / ${c}: ${signatures.join(' | ')}`
        );
      }
    }
  }
}

console.log(`\n→ ${stoch}/${total} células estocásticas.`);

// ---- Forma das requests de leitura + modo efetivo do slice ----
console.log('\n## Forma das requests de read e modo efetivo do slice');
console.log('(search+lineRange é UMA request híbrida; pela semântica atual de extractSlice, search tem precedência sobre lineRange)');

for (const m of models) {
  for (const p of protocols) {
    for (const c of classes) {
      const rs = cell(m, p, c);

      if (!rs.length) continue;

      const observations = rs
        .map(readObservabilityOf)
        .filter(Boolean);

      if (!observations.length) {
        console.log(
          `  ${m.padEnd(20)} ${p.padEnd(14)} / ${c}: indisponível (run sem callsRaw/campos derivados)`
        );
        continue;
      }

      const shapes = hist(observations.flatMap(observation => observation.shapes));
      const modes = hist(observations.flatMap(observation => observation.effectiveModes));
      const hybrid = observations.reduce(
        (sum, observation) => sum + observation.hybridReadRequests,
        0
      );
      const requestCount = observations.reduce(
        (sum, observation) => sum + observation.shapes.length,
        0
      );

      console.log(
        `  ${m.padEnd(20)} ${p.padEnd(14)} / ${c}: requests=${requestCount} · shapes=${JSON.stringify(shapes)} · effective=${JSON.stringify(modes)} · hybrid=${hybrid}`
      );
    }
  }
}

// ---- Assinaturas de falha por ocorrência do `before` ----
console.log('\n## Ocorrências do `before` no arquivo original (unicidade da âncora)');
const occAll = rows.flatMap(r => r.beforeOccurrences ?? []);
console.log(`  distribuição global de ocorrências: ${JSON.stringify(hist(occAll))} (1 = âncora única; 0 = before não existe; ≥2 = ambígua)`);

// ---- Rodada da edição / read-stalling ----
console.log('\n## Rodada em que a edição ocorreu (orçamento restante) — read-stalling');
for (const m of models) {
  for (const p of protocols) {
    const rs = rows.filter(r => r.model === m && protocolOf(r) === p && r.editRound !== null);
    const rl = hist(rs.map(r => r.roundsLeftAtEdit));
    console.log(`  ${m.padEnd(20)} ${p.padEnd(7)} roundsLeftAtEdit: ${JSON.stringify(rl)} (0 = só editou na rodada final forçada)`);
  }
}

// ---- Totais brutos por modelo (comparar por célula, não por total) ----
console.log('\n## Totais brutos por modelo (⚠ comparar por célula, não por total)');
for (const m of models) {
  for (const p of protocols) {
    const rs = rows.filter(r => r.model === m && protocolOf(r) === p);
    console.log(`  ${m.padEnd(20)} ${p.padEnd(7)} ${rs.filter(r => r.outcome === 'accepted').length}/${rs.length} aceito · ${rs.filter(r => r.achieved).length}/${rs.length} achieved`);
  }
}
