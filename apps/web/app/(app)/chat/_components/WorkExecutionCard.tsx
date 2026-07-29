'use client';
import { useState } from 'react';
import type { AutonomousExecutionProjection } from '@anima/core';
import styles from './chat.module.css';

// UX-01 — cartão de execução autônoma. É EXCLUSIVAMENTE uma projeção do estado
// persistido (vem pronto de @anima/core); o cliente não inventa nada. As únicas
// ações são pedir pausa/cancelamento reais — persistidos e aplicados
// cooperativamente pelo laço num checkpoint seguro. Não é console nem dashboard.

const STATUS_LABEL: Record<AutonomousExecutionProjection['status'], string> = {
  running: 'Em execução',
  paused: 'Pausada',
  cancelled: 'Cancelada',
  abandoned: 'Abandonada (limite excedido)',
  submitted_for_review: 'Resultado em revisão',
  failed: 'Falhou',
  blocked: 'Bloqueada (orçamento)',
};
const CONTROL_APPLIED_LABEL: Record<string, string> = {
  paused_by_user: 'Pausada por você',
  cancelled_by_user: 'Cancelada por você',
};

// Formatação determinística (sem locale/fuso variável): "2026-07-29 12:00 UTC".
const instant = (iso: string): string => {
  const trimmed = iso.replace('T', ' ').slice(0, 16);
  return iso.endsWith('Z') ? `${trimmed} UTC` : trimmed;
};

type Props = {
  execution: AutonomousExecutionProjection;
  workItemId: string;
  proposalVersion: number;
  onReload: () => void | Promise<void>;
};

export function WorkExecutionCard({ execution, workItemId, proposalVersion, onReload }: Props) {
  const [status, setStatus] = useState<'idle' | 'submitting'>('idle');
  const [error, setError] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const busy = status !== 'idle';
  const { limits, latestCheckpoint, pendingControl, appliedControl, budgetBlock } = execution;

  async function request(action: 'pause' | 'cancel') {
    if (busy) return;
    setStatus('submitting'); setError('');
    const response = await fetch('/api/work-orchestration/control', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workItemId, expectedProposalVersion: proposalVersion, attemptId: execution.attemptId, action }),
    });
    const body = await response.json().catch(() => ({}));
    setConfirmCancel(false); setStatus('idle');
    if (response.ok && body.ok) { await onReload(); return; }
    setError(body.error?.message ?? 'Não foi possível registrar o pedido.');
    // Estado mudou no servidor (versão obsoleta, item sumiu): reprojeta o cartão
    // a partir do estado vigente em vez de insistir sobre uma leitura velha.
    if (body.error?.code === 'version_conflict' || body.error?.code === 'work_item_not_found') await onReload();
  }

  const limitParts = [
    limits.maxAttempts !== null ? `${limits.maxAttempts} tentativa(s)` : null,
    limits.maxDurationMinutes !== null ? `${limits.maxDurationMinutes} min` : null,
  ].filter(Boolean);

  return (
    <section className={styles.workNotice} aria-label="Execução autônoma" aria-busy={busy}>
      <div className={styles.workCardHeader}><strong>Execução autônoma</strong><span>{STATUS_LABEL[execution.status]}</span></div>
      <dl className={styles.workMeta}>
        {execution.executorId && <div><dt>Executor</dt><dd>{execution.executorId}</dd></div>}
        {execution.providerRef && <div><dt>Provedor</dt><dd>{execution.providerRef}</dd></div>}
        {execution.modelRef && <div><dt>Modelo</dt><dd>{execution.modelRef}</dd></div>}
        {execution.effort && <div><dt>Esforço</dt><dd>{execution.effort}</dd></div>}
        <div><dt>Início</dt><dd><time dateTime={execution.startedAt}>{instant(execution.startedAt)}</time></dd></div>
        {limitParts.length > 0 && <div><dt>Limites</dt><dd>{limitParts.join(' · ')}</dd></div>}
      </dl>
      {latestCheckpoint
        ? <p>Checkpoint #{latestCheckpoint.signalSequence}: {latestCheckpoint.completedSteps} concluído(s), {latestCheckpoint.remainingSteps} restante(s). Próximo: {latestCheckpoint.nextStep || '—'}</p>
        : <p>Nenhum checkpoint persistido ainda.</p>}
      {budgetBlock && <p>Orçamento atingido: {budgetBlock.reason}{budgetBlock.reachedLimit ? ` (limite: ${budgetBlock.reachedLimit})` : ''}.</p>}
      {pendingControl && <p role="status">Pedido de {pendingControl.action === 'pause' ? 'pausa' : 'cancelamento'} registrado; será aplicado no próximo checkpoint seguro.</p>}
      {appliedControl && <p>{CONTROL_APPLIED_LABEL[appliedControl.reason] ?? appliedControl.reason} em <time dateTime={appliedControl.appliedAt}>{instant(appliedControl.appliedAt)}</time>.</p>}
      {execution.canRequestControl && !confirmCancel && (
        <div className={styles.workActions}>
          <button disabled={busy} onClick={() => request('pause')}>Pausar</button>
          <button disabled={busy} onClick={() => setConfirmCancel(true)}>Cancelar</button>
        </div>
      )}
      {execution.canRequestControl && confirmCancel && (
        <div className={styles.workDecision}>
          <p>Cancelar encerra esta execução no próximo checkpoint seguro. Confirmar?</p>
          <button disabled={busy} onClick={() => request('cancel')}>Confirmar cancelamento</button>
          <button disabled={busy} onClick={() => setConfirmCancel(false)}>Voltar</button>
        </div>
      )}
      {status === 'submitting' && <p role="status">Registrando o pedido…</p>}
      {error && <p role="alert" className={styles.error}>{error} Você pode tentar novamente.</p>}
    </section>
  );
}
