'use server';

import { createClient } from '@/lib/supabase/server';

type Message = { role: 'user' | 'assistant'; content: string };

type Extracted = {
  pillars: string[];
  subPillars: { name: string; parentName: string }[];
  archetype: Record<string, number>;
};

const OLLAMA_URL   = process.env.OLLAMA_URL   ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';

const DEFAULT_PILLARS   = ['Mente', 'Trabalho', 'Saúde', 'Relações', 'Lazer'];
const DEFAULT_ARCHETYPE = { explorer: 25, focused: 25, builder: 25, visionary: 25 };

function norm(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export async function saveName(name: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Não autenticado');
  await supabase.from('profiles').update({ name }).eq('id', user.id);
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

  // Busca catálogo de pilares para fazer o match por nome
  const { data: catalog } = await supabase.from('pillar_catalog').select('id, name');
  const catalogMap = new Map((catalog ?? []).map(p => [norm(p.name), p]));

  // Insere pilares principais
  const pillarRows = extracted.pillars.map((name, i) => ({
    user_id:    user.id,
    catalog_id: catalogMap.get(norm(name))?.id ?? null,
    name,
    xp_rate:    1.0,
    sort_order: i,
  }));

  const { data: insertedPillars } = await supabase
    .from('user_pillars')
    .insert(pillarRows)
    .select('id, name');

  // Insere sub-pilares inferidos
  if (extracted.subPillars.length > 0 && insertedPillars) {
    const subRows = extracted.subPillars.map((sp, i) => ({
      user_id:    user.id,
      catalog_id: null,
      name:       sp.name,
      xp_rate:    1.0,
      sort_order: extracted.pillars.length + i,
    }));

    const { data: insertedSubs } = await supabase
      .from('user_pillars')
      .insert(subRows)
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

  // Finaliza o perfil
  await supabase.from('profiles').update({
    onboarding_completed_at: new Date().toISOString(),
    archetype: extracted.archetype,
  }).eq('id', user.id);
}

async function extractFromConversation(messages: Message[], name: string): Promise<Extracted> {
  if (messages.length === 0) {
    return { pillars: DEFAULT_PILLARS, subPillars: [], archetype: DEFAULT_ARCHETYPE };
  }

  const conversationText = messages
    .map(m => `${m.role === 'user' ? name : 'Anima'}: ${m.content}`)
    .join('\n');

  const prompt = `Com base nesta conversa inicial entre o Anima e ${name}, extraia o perfil.

CONVERSA:
${conversationText}

Retorne APENAS um JSON válido com exatamente estas chaves:
{
  "pillars": ["NomePilar1", "NomePilar2", "NomePilar3"],
  "subPillars": [{"name": "TopicoEspecifico", "parentName": "NomePilar1"}],
  "archetype": {"explorer": 40, "focused": 30, "builder": 20, "visionary": 10}
}

REGRAS PARA pillars:
- Escolha APENAS da lista: [Mente, Propósito, Trabalho, Saúde, Relações, Finanças, Lazer]
- Inclua entre 3 e 5 pilares — os mais relevantes para esta pessoa
- Infira mesmo de menções indiretas:
    projeto/empresa/código/carreira → Trabalho
    família/amigos/amor/parceiro → Relações
    exercício/sono/alimentação/energia → Saúde
    leitura/aprendizado/foco/clareza → Mente
    propósito/valores/missão/legado → Propósito
    dinheiro/renda/dívida/investimento → Finanças
    hobby/descanso/viagem/jogo/lazer → Lazer
- NÃO copie o exemplo acima — analise a conversa real

REGRAS PARA subPillars:
- Apenas temas bem específicos e claramente mencionados (ex: "skate", "Anima", "ansiedade")
- Array vazio se não houver nada suficientemente específico

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
      pillars:    Array.isArray(parsed.pillars) && parsed.pillars.length > 0 ? parsed.pillars : DEFAULT_PILLARS,
      subPillars: Array.isArray(parsed.subPillars) ? parsed.subPillars : [],
      archetype:  typeof parsed.archetype === 'object' && parsed.archetype !== null
        ? parsed.archetype
        : DEFAULT_ARCHETYPE,
    };
  } catch {
    return { pillars: DEFAULT_PILLARS, subPillars: [], archetype: DEFAULT_ARCHETYPE };
  } finally {
    clearTimeout(timeout);
  }
}
