'use client';
import { useState } from 'react';
import { WorkProposalCard, type WorkPresentationView } from '@/app/(app)/chat/_components/WorkProposalCard';
import { presentWorkReencounter } from '@/app/(app)/chat/_components/work-item-presentation';
import styles from './trabalhos.module.css';

// Detalhe de UM trabalho. Reutiliza o WorkProposalCard e as rotas de ação existentes; este componente só
// hospeda o cartão fora da conversa (estado local da apresentação e foco). Nenhuma decisão nova vive aqui.
export function TrabalhoDetalhe({ initial, reference, title }: { initial: WorkPresentationView; reference: string | null; title: string }) {
  const [presentation, setPresentation] = useState(initial);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [row] = presentWorkReencounter([presentation]);

  async function focus() {
    setError(null);
    try {
      const response = await fetch('/api/work-orchestration/focus', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workItemId: presentation.item.id }),
      });
      if (response.ok) setFocused(true); else setError('Não foi possível alterar o trabalho em foco.');
    } catch {
      setError('Não foi possível alterar o trabalho em foco.');
    }
  }

  return (
    <main className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="Navegação"><a href="/trabalhos">← Todos os trabalhos</a></nav>
      <header className={styles.header}>
        <h1>{reference && <code className={styles.ref}>{reference}</code>} {title}</h1>
        <p>{presentation.item.state} · v{presentation.item.proposalVersion} · id {presentation.item.id}</p>
      </header>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <WorkProposalCard
        presentation={presentation}
        focused={focused}
        onFocus={() => void focus()}
        onChange={setPresentation}
        autonomousExecutionAllowed={row?.autonomousEligible}
        autonomousBlockReason={row?.blockingDependencyIds.length ? row.readinessLabel : null}
        trackAutonomousProgress={presentation.execution?.status === 'running'}
      />
    </main>
  );
}
