// Camada 3 — extração de entidades semânticas
// Chamada fire-and-forget após cada atividade registrada.
// Identifica entidades recorrentes (projetos, pessoas, lugares, hábitos)
// e as upserta em semantic_entities para enriquecer o contexto da IA.

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

const OLLAMA_URL   = process.env.OLLAMA_URL   ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';

type ExtractedEntity = {
  name: string;
  type: string;
  context: string;
};

const VALID_TYPES = new Set(['pessoa', 'lugar', 'projeto', 'ferramenta', 'habito', 'conceito']);

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Não autorizado', { status: 401 });

  const body = await req.json() as { note?: string; recordId?: string };
  const { note, recordId } = body;

  // Notas curtas ou sem conteúdo não valem a extração
  if (!note?.trim() || note.trim().length < 10 || !recordId) {
    return new Response('OK', { status: 200 });
  }

  // ── Extração via Ollama ───────────────────────────────────────────────────
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
    const ollamaRes = await fetch(`${OLLAMA_URL}/api/generate`, {
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

    if (ollamaRes.ok) {
      const data = await ollamaRes.json() as { response: string };
      try {
        const parsed = JSON.parse(data.response);
        const arr = Array.isArray(parsed) ? parsed
          : Array.isArray(parsed?.entities) ? parsed.entities
          : [];
        entities = arr.filter(
          (e: unknown): e is ExtractedEntity =>
            typeof e === 'object' && e !== null &&
            typeof (e as ExtractedEntity).name === 'string' &&
            (e as ExtractedEntity).name.trim().length > 1,
        );
      } catch {
        // JSON inválido — ignora silenciosamente
      }
    }
  } catch {
    // Timeout ou erro de rede — ignora
  } finally {
    clearTimeout(timeout);
  }

  if (entities.length === 0) return new Response('OK', { status: 200 });

  // ── Upsert em semantic_entities ──────────────────────────────────────────
  for (const entity of entities) {
    const name = entity.name.trim().slice(0, 100);
    const type = VALID_TYPES.has(entity.type) ? entity.type : 'conceito';
    const context = (entity.context ?? '').trim().slice(0, 200) || null;

    const { data: existing } = await supabase
      .from('semantic_entities')
      .select('id, occurrence_count')
      .eq('user_id', user.id)
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
        .insert({ user_id: user.id, name, entity_type: type, context })
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

  return new Response('OK', { status: 200 });
}
