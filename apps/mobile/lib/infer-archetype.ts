import { supabase } from './supabase';

const OLLAMA_URL   = process.env.EXPO_PUBLIC_OLLAMA_URL   ?? 'http://100.68.239.78:11434';
const OLLAMA_MODEL = process.env.EXPO_PUBLIC_OLLAMA_MODEL ?? 'qwen2.5:14b';

type ArchetypeMap = { explorer: number; focused: number; builder: number; visionary: number };
type Message      = { role: string; content: string };
type Pillar       = { name: string; level: number; xp_total: number };

export async function inferAndSaveArchetype(
  userId: string,
  recentMessages: Message[],
  pillars: Pillar[],
): Promise<void> {
  const conversationText = recentMessages
    .map(m => `${m.role === 'user' ? 'Usuário' : 'Anima'}: ${m.content}`)
    .join('\n');

  const pillarsText = pillars
    .map(p => `${p.name} (nível ${p.level}, ${p.xp_total} XP)`)
    .join(', ');

  const prompt = `Analise o comportamento desta pessoa com base nas conversas recentes e nos pilares de vida.

PILARES ATIVOS: ${pillarsText || 'nenhum ainda'}

CONVERSAS RECENTES:
${conversationText}

Classifique o perfil comportamental usando 4 arquétipos (percentuais inteiros, soma = 100):
- explorer: muda de interesse com frequência, busca novidade, muitos pilares variados
- focused: vai fundo em poucos pilares, prefere profundidade sobre amplitude
- builder: motivado por consistência e progresso gradual, ama hábitos e sequências
- visionary: pensa em objetivos grandes de longo prazo, conecta ações a uma visão maior

Retorne APENAS JSON válido:
{"explorer": 30, "focused": 25, "builder": 30, "visionary": 15}`;

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 20_000);

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

    if (!res.ok) return;

    const body   = await res.json() as { response: string };
    const parsed = JSON.parse(body.response) as Partial<ArchetypeMap>;
    const keys   = ['explorer', 'focused', 'builder', 'visionary'] as const;

    if (!keys.every(k => typeof parsed[k] === 'number' && (parsed[k] ?? 0) >= 0)) return;

    const total = keys.reduce((s, k) => s + (parsed[k] ?? 0), 0);
    if (total === 0) return;

    const archetype: ArchetypeMap = {
      explorer:  Math.round((parsed.explorer  ?? 25) * 100 / total),
      focused:   Math.round((parsed.focused   ?? 25) * 100 / total),
      builder:   Math.round((parsed.builder   ?? 25) * 100 / total),
      visionary: Math.round((parsed.visionary ?? 25) * 100 / total),
    };

    await supabase.from('profiles').update({ archetype }).eq('id', userId);
  } catch {
    // falha silenciosa
  } finally {
    clearTimeout(timeout);
  }
}
