'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { logPulso } from '../actions';
import styles from './PulsoWidget.module.css';

export default function PulsoWidget() {
  const router               = useRouter();
  const [text, setText]      = useState('');
  const [saving, setSaving]  = useState(false);
  const [saved, setSaved]    = useState(false);
  const [pillar, setPillar]  = useState('');
  const textareaRef          = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    try {
      const { pillarName, recordId } = await logPulso(text);
      setPillar(pillarName);
      setSaved(true);
      setText('');

      // Processamento semântico fire-and-forget
      if (recordId) {
        const body = JSON.stringify({ note: text, recordId });
        fetch('/api/ai/extract-entities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).catch(() => {});
        fetch('/api/ai/embed-entry',      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).catch(() => {});
      }

      setTimeout(() => {
        setSaved(false);
        setPillar('');
        router.refresh();
      }, 2500);
    } catch {
      setSaving(false);
    }
    setSaving(false);
  };

  return (
    <div className={styles.widget}>
      {saved ? (
        <p className={styles.savedMsg}>
          ✓ Registrado em <strong>{pillar}</strong>
        </p>
      ) : (
        <>
          <textarea
            ref={textareaRef}
            className={styles.input}
            placeholder="O que está acontecendo?"
            value={text}
            onChange={e => setText(e.target.value)}
            rows={2}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            disabled={saving}
          />
          <div className={styles.footer}>
            <span className={styles.hint}>↵ para registrar</span>
            <button
              className={styles.sendBtn}
              onClick={handleSubmit}
              disabled={!text.trim() || saving}
            >
              {saving ? '…' : 'Registrar'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
