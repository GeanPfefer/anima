// One-off: extrai entidades semânticas das atividades já registradas.
// Roda a mesma extração da Camada 3 sobre xp_records.note existentes,
// populando semantic_entities + entity_mentions. Idempotência fraca
// (occurrence_count incrementa a cada rodada) — rode uma vez só.
//
// Uso: node scripts/backfill-entities.mjs
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.SUPABASE_SECRET ?? '***REMOVED***';
const OLLAMA_URL   = process.env.OLLAMA_URL   ?? 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';

const VALID_TYPES = new Set(['pessoa', 'lugar', 'projeto', 'ferramenta', 'habito', 'conceito']);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

async function extractFromNote(note) {
  const prompt = `Extraia TODAS as entidades nomeadas do texto: pessoas, projetos específicos, lugares, ferramentas/apps, hábitos nomeados.
Ignore palavras genéricas (trabalho, exercício, manhã, dia).

Texto: "${note.replace(/"/g, "'").replace(/\n/g, ' ')}"

Responda SOMENTE com um array JSON, um objeto por entidade, sem texto extra:
[{"name":"FL Studio","type":"ferramenta","context":"app de música"},{"name":"Marina","type":"pessoa","context":"amiga"}]

Tipos válidos: pessoa, lugar, projeto, ferramenta, habito, conceito. context = até 45 chars. Se não houver entidade, retorne [].`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false, options: { temperature: 0.1 } }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    let parsed;
    try { parsed = JSON.parse(data.response); }
    catch { const m = data.response.match(/\[[\s\S]*\]/); parsed = m ? JSON.parse(m[0]) : []; }
    const arr = Array.isArray(parsed) ? parsed
      : Array.isArray(parsed?.entities) ? parsed.entities
      : (parsed && typeof parsed === 'object' && typeof parsed.name === 'string') ? [parsed]
      : [];
    return arr.filter(e => e && typeof e.name === 'string' && e.name.trim().length > 1);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const { data: records, error } = await supabase
    .from('xp_records')
    .select('id, user_id, note')
    .not('note', 'is', null)
    .order('created_at');

  if (error) { console.error('Erro ao buscar xp_records:', error.message); process.exit(1); }

  const valid = (records ?? []).filter(r => (r.note ?? '').trim().length >= 10);
  console.log(`Processando ${valid.length} atividades com nota...`);

  let entCreated = 0, mentions = 0, i = 0;

  for (const rec of valid) {
    i++;
    const entities = await extractFromNote(rec.note);
    process.stdout.write(`\r[${i}/${valid.length}] "${rec.note.slice(0, 40)}" → ${entities.length} entidade(s)        `);

    for (const ent of entities) {
      const name = String(ent.name).trim().slice(0, 100);
      const type = VALID_TYPES.has(ent.type) ? ent.type : 'conceito';
      const context = (ent.context ?? '').toString().trim().slice(0, 200) || null;

      const { data: existing } = await supabase
        .from('semantic_entities')
        .select('id, occurrence_count')
        .eq('user_id', rec.user_id)
        .eq('name', name)
        .maybeSingle();

      let entityId = null;
      if (existing) {
        await supabase.from('semantic_entities').update({
          entity_type: type, context,
          last_seen_at: new Date().toISOString(),
          occurrence_count: existing.occurrence_count + 1,
        }).eq('id', existing.id);
        entityId = existing.id;
      } else {
        const { data: created } = await supabase
          .from('semantic_entities')
          .insert({ user_id: rec.user_id, name, entity_type: type, context })
          .select('id').single();
        entityId = created?.id ?? null;
        if (entityId) entCreated++;
      }

      if (entityId) {
        await supabase.from('entity_mentions').insert({
          entity_id: entityId, xp_record_id: rec.id, context_snippet: rec.note.slice(0, 200),
        });
        mentions++;
      }
    }
  }

  console.log(`\n\nPronto. ${entCreated} entidades novas, ${mentions} menções.`);
  process.exit(0);
}

main();
