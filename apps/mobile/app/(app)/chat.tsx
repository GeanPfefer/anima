import { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/hooks/use-auth';
import {
  loadHistory,
  sendChatMessage,
  clearHistory,
  getOnboardingGreeting,
  type ChatMessage,
} from '@/lib/mobile-chat';
import { colors, spacing, radius } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import type { WorkPresentation } from '@anima/core';
import { MobileWorkCard } from '@/components/MobileWorkCard';
import { confirmWorkFocus, getWorkFocus, loadWorkItems, setWorkFocus } from '@/lib/mobile-work';

export default function ChatScreen() {
  const insets  = useSafeAreaInsets();
  const { session } = useAuth();
  const userId  = session?.user?.id ?? null;

  const [messages,         setMessages]         = useState<ChatMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [input,            setInput]            = useState('');
  const [isStreaming,      setIsStreaming]       = useState(false);
  const [loading,          setLoading]          = useState(true);
  const [workItems,        setWorkItems]        = useState<Record<string,WorkPresentation>>({});
  // UX-04 — cartões reencontrados por uma consulta de histórico, indexados pela
  // mensagem-gatilho. Consulta viva (reperguntar re-lista), independente da
  // conversa original estar ativa; distinta de workItems (cartão de uma mensagem).
  const [historyCards,     setHistoryCards]     = useState<Record<string,WorkPresentation[]>>({});
  const [focusedWorkItemId, setFocusedWorkItemId] = useState<string | null>(null);
  const [focusChoice, setFocusChoice] = useState<{ sourceMessageId: string; candidates: readonly { id: string; summary: string }[] } | null>(null);

  const listRef = useRef<FlatList<ChatMessage | { role: 'streaming'; content: string }>>(null);

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      setLoading(true);
      loadHistory(userId)
        .then(async (history) => {
          if (history.length === 0) {
            const greeting = await getOnboardingGreeting(userId);
            if (greeting) {
              setMessages([{ role: 'assistant', content: greeting }]);
            } else {
              setMessages([]);
            }
          } else {
            setMessages(history);
            setWorkItems(await loadWorkItems(history.flatMap(message=>message.role==='user'&&message.id?[message.id]:[])));
            setFocusedWorkItemId(await getWorkFocus().catch(() => null));
          }
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }, [userId]),
  );

  function scrollToBottom() {
    listRef.current?.scrollToEnd({ animated: true });
  }

  async function handleSend() {
    if (!userId || !input.trim() || isStreaming) return;

    const text        = input.trim();
    const userMessage: ChatMessage = { role: 'user', content: text };
    const history     = [...messages, userMessage];

    setMessages(history);
    setInput('');
    setIsStreaming(true);
    setStreamingContent('');
    setTimeout(scrollToBottom, 50);

    try {
      const routing = await sendChatMessage(userId, text, messages, (token) => {
        setStreamingContent(prev => {
          setTimeout(scrollToBottom, 10);
          return prev + token;
        });
      });

      // After streaming: reload history to get the saved assistant message
      const updated = await loadHistory(userId);
      if (routing?.kind === 'focus_confirmation_required') {
        updated.push({ role: 'assistant', content: 'A qual trabalho você se refere? Escolha abaixo para eu associar sua mensagem ao item certo.' });
        setFocusChoice({ sourceMessageId: routing.sourceMessageId, candidates: routing.candidates });
      }
      if (routing?.kind === 'error') {
        updated.push({ role: 'assistant', content: `Não foi possível registrar o trabalho desta mensagem: ${routing.message} Você pode tentar novamente.` });
      }
      if (routing?.kind === 'proposal' || routing?.kind === 'continued') {
        setFocusedWorkItemId(routing.kind === 'proposal' ? routing.presentation.item.id : routing.workItemId);
      }
      if (routing?.kind === 'history') {
        const triggerId = [...updated].reverse().find(message => message.role === 'user')?.id;
        if (triggerId) setHistoryCards(previous => ({ ...previous, [triggerId]: [...routing.presentations] }));
      }
      setMessages(updated);
      setWorkItems(await loadWorkItems(updated.flatMap(message=>message.role==='user'&&message.id?[message.id]:[])));
      setStreamingContent('');
    } catch (err) {
      void supabase.rpc('abandon_current_conversation_turn');
      const isTimeout     = err instanceof Error && err.message === 'timeout';
      const isPersistence = err instanceof Error && err.message === 'persistence';
      const msg = isTimeout
        ? 'O Anima está demorando muito para responder. O Ollama pode estar ocupado — tente novamente em alguns instantes.'
        : isPersistence
          ? 'Sua mensagem não pôde ser salva e nada foi enviado. Verifique a conexão com o servidor e tente novamente.'
          : 'Não foi possível conectar ao Anima. Verifique se o Ollama está rodando em ' + (process.env.EXPO_PUBLIC_OLLAMA_URL ?? 'http://100.68.239.78:11434');
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: msg },
      ]);
      setStreamingContent('');
    } finally {
      setIsStreaming(false);
      setTimeout(scrollToBottom, 100);
    }
  }

  function handleClear() {
    if (!userId) return;
    Alert.alert('Nova conversa', 'Arquivar esta conversa e iniciar uma nova? O histórico será preservado.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Arquivar',
        onPress: () => {
          clearHistory(userId)
            .then(() => {
              setMessages([]);
              setWorkItems({});
              setHistoryCards({});
              setStreamingContent('');
            })
            .catch(() => Alert.alert('Arquivamento indisponível', 'Há uma resposta em andamento ou a conexão falhou. A conversa atual foi preservada.'));
        },
      },
    ]);
  }

  type ListItem = ChatMessage | { role: 'streaming'; content: string };

  const listData: ListItem[] = [
    ...messages,
    ...(isStreaming && streamingContent ? [{ role: 'streaming' as const, content: streamingContent }] : []),
  ];

  function renderItem({ item }: { item: ListItem }) {
    const isUser      = item.role === 'user';
    const isStreamed   = item.role === 'streaming';
    const isAssistant = item.role === 'assistant' || isStreamed;

    return (
      <View style={styles.messageContainer}><View style={[styles.messageRow, isUser ? styles.messageRowUser : styles.messageRowAssistant]}>
        {isAssistant && (
          <View style={styles.avatarDot} />
        )}
        <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
          <Text style={[styles.bubbleText, isUser ? styles.bubbleTextUser : styles.bubbleTextAssistant]}>
            {item.content}
            {isStreamed && <Text style={styles.cursor}>▋</Text>}
          </Text>
        </View>
      </View>{isUser&&'id' in item&&item.id&&workItems[item.id]&&<MobileWorkCard presentation={workItems[item.id]!} focused={focusedWorkItemId===workItems[item.id]!.item.id} onFocus={()=>{const target=workItems[item.id!]!.item.id;setWorkFocus(target).then(()=>setFocusedWorkItemId(target)).catch(()=>Alert.alert('Foco indisponível','Não foi possível alterar o trabalho em foco. Tente novamente.'));}} onChange={next=>setWorkItems(previous=>({...previous,[item.id!]:next}))}/>}
      {isUser&&'id' in item&&item.id&&historyCards[item.id]?.length?historyCards[item.id]!.map((view,index)=><MobileWorkCard key={view.item.id} presentation={view} focused={focusedWorkItemId===view.item.id} onFocus={()=>{const target=view.item.id;setWorkFocus(target).then(()=>setFocusedWorkItemId(target)).catch(()=>Alert.alert('Foco indisponível','Não foi possível alterar o trabalho em foco. Tente novamente.'));}} onChange={next=>setHistoryCards(previous=>({...previous,[item.id!]:previous[item.id!]!.map((existing,position)=>position===index?next:existing)}))}/>):null}</View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={insets.top}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Anima</Text>
        <TouchableOpacity disabled={isStreaming} onPress={handleClear} style={styles.clearBtn}>
          <Text style={styles.clearBtnText}>Nova conversa</Text>
        </TouchableOpacity>
      </View>

      {/* Messages */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={listData}
          keyExtractor={(_, i) => String(i)}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={scrollToBottom}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>Anima</Text>
              <Text style={styles.emptyText}>
                O que está acontecendo na sua vida?
              </Text>
            </View>
          }
        />
      )}

      {/* Escolha de foco quando a referência é ambígua */}
      {focusChoice && (
        <View style={styles.focusChoice}>
          <Text style={styles.focusChoiceTitle}>A qual trabalho você se refere?</Text>
          {focusChoice.candidates.map(candidate => (
            <TouchableOpacity
              key={candidate.id}
              style={styles.focusChoiceOption}
              onPress={() => {
                confirmWorkFocus(candidate.id, focusChoice.sourceMessageId)
                  .then(() => {
                    setFocusedWorkItemId(candidate.id);
                    setFocusChoice(null);
                    setMessages(prev => [...prev, { role: 'assistant', content: `Foco definido: ${candidate.summary}. Sua mensagem foi associada a este trabalho.` }]);
                  })
                  .catch(() => Alert.alert('Foco indisponível', 'Não foi possível associar sua mensagem a este trabalho. Escolha novamente ou tente mais tarde.'));
              }}
            >
              <Text style={styles.focusChoiceOptionText}>{candidate.summary}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity onPress={() => setFocusChoice(null)}>
            <Text style={styles.focusChoiceDismiss}>Nenhum destes</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Input */}
      <View style={[styles.inputRow, { paddingBottom: insets.bottom + spacing.sm }]}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Escreva algo…"
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={2000}
          onSubmitEditing={handleSend}
          returnKeyType="send"
          blurOnSubmit
          editable={!isStreaming}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!input.trim() || isStreaming) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!input.trim() || isStreaming}
        >
          {isStreaming
            ? <ActivityIndicator size="small" color={colors.textMuted} />
            : <Text style={styles.sendBtnText}>↑</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  clearBtn: {
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
  },
  clearBtnText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
    flexGrow: 1,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  messageContainer: { gap: spacing.xs },
  messageRowUser: {
    justifyContent: 'flex-end',
  },
  messageRowAssistant: {
    justifyContent: 'flex-start',
  },
  avatarDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
    marginBottom: 6,
    flexShrink: 0,
  },
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  bubbleUser: {
    backgroundColor: colors.accent,
    borderBottomRightRadius: 3,
  },
  bubbleAssistant: {
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 3,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 22,
  },
  bubbleTextUser: {
    color: '#fff',
  },
  bubbleTextAssistant: {
    color: colors.textPrimary,
  },
  cursor: {
    color: colors.accent,
    opacity: 0.8,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: 80,
    gap: spacing.sm,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  emptyText: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
  focusChoice: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.bgSurface,
    gap: spacing.xs,
  },
  focusChoiceTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  focusChoiceOption: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.bgElevated,
  },
  focusChoiceOptionText: {
    fontSize: 13,
    color: colors.textPrimary,
  },
  focusChoiceDismiss: {
    fontSize: 12,
    color: colors.textMuted,
    paddingVertical: 4,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  input: {
    flex: 1,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.textPrimary,
    maxHeight: 120,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: colors.bgElevated,
  },
  sendBtnText: {
    fontSize: 18,
    color: '#fff',
    fontWeight: '700',
  },
});
