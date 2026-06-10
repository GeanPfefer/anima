'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './PendingPillarsWidget.module.css';

type PendingPillar = {
  id: string;
  name: string;
  pending_activity: { durationMinutes: number; note: string } | null;
};

type Props = {
  pillars: PendingPillar[];
};

export default function PendingPillarsWidget({ pillars: initial }: Props) {
  const router = useRouter();
  const [pillars, setPillars] = useState(initial);
  const [names, setNames]     = useState<Record<string, string>>(
    Object.fromEntries(initial.map(p => [p.id, p.name])),
  );
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  if (pillars.length === 0) return null;

  const handleConfirm = async (pillar: PendingPillar) => {
    const name = (names[pillar.id] ?? pillar.name).trim();
    if (!name || busy[pillar.id]) return;
    setBusy(b => ({ ...b, [pillar.id]: true }));

    await fetch('/api/pillars/confirm', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ pillarId: pillar.id, name }),
    }).catch(() => {});

    setPillars(ps => ps.filter(p => p.id !== pillar.id));
    router.refresh();
  };

  const handleDismiss = async (pillar: PendingPillar) => {
    if (busy[pillar.id]) return;
    setBusy(b => ({ ...b, [pillar.id]: true }));

    await fetch('/api/pillars/dismiss', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ pillarId: pillar.id }),
    }).catch(() => {});

    setPillars(ps => ps.filter(p => p.id !== pillar.id));
  };

  return (
    <div className={styles.wrapper}>
      {pillars.map(pillar => {
        const pa = pillar.pending_activity;
        const hint = pa?.note
          ? `"${pa.note}"${pa.durationMinutes > 0 ? ` · ${pa.durationMinutes}min` : ''}`
          : null;

        return (
          <div key={pillar.id} className={styles.card}>
            <span className={styles.label}>Novo pilar detectado</span>
            {hint && <p className={styles.hint}>{hint}</p>}
            <div className={styles.row}>
              <input
                className={styles.nameInput}
                value={names[pillar.id] ?? pillar.name}
                onChange={e => setNames(n => ({ ...n, [pillar.id]: e.target.value }))}
                maxLength={20}
                disabled={busy[pillar.id]}
              />
              <button
                className={styles.confirmBtn}
                onClick={() => handleConfirm(pillar)}
                disabled={busy[pillar.id] || !(names[pillar.id] ?? pillar.name).trim()}
              >
                Criar pilar
              </button>
              <button
                className={styles.dismissBtn}
                onClick={() => handleDismiss(pillar)}
                disabled={busy[pillar.id]}
              >
                Ignorar
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
