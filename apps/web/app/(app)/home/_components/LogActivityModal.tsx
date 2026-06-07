'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { calculateBonusMultiplier } from '@anima/core';
import { parseActivities, getActivityBonuses, logMultipleActivities } from '../actions';
import type { ActivityBonusType } from '@anima/types';
import styles from './LogActivityModal.module.css';

type Pillar = { id: string; name: string; xp_rate: number };

type Phase = 'input' | 'parsing' | 'reviewing' | 'submitting' | 'success';

type ReviewEntry = {
  id: string;
  pillarId: string;
  durationMinutes: number;
  note: string;
  bonuses: ActivityBonusType[];
};

function normStr(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function matchPillar(name: string, pillars: Pillar[]): Pillar | undefined {
  const n = normStr(name);
  return (
    pillars.find(p => normStr(p.name) === n) ??
    pillars.find(p => normStr(p.name).includes(n) || n.includes(normStr(p.name)))
  );
}

function calcXP(entry: ReviewEntry, pillars: Pillar[]): number {
  const pillar = pillars.find(p => p.id === entry.pillarId);
  if (!pillar || entry.durationMinutes <= 0) return 0;
  const base = Math.round(entry.durationMinutes * pillar.xp_rate);
  return Math.round(base * calculateBonusMultiplier(entry.bonuses));
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function LogActivityModal({ pillars }: { pillars: Pillar[] }) {
  const router = useRouter();
  const [open, setOpen]               = useState(false);
  const [phase, setPhase]             = useState<Phase>('input');
  const [text, setText]               = useState('');
  const [entries, setEntries]         = useState<ReviewEntry[]>([]);
  const [totalXP, setTotalXP]         = useState(0);
  const [errorMsg, setErrorMsg]       = useState('');
  const [activityDate, setActivityDate] = useState(todayStr());
  const counterRef                    = useRef(0);

  const handleClose = () => {
    setOpen(false);
    setPhase('input');
    setText('');
    setEntries([]);
    setTotalXP(0);
    setErrorMsg('');
    setActivityDate(todayStr());
  };

  const handleParse = async () => {
    if (!text.trim()) return;
    setPhase('parsing');
    setErrorMsg('');
    try {
      const parsed = await parseActivities(text, pillars.map(p => p.name));

      if (parsed.length === 0) {
        setErrorMsg('Não consegui identificar atividades. Descreva o que você fez e quanto tempo durou.');
        setPhase('input');
        return;
      }

      const matched = parsed
        .map(a => ({
          pillar: matchPillar(a.pillarName, pillars) ?? pillars[0],
          durationMinutes: a.durationMinutes,
          note: a.note,
        }))
        .filter((m): m is { pillar: Pillar; durationMinutes: number; note: string } => !!m.pillar);

      const uniqueIds = [...new Set(matched.map(m => m.pillar.id))];
      const bonusMap: Record<string, ActivityBonusType[]> = {};
      await Promise.all(uniqueIds.map(async id => {
        bonusMap[id] = await getActivityBonuses(id, activityDate);
      }));

      setEntries(matched.map(m => ({
        id: String(counterRef.current++),
        pillarId: m.pillar.id,
        durationMinutes: m.durationMinutes,
        note: m.note,
        bonuses: bonusMap[m.pillar.id] ?? [],
      })));
      setPhase('reviewing');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Erro ao interpretar texto');
      setPhase('input');
    }
  };

  const handleChangePillar = async (entryId: string, pillarId: string) => {
    const bonuses = await getActivityBonuses(pillarId, activityDate);
    setEntries(prev => prev.map(e => e.id === entryId ? { ...e, pillarId, bonuses } : e));
  };

  const handleChangeDuration = (entryId: string, val: number) => {
    setEntries(prev => prev.map(e =>
      e.id === entryId ? { ...e, durationMinutes: Math.max(0, Math.min(480, val)) } : e,
    ));
  };

  const handleRemove = (entryId: string) => {
    setEntries(prev => {
      const next = prev.filter(e => e.id !== entryId);
      if (next.length === 0) setPhase('input');
      return next;
    });
  };

  const handleSubmit = async () => {
    if (entries.length === 0) return;
    setPhase('submitting');
    setErrorMsg('');
    try {
      const { totalXP: xp, entries: logged } = await logMultipleActivities(
        entries.map(e => ({
          pillarId:        e.pillarId,
          durationMinutes: e.durationMinutes,
          note:            e.note,
          activityDate,
        })),
      );
      setTotalXP(xp);
      setPhase('success');

      // Extração de entidades semânticas — fire-and-forget, não bloqueia o usuário
      for (const { recordId, note } of logged) {
        if (note) {
          fetch('/api/ai/extract-entities', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note, recordId }),
          }).catch(() => {});
        }
      }

      setTimeout(() => { router.refresh(); handleClose(); }, 2000);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Erro ao registrar');
      setPhase('reviewing');
    }
  };

  const totalXPPreview = entries.reduce((sum, e) => sum + calcXP(e, pillars), 0);
  const isSubmitting   = phase === 'submitting';
  const isToday        = activityDate === todayStr();

  if (!open) {
    return (
      <button className={styles.fab} onClick={() => setOpen(true)}>
        + Nova entrada
      </button>
    );
  }

  return (
    <>
      <div className={styles.backdrop} onClick={isSubmitting || phase === 'success' ? undefined : handleClose} />

      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>
            {phase === 'input'     ? 'Nova entrada'   :
             phase === 'parsing'   ? 'Interpretando…' :
             phase === 'reviewing' ? 'Confirmar'      :
             phase === 'submitting'? 'Registrando…'   : ''}
          </h2>
          {phase !== 'submitting' && phase !== 'success' && (
            <button className={styles.closeBtn} onClick={handleClose} aria-label="Fechar">✕</button>
          )}
        </div>

        {phase === 'input' && (
          <div className={styles.inputPhase}>
            <textarea
              className={styles.inputArea}
              placeholder="O que você fez? Escreva livremente — a IA vai interpretar tudo."
              value={text}
              onChange={e => setText(e.target.value)}
              rows={5}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleParse(); }}
            />
            {errorMsg && <p className={styles.error}>{errorMsg}</p>}
            <button className={styles.submitBtn} onClick={handleParse} disabled={!text.trim()}>
              Interpretar →
            </button>
          </div>
        )}

        {phase === 'parsing' && (
          <div className={styles.parsingState}>
            <div className={styles.spinner} />
            <p className={styles.parsingMsg}>Anima está pensando…</p>
          </div>
        )}

        {(phase === 'reviewing' || phase === 'submitting') && (
          <div className={styles.reviewPhase}>
            {/* Seletor de data — permite backfill com datas passadas */}
            <div className={styles.dateRow}>
              <span className={styles.dateLabel}>Data</span>
              <input
                type="date"
                className={styles.dateInput}
                value={activityDate}
                max={todayStr()}
                onChange={e => setActivityDate(e.target.value)}
                disabled={isSubmitting}
              />
              {isToday && <span className={styles.dateTodayBadge}>hoje</span>}
            </div>

            <div className={styles.reviewList}>
              {entries.map(entry => {
                const entryXP = calcXP(entry, pillars);
                return (
                  <div key={entry.id} className={styles.entryCard}>
                    <div className={styles.entryHeader}>
                      <span className={styles.entryXP}>
                        {entry.durationMinutes > 0 ? `${entry.durationMinutes}min · ` : ''}
                        {entryXP > 0 ? `+${entryXP} XP` : '—'}
                      </span>
                      <button className={styles.entryRemove} onClick={() => handleRemove(entry.id)} disabled={isSubmitting}>×</button>
                    </div>
                    {entry.note && <p className={styles.entryNote}>{entry.note}</p>}
                    <div className={styles.entryPillarRow}>
                      {pillars.map(p => (
                        <button
                          key={p.id}
                          className={`${styles.pill} ${entry.pillarId === p.id ? styles.pillActive : ''}`}
                          onClick={() => handleChangePillar(entry.id, p.id)}
                          disabled={isSubmitting}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                    <div className={styles.entryDurationRow}>
                      <span className={styles.entryDurationLabel}>Duração (min)</span>
                      <input
                        type="number"
                        className={styles.durationInput}
                        value={entry.durationMinutes}
                        min={0}
                        max={480}
                        onChange={e => handleChangeDuration(entry.id, Number(e.target.value) || 0)}
                        disabled={isSubmitting}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {errorMsg && <p className={styles.error}>{errorMsg}</p>}

            <button
              className={styles.submitBtn}
              onClick={handleSubmit}
              disabled={isSubmitting || entries.length === 0}
            >
              {isSubmitting ? 'Registrando…' : `Registrar · +${totalXPPreview} XP`}
            </button>
          </div>
        )}

        {phase === 'success' && (
          <div className={styles.success}>
            <div className={styles.successXP}>+{totalXP} XP</div>
            <p className={styles.successMsg}>
              {entries.length > 1 ? `${entries.length} entradas registradas` : 'Entrada registrada'}
              {!isToday && ` · ${new Date(activityDate + 'T12:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}`}
            </p>
          </div>
        )}
      </div>
    </>
  );
}
