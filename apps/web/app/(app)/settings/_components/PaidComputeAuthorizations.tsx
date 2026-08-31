'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from './PaidComputeAuthorizations.module.css';

interface AuthorizationView {
  id: string;
  providerId: string;
  nodeId: string | null;
  resourceClass: string | null;
  workItemId: string | null;
  maxDurationMs: number;
  maxCost: { currency: string; amount: number } | null;
  validFrom: string;
  validUntil: string;
  revokedAt: string | null;
  createdAt: string;
  active: boolean;
}

const ENDPOINT = '/api/work-orchestration/paid-compute-authorizations';

const localInput = (date: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const fmt = (iso: string): string => new Date(iso).toLocaleString();
const minutes = (ms: number): string => `${(ms / 60000).toLocaleString()} min`;

const statusOf = (a: AuthorizationView): { label: string; kind: 'active' | 'revoked' | 'expired' | 'pending' } => {
  if (a.revokedAt !== null) return { label: 'Revogada', kind: 'revoked' };
  const now = Date.now();
  if (now < Date.parse(a.validFrom)) return { label: 'Agendada', kind: 'pending' };
  if (now >= Date.parse(a.validUntil)) return { label: 'Expirada', kind: 'expired' };
  return { label: 'Ativa', kind: 'active' };
};

export default function PaidComputeAuthorizations() {
  const [items, setItems] = useState<AuthorizationView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [providerId, setProviderId] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [resourceClass, setResourceClass] = useState('');
  const [workItemId, setWorkItemId] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('30');
  const [costCurrency, setCostCurrency] = useState('USD');
  const [costAmount, setCostAmount] = useState('');
  const [validFrom, setValidFrom] = useState(() => localInput(new Date()));
  const [validUntil, setValidUntil] = useState(() => localInput(new Date(Date.now() + 60 * 60_000)));

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const res = await fetch(ENDPOINT, { headers: { accept: 'application/json' } });
      const body = await res.json();
      if (!res.ok || !body.ok) { setLoadError(body?.error?.message ?? 'Falha ao carregar autorizações.'); return; }
      setItems(body.value as AuthorizationView[]);
    } catch {
      setLoadError('Falha de rede ao carregar autorizações.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');

    if (providerId.trim().length === 0) { setFormError('Informe o provider.'); return; }
    const durMin = Number(durationMinutes);
    if (!Number.isFinite(durMin) || durMin <= 0) { setFormError('Duração máxima precisa ser positiva (minutos).'); return; }
    if (Date.parse(validUntil) <= Date.parse(validFrom)) { setFormError('Validade final precisa ser posterior à inicial.'); return; }

    const amount = Number(costAmount);
    if (costCurrency.trim().length === 0 || !Number.isFinite(amount) || amount <= 0) {
      setFormError('O teto agregado exige moeda e valor > 0.'); return;
    }
    const maxCost = { currency: costCurrency.trim(), amount };

    setSubmitting(true);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          providerId: providerId.trim(),
          nodeId: nodeId.trim() || null,
          resourceClass: resourceClass.trim() || null,
          workItemId: workItemId.trim() || null,
          maxDurationMs: Math.round(durMin * 60_000),
          maxCost,
          validFrom: new Date(validFrom).toISOString(),
          validUntil: new Date(validUntil).toISOString(),
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) { setFormError(body?.error?.message ?? 'Falha ao conceder autorização.'); return; }
      setFormSuccess('Autorização concedida.');
      setNodeId(''); setResourceClass(''); setWorkItemId(''); setCostAmount('');
      await load();
    } catch {
      setFormError('Falha de rede ao conceder autorização.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setFormError('');
    setFormSuccess('');
    setBusyId(id);
    try {
      const res = await fetch(`${ENDPOINT}/${id}`, { method: 'DELETE', headers: { accept: 'application/json' } });
      const body = await res.json();
      if (!res.ok || !body.ok) { setFormError(body?.error?.message ?? 'Falha ao revogar.'); return; }
      await load();
    } catch {
      setFormError('Falha de rede ao revogar.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className={styles.wrap}>
      <p className={styles.note}>
        Autorização humana para compute pago. Concessão e revogação são atos seus (owner-scoped).
        Nenhuma credencial de provider é inserida aqui — apenas o envelope de autorização. Conceder
        não inicia execução nem chama provider algum.
      </p>

      <form onSubmit={handleGrant} className={styles.form}>
        <div className={styles.grid}>
          <label className={styles.field}>
            <span className={styles.label}>Provider *</span>
            <input className={styles.input} value={providerId} onChange={e => setProviderId(e.target.value)}
              placeholder="ex.: runpod, fly, local-process" required />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Node (opcional)</span>
            <input className={styles.input} value={nodeId} onChange={e => setNodeId(e.target.value)}
              placeholder="qualquer node se vazio" />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Resource class (opcional)</span>
            <input className={styles.input} value={resourceClass} onChange={e => setResourceClass(e.target.value)}
              placeholder="ex.: gpu-24gb" />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Work item (opcional, UUID)</span>
            <input className={styles.input} value={workItemId} onChange={e => setWorkItemId(e.target.value)}
              placeholder="restringe a um item" />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Duração máxima (min) *</span>
            <input className={styles.input} type="number" min={1} step={1} value={durationMinutes}
              onChange={e => setDurationMinutes(e.target.value)} required />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Válida de *</span>
            <input className={styles.input} type="datetime-local" value={validFrom}
              onChange={e => setValidFrom(e.target.value)} required />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Válida até *</span>
            <input className={styles.input} type="datetime-local" value={validUntil}
              onChange={e => setValidUntil(e.target.value)} required />
          </label>
        </div>

          <div className={styles.costRow}>
            <label className={styles.field}>
              <span className={styles.label}>Moeda</span>
              <input className={styles.input} value={costCurrency} onChange={e => setCostCurrency(e.target.value)} placeholder="USD" />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Teto agregado *</span>
              <input className={styles.input} type="number" min="0.000001" step="0.000001" value={costAmount}
                onChange={e => setCostAmount(e.target.value)} placeholder="0.00" />
            </label>
          </div>

        {formError && <p className={styles.error}>{formError}</p>}
        {formSuccess && <p className={styles.success}>{formSuccess}</p>}

        <button type="submit" className={styles.button} disabled={submitting}>
          {submitting ? 'Concedendo…' : 'Conceder autorização'}
        </button>
      </form>

      <div className={styles.list}>
        <h3 className={styles.listTitle}>Autorizações</h3>
        {loading && <p className={styles.muted}>Carregando…</p>}
        {loadError && <p className={styles.error}>{loadError}</p>}
        {!loading && !loadError && items.length === 0 && <p className={styles.muted}>Nenhuma autorização.</p>}
        {items.map(a => {
          const st = statusOf(a);
          return (
            <div key={a.id} className={styles.row}>
              <div className={styles.rowMain}>
                <span className={`${styles.badge} ${styles[st.kind]}`}>{st.label}</span>
                <span className={styles.provider}>{a.providerId}</span>
                <span className={styles.meta}>
                  {a.nodeId ? `node ${a.nodeId}` : 'qualquer node'}
                  {a.resourceClass ? ` · ${a.resourceClass}` : ''}
                  {a.workItemId ? ` · item ${a.workItemId.slice(0, 8)}` : ''}
                </span>
              </div>
              <div className={styles.rowMeta}>
                <span>até {minutes(a.maxDurationMs)}</span>
                <span>{a.maxCost ? `${a.maxCost.currency} ${a.maxCost.amount}` : 'sem teto de custo'}</span>
                <span>{fmt(a.validFrom)} → {fmt(a.validUntil)}</span>
              </div>
              {a.revokedAt === null && (
                <button className={styles.revoke} onClick={() => void handleRevoke(a.id)} disabled={busyId === a.id}>
                  {busyId === a.id ? 'Revogando…' : 'Revogar'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
