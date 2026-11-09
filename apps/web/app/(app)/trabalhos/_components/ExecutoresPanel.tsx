'use client';
import { useState } from 'react';
import styles from './trabalhos.module.css';

// Painel READ-ONLY de executores de um trabalho. Consome a rota `items/[id]/executors`, que é a MESMA descoberta
// de `anima work executors`. Nada aqui escolhe executor, aprova ou inicia tentativa: a execução continua sendo o
// ato humano governado, cujo comando exato é exibido. O chat consumirá o mesmo contrato.
export interface ExecutorCandidateView {
  provider: string; backendId: string; displayName: string; availability: 'ready' | 'unavailable' | 'unknown';
  eligibility: 'eligible' | 'ineligible'; reasonUnavailable: string | null; reasonIneligible: string | null; model: string; costClass: string;
}
export interface ExecutorDiscoveryView {
  workItemId: string; state: string; proposalVersion: number; observedAt: string; contractBackend: string | null;
  candidates: ExecutorCandidateView[];
  recommendation: { backendId: string; rule: string; reason: string } | null;
  noRecommendation: { reason: string } | null;
  governedCommand: string;
  nextSteps?: { label: string; actor: 'human' | 'supervisor'; command: string }[];
}

const AVAILABILITY: Record<ExecutorCandidateView['availability'], string> = { ready: 'pronto', unavailable: 'indisponível', unknown: 'não sondado' };
const EXECUTABLE_STATES = new Set(['approved']);

export function ExecutoresPanel({ workItemId, fetcher }: { workItemId: string; fetcher?: typeof fetch }) {
  const [data, setData] = useState<ExecutorDiscoveryView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setLoading(true); setError(null);
    try {
      const response = await (fetcher ?? fetch)(`/api/work-orchestration/items/${encodeURIComponent(workItemId)}/executors`);
      const body = await response.json() as { ok: boolean; value?: ExecutorDiscoveryView };
      if (response.ok && body.ok && body.value) setData(body.value); else setError('Não foi possível verificar os executores agora.');
    } catch {
      setError('Não foi possível verificar os executores agora.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-label="Executores" className={styles.executors}>
      <h2>Executores</h2>
      <p>Verificação somente leitura. Não escolhe executor, não aprova e não inicia tentativa.</p>
      <button type="button" onClick={() => void check()} disabled={loading}>{loading ? 'Verificando…' : data ? 'Verificar novamente' : 'Verificar executores'}</button>
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <ul>
            {data.candidates.map(c => (
              <li key={c.backendId} data-provider={c.provider}>
                <strong>{c.displayName}</strong> ({c.model}) — {AVAILABILITY[c.availability]}, {c.eligibility === 'eligible' ? 'elegível' : 'inelegível'}, custo {c.costClass}
                {c.reasonUnavailable && <> · {c.reasonUnavailable}</>}{c.reasonIneligible && <> · {c.reasonIneligible}</>}
              </li>
            ))}
          </ul>
          {data.recommendation
            ? <p>Recomendação ({data.recommendation.rule}): <strong>{data.recommendation.backendId}</strong>. {data.recommendation.reason}</p>
            : <p>Sem recomendação: nenhum executor elegível está pronto.</p>}
          <p>Verificado em {data.observedAt}. A recomendação reflete só prontidão, elegibilidade e custo — não a adequação à tarefa.</p>
          {data.nextSteps && data.nextSteps.length > 0
            ? (
              <div>
                <p>Próximos atos governados para o estado <strong>{data.state}</strong> (a interface não os executa):</p>
                <ol>
                  {data.nextSteps.map(step => (
                    <li key={step.command}>{step.actor === 'human' ? 'Humano' : 'Supervisor'} — {step.label}: <code>{step.command}</code></li>
                  ))}
                </ol>
              </div>
            )
            : EXECUTABLE_STATES.has(data.state)
              ? <p>Para executar uma volta isolada (ato humano governado), rode no terminal: <code>{data.governedCommand}</code></p>
              : <p>Estado {data.state}: ainda não há volta isolada a executar (a execução exige proposta aprovada).</p>}
        </>
      )}
    </section>
  );
}
