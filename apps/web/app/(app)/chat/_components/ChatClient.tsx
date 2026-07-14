'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import styles from './chat.module.css';

type Persona = 'anima' | 'prisma';

type Message = { role: 'user' | 'assistant'; content: string; persona?: Persona };

type ProposedLink = {
  childId:    string;
  childName:  string;
  parentId:   string | null;
  parentName: string;
};

type IdentityProbe = {
  id:          string;
  type:        string;
  label:       string;
  description: string | null;
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
  const [error, setError]             = useState('');
  const [isOnboarding, setIsOnboarding] = useState(isFirstTime);
  const [pendingLinks, setPendingLinks] = useState<ProposedLink[]>([]);
  const [pendingProbes, setPendingProbes] = useState<IdentityProbe[]>([]);
  const bottomRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Carrega histórico persistido ao montar (evita reset ao trocar de aba)
  useEffect(() => {
    if (isOnboarding) {
      fetchOnboardingMessage([]);
      return;
    }
    fetch('/api/ai/history')
      .then(r => r.ok ? r.json() : [])
      .then((history: { role: string; content: string }[]) => {
        if (history.length > 0) {
          setMessages(history.map(m => ({
            role:    m.role as 'user' | 'assistant',
            content: m.content,
          })));
        }
      })
      .catch(() => {});
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
    if (!text || loading) return;

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
    const persona        = (res.headers.get('X-Persona') as Persona | null) ?? 'anima';
    const probeHeader    = res.headers.get('X-Identity-Probe');

    // Marca a bolha em streaming com a persona antes de receber o texto
    setMessages(prev => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === 'assistant') next[next.length - 1] = { ...last, persona };
      return next;
    });

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
    if (probeHeader) {
      try {
        const probe = JSON.parse(decodeURIComponent(probeHeader)) as IdentityProbe;
        setPendingProbes(prev => prev.some(p => p.id === probe.id) ? prev : [...prev, probe]);
      } catch { /* header inválido, ignora */ }
    }
    if (activityHeader) router.refresh();
  }

  async function resolveProbe(probe: IdentityProbe, status: 'confirmed' | 'rejected' | 'pending') {
    setPendingProbes(prev => prev.filter(p => p.id !== probe.id));
    // "Ainda não sei" só dispensa o card — a hipótese segue pendente
    if (status === 'pending') return;
    await fetch('/api/identity/status', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id: probe.id, status }),
    }).catch(() => {});
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
          ...last,
          role:    'assistant',
          content: (last?.content ?? '') + chunk,
        };
        return updated;
      });
    }
  }

  async function clearHistory() {
    if (!confirm('Limpar todo o histórico de conversa?')) return;
    await fetch('/api/ai/history', { method: 'DELETE' });
    setMessages([]);
    setError('');
  }

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
              : 'Anima registra e organiza · escreva @prisma para refletir'}
          </p>
        </div>
        {messages.length > 0 && !isOnboarding && (
          <button className={styles.clearBtn} onClick={clearHistory} title="Limpar histórico">
            Limpar
          </button>
        )}
      </div>

      <div className={styles.messages}>
        {messages.length === 0 && !isOnboarding && (
          <div className={styles.empty}>
            <p className={styles.emptyIcon}>🧠</p>
            <p className={styles.emptyText}>Como posso te ajudar hoje?</p>
            <div className={styles.suggestions}>
              {[
                'Como estão meus pilares?',
                'O que tenho registrado recentemente?',
                '@prisma o que você percebe em mim?',
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
          <div key={i} className={`${styles.message} ${styles[m.role]}`}>
            <div className={styles.bubbleWrap}>
              {m.role === 'assistant' && m.persona === 'prisma' && (
                <span className={styles.personaPrisma}>🟣 Prisma</span>
              )}
              <div className={styles.bubble}>
                {m.role === 'assistant' && m.content === '' && isTyping
                  ? <span className={styles.typingDots}><span /><span /><span /></span>
                  : m.role === 'assistant'
                    ? <ReactMarkdown>{m.content}</ReactMarkdown>
                    : m.content
                }
              </div>
            </div>
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

        {pendingProbes.length > 0 && (
          <div className={styles.linkCards}>
            {pendingProbes.map((probe) => (
              <div key={probe.id} className={`${styles.linkCard} ${styles.probeCard}`}>
                <span className={`${styles.linkLabel} ${styles.probeLabel}`}>🟣 Prisma · faz sentido?</span>
                <p className={styles.linkText}>{probe.description || probe.label}</p>
                <div className={styles.linkActions}>
                  <button className={styles.linkYes} onClick={() => resolveProbe(probe, 'confirmed')}>Faz sentido</button>
                  <button className={styles.linkNo}  onClick={() => resolveProbe(probe, 'rejected')}>Não faz</button>
                  <button className={styles.linkNo}  onClick={() => resolveProbe(probe, 'pending')}>Ainda não sei</button>
                </div>
              </div>
            ))}
          </div>
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
          disabled={loading}
        />
        <button className={styles.sendBtn} onClick={send} disabled={loading || !input.trim()}>
          ↑
        </button>
      </div>
    </div>
  );
}
