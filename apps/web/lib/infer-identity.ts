import { createClient } from '@/lib/supabase/server';

const OLLAMA_URL   = process.env.OLLAMA_URL   ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';

type Message = { role: string; content: string };

const VALID_TYPES = new Set(['value', 'goal', 'belief', 'motivation', 'fear', 'interest', 'pattern']);

type RawHypothesis = {
  type: string;
  label: string;
  description?: string;
  confidence?: number;
  evidence?: unknown;
};

function norm(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

// Identidade Emergente: observa quem a pessoa parece ser a partir da memória
// (notas, entidades, conversas) e propõe/atualiza HIPÓTESES com evidências.
// Não afirma verdades. Chamado fire-and-forget da rota de chat (cadência ~15 msgs).
export async function inferAndSaveIdentity(
  userId: string,
  recentMessages: Message[],
): Promise<void> {
  const supabase = await createClient();

  // ── Contexto da memória ────────────────────────────────────────
  const [notesRes, entitiesRes, hypoRes] = await Promise.all([
    supabase
      .from('notes')
      .select('content, note_type, pillar_hint')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(40),
    supabase
      .from('semantic_entities')
      .select('name, entity_type, occurrence_count')
      .eq('user_id', userId)
      .order('occurrence_count', { ascending: false })
      .limit(25),
    supabase
      .from('identity_hypotheses')
      .select('id, type, label, confidence, status')
      .eq('user_id', userId),
  ]);

  const notes    = notesRes.data    ?? [];
  const entities = entitiesRes.data ?? [];
  const existing = hypoRes.data     ?? [];

  // Nada de substância ainda → não inventa identidade.
  if (notes.length === 0 && entities.length === 0 && recentMessages.length < 4) return;

  const notesText = notes.length > 0
    ? notes.map(n => `- [${n.note_type ?? 'nota'}] ${n.content}`).join('\n')
    : '(nenhuma)';
  const entitiesText = entities.length > 0
    ? entities.map(e => `${e.name} (${e.entity_type ?? 'conceito'})`).join(', ')
    : '(nenhuma)';
  const conversationText = recentMessages
    .map(m => `${m.role === 'user' ? 'Usuário' : 'Anima'}: ${m.content}`)
    .join('\n');
  const existingText = existing.length > 0
    ? existing.map(h => `${h.type}:${h.label}`).join(', ')
    : '(nenhuma ainda)';

  // Sem format:json — enviesa o qwen a um objeto só, perdendo o array.
  const prompt = `Você observa quem esta pessoa PARECE ser, a partir da memória dela. NÃO afirme verdades — proponha HIPÓTESES com evidência real no material abaixo.

Tipos de hipótese:
- value: um valor pessoal (ex: Autonomia, Criatividade)
- goal: um objetivo de vida
- belief: uma crença
- motivation: o que a motiva
- fear: um receio ou preocupação recorrente
- interest: um interesse forte
- pattern: um padrão de comportamento

JÁ OBSERVADO (atualize/reforce, NÃO duplique): ${existingText}

NOTAS RECENTES:
${notesText}

INTERESSES/ENTIDADES: ${entitiesText}

CONVERSAS RECENTES:
${conversationText || '(nenhuma)'}

Para cada hipótese sustentada pelo material:
- "type": um dos tipos acima
- "label": curto, 1–3 palavras (ex: "Autonomia")
- "description": uma frase explicando a hipótese
- "confidence": 0–100 (quão forte a evidência sustenta)
- "evidence": array de 1–4 trechos curtos do material que sustentam a hipótese

Seja conservador: só o que o material realmente sustenta. Máximo 6 hipóteses.
Responda SOMENTE com um array JSON, sem texto extra. Exemplo:
[{"type":"value","label":"Autonomia","description":"Valoriza independência e controle sobre as próprias ferramentas","confidence":80,"evidence":["quer rodar IA local","não gosta de depender de APIs externas"]}]
Se não houver nada sustentável, retorne [].`;

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 30_000);

  let hypotheses: RawHypothesis[] = [];
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  controller.signal,
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false, options: { temperature: 0.2 } }),
    });
    if (!res.ok) return;
    const body = await res.json() as { response: string };
    let parsed: unknown;
    try { parsed = JSON.parse(body.response); }
    catch { const m = body.response.match(/\[[\s\S]*\]/); parsed = m ? JSON.parse(m[0]) : []; }
    const arr = Array.isArray(parsed) ? parsed : ((parsed as { hypotheses?: unknown[] })?.hypotheses ?? []);
    hypotheses = (Array.isArray(arr) ? arr : []).filter(
      (h): h is RawHypothesis =>
        typeof h === 'object' && h !== null &&
        typeof (h as RawHypothesis).type === 'string' &&
        typeof (h as RawHypothesis).label === 'string' &&
        (h as RawHypothesis).label.trim().length > 0,
    );
  } catch {
    return;
  } finally {
    clearTimeout(timeout);
  }

  if (hypotheses.length === 0) return;

  const existingByKey = new Map(existing.map(h => [`${h.type}|${norm(h.label)}`, h]));

  for (const h of hypotheses.slice(0, 6)) {
    const type = VALID_TYPES.has(h.type) ? h.type : 'pattern';
    const label = h.label.trim().slice(0, 40);
    if (!label) continue;
    const description = typeof h.description === 'string' ? h.description.slice(0, 200) : null;
    const llmConf = typeof h.confidence === 'number' ? clamp(h.confidence) : 50;
    const snippets = (Array.isArray(h.evidence) ? h.evidence : [])
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .map(s => s.trim().slice(0, 200))
      .slice(0, 4);

    const prev = existingByKey.get(`${type}|${norm(label)}`);

    if (prev) {
      // Reforço suave: estabilidade + leve subida quando a hipótese recorre.
      const confidence = clamp(prev.confidence * 0.7 + llmConf * 0.3 + 3);

      // Dedup de evidência por snippet já existente.
      const { data: existingEv } = await supabase
        .from('identity_evidence')
        .select('snippet')
        .eq('hypothesis_id', prev.id);
      const known = new Set((existingEv ?? []).map(e => norm(e.snippet ?? '')));
      const fresh = snippets.filter(s => !known.has(norm(s)));

      if (fresh.length > 0) {
        await supabase.from('identity_evidence').insert(
          fresh.map(snippet => ({
            hypothesis_id: prev.id, user_id: userId,
            source_type: 'conversation', snippet,
          })),
        );
      }

      // evidence_count = contagem real após inserir (sempre consistente).
      const { count } = await supabase
        .from('identity_evidence')
        .select('*', { count: 'exact', head: true })
        .eq('hypothesis_id', prev.id);

      await supabase
        .from('identity_hypotheses')
        .update({
          description,
          confidence,
          evidence_count:   count ?? (existingEv?.length ?? 0) + fresh.length,
          last_evidence_at: new Date().toISOString(),
          updated_at:       new Date().toISOString(),
        })
        .eq('id', prev.id);
    } else {
      const { data: created } = await supabase
        .from('identity_hypotheses')
        .insert({
          user_id: userId, type, label, description,
          confidence: llmConf, status: 'pending',
          evidence_count: snippets.length,
          last_evidence_at: snippets.length > 0 ? new Date().toISOString() : null,
        })
        .select('id')
        .single();
      if (created && snippets.length > 0) {
        await supabase.from('identity_evidence').insert(
          snippets.map(snippet => ({
            hypothesis_id: created.id, user_id: userId,
            source_type: 'conversation', snippet,
          })),
        );
      }
    }
  }
}
