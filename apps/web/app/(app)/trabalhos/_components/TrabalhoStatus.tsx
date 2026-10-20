import type { WorkReferenceAmbiguousCandidate } from '@/lib/work-orchestration/work-reference';
import styles from './trabalhos.module.css';

// Desfechos do detalhe que NÃO abrem um trabalho: referência ambígua (vários itens), inexistente, inválida ou erro de leitura.
// Um código partilhado por sucessores nunca abre um item em silêncio: o usuário escolhe pelo UUID.

const stamp = (iso: string) => `${iso.slice(0, 16).replace('T', ' ')} UTC`;

export function TrabalhoAmbiguo({ reference, candidates }: { reference: string; candidates: readonly WorkReferenceAmbiguousCandidate[] }) {
  return (
    <main className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="Navegação"><a href="/trabalhos">← Todos os trabalhos</a></nav>
      <header className={styles.header}>
        <h1><code className={styles.ref}>{reference}</code> corresponde a mais de um trabalho</h1>
        <p>Escolha qual abrir. Nada foi aberto automaticamente.</p>
      </header>
      <ul className={styles.list} aria-label="Candidatos">
        {candidates.map(candidate => (
          <li key={candidate.workItemId} className={styles.row}>
            <a className={styles.rowLink} href={`/trabalhos/${encodeURIComponent(reference)}?item=${candidate.workItemId}`}>
              <span className={styles.rowTop}>
                <span className={styles.state} data-state={candidate.state}>{candidate.state}</span>
                <span className={styles.meta}>v{candidate.proposalVersion} · criado {stamp(candidate.createdAt)}</span>
              </span>
              <strong className={styles.title}>{candidate.workItemId}</strong>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}

const MESSAGES = {
  not_found: { title: 'Trabalho não encontrado', text: 'Não existe um trabalho seu com essa referência.' },
  invalid: { title: 'Referência inválida', text: 'Use um código como PROOF-01 ou o identificador completo do trabalho.' },
  error: { title: 'Não foi possível carregar o trabalho', text: 'A leitura falhou. Tente novamente; nenhuma ação foi executada.' },
} as const;

export function TrabalhoIndisponivel({ kind }: { kind: keyof typeof MESSAGES }) {
  return (
    <main className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="Navegação"><a href="/trabalhos">← Todos os trabalhos</a></nav>
      <div className={styles.error} role="alert">
        <strong>{MESSAGES[kind].title}</strong>
        <p>{MESSAGES[kind].text}</p>
      </div>
    </main>
  );
}
