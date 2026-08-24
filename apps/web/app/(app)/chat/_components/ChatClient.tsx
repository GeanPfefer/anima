'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import styles from './chat.module.css';
import { WorkProposalCard, type WorkPresentationView } from './WorkProposalCard';
import { WorkFocusChoice } from './WorkFocusChoice';
import { ProjectWorkPanel } from './ProjectWorkPanel';
import { groupWorkPresentationsBySource, replaceWorkPresentation } from './work-item-presentation';
import { findInterruptedTurn, type InterruptedTurn } from '@/lib/ai/chat-turn';

type Message = { id?: string; role: 'user' | 'assistant'; content: string };
type ChatProvider = 'openai' | 'ollama';
type PresentedItemReference = { workItemId: string; ordinal: number; role: 'active_item' | 'unresolved_failure' | 'review_item' | 'blocked_item' };

type ProposedLink = {
  childId:    string;
  childName:  string;
  parentId:   string | null;
  parentName: string;
};

type Props = {
  isFirstTime: boolean;
  userName:    string;
  // Superfície de autodesenvolvimento: só existe para quem o servidor autorizou
  // (allowlist dedicado). Ausente por padrão — o chat comum não a expõe.
  devAuthorized?: boolean;
};

export function ChatClient({ isFirstTime, userName, devAuthorized = false }: Props) {
  const router = useRouter();
  const [messages, setMessages]       = useState<Message[]>([]);
  const [input, setInput]             = useState('');
  const [loading, setLoading]         = useState(false);
  const [hydrating,setHydrating]      = useState(!isFirstTime);
  const [continuityError,setContinuityError] = useState(false);
  const [error, setError]             = useState('');
  const [isOnboarding, setIsOnboarding] = useState(isFirstTime);
  const [provider, setProvider]         = useState<ChatProvider>('openai');
  // Modo de autodesenvolvimento do Anima: OFF por padrão e NÃO persistido — ativar
  // é uma ação humana consciente por sessão. Só tem efeito para usuário autorizado.
  const [devMode, setDevMode]           = useState(false);
  const [pendingLinks, setPendingLinks] = useState<ProposedLink[]>([]);
  const [workItems, setWorkItems] = useState<Record<string, WorkPresentationView[]>>({});
  const [projectWorkItems,setProjectWorkItems]=useState<WorkPresentationView[]>([]);
  // UX-04 — cartões reencontrados por uma consulta de histórico, indexados pela
  // mensagem-gatilho. É uma projeção viva da consulta (reperguntar re-lista),
  // distinta do cartão criado por uma mensagem (workItems).
  const [historyCards, setHistoryCards] = useState<Record<string, WorkPresentationView[]>>({});
  const [focusedWorkItemId,setFocusedWorkItemId]=useState<string|null>(null);
  const [focusChoice,setFocusChoice]=useState<{sourceMessageId:string;candidates:readonly{id:string;summary:string}[]}|null>(null);
  // Turno interrompido/órfão (correção 3): mensagem do usuário sem resposta,
  // retryável. Reconstruído do servidor no reload e marcado ao falhar ao vivo.
  const [retryTurn, setRetryTurn] = useState<InterruptedTurn | null>(null);
  const bottomRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Id persistido da mensagem do usuário do turno em andamento (para retry idempotente).
  const lastSourceId = useRef<string | undefined>(undefined);
  // Proveniência conversacional efêmera: somente refs estruturadas do último
  // turno do Advisor, nunca texto/payload nem autorização em cache.
  const presentedItemReferences = useRef<readonly PresentedItemReference[]>([]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const saved = window.localStorage.getItem('anima-chat-provider');
    if (saved === 'openai' || saved === 'ollama') setProvider(saved);
  }, []);

  function selectProvider(next: ChatProvider) {
    if (loading) return;
    setProvider(next);
    window.localStorage.setItem('anima-chat-provider', next);
  }

  // Só o usuário autorizado alterna o modo. Ao ativar, fixa o provedor em GPT: o
  // planejador que investiga o repositório e produz o execution_spec de worktree é
  // exclusivamente OpenAI. Desativar volta ao chat pessoal comum.
  const devActive = devAuthorized && devMode;
  function toggleDevMode() {
    if (loading || !devAuthorized) return;
    const next = !devMode;
    setDevMode(next);
    if (next) selectProvider('openai');
  }

  // Carrega histórico persistido ao montar (evita reset ao trocar de aba)
  useEffect(() => {
    if (isOnboarding) {
      setHydrating(false);
      fetchOnboardingMessage([]);
      return;
    }
    fetch('/api/ai/history')
      .then(r => r.ok ? r.json() : [])
      .then(async (history: { id: string; role: string; content: string }[]) => {
        if (history.length > 0) {
          const loaded = history.map(m => ({
            id: m.id, role: m.role as 'user' | 'assistant',
            content: m.content,
          }));
          setMessages(loaded);
          // Reconstrói o estado do turno a partir do servidor: uma mensagem de
          // usuário sem resposta depois (após um reload durante a geração) é um
          // turno interrompido e retryável — nunca fica em silêncio indefinido.
          setRetryTurn(findInterruptedTurn(loaded));
          const userMessages = history.filter(message => message.role === 'user');
          const results = await Promise.all(userMessages.map(async message => {
            const response = await fetch(`/api/work-orchestration/items/by-source/${message.id}`);
            if (!response.ok) return [] as WorkPresentationView[];
            const body = await response.json(); return body.ok ? body.value as WorkPresentationView[] : [];
          }));
          setWorkItems(groupWorkPresentationsBySource(results.flat()));
        }
      })
      .catch(() => {setContinuityError(true);setError('Não foi possível reconstruir a conversa persistida. Recarregue antes de enviar uma nova mensagem.');})
      .finally(()=>setHydrating(false));
    fetch('/api/work-orchestration/focus').then(response=>response.ok?response.json():null).then(body=>{if(body?.ok)setFocusedWorkItemId(body.value)}).catch(()=>{});
    fetch('/api/work-orchestration/items').then(response=>response.ok?response.json():null).then(body=>{if(body?.ok&&Array.isArray(body.value))setProjectWorkItems(body.value as WorkPresentationView[])}).catch(()=>{});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchOnboardingMessage(msgs: Message[]) {
    setLoading(true);
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    try {
      const res = await fetch('/api/ai/onboarding', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: userName, messages: msgs }),
      });
      if (!res.ok || !res.body) throw new Error('Erro na API');

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let aiText    = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        aiText += decoder.decode(value, { stream: true });
        setMessages(prev => {
          const next = [...prev];
          next[next.length - 1] = { role: 'assistant', content: aiText };
          return next;
        });
      }
    } finally {
      setLoading(false);
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }

  // Falha de turno: mantém a mensagem do usuário (remove só o placeholder vazio
  // do assistente), avisa e marca o turno como retryável. Nunca perde a mensagem
  // nem inventa resposta.
  function markTurnFailed(e: unknown, content: string, id?: string) {
    void fetch('/api/ai/turns/abandon', { method: 'POST' });
    setError(e instanceof Error ? e.message : 'Erro ao conectar com a IA');
    setMessages(prev => (prev[prev.length - 1]?.role === 'assistant' && prev[prev.length - 1]?.content === '')
      ? prev.slice(0, -1)
      : prev);
    setRetryTurn(id ? { id, content } : { content });
  }

  async function send() {
    const text = input.trim();
    if (!text || loading || hydrating || continuityError) return;

    setInput('');
    setError('');
    setRetryTurn(null);
    lastSourceId.current = undefined;
    const newMessages: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);
    setLoading(true);
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    const isFirstUserMessage = newMessages.filter(m => m.role === 'user').length === 1;

    try {
      if (isOnboarding) {
        await streamOnboarding(newMessages);
        // Completa onboarding em background após a primeira resposta do usuário
        if (isFirstUserMessage) {
          fetch('/api/ai/complete-onboarding', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ messages: newMessages }),
          }).then(() => router.refresh()).catch(() => {});
          setIsOnboarding(false);
        }
      } else {
        await streamChat(text);
      }
    } catch (e) {
      markTurnFailed(e, text, lastSourceId.current);
    } finally {
      setLoading(false);
    }
  }

  // Retry idempotente: reenvia o MESMO turno pelo id persistido (retryMessageId),
  // sem criar uma segunda mensagem do usuário no servidor.
  async function retry() {
    if (loading || hydrating || continuityError || !retryTurn) return;
    const turn = retryTurn;
    setRetryTurn(null);
    setError('');
    setLoading(true);
    lastSourceId.current = turn.id;
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);
    try {
      await streamChat(turn.content, turn.id);
    } catch (e) {
      markTurnFailed(e, turn.content, turn.id);
    } finally {
      setLoading(false);
    }
  }

  async function streamOnboarding(msgs: Message[]) {
    const res = await fetch('/api/ai/onboarding', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name: userName, messages: msgs }),
    });
    if (!res.ok) throw new Error('Erro na resposta');
    await readStream(res);
  }

  async function streamChat(text: string, retryMessageId?: string) {
    // `developmentMode:true` só sai desta superfície dedicada e só para quem o
    // servidor autorizou; o chat pessoal comum nunca o envia. No modo dev o
    // provedor é sempre GPT (o planejador de worktree é OpenAI). O servidor
    // re-verifica a autorização — o cliente nunca habilita nada sozinho.
    const res = await fetch('/api/ai/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message: text, provider: devActive ? 'openai' : provider, ...(presentedItemReferences.current.length > 0 ? { presentedItemReferences: presentedItemReferences.current } : {}), ...(devActive ? { developmentMode: true } : {}), ...(retryMessageId ? { retryMessageId } : {}) }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Erro desconhecido' }));
      throw new Error(err.error ?? 'Erro na resposta');
    }
    const activityHeader = res.headers.get('X-Activity-Logged');
    const linksHeader    = res.headers.get('X-Pillar-Links');
    const sourceMessageId = res.headers.get('X-Source-Message-Id');
    const orchestrationHeader = res.headers.get('X-Work-Orchestration');
    const presentedItemsHeader = res.headers.get('X-Anima-Presented-Items');
    if (presentedItemsHeader) {
      try {
        const parsed = JSON.parse(decodeURIComponent(presentedItemsHeader)) as unknown;
        if (Array.isArray(parsed)) presentedItemReferences.current = parsed as PresentedItemReference[];
      } catch { /* metadado opcional inválido não substitui o último conjunto válido */ }
    }
    // Guarda o id persistido para um eventual retry idempotente deste turno.
    if (sourceMessageId) lastSourceId.current = sourceMessageId;
    if (sourceMessageId) setMessages(previous => previous.map((message, index) => index === previous.length - 2 && message.role === 'user' ? { ...message, id: sourceMessageId } : message));
    await readStream(res);
    if (linksHeader) {
      try {
        const links = JSON.parse(decodeURIComponent(linksHeader)) as ProposedLink[];
        setPendingLinks(prev => {
          const seen = new Set(prev.map(l => `${l.childId}|${l.parentName.toLowerCase()}`));
          return [...prev, ...links.filter(l => !seen.has(`${l.childId}|${l.parentName.toLowerCase()}`))];
        });
      } catch { /* header inválido, ignora */ }
    }
    if (activityHeader) router.refresh();
    if (orchestrationHeader) {
      try {
        const metadata = JSON.parse(decodeURIComponent(orchestrationHeader)) as { kind: string; sourceMessageId: string; workItemId?:string; presentation?: WorkPresentationView; presentations?: WorkPresentationView[]; candidates?:{id:string;summary:string}[]; question?: { question: string }; error?: { code: string; message: string }; reason?: string };
        if (metadata.presentation) {setWorkItems(previous => ({ ...previous, [metadata.sourceMessageId]: replaceWorkPresentation(previous[metadata.sourceMessageId]??[],metadata.presentation!) }));setProjectWorkItems(previous=>replaceWorkPresentation(previous,metadata.presentation!));setFocusedWorkItemId(metadata.presentation.item.id);}
        // UX-04 — a consulta de histórico devolve a lista reconstruída; renderiza
        // os cartões abaixo da mensagem-gatilho, cada um com as ações reais.
        if (metadata.kind === 'work_history' && metadata.presentations) setHistoryCards(previous => ({ ...previous, [metadata.sourceMessageId]: metadata.presentations! }));
        if (metadata.kind === 'clarification_required' && metadata.question) setMessages(previous => [...previous, { role: 'assistant', content: metadata.question!.question }]);
        if (metadata.kind === 'work_error') setError(`Não foi possível registrar o trabalho desta mensagem: ${metadata.error?.message ?? 'erro desconhecido'}. Você pode tentar novamente.`);
        // Capacidade ausente, dita pelo servidor (não pelo texto do modelo): sem
        // Orquestração habilitada, nenhuma proposta foi criada — e o cartão não existe.
        if(metadata.kind==='focus_confirmation_required'&&metadata.candidates){setMessages(previous=>[...previous,{role:'assistant',content:'A qual trabalho você se refere? Escolha abaixo para eu associar sua mensagem ao item certo.'}]);setFocusChoice({sourceMessageId:metadata.sourceMessageId,candidates:metadata.candidates});}
      } catch { /* metadado opcional inválido não interrompe o chat */ }
    }
  }

  async function applyLink(link: ProposedLink) {
    const body = link.parentId
      ? { childId: link.childId, parentId: link.parentId }
      : { childId: link.childId, parentName: link.parentName };
    const res = await fetch('/api/pillars/link', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    }).catch(() => null);
    setPendingLinks(prev => prev.filter(l => l !== link));
    if (res?.ok) router.refresh();
  }

  function dismissLink(link: ProposedLink) {
    setPendingLinks(prev => prev.filter(l => l !== link));
  }

  async function readStream(res: Response) {
    const reader  = res.body!.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      setMessages(prev => {
        const updated = [...prev];
        const last    = updated[updated.length - 1];
        updated[updated.length - 1] = {
          role:    'assistant',
          content: (last?.content ?? '') + chunk,
        };
        return updated;
      });
    }
  }

  async function clearHistory() {
    if(loading)return;
    if (!confirm('Arquivar esta conversa e iniciar uma nova? O histórico será preservado.')) return;
    const response = await fetch('/api/ai/history', { method: 'DELETE' });
    if (!response.ok) { const body = await response.json().catch(() => ({})); setError(body.error ?? 'Não foi possível arquivar esta conversa.'); return; }
    setMessages([]);
    setWorkItems({});
    setHistoryCards({});
    setFocusChoice(null);
    setError('');
  }

  async function reopenPreviousConversation(){
    if(loading)return;
    setLoading(true);setError('');
    try{
      const response=await fetch('/api/ai/history',{method:'POST'});
      if(!response.ok){const body=await response.json().catch(()=>({}));setError(body.error??'Não foi possível retomar a conversa.');return;}
      window.location.reload();
    }finally{setLoading(false);}
  }

  async function focusWork(workItemId:string){const response=await fetch('/api/work-orchestration/focus',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workItemId})});if(response.ok)setFocusedWorkItemId(workItemId);else setError('Não foi possível alterar o trabalho em foco.');}

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const isTyping = loading && messages.at(-1)?.content === '';

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Anima IA</h1>
          <p className={styles.subtitle}>
            {isOnboarding
              ? 'Primeira conversa — conte o que está acontecendo na sua vida'
              : 'Seu assistente pessoal — conhece seus pilares e histórico'}
          </p>
        </div>
        <div className={styles.headerActions}>
          {devAuthorized && !isOnboarding && (
            <button
              type="button"
              className={devActive ? styles.devToggleActive : styles.devToggle}
              disabled={loading}
              aria-pressed={devActive}
              onClick={toggleDevMode}
              title="Desenvolvimento do próprio Anima: neste modo suas mensagens podem gerar propostas de alteração no projeto. Nada é executado sem sua aprovação."
            >
              {devActive ? '● Dev do Anima' : 'Dev do Anima'}
            </button>
          )}
          {!isOnboarding && (
            <div className={styles.providerPicker} aria-label="Provedor de inteligência">
              <button
                type="button"
                className={provider === 'openai' ? styles.providerActive : undefined}
                disabled={loading}
                onClick={() => selectProvider('openai')}
                title="Usa a API da OpenAI; envia a conversa e o contexto relevante do Anima"
              >
                GPT
              </button>
              <button
                type="button"
                className={provider === 'ollama' ? styles.providerActive : undefined}
                disabled={loading}
                onClick={() => selectProvider('ollama')}
                title="Processamento local pelo Ollama; não envia a conversa à OpenAI"
              >
                Local
              </button>
            </div>
          )}
          {messages.length > 0 && !isOnboarding && (
            <button className={styles.clearBtn} disabled={loading} onClick={clearHistory} title="Arquivar conversa atual">
              Nova conversa
            </button>
          )}
        </div>
      </div>

      {devActive && (
        <div className={styles.devBanner} role="status">
          <strong>Modo desenvolvimento do Anima ativo.</strong> Suas mensagens aqui
          podem virar propostas de alteração no próprio projeto, planejadas pelo GPT
          sobre o código real. Nada é executado sem a sua aprovação — a execução
          autônoma continua sendo uma ação separada, no cartão do trabalho.
        </div>
      )}

      <div className={styles.messages}>
        <ProjectWorkPanel items={projectWorkItems} focusedWorkItemId={focusedWorkItemId} onFocus={focusWork} onChange={updated=>setProjectWorkItems(previous=>replaceWorkPresentation(previous,updated))}/>
        {messages.length === 0 && !isOnboarding && (
          <div className={styles.empty}>
            <p className={styles.emptyIcon}>🧠</p>
            <p className={styles.emptyText}>Como posso te ajudar hoje?</p>
            <button className={styles.suggestion} disabled={loading} onClick={reopenPreviousConversation}>Retomar conversa anterior</button>
            <div className={styles.suggestions}>
              {[
                'Como estão meus pilares?',
                'Qual pilar devo focar esta semana?',
                'O que tenho registrado recentemente?',
              ].map((s) => (
                <button
                  key={s}
                  className={styles.suggestion}
                  onClick={() => { setInput(s); textareaRef.current?.focus(); }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={m.id ?? i} className={`${styles.message} ${styles[m.role]}`}>
            <div className={styles.bubble}>
              {m.role === 'assistant' && m.content === '' && isTyping
                ? <span className={styles.typingDots}><span /><span /><span /></span>
                : m.role === 'assistant'
                  ? <ReactMarkdown>{m.content}</ReactMarkdown>
                  : m.content
              }
            </div>
            {m.role === 'user' && m.id && workItems[m.id]?.map(view => <WorkProposalCard key={view.item.id} presentation={view} focused={focusedWorkItemId===view.item.id} onFocus={()=>focusWork(view.item.id)} onChange={presentation => setWorkItems(previous => ({ ...previous, [m.id!]: replaceWorkPresentation(previous[m.id!]??[],presentation) }))} />)}
            {m.role === 'user' && m.id && historyCards[m.id]?.length ? historyCards[m.id]!.map((view, index) => <WorkProposalCard key={view.item.id} presentation={view} focused={focusedWorkItemId===view.item.id} onFocus={()=>focusWork(view.item.id)} onChange={updated => setHistoryCards(previous => ({ ...previous, [m.id!]: previous[m.id!]!.map((existing, position) => position === index ? updated : existing) }))} />) : null}
          </div>
        ))}

        {pendingLinks.length > 0 && (
          <div className={styles.linkCards}>
            {pendingLinks.map((link, i) => (
              <div key={`${link.childId}-${i}`} className={styles.linkCard}>
                <span className={styles.linkLabel}>Agrupar pilares</span>
                <p className={styles.linkText}>
                  Quer que <strong>{link.childName}</strong> faça parte de <strong>{link.parentName}</strong>
                  {link.parentId === null && <em> (novo pilar)</em>}?
                </p>
                <div className={styles.linkActions}>
                  <button className={styles.linkYes} onClick={() => applyLink(link)}>Sim</button>
                  <button className={styles.linkNo}  onClick={() => dismissLink(link)}>Não</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {focusChoice && (
          <WorkFocusChoice
            sourceMessageId={focusChoice.sourceMessageId}
            candidates={focusChoice.candidates}
            onResolved={(workItemId, summary) => {
              setFocusedWorkItemId(workItemId);
              setFocusChoice(null);
              setMessages(previous => [...previous, { role: 'assistant', content: `Foco definido: ${summary}. Sua mensagem foi associada a este trabalho.` }]);
            }}
            onDismiss={() => setFocusChoice(null)}
          />
        )}

        {error && <p className={styles.error}>{error}</p>}
        {retryTurn && !loading && (
          <button className={styles.suggestion} onClick={retry} aria-label="Tentar responder novamente">
            Tentar responder de novo
          </button>
        )}
        <div ref={bottomRef} />
      </div>

      <div className={styles.inputArea}>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isOnboarding
            ? 'Escreva aqui… (Enter para enviar)'
            : 'Digite uma mensagem… (Enter para enviar, Shift+Enter para nova linha)'}
          rows={2}
          disabled={loading||hydrating||continuityError}
        />
        <button className={styles.sendBtn} onClick={send} disabled={loading || hydrating || continuityError || !input.trim()}>
          ↑
        </button>
      </div>
    </div>
  );
}
