import type { SupabaseClient } from '@supabase/supabase-js';

// Camada 3 — extração de entidades semânticas.
// Chamada direta (server-side) após cada atividade registrada, recebendo o
// cliente já autenticado e o userId — evita o fetch interno sem cookies que
// caía em 401 e descartava tudo silenciosamente.

const OLLAMA_URL   = process.env.OLLAMA_URL   ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';

const VALID_TYPES = new Set(['pessoa', 'lugar', 'projeto', 'ferramenta', 'habito', 'conceito']);

type ExtractedEntity = { name: string; type: string; context: string };

export async function extractEntities(
  supabase: SupabaseClient,
  userId: string,
  note: string,
  recordId: string,
): Promise<void> {
  if (!note?.trim() || note.trim().length < 10 || !recordId) return;

  // Sem format:json — ele enviesa o qwen a devolver UM objeto só, perdendo
  // entidades. Forçar array por exemplo + parsing tolerante é mais confiável.
  const prompt = `Extraia TODAS as entidades nomeadas do texto: pessoas, projetos específicos, lugares, ferramentas/apps, hábitos nomeados.
Ignore palavras genéricas (trabalho, exercício, manhã, dia).

Texto: "${note.replace(/"/g, "'").replace(/\n/g, ' ')}"

Responda SOMENTE com um array JSON, um objeto por entidade, sem texto extra:
[{"name":"FL Studio","type":"ferramenta","context":"app de música"},{"name":"Marina","type":"pessoa","context":"amiga"}]

Tipos válidos: pessoa, lugar, projeto, ferramenta, habito, conceito. context = até 45 chars. Se não houver entidade, retorne [].`;

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 20_000);

  let entities: ExtractedEntity[] = [];

  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  controller.signal,
      body: JSON.stringify({
        model:   OLLAMA_MODEL,
        prompt,
        stream:  false,
        options: { temperature: 0.1 },
      }),
    });

    if (res.ok) {
      const data = await res.json() as { response: string };
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.response);
      } catch {
        const m = data.response.match(/\[[\s\S]*\]/);
        parsed = m ? JSON.parse(m[0]) : [];
      }
      const arr = Array.isArray(parsed) ? parsed
        : Array.isArray((parsed as { entities?: unknown[] })?.entities) ? (parsed as { entities: unknown[] }).entities
        : (parsed && typeof parsed === 'object' && typeof (parsed as ExtractedEntity).name === 'string') ? [parsed]
        : [];
      entities = (arr as unknown[]).filter(
        (e): e is ExtractedEntity =>
          typeof e === 'object' && e !== null &&
          typeof (e as ExtractedEntity).name === 'string' &&
          (e as ExtractedEntity).name.trim().length > 1,
      );
    }
  } catch {
    // timeout/rede — ignora
  } finally {
    clearTimeout(timeout);
  }

  if (entities.length === 0) return;

  for (const entity of entities) {
    const name    = entity.name.trim().slice(0, 100);
    const type    = VALID_TYPES.has(entity.type) ? entity.type : 'conceito';
    const context = (entity.context ?? '').trim().slice(0, 200) || null;

    const { data: existing } = await supabase
      .from('semantic_entities')
      .select('id, occurrence_count')
      .eq('user_id', userId)
      .eq('name', name)
      .maybeSingle();

    let entityId: string | null = null;

    if (existing) {
      await supabase
        .from('semantic_entities')
        .update({
          entity_type:      type,
          context,
          last_seen_at:     new Date().toISOString(),
          occurrence_count: existing.occurrence_count + 1,
        })
        .eq('id', existing.id);
      entityId = existing.id;
    } else {
      const { data: created } = await supabase
        .from('semantic_entities')
        .insert({ user_id: userId, name, entity_type: type, context })
        .select('id')
        .single();
      entityId = created?.id ?? null;
    }

    if (entityId) {
      await supabase.from('entity_mentions').insert({
        entity_id:       entityId,
        xp_record_id:    recordId,
        context_snippet: note.slice(0, 200),
      });
    }
  }
}
