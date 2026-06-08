'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { saveName, completeOnboarding } from './actions';
import styles from './welcome.module.css';

type Message = { role: 'user' | 'assistant'; content: string };
type Phase = 'name' | 'chat';

export default function WelcomePage() {
  const router = useRouter();
  const [phase, setPhase]           = useState<Phase>('name');
  const [nameVal, setNameVal]       = useState('');
  const [messages, setMessages]     = useState<Message[]>([]);
  const [input, setInput]           = useState('');
  const [streaming, setStreaming]   = useState(false);
  const [completing, setCompleting] = useState(false);
  const [showDashBtn, setShowDashBtn] = useState(false);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLTextAreaElement>(null);
  const nameRef    = useRef('');

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  const streamResponse = async (msgs: Message[], currentName: string) => {
    setStreaming(true);
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    try {
      const res = await fetch('/api/ai/onboarding', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: currentName, messages: msgs }),
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
      setStreaming(false);
      setShowDashBtn(true);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const handleNameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = nameVal.trim();
    if (!name) return;
    nameRef.current = name;
    await saveName(name);
    setPhase('chat');
    // Mensagens vazias → IA inicia a conversa
    await streamResponse([], name);
  };

  const handleSend = async () => {
    if (!input.trim() || streaming) return;
    const userMsg: Message = { role: 'user', content: input.trim() };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    await streamResponse(next, nameRef.current);
  };

  const handleComplete = async () => {
    setCompleting(true);
    try {
      await completeOnboarding(messages);
      router.replace('/home');
    } catch {
      setCompleting(false);
    }
  };

  /* ── Fase nome ──────────────────────────────────────────── */
  if (phase === 'name') {
    return (
      <div className={styles.namePhase}>
        <div className={styles.nameCard}>
          <h1 className={styles.logo}>Anima</h1>
          <p className={styles.nameSub}>Uma memória viva da sua vida.</p>

          <div className={styles.pillarsPreview}>
            <p className={styles.pillarsLabel}>O que o Anima aprende a rastrear</p>
            <div className={styles.pillarsChips}>
              {['Trabalho', 'Saúde', 'Relações', 'Mente', 'Lazer', 'Finanças', 'Propósito'].map(p => (
                <span key={p} className={styles.pillarsChip}>{p}</span>
              ))}
            </div>
            <p className={styles.pillarsHint}>detectado pela IA · você não configura nada</p>
          </div>

          <form onSubmit={handleNameSubmit} className={styles.nameForm}>
            <input
              className={styles.nameInput}
              type="text"
              placeholder="Como posso te chamar?"
              value={nameVal}
              onChange={e => setNameVal(e.target.value)}
              autoFocus
              maxLength={50}
            />
            <button className={styles.nameBtn} type="submit" disabled={!nameVal.trim()}>
              Começar →
            </button>
          </form>
        </div>
      </div>
    );
  }

  /* ── Fase conversa ──────────────────────────────────────── */
  return (
    <div className={styles.chatPhase}>
      <div className={styles.messages}>
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? styles.userMsg : styles.aiMsg}>
            <p className={styles.msgText}>{m.content}</p>
          </div>
        ))}
        {streaming && (messages.length === 0 || messages[messages.length - 1]?.role === 'user') && (
          <div className={styles.aiMsg}>
            <div className={styles.dots}><span /><span /><span /></div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className={styles.footer}>
        {showDashBtn && (
          <button
            className={styles.dashBtn}
            onClick={handleComplete}
            disabled={completing || streaming}
          >
            {completing ? 'Preparando seu espaço…' : 'Explorar meu dashboard →'}
          </button>
        )}
        <div className={styles.inputRow}>
          <textarea
            ref={inputRef}
            className={styles.chatInput}
            placeholder="Escreva aqui…"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            rows={1}
            disabled={streaming}
          />
          <button
            className={styles.sendBtn}
            onClick={handleSend}
            disabled={!input.trim() || streaming}
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}
