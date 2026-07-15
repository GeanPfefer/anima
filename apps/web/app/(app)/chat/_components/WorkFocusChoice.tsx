'use client';
import { useState } from 'react';
import styles from './chat.module.css';

type Candidate = { id: string; summary: string };
type Props = {
  sourceMessageId: string;
  candidates: readonly Candidate[];
  onResolved: (workItemId: string, summary: string) => void;
  onDismiss: () => void;
};

// Resposta estruturada à pergunta de ambiguidade: fixa o foco escolhido e
// vincula a mensagem original ao item antes de confirmar ao usuário.
export function WorkFocusChoice({ sourceMessageId, candidates, onResolved, onDismiss }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function choose(candidate: Candidate) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const focusResponse = await fetch('/api/work-orchestration/focus', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workItemId: candidate.id }) });
      const focusBody = await focusResponse.json().catch(() => ({}));
      if (!focusResponse.ok || !focusBody.ok) throw new Error(focusBody.error?.message ?? 'Não foi possível definir o foco.');
      const contextResponse = await fetch('/api/work-orchestration/contexts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workItemId: candidate.id, expectedProposalVersion: focusBody.value.proposalVersion, references: [{ kind: 'message', id: sourceMessageId }] }) });
      const contextBody = await contextResponse.json().catch(() => ({}));
      if (!contextResponse.ok || !contextBody.ok) throw new Error(contextBody.error?.message ?? 'Não foi possível associar sua mensagem ao trabalho.');
      onResolved(candidate.id, candidate.summary);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível concluir a escolha.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.workCard} role="group" aria-label="Escolha do trabalho em foco" aria-busy={busy}>
      <strong>A qual trabalho você se refere?</strong>
      <div className={styles.workActions}>
        {candidates.map(candidate => (
          <button key={candidate.id} disabled={busy} onClick={() => choose(candidate)}>{candidate.summary}</button>
        ))}
        <button disabled={busy} onClick={onDismiss}>Nenhum destes</button>
      </div>
      {error && <p role="alert" className={styles.error}>{error} Você pode tentar novamente.</p>}
    </div>
  );
}
