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
const cell = (m, c) => rows.filter(r => r.model === m && r.class === c);

const pct = (n, d) => d ? `${Math.round((100 * n) / d)}%` : '—';
const hist = arr => arr.reduce((a, x) => (a[x] = (a[x] ?? 0) + 1, a), {});

console.log(`# Análise — ${dir}`);
console.log(`Modelos: ${models.join(', ')} | Classes: ${classes.length} | reps: ${meta.config.reps} | seed: ${meta.config.seed}`);
console.log(`Config: ${meta.config.productionConfig}\n`);

// ---- Matriz host-aceito/total + achieved/total + códigos ----
console.log('## Por célula (host-aceito/total · achieved/total · [códigos] · determinismo)');
for (const c of classes) {
  console.log(`\n### ${c}`);
  for (const m of models) {
    const rs = cell(m, c);
    const acc = rs.filter(r => r.outcome === 'accepted').length;
    const ach = rs.filter(r => r.achieved).length;
    const codes = hist(rs.filter(r => r.failureCode).map(r => r.failureCode));
    const outcomes = new Set(rs.map(r => r.outcome === 'accepted' ? 'A' : (r.failureCode ?? 'F')));
    const deterministic = outcomes.size <= 1;
    const codesStr = Object.entries(codes).map(([k, v]) => `${k}×${v}`).join(', ') || '—';
    console.log(`  ${m.padEnd(20)} aceito ${acc}/${rs.length} (${pct(acc, rs.length)}) · achieved ${ach}/${rs.length} · [${codesStr}] · ${deterministic ? 'determinístico' : 'ESTOCÁSTICO'}`);
  }
}

// ---- Monotonicidade de capacidade entre modelos, por classe ----
console.log('\n## Monotonicidade de capacidade (taxa de aceite por classe, na ordem dos modelos)');
console.log('(monotônico = taxa não-decrescente 7b→14b→30b; caso contrário, capacidade NÃO é monotônica no tamanho)');
let anyNonMono = false;
for (const c of classes) {
  const rates = models.map(m => { const rs = cell(m, c); return rs.length ? rs.filter(r => r.outcome === 'accepted').length / rs.length : null; });
  let mono = true;
  for (let i = 1; i < rates.length; i++) if (rates[i - 1] !== null && rates[i] !== null && rates[i] < rates[i - 1] - 1e-9) mono = false;
  if (!mono) anyNonMono = true;
  console.log(`  ${c.padEnd(18)} ${rates.map(r => r === null ? '—' : (r * 100).toFixed(0).padStart(3) + '%').join(' → ')}  ${mono ? '' : '⟵ NÃO-monotônico'}`);
}
console.log(`\n→ Capacidade ${anyNonMono ? 'NÃO é' : 'é'} monotônica no tamanho neste conjunto.`);

// ---- Estocasticidade global ----
console.log('\n## Estocasticidade (células cujos reps discordam a temperature=0)');
let stoch = 0, total = 0;
for (const c of classes) for (const m of models) {
  const rs = cell(m, c); if (!rs.length) continue; total++;
  const outcomes = new Set(rs.map(r => r.outcome === 'accepted' ? 'A' : (r.failureCode ?? 'F')));
  if (outcomes.size > 1) { stoch++; console.log(`  ${m} / ${c}: ${[...outcomes].join(' | ')}`); }
}
console.log(`\n→ ${stoch}/${total} células estocásticas.`);

// ---- Assinaturas de falha por ocorrência do `before` ----
console.log('\n## Ocorrências do `before` no arquivo original (unicidade da âncora)');
const occAll = rows.flatMap(r => r.beforeOccurrences ?? []);
console.log(`  distribuição global de ocorrências: ${JSON.stringify(hist(occAll))} (1 = âncora única; 0 = before não existe; ≥2 = ambígua)`);

// ---- Rodada da edição / read-stalling ----
console.log('\n## Rodada em que a edição ocorreu (orçamento restante) — read-stalling');
for (const m of models) {
  const rs = rows.filter(r => r.model === m && r.editRound !== null);
  const rl = hist(rs.map(r => r.roundsLeftAtEdit));
  console.log(`  ${m.padEnd(20)} roundsLeftAtEdit: ${JSON.stringify(rl)} (0 = só editou na rodada final forçada)`);
}

// ---- Totais brutos por modelo (comparar por célula, não por total) ----
console.log('\n## Totais brutos por modelo (⚠ comparar por célula, não por total)');
for (const m of models) {
  const rs = rows.filter(r => r.model === m);
  console.log(`  ${m.padEnd(20)} ${rs.filter(r => r.outcome === 'accepted').length}/${rs.length} aceito · ${rs.filter(r => r.achieved).length}/${rs.length} achieved`);
}
