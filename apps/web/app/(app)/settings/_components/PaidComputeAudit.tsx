'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from './PaidComputeAudit.module.css';

interface AuditRecord {
  nodeId: string;
  providerId: string;
  providerRef: string | null;
  authorizationRef: string | null;
  startedAt: string | null;
  offlineAt: string | null;
  lastState: string;
  outcome: 'active' | 'teardown_pending' | 'terminated' | 'failed';
  orphanRisk: boolean;
  estimatedCost: { currency: string; amount: number } | null;
}
interface BudgetRecord {
  authorizationId: string;
  ceiling: { currency: string; amount: number } | null;
  reserved: number;
  voided: number;
  committed: number;
  remaining: number | null;
  reservations: { reservationId: string; leaseId: string; nodeId: string; amount: number; currency: string; voided: boolean }[];
}

const ENDPOINT = '/api/work-orchestration/paid-compute-audit';
const fmt = (iso: string | null): string => (iso ? new Date(iso).toLocaleString() : '—');

export default function PaidComputeAudit() {
  const [items, setItems] = useState<AuditRecord[]>([]);
  const [budgets, setBudgets] = useState<BudgetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch(ENDPOINT, { headers: { accept: 'application/json' } });
      const body = await res.json();
      if (!res.ok || !body.ok) { setError(body?.error?.message ?? 'Falha ao carregar a auditoria.'); return; }
      // Só compute PAGO importa aqui; owned morre com o host.
      const value = body.value as { leases: AuditRecord[]; budgets: BudgetRecord[] };
      setItems(value.leases.filter(r => r.authorizationRef !== null || r.orphanRisk));
      setBudgets(value.budgets);
    } catch {
      setError('Falha de rede ao carregar a auditoria.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className={styles.wrap}>
      <p className={styles.note}>
        Auditoria read-only do compute pago (do log durável de evidência): quem autorizou, node/
        provider, marcos, custo estimado e RISCO DE ÓRFÃO. Nenhum segredo é registrado.
      </p>
      {loading && <p className={styles.muted}>Carregando…</p>}
      {error && <p className={styles.error}>{error}</p>}
      {budgets.map(b => (
        <div key={b.authorizationId} className={styles.row}>
          <div className={styles.head}><span className={styles.node}>Autorização {b.authorizationId.slice(0, 8)}</span></div>
          <div className={styles.meta}>
            <span>{b.ceiling ? `teto ${b.ceiling.currency} ${b.ceiling.amount.toFixed(4)}` : 'sem teto agregado — inelegível'}</span>
            <span>reservado {b.reserved.toFixed(4)} · anulado {b.voided.toFixed(4)} · comprometido {b.committed.toFixed(4)}</span>
            <span>{b.remaining === null ? 'restante indisponível' : `restante ${b.remaining.toFixed(4)}`} · {b.reservations.length} lease(s)</span>
          </div>
        </div>
      ))}
      {!loading && !error && items.length === 0 && budgets.length === 0 && <p className={styles.muted}>Nenhuma atividade de compute pago.</p>}
      {items.map((r, i) => (
        <div key={`${r.nodeId}-${i}`} className={styles.row}>
          <div className={styles.head}>
            <span className={`${styles.badge} ${styles[r.outcome]}`}>{r.outcome}</span>
            <span className={styles.node}>{r.providerId} · {r.nodeId}</span>
            {r.orphanRisk && <span className={styles.orphan}>risco de órfão</span>}
          </div>
          <div className={styles.meta}>
            <span>{r.providerRef ? `ref ${r.providerRef}` : 'sem providerRef'}{r.authorizationRef ? ` · auth ${r.authorizationRef.slice(0, 8)}` : ''}</span>
            <span>início {fmt(r.startedAt)} · offline {fmt(r.offlineAt)}</span>
            <span>{r.estimatedCost ? `~ ${r.estimatedCost.currency} ${r.estimatedCost.amount.toFixed(4)}` : 'sem custo estimado'}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
