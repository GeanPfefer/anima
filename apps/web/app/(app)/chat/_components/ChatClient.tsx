'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import styles from './chat.module.css';
import { WorkProposalCard, type WorkPresentationView } from './WorkProposalCard';
import { WorkFocusChoice } from './WorkFocusChoice';

type Message = { id?: string; role: 'user' | 'assistant'; content: string };

type ProposedLink = {
  childId:    string;
  childName:  string;
  parentId:   string | null;
  parentName: string;
};

type Props = {
  isFirstTime: boolean;
  userName:    string;
};

export function ChatClient({ isFirstTime, userName }: Props) {
  const router = useRouter();
  const [messages, setMessages]       = useState<Message[]>([]);
  const [input, setInput]             = useState('');
  const [loading, setLoading]         = useState(false);
  const [hydrating,setHydrating]      = useState(!isFirstTime);
  const [continuityError,setContinuityError] = useState(false);
  const [error, setError]             = useState('');
  const [isOnboarding, setIsOnboarding] = useState(isFirstTime);
  const [pendingLinks, setPendingLinks] = useState<ProposedLink[]>([]);
  const [workItems, setWorkItems] = useState<Record<string, WorkPresentationView>>({});
  const [focusedWorkItemId,setFocusedWorkItemId]=useState<string|null>(null);
  const [focusChoice,setFocusChoice]=useState<{sourceMessageId:string;candidates:readonly{id:string;summary:string}[]}|null>(null);
  const bottomRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
          setMessages(history.map(m => ({
            id: m.id, role: m.role as 'user' | 'assistant',
            content: m.content,
          })));
          const userMessages = history.filter(message => message.role === 'user');
          const results = await Promise.all(userMessages.map(async message => {
            const response = await fetch(`/api/work-orchestration/items/by-source/${message.id}`);
            if (!response.ok) return [] as WorkPresentationView[];
            const body = await response.json(); return body.ok ? body.value as WorkPresentationView[] : [];
          }));
          setWorkItems(Object.fromEntries(results.flat().map(value => [value.item.sourceMessageId, value])));
        }
      })
      .catch(() => {setContinuityError(true);setError('Não foi possível reconstruir a conversa persistida. Recarregue antes de enviar uma nova mensagem.');})
      .finally(()=>setHydrating(false));
    fetch('/api/work-orchestration/focus').then(response=>response.ok?response.json():null).then(body=>{if(body?.ok)setFocusedWorkItemId(body.value)}).catch(()=>{});
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

  async function send() {
    const text = input.trim();
    if (!text || loading || hydrating || continuityError) return;

    setInput('');
    setError('');
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
      void fetch('/api/ai/turns/abandon',{method:'POST'});
      setError(e instanceof Error ? e.message : 'Erro ao conectar com a IA');
      setMessages(prev => prev.slice(0, -1));
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

  async function streamChat(text: string) {
    const res = await fetch('/api/ai/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message: text }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Erro desconhecido' }));
      throw new Error(err.error ?? 'Erro na resposta');
    }
    const activityHeader = res.headers.get('X-Activity-Logged');
    const linksHeader    = res.headers.get('X-Pillar-Links');
    const sourceMessageId = res.headers.get('X-Source-Message-Id');
    const orchestrationHeader = res.headers.get('X-Work-Orchestration');
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
        const metadata = JSON.parse(decodeURIComponent(orchestrationHeader)) as { kind: string; sourceMessageId: string; workItemId?:string; presentation?: WorkPresentationView; candidates?:{id:string;summary:string}[]; question?: { question: string }; error?: { code: string; message: string }; reason?: string };
        if (metadata.presentation) {setWorkItems(previous => ({ ...previous, [metadata.sourceMessageId]: metadata.presentation! }));setFocusedWorkItemId(metadata.presentation.item.id);}
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
        {messages.length > 0 && !isOnboarding && (
          <button className={styles.clearBtn} disabled={loading} onClick={clearHistory} title="Arquivar conversa atual">
            Nova conversa
          </button>
        )}
      </div>

      <div className={styles.messages}>
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
            {m.role === 'user' && m.id && workItems[m.id] && <WorkProposalCard presentation={workItems[m.id]!} focused={focusedWorkItemId===workItems[m.id]!.item.id} onFocus={()=>focusWork(workItems[m.id!]!.item.id)} onChange={presentation => setWorkItems(previous => ({ ...previous, [m.id!]: presentation }))} />}
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
