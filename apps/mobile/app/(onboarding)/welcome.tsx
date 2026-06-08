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

const DEFAULT_PILLARS   = ['Mente', 'Trabalho', 'Saúde', 'Relações', 'Lazer'];
const DEFAULT_ARCHETYPE = { explorer: 25, focused: 25, builder: 25, visionary: 25 };

type Message    = { role: 'user' | 'assistant'; content: string };
type Phase      = 'name' | 'chat';

function norm(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function buildSystemPrompt(name: string): string {
  return `Você é o Anima, tendo sua primeira conversa com ${name}.

Objetivo IMPLÍCITO (nunca mencione): entender a vida de ${name} agora, detectar áreas relevantes.

REGRAS:
- NUNCA mencione "pilares", "XP", "níveis", "configuração"
- NUNCA faça mais de UMA pergunta por mensagem
- Respostas curtas — máx 3 frases
- Após 3+ trocas com contexto, diga: "Acho que já tenho uma boa ideia do que está rolando. Você pode explorar seu dashboard quando quiser."

Tom: curioso, humano, leve — como um amigo atento.
Idioma: português brasileiro informal.

Se receber "." como primeira mensagem, inicie com uma pergunta aberta como:
"Oi ${name}! O que fez você baixar o Anima?"`;
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
  const scrollRef = useRef<ScrollView>(null);
  const nameRef   = useRef('');

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

  const handleSend = async () => {
    if (!input.trim() || waiting) return;
    const userMsg: Message = { role: 'user', content: input.trim() };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setWaiting(true);
    try {
      const text = await callOllama(next, nameRef.current);
      setMessages(prev => [...prev, { role: 'assistant', content: text }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Ops, tive um problema. Pode tentar de novo?' }]);
    } finally {
      setWaiting(false);
    }
  };

  const handleComplete = async () => {
    setCompleting(true);
    try {
      const extracted = await extractProfile(messages, nameRef.current);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Não autenticado');

      const { data: catalog } = await supabase.from('pillar_catalog').select('id, name');
      const catalogMap = new Map((catalog ?? []).map(p => [norm(p.name), p]));

      const pillarRows = extracted.pillars.map((n: string, i: number) => ({
        user_id:    user.id,
        catalog_id: catalogMap.get(norm(n))?.id ?? null,
        name:       n,
        xp_rate:    1.0,
        sort_order: i,
      }));

      const { data: insertedPillars } = await supabase
        .from('user_pillars')
        .insert(pillarRows)
        .select('id, name');

      if (extracted.subPillars.length > 0 && insertedPillars) {
        const subRows = extracted.subPillars.map((sp: { name: string }, i: number) => ({
          user_id: user.id, catalog_id: null,
          name: sp.name, xp_rate: 1.0,
          sort_order: extracted.pillars.length + i,
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
              : <Text style={s.dashBtnText}>Explorar meu dashboard →</Text>
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
