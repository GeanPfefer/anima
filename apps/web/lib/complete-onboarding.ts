import { createClient } from '@/lib/supabase/server';

type Message = { role: 'user' | 'assistant'; content: string };

type Extracted = {
  pillars:    string[];
  subPillars: { name: string; parentName: string }[];
  archetype:  Record<string, number>;
};

const OLLAMA_URL   = process.env.OLLAMA_URL   ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';

const DEFAULT_ARCHETYPE = { explorer: 25, focused: 25, builder: 25, visionary: 25 };

function norm(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

async function extractFromConversation(messages: Message[], name: string): Promise<Extracted> {
  if (messages.length === 0) {
    return { pillars: [], subPillars: [], archetype: DEFAULT_ARCHETYPE };
  }

  const conversationText = messages
    .map(m => `${m.role === 'user' ? name : 'Anima'}: ${m.content}`)
    .join('\n');

  const prompt = `Com base nesta conversa inicial entre o Anima e ${name}, identifique as áreas de vida relevantes.

CONVERSA:
${conversationText}

Retorne APENAS um JSON válido com exatamente estas chaves:
{
  "pillars": ["NomePilar1", "NomePilar2"],
  "subPillars": [{"name": "TopicoEspecifico", "parentName": "NomePilar1"}],
  "archetype": {"explorer": 40, "focused": 30, "builder": 20, "visionary": 10}
}

REGRAS PARA pillars:
- Os pilares Saúde, Mente e Relações JÁ EXISTEM — NÃO os inclua aqui
- Apenas pilares ADICIONAIS claramente evidenciados na conversa
- Nomes simples em português, máx 20 chars (ex: "Trabalho", "Finanças", "Lazer", "Crescimento")
- Se não houver nada claro além dos 3 base, retorne array vazio []
- Máximo 4 pilares adicionais
- NUNCA inclua o nome do app (Anima), hábitos ruins ou nomes próprios como pilares

REGRAS PARA subPillars:
- Sub-pilares são atividades ou temas ESPECÍFICOS mencionados explicitamente
- NUNCA inclua: nome do app, nomes de pessoas, hábitos prejudiciais, conceitos abstratos
- Array vazio se a conversa for curta ou não mencionar nada suficientemente específico
- Máximo 3 sub-pilares

REGRAS PARA archetype:
- Percentuais inteiros somando exatamente 100`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

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

    if (!res.ok) throw new Error('Ollama error');

    const body = await res.json() as { response: string };
    let parsed: Partial<Extracted>;
    try {
      parsed = JSON.parse(body.response);
    } catch {
      const match = body.response.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : {};
    }

    return {
      pillars:    Array.isArray(parsed.pillars) ? parsed.pillars : [],
      subPillars: Array.isArray(parsed.subPillars) ? parsed.subPillars : [],
      archetype:  typeof parsed.archetype === 'object' && parsed.archetype !== null
        ? parsed.archetype
        : DEFAULT_ARCHETYPE,
    };
  } catch {
    return { pillars: [], subPillars: [], archetype: DEFAULT_ARCHETYPE };
  } finally {
    clearTimeout(timeout);
  }
}

export async function completeOnboarding(messages: Message[]): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Não autenticado');

  const { data: profile } = await supabase
    .from('profiles')
    .select('name')
    .eq('id', user.id)
    .single();

  const extracted = await extractFromConversation(messages, profile?.name ?? 'usuário');

  const { data: existingPillars } = await supabase
    .from('user_pillars')
    .select('name')
    .eq('user_id', user.id);
  const existingNames = new Set((existingPillars ?? []).map(p => norm(p.name)));

  const newPillarNames = extracted.pillars.filter(n => !existingNames.has(norm(n)));

  let insertedPillars: Array<{ id: string; name: string }> = [];
  if (newPillarNames.length > 0) {
    const { data } = await supabase
      .from('user_pillars')
      .insert(newPillarNames.map((name, i) => ({
        user_id:    user.id,
        catalog_id: null,
        name,
        xp_rate:    1.0,
        sort_order: (existingPillars?.length ?? 3) + i,
      })))
      .select('id, name');
    insertedPillars = data ?? [];
  }

  if (extracted.subPillars.length > 0 && insertedPillars.length > 0) {
    const { data: insertedSubs } = await supabase
      .from('user_pillars')
      .insert(extracted.subPillars.map((sp, i) => ({
        user_id:    user.id,
        catalog_id: null,
        name:       sp.name,
        xp_rate:    1.0,
        sort_order: (existingPillars?.length ?? 3) + newPillarNames.length + i,
      })))
      .select('id, name');

    if (insertedSubs) {
      const rels = extracted.subPillars
        .map(sp => ({
          child:  insertedSubs.find(s => norm(s.name) === norm(sp.name)),
          parent: insertedPillars.find(p => norm(p.name) === norm(sp.parentName)),
        }))
        .filter((r): r is { child: { id: string; name: string }; parent: { id: string; name: string } } =>
          r.child !== undefined && r.parent !== undefined,
        )
        .map(r => ({ parent_id: r.parent.id, child_id: r.child.id }));

      if (rels.length > 0) {
        await supabase.from('pillar_relationships').insert(rels);
      }
    }
  }

  await supabase.from('profiles').update({
    onboarding_completed_at: new Date().toISOString(),
    archetype: extracted.archetype,
  }).eq('id', user.id);
}
