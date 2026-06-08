'use client';

import { useState } from 'react';
import styles from './ObsidianExport.module.css';

export default function ObsidianExport() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleExport() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/integrations/obsidian/export');
      if (!res.ok) throw new Error('Falha na geração do vault');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Usa o filename do header se disponível
      const cd = res.headers.get('Content-Disposition') ?? '';
      a.download = cd.match(/filename="([^"]+)"/)?.[1] ?? 'anima-vault.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setError('Erro ao exportar. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.icon}>◈</span>
        <div>
          <div className={styles.name}>Obsidian</div>
          <p className={styles.description}>
            Exporta todo o seu histórico como um vault — arquivos{' '}
            <code className={styles.code}>.md</code> com frontmatter estruturado e{' '}
            <code className={styles.code}>[[links]]</code> entre entradas e pilares.
            Fase 1: somente exportação.
          </p>
        </div>
      </div>
      {error && <p className={styles.error}>{error}</p>}
      <button
        className={styles.btn}
        onClick={handleExport}
        disabled={loading}
      >
        {loading ? 'Gerando…' : '↓ Exportar vault'}
      </button>
    </div>
  );
}
