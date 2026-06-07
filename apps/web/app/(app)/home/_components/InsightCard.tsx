'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import styles from './InsightCard.module.css';

type Props = {
  insight: { id: string; text: string; generated_at: string } | null;
  shouldTrigger: boolean; // home page diz se deve gerar novo insight
};

export default function InsightCard({ insight: initial, shouldTrigger }: Props) {
  const router = useRouter();
  const [insight, setInsight]     = useState(initial);
  const [loading, setLoading]     = useState(false);
  const [dismissing, setDismissing] = useState(false);

  // Dispara geração de insight em background se necessário
  useEffect(() => {
    if (!shouldTrigger || insight) return;
    setLoading(true);
    fetch('/api/ai/generate-insight', { method: 'POST' })
      .then(r => r.json())
      .then((data: { insight?: { id: string; text: string; generated_at: string } }) => {
        if (data.insight) {
          setInsight(data.insight);
          router.refresh();
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDismiss = async () => {
    if (!insight || dismissing) return;
    setDismissing(true);
    await fetch('/api/ai/dismiss-insight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ insightId: insight.id }),
    });
    setInsight(null);
    router.refresh();
  };

  if (!insight && !loading) return null;

  if (loading && !insight) {
    return (
      <div className={styles.card}>
        <div className={styles.loading}>
          <span className={styles.dot} />
          <span className={styles.dot} />
          <span className={styles.dot} />
        </div>
      </div>
    );
  }

  if (!insight) return null;

  const daysAgo = Math.floor(
    (Date.now() - new Date(insight.generated_at).getTime()) / 86400_000,
  );
  const ageLabel = daysAgo === 0 ? 'hoje' : daysAgo === 1 ? 'ontem' : `há ${daysAgo} dias`;

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.label}>Insight</span>
        <span className={styles.age}>{ageLabel}</span>
        <button
          className={styles.dismiss}
          onClick={handleDismiss}
          disabled={dismissing}
          aria-label="Dispensar insight"
        >
          ✕
        </button>
      </div>
      <p className={styles.text}>{insight.text}</p>
    </div>
  );
}
