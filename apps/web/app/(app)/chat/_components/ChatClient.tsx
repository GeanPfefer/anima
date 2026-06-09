'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import styles from './chat.module.css';

type Message = { role: 'user' | 'assistant'; content: string };

export function ChatClient() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const bottomRef    = useRef<HTMLDivElement>(null);
  const textareaRef  = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    setError('');
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setLoading(true);

    // Placeholder vazio — cursor piscando aparece enquanto content === ''
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro desconhecido' }));
        throw new Error(err.error ?? 'Erro na resposta');
      }

      const activityHeader = res.headers.get('X-Activity-Logged');
      const reader  = res.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          updated[updated.length - 1] = {
            role: 'assistant',
            content: (last?.content ?? '') + chunk,
          };
          return updated;
        });
      }

      // Atualiza XP e histórico no dashboard se alguma atividade foi registrada
      if (activityHeader) {
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao conectar com a IA');
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setLoading(false);
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
          <p className={styles.subtitle}>Seu assistente pessoal — conhece seus pilares e histórico</p>
        </div>
        {messages.length > 0 && (
          <button className={styles.clearBtn} onClick={clearHistory} title="Limpar histórico">
            Limpar
          </button>
        )}
      </div>

      <div className={styles.messages}>
        {messages.length === 0 && (
          <div className={styles.empty}>
            <p className={styles.emptyIcon}>🧠</p>
            <p className={styles.emptyText}>Como posso te ajudar hoje?</p>
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
          <div key={i} className={`${styles.message} ${styles[m.role]}`}>
            <div className={styles.bubble}>
              {/* Indicador de digitação: cursor piscando enquanto a IA não começou a responder */}
              {m.role === 'assistant' && m.content === '' && isTyping
                ? <span className={styles.typingDots}><span /><span /><span /></span>
                : m.role === 'assistant'
                  ? <ReactMarkdown>{m.content}</ReactMarkdown>
                  : m.content
              }
            </div>
          </div>
        ))}

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
          placeholder="Digite uma mensagem... (Enter para enviar, Shift+Enter para nova linha)"
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
