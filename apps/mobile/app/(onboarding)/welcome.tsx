import { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ScrollView, StyleSheet, KeyboardAvoidingView,
  Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { colors, spacing, radius } from '@/constants/theme';

const OLLAMA_URL   = process.env.EXPO_PUBLIC_OLLAMA_URL   ?? 'http://100.68.239.78:11434';
const OLLAMA_MODEL = process.env.EXPO_PUBLIC_OLLAMA_MODEL ?? 'qwen2.5:14b';

// Os 3 pilares raiz (Saúde, Mente, Relações) já são criados pelo trigger de signup.
// O onboarding só adiciona pilares EXTRAS inferidos da conversa.
const DEFAULT_PILLARS   = [] as string[];
const DEFAULT_ARCHETYPE = { explorer: 25, focused: 25, builder: 25, visionary: 25 };

type Message    = { role: 'user' | 'assistant'; content: string };
type Phase      = 'name' | 'chat';

function norm(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function buildSystemPrompt(name: string): string {
  return `Você é o Anima. Esta é sua primeira conversa com ${name}.

MISSÃO (nunca diga isso): ouvir e entender como é a vida de ${name} agora.
Não aconselhar. Não planejar. Não ajudar. Só entender.

PROIBIDO — estas respostas destroem a experiência:
❌ "Vamos focar em uma área específica"
❌ "Qual área da sua vida você quer melhorar?"
❌ Listar categorias como opções para o usuário escolher
❌ "Vamos criar um planejamento / plano de ação"
❌ "Qual é o seu maior desafio?"
❌ Dar conselhos ou sugestões não pedidos
❌ Mais de uma pergunta por mensagem
❌ Mencionar "pilares", "XP", "níveis", "dashboard" ou termos do sistema

SE o usuário perguntar "quais áreas existem?" ou "o que você rastreia?":
→ Diga algo como: "O sistema detecta sozinho o que é relevante pra você a partir das conversas — não tem uma lista fixa. Vai aparecendo no seu perfil conforme você conta mais."

PERMITIDO:
✅ Perguntas sobre o dia a dia, o que está acontecendo agora
✅ Curiosidade sobre o presente — não sobre metas futuras
✅ Resposta curta (máx 2 frases) + uma pergunta
✅ Tom de amigo que acabou de te conhecer — leve, sem pressão

Após 3+ trocas com contexto real da vida da pessoa, encerre naturalmente com algo como:
"Já tenho uma boa ideia de como é a sua vida agora. Pode explorar seu perfil quando quiser."

Idioma: português brasileiro informal.
Primeira mensagem (ao receber "."): algo genuíno como "O que tá rolando na sua vida ultimamente, ${name}?"`;
}

async function callOllama(msgs: Message[], name: string): Promise<string> {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 30_000);

  try {
    const ollamaMessages = msgs.length === 0
      ? [{ role: 'user', content: '.' }]
      : msgs;

    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  controller.signal,
      body: JSON.stringify({
        model:    OLLAMA_MODEL,
        stream:   false,
        messages: [
          { role: 'system', content: buildSystemPrompt(name) },
          ...ollamaMessages,
        ],
      }),
    });

    if (!res.ok) throw new Error('Ollama error');
    const data = await res.json() as { message?: { content?: string } };
    return data.message?.content ?? '';
  } finally {
    clearTimeout(timeout);
  }
}

async function extractProfile(messages: Message[], name: string) {
  if (messages.length === 0) {
    return { pillars: DEFAULT_PILLARS, subPillars: [], archetype: DEFAULT_ARCHETYPE };
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
- Infira de menções:
    projeto/empresa/código/carreira → Trabalho
    hobby/descanso/criatividade/arte → Lazer
    dinheiro/renda/dívida/investimento → Finanças
    propósito/valores/missão/identidade → Crescimento

REGRAS PARA subPillars:
- Apenas temas muito específicos e claramente mencionados (ex: "skate", "meditação")
- Array vazio se não houver nada suficientemente específico

REGRAS PARA archetype:
- Percentuais inteiros somando exatamente 100`;

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  controller.signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL, prompt, stream: false,
        format: 'json', options: { temperature: 0.1 },
      }),
    });
    if (!res.ok) throw new Error('Ollama error');
    const body = await res.json() as { response: string };
    const parsed = JSON.parse(body.response);
    return {
      pillars:    Array.isArray(parsed.pillars) && parsed.pillars.length > 0 ? parsed.pillars : DEFAULT_PILLARS,
      subPillars: Array.isArray(parsed.subPillars) ? parsed.subPillars : [],
      archetype:  typeof parsed.archetype === 'object' ? parsed.archetype : DEFAULT_ARCHETYPE,
    };
  } catch {
    return { pillars: DEFAULT_PILLARS, subPillars: [], archetype: DEFAULT_ARCHETYPE };
  } finally {
    clearTimeout(timeout);
  }
}

export default function WelcomeScreen() {
  const router           = useRouter();
  const { top, bottom }  = useSafeAreaInsets();
  const [phase, setPhase]             = useState<Phase>('name');
  const [nameVal, setNameVal]         = useState('');
  const [messages, setMessages]       = useState<Message[]>([]);
  const [input, setInput]             = useState('');
  const [waiting, setWaiting]         = useState(false);
  const [completing, setCompleting]   = useState(false);
  const [showDashBtn, setShowDashBtn] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const scrollRef    = useRef<ScrollView>(null);
  const nameRef      = useRef('');
  const completedRef = useRef(false);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [messages, waiting]);

  const handleNameSubmit = async () => {
    const name = nameVal.trim();
    if (!name) return;
    nameRef.current = name;

    const { data: { user } } = await supabase.auth.getUser();
    if (user) await supabase.from('profiles').update({ name }).eq('id', user.id);

    setPhase('chat');
    setWaiting(true);
    try {
      const text = await callOllama([], name);
      setMessages([{ role: 'assistant', content: text }]);
      setShowDashBtn(true);
    } catch {
      setMessages([{ role: 'assistant', content: `Olá, ${name}! O que está ocupando sua cabeça ultimamente?` }]);
      setShowDashBtn(true);
    } finally {
      setWaiting(false);
    }
  };

  // Extrai perfil e salva em background após primeira troca
  const handleBackgroundComplete = async (msgs: Message[]) => {
    if (completedRef.current) return;
    completedRef.current = true;
    try {
      const extracted = await extractProfile(msgs, nameRef.current);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: existingPillars } = await supabase
        .from('user_pillars').select('name').eq('user_id', user.id);
      const existingNames = new Set((existingPillars ?? []).map((p: { name: string }) => norm(p.name)));
      const newPillarNames = (extracted.pillars as string[]).filter((n) => !existingNames.has(norm(n)));

      let insertedPillars: Array<{ id: string; name: string }> = [];
      if (newPillarNames.length > 0) {
        const { data } = await supabase.from('user_pillars').insert(
          newPillarNames.map((n, i) => ({
            user_id: user.id, catalog_id: null, name: n, xp_rate: 1.0,
            sort_order: (existingPillars?.length ?? 3) + i,
          })),
        ).select('id, name');
        insertedPillars = data ?? [];
      }

      if (extracted.subPillars.length > 0 && insertedPillars.length > 0) {
        const baseOrder = (existingPillars?.length ?? 3) + insertedPillars.length;
        const { data: insertedSubs } = await supabase.from('user_pillars').insert(
          extracted.subPillars.map((sp: { name: string }, i: number) => ({
            user_id: user.id, catalog_id: null, name: sp.name, xp_rate: 1.0,
            sort_order: baseOrder + i,
          })),
        ).select('id, name');
        if (insertedSubs) {
          const rels = extracted.subPillars
            .map((sp: { name: string; parentName: string }) => ({
              child:  insertedSubs.find((s: { name: string }) => norm(s.name) === norm(sp.name)),
              parent: insertedPillars.find((p: { name: string }) => norm(p.name) === norm(sp.parentName)),
            }))
            .filter((r: { child?: { id: string }; parent?: { id: string } }) => r.child && r.parent)
            .map((r: { child: { id: string }; parent: { id: string } }) => ({ parent_id: r.parent.id, child_id: r.child.id }));
          if (rels.length > 0) await supabase.from('pillar_relationships').insert(rels);
        }
      }

      await supabase.from('profiles').update({
        onboarding_completed_at: new Date().toISOString(),
        archetype: extracted.archetype,
      }).eq('id', user.id);

      setProfileReady(true);
    } catch {
      completedRef.current = false;
    }
  };

  const handleSend = async () => {
    if (!input.trim() || waiting) return;
    const userMsg: Message = { role: 'user', content: input.trim() };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setWaiting(true);
    try {
      const text = await callOllama(next, nameRef.current);
      const updated = [...next, { role: 'assistant' as const, content: text }];
      setMessages(updated);

      // Após primeira mensagem do usuário: extrai perfil em background
      if (next.filter((m) => m.role === 'user').length === 1) {
        handleBackgroundComplete(updated);
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Ops, tive um problema. Pode tentar de novo?' }]);
    } finally {
      setWaiting(false);
    }
  };

  const handleComplete = async () => {
    // Se o perfil já foi salvo em background, só navega
    if (profileReady) {
      router.replace('/(app)/home');
      return;
    }
    setCompleting(true);
    try {
      const extracted = await extractProfile(messages, nameRef.current);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Não autenticado');

      // Pilares raiz (Saúde, Mente, Relações) já criados pelo trigger de signup.
      // Busca pilares já existentes para evitar duplicatas.
      const { data: existingPillars } = await supabase
        .from('user_pillars')
        .select('name')
        .eq('user_id', user.id);
      const existingNames = new Set((existingPillars ?? []).map((p: { name: string }) => norm(p.name)));

      const newPillarNames = (extracted.pillars as string[]).filter(n => !existingNames.has(norm(n)));

      let insertedPillars: Array<{ id: string; name: string }> = [];
      if (newPillarNames.length > 0) {
        const pillarRows = newPillarNames.map((n, i) => ({
          user_id:    user.id,
          catalog_id: null,
          name:       n,
          xp_rate:    1.0,
          sort_order: (existingPillars?.length ?? 3) + i,
        }));

        const { data } = await supabase
          .from('user_pillars')
          .insert(pillarRows)
          .select('id, name');
        insertedPillars = data ?? [];
      }

      if (extracted.subPillars.length > 0 && insertedPillars.length > 0) {
        const baseOrder = (existingPillars?.length ?? 3) + insertedPillars.length;
        const subRows = extracted.subPillars.map((sp: { name: string }, i: number) => ({
          user_id: user.id, catalog_id: null,
          name: sp.name, xp_rate: 1.0,
          sort_order: baseOrder + i,
        }));
        const { data: insertedSubs } = await supabase
          .from('user_pillars').insert(subRows).select('id, name');

        if (insertedSubs) {
          const rels = extracted.subPillars
            .map((sp: { name: string; parentName: string }) => ({
              child:  insertedSubs.find((s: { name: string }) => norm(s.name) === norm(sp.name)),
              parent: insertedPillars.find((p: { name: string }) => norm(p.name) === norm(sp.parentName)),
            }))
            .filter((r: { child?: { id: string }; parent?: { id: string } }) => r.child && r.parent)
            .map((r: { child: { id: string }; parent: { id: string } }) => ({ parent_id: r.parent.id, child_id: r.child.id }));
          if (rels.length > 0) await supabase.from('pillar_relationships').insert(rels);
        }
      }

      await supabase.from('profiles').update({
        onboarding_completed_at: new Date().toISOString(),
        archetype: extracted.archetype,
      }).eq('id', user.id);

      router.replace('/(app)/home');
    } catch {
      setCompleting(false);
    }
  };

  /* ── Fase nome ──────────────────────────────────────────── */
  if (phase === 'name') {
    return (
      <View style={[s.center, { paddingTop: top }]}>
        <View style={s.nameCard}>
          <Text style={s.logo}>Anima</Text>
          <Text style={s.nameSub}>Como posso te chamar?</Text>
          <TextInput
            style={s.nameInput}
            placeholder="Seu nome"
            placeholderTextColor={colors.textMuted}
            value={nameVal}
            onChangeText={setNameVal}
            autoFocus
            maxLength={50}
            returnKeyType="done"
            onSubmitEditing={handleNameSubmit}
          />
          <TouchableOpacity
            style={[s.btn, !nameVal.trim() && s.btnDisabled]}
            onPress={handleNameSubmit}
            disabled={!nameVal.trim()}
            activeOpacity={0.8}
          >
            <Text style={s.btnText}>Começar →</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  /* ── Fase conversa ──────────────────────────────────────── */
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={bottom}
    >
      <ScrollView
        ref={scrollRef}
        style={s.msgList}
        contentContainerStyle={[s.msgContent, { paddingTop: top + spacing.lg }]}
        keyboardShouldPersistTaps="handled"
      >
        {messages.map((m, i) => (
          <View
            key={i}
            style={[s.msgBubble, m.role === 'user' ? s.userBubble : s.aiBubble]}
          >
            <Text style={[s.msgText, m.role === 'user' && s.userMsgText]}>
              {m.content}
            </Text>
          </View>
        ))}
        {waiting && (
          <View style={s.aiBubble}>
            <View style={s.dots}>
              <View style={s.dot} />
              <View style={s.dot} />
              <View style={s.dot} />
            </View>
          </View>
        )}
      </ScrollView>

      <View style={[s.footer, { paddingBottom: bottom + spacing.md }]}>
        {showDashBtn && (
          <TouchableOpacity
            style={[s.dashBtn, (completing || waiting) && s.btnDisabled]}
            onPress={handleComplete}
            disabled={completing || waiting}
            activeOpacity={0.8}
          >
            {completing
              ? <ActivityIndicator color={colors.accent} size="small" />
              : <Text style={s.dashBtnText}>
                  {profileReady ? 'Ir para o dashboard →' : 'Explorar meu dashboard →'}
                </Text>
            }
          </TouchableOpacity>
        )}
        <View style={s.inputRow}>
          <TextInput
            style={s.chatInput}
            placeholder="Escreva aqui…"
            placeholderTextColor={colors.textMuted}
            value={input}
            onChangeText={setInput}
            multiline
            editable={!waiting}
            returnKeyType="send"
            onSubmitEditing={handleSend}
            blurOnSubmit
          />
          <TouchableOpacity
            style={[s.sendBtn, (!input.trim() || waiting) && s.btnDisabled]}
            onPress={handleSend}
            disabled={!input.trim() || waiting}
            activeOpacity={0.8}
          >
            <Text style={s.sendBtnText}>↑</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  center:   { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  nameCard: { width: '100%', maxWidth: 360, alignItems: 'center', gap: spacing.lg },
  logo:     { fontSize: 36, fontWeight: '800', color: colors.textPrimary, letterSpacing: -1 },
  nameSub:  { fontSize: 17, color: colors.textSecondary, textAlign: 'center' },
  nameInput:{
    width: '100%', backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 4,
    fontSize: 16, color: colors.textPrimary, textAlign: 'center',
  },
  btn:        { width: '100%', backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  btnDisabled:{ opacity: 0.4 },
  btnText:    { color: '#fff', fontSize: 16, fontWeight: '600' },

  msgList:    { flex: 1 },
  msgContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.md },
  msgBubble:  { maxWidth: '80%' },
  aiBubble:   { alignSelf: 'flex-start' },
  userBubble: { alignSelf: 'flex-end' },
  msgText:    { fontSize: 15, color: colors.textPrimary, lineHeight: 24 },
  userMsgText:{ color: colors.textSecondary, textAlign: 'right' },

  dots: { flexDirection: 'row', gap: 5, paddingVertical: 4 },
  dot:  { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.textMuted },

  footer:   { borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.sm },
  dashBtn:  { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, alignSelf: 'flex-start' },
  dashBtnText:{ color: colors.textMuted, fontSize: 13 },
  inputRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' },
  chatInput:{
    flex: 1, backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 4,
    fontSize: 15, color: colors.textPrimary, maxHeight: 120,
  },
  sendBtn:    { backgroundColor: colors.accent, borderRadius: radius.md, width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  sendBtnText:{ color: '#fff', fontSize: 18 },
});
