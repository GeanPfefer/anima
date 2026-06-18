'use client';

import { useState } from 'react';
import styles from '../identity.module.css';

export type Evidence = { snippet: string; sourceType: string };
export type Hypothesis = {
  id: string;
  type: string;
  label: string;
  description: string | null;
  confidence: number;
  status: string;
  evidenceCount: number;
  evidence: Evidence[];
};
export type Group = { type: string; label: string; items: Hypothesis[] };

function confidenceColor(c: number): string {
  if (c >= 75) return '#22c55e';
  if (c >= 50) return '#eab308';
  return '#94a3b8';
}

export default function IdentityList({ groups }: { groups: Group[] }) {
  const [status, setStatus] = useState<Record<string, string>>(
    () => Object.fromEntries(groups.flatMap(g => g.items.map(h => [h.id, h.status]))),
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  async function setHypothesisStatus(id: string, next: string) {
    const current = status[id] ?? 'pending';
    const target  = current === next ? 'pending' : next; // clicar o ativo volta a pending
    setBusy(b => ({ ...b, [id]: true }));
    const prev = status[id];
    setStatus(s => ({ ...s, [id]: target })); // otimista
    const res = await fetch('/api/identity/status', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id, status: target }),
    }).catch(() => null);
    setBusy(b => ({ ...b, [id]: false }));
    if (!res?.ok) setStatus(s => ({ ...s, [id]: prev ?? 'pending' })); // reverte em erro
  }

  return (
    <div className={styles.groups}>
      {groups.map(group => (
        <div key={group.type} className={styles.group}>
          <div className={styles.groupHeader}>
            <span className={styles.groupLabel}>{group.label}</span>
            <span className={styles.groupCount}>{group.items.length}</span>
          </div>

          <div className={styles.cards}>
            {group.items.map(h => {
              const st = status[h.id] ?? 'pending';
              const isOpen = !!expanded[h.id];
              return (
                <div
                  key={h.id}
                  className={`${styles.card} ${st === 'rejected' ? styles.cardRejected : ''}`}
                >
                  <div className={styles.cardTop}>
                    <span className={styles.cardLabel}>{h.label}</span>
                    <span className={styles.cardConf} style={{ color: confidenceColor(h.confidence) }}>
                      {h.confidence}%
                    </span>
                  </div>

                  <div className={styles.bar}>
                    <div
                      className={styles.barFill}
                      style={{ width: `${h.confidence}%`, background: confidenceColor(h.confidence) }}
                    />
                  </div>

                  {h.description && <p className={styles.cardDesc}>{h.description}</p>}

                  <div className={styles.cardActions}>
                    <button
                      className={`${styles.actBtn} ${st === 'confirmed' ? styles.actConfirm : ''}`}
                      onClick={() => setHypothesisStatus(h.id, 'confirmed')}
                      disabled={busy[h.id]}
                    >
                      ✓ faz sentido
                    </button>
                    <button
                      className={`${styles.actBtn} ${st === 'rejected' ? styles.actReject : ''}`}
                      onClick={() => setHypothesisStatus(h.id, 'rejected')}
                      disabled={busy[h.id]}
                    >
                      ✕ não
                    </button>
                    {h.evidence.length > 0 && (
                      <button
                        className={styles.evidenceToggle}
                        onClick={() => setExpanded(e => ({ ...e, [h.id]: !isOpen }))}
                      >
                        {isOpen ? 'ocultar' : `por quê? (${h.evidence.length})`}
                      </button>
                    )}
                  </div>

                  {isOpen && h.evidence.length > 0 && (
                    <ul className={styles.evidenceList}>
                      {h.evidence.map((ev, i) => (
                        <li key={i} className={styles.evidenceItem}>{ev.snippet}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
