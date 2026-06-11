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

  const prompt = `Analise o seguinte texto pessoal e extraia entidades específicas e relevantes.

Texto: "${note.replace(/"/g, "'").replace(/\n/g, ' ')}"

Entidades de interesse: nomes próprios de pessoas, projetos específicos, locais frequentes, ferramentas/apps, hábitos nomeados.
Ignore palavras genéricas como "trabalho", "exercício", "manhã", "dia".

Retorne APENAS um array JSON válido (pode ser vazio se não houver entidades relevantes):
[{"name": "...", "type": "pessoa|lugar|projeto|ferramenta|habito|conceito", "context": "descrição em até 45 chars"}]`;

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
        format:  'json',
        options: { temperature: 0.1 },
      }),
    });

    if (res.ok) {
      const data = await res.json() as { response: string };
      try {
        const parsed = JSON.parse(data.response) as unknown;
        const arr = Array.isArray(parsed) ? parsed
          : Array.isArray((parsed as { entities?: unknown[] })?.entities) ? (parsed as { entities: unknown[] }).entities
          : [];
        entities = (arr as unknown[]).filter(
          (e): e is ExtractedEntity =>
            typeof e === 'object' && e !== null &&
            typeof (e as ExtractedEntity).name === 'string' &&
            (e as ExtractedEntity).name.trim().length > 1,
        );
      } catch { /* JSON inválido — ignora */ }
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
