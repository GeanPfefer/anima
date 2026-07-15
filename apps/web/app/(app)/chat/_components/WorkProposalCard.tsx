'use client';
import { useState } from 'react';
import type { ApprovalDecision, ResultReviewDecision, WorkItem, WorkProposal } from '@anima/core';
import styles from './chat.module.css';

export type WorkItemView = Omit<WorkItem, 'createdAt' | 'updatedAt'> & { createdAt: string; updatedAt: string; lastEventType?: string };
type Props = { item: WorkItemView; onChange: (item: WorkItemView) => void };

export function WorkProposalCard({ item, onChange }: Props) {
  const [status, setStatus] = useState<'idle' | 'submitting' | 'reconciling' | 'failed'>('idle');
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'none' | 'defer' | 'correct' | 'result' | 'review_changes'>('none');
  const [detail, setDetail] = useState('');
  const [customDeferReason, setCustomDeferReason] = useState('');
  const [references, setReferences] = useState('');
  const proposal = item.proposal as WorkProposal;

  async function reload() {
    setStatus('reconciling');
    const response = await fetch(`/api/work-orchestration/items/${item.id}`);
    const body = await response.json();
    if (response.ok && body.ok) onChange(body.value.item as WorkItemView);
    setStatus(response.ok ? 'idle' : 'failed');
  }

  async function decide(decision: ApprovalDecision) {
    if (status !== 'idle') return;
    setStatus('submitting'); setError('');
    const response = await fetch('/api/work-orchestration/decisions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workItemId: item.id, expectedProposalVersion: item.proposalVersion, decision }) });
    const body = await response.json();
    if (response.ok && body.ok) { onChange({ ...(body.value as WorkItemView), ...(decision.type === 'defer' ? { lastEventType: 'work_deferred' } : {}) }); setMode('none'); setDetail(''); setCustomDeferReason(''); setStatus('idle'); return; }
    if (body.error?.code === 'version_conflict' || body.error?.code === 'ambiguous_outcome') { await reload(); setError('A proposta foi relida antes de permitir outra decisão.'); return; }
    setError(body.error?.message ?? 'Não foi possível registrar a decisão.'); setStatus('failed');
  }

  async function requestCorrection() {
    if (!detail.trim()) return;
    await decide({ type: 'request_changes', requestedChanges: detail.trim() });
    const nextProposal = { ...proposal, data: { ...proposal.data, objective: detail.trim(), summary: detail.trim() } };
    const response = await fetch('/api/work-orchestration/revisions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workItemId: item.id, expectedProposalVersion: item.proposalVersion, intent: item.intent, proposal: nextProposal }) });
    const body = await response.json();
    if (response.ok && body.ok) { onChange(body.value as WorkItemView); setMode('none'); setDetail(''); setStatus('idle'); }
    else { setError('A correção foi solicitada, mas a nova versão ainda precisa ser retomada.'); await reload(); }
  }

  async function transition(endpoint: string, payload: Record<string, unknown>) {
    if (status !== 'idle') return;
    setStatus('submitting'); setError('');
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workItemId: item.id, expectedProposalVersion: item.proposalVersion, ...payload }) });
    const body = await response.json();
    if (response.ok && body.ok) { onChange(body.value as WorkItemView); setMode('none'); setDetail(''); setReferences(''); setStatus('idle'); return; }
    if (body.error?.code === 'version_conflict' || body.error?.code === 'ambiguous_outcome') { await reload(); setError('O trabalho foi relido antes de permitir outra ação.'); return; }
    setError(body.error?.message ?? 'Não foi possível atualizar o trabalho.'); setStatus('failed');
  }

  const review = (decision: ResultReviewDecision) => transition('/api/work-orchestration/reviews', { decision });

  const readonly = item.state !== 'proposed';
  return <article className={styles.workCard} aria-label={`Proposta de trabalho, versão ${item.proposalVersion}`} aria-busy={status === 'submitting' || status === 'reconciling'}>
    <div className={styles.workCardHeader}><strong>Proposta de trabalho</strong><span>{item.state} · v{item.proposalVersion}</span></div>
    <h3>{proposal.data.summary}</h3><p>{proposal.data.objective}</p>
    <dl className={styles.workMeta}><div><dt>Capacidade</dt><dd>{item.capability}</dd></div><div><dt>Impacto</dt><dd>{item.impactLevel}</dd></div></dl>
    <section><strong>Inclui</strong><ul>{proposal.data.includedScope.map(value => <li key={value}>{value}</li>)}</ul></section>
    <section><strong>Não inclui</strong><ul>{proposal.data.excludedScope.map(value => <li key={value}>{value}</li>)}</ul></section>
    <section><strong>Efeitos esperados</strong><ul>{proposal.data.expectedEffects.map(value => <li key={value}>{value}</li>)}</ul></section>
    <section><strong>Riscos</strong><ul>{proposal.data.risks.map(value => <li key={value}>{value}</li>)}</ul></section>
    <p className={styles.workNotice}>{item.state === 'proposed' ? 'Nenhuma execução começou.' : item.state === 'approved' ? 'Proposta aprovada. A execução ainda não começou.' : item.state === 'in_progress' ? 'Execução manual em andamento.' : item.state === 'review' ? 'Resultado disponível para sua revisão.' : item.state === 'changes_requested' ? 'Correções solicitadas; o histórico anterior foi preservado.' : item.state === 'completed' ? 'Resultado aceito e trabalho concluído.' : `Estado atual: ${item.state}.`}</p>
    {!readonly && item.lastEventType === 'work_deferred' && mode === 'none' && <div className={styles.workNotice}>Proposta adiada. <button onClick={() => setMode('defer')}>Reabrir decisão</button></div>}
    {!readonly && mode === 'none' && item.lastEventType !== 'work_deferred' && <div className={styles.workActions}>
      <button disabled={status !== 'idle'} onClick={() => decide({ type: 'approve' })}>Aprovar</button>
      <button disabled={status !== 'idle'} onClick={() => setMode('correct')}>Pedir correção</button>
      <button disabled={status !== 'idle'} onClick={() => setMode('defer')}>Adiar</button>
      <button disabled={status !== 'idle'} onClick={() => decide({ type: 'reject' })}>Rejeitar</button>
    </div>}
    {mode === 'defer' && <div className={styles.workDecision}><label>Motivo<select value={detail} onChange={event => setDetail(event.target.value)}><option value="">Selecione</option><option>Quero decidir depois</option><option>Falta contexto</option><option>Não é prioridade agora</option><option value="other">Outro</option></select></label>{detail === 'other' && <input aria-label="Outro motivo" value={customDeferReason} onChange={event => setCustomDeferReason(event.target.value)} />}<button disabled={!(detail === 'other' ? customDeferReason : detail).trim() || status !== 'idle'} onClick={() => decide({ type: 'defer', reason: detail === 'other' ? customDeferReason : detail })}>Confirmar adiamento</button><button onClick={() => setMode('none')}>Voltar</button></div>}
    {mode === 'correct' && <div className={styles.workDecision}><label>O que deve mudar?<textarea value={detail} onChange={event => setDetail(event.target.value)} /></label><button disabled={!detail.trim() || status !== 'idle'} onClick={requestCorrection}>Criar nova versão</button><button onClick={() => setMode('none')}>Voltar</button></div>}
    {(item.state === 'approved' || item.state === 'changes_requested') && mode === 'none' && <div className={styles.workActions}><button disabled={status !== 'idle'} onClick={() => transition('/api/work-orchestration/start', {})}>{item.state === 'approved' ? 'Iniciar execução manual' : 'Retomar correções'}</button></div>}
    {item.state === 'in_progress' && mode === 'none' && <div className={styles.workActions}><button disabled={status !== 'idle'} onClick={() => setMode('result')}>Registrar resultado</button></div>}
    {mode === 'result' && <div className={styles.workDecision}><label>Resumo do resultado<textarea value={detail} onChange={event => setDetail(event.target.value)} /></label><label>Referências, uma por linha<textarea value={references} onChange={event => setReferences(event.target.value)} /></label><button disabled={!detail.trim() || status !== 'idle'} onClick={() => transition('/api/work-orchestration/results', { result: { summary: detail.trim(), resultReferences: references.split('\n').map(value => value.trim()).filter(Boolean) } })}>Enviar para revisão</button><button onClick={() => setMode('none')}>Voltar</button></div>}
    {item.state === 'review' && mode === 'none' && <div className={styles.workActions}><button disabled={status !== 'idle'} onClick={() => review({ type: 'accept' })}>Aceitar resultado</button><button disabled={status !== 'idle'} onClick={() => setMode('review_changes')}>Pedir correções no resultado</button></div>}
    {mode === 'review_changes' && <div className={styles.workDecision}><label>Correções necessárias<textarea value={detail} onChange={event => setDetail(event.target.value)} /></label><button disabled={!detail.trim() || status !== 'idle'} onClick={() => review({ type: 'request_changes', requestedChanges: detail.trim() })}>Confirmar correções</button><button onClick={() => setMode('none')}>Voltar</button></div>}
    {status === 'reconciling' && <p role="status">Verificando estado atual…</p>}{error && <p role="alert" className={styles.error}>{error}</p>}
  </article>;
}
