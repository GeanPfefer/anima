import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import IdentityList, { type Group, type Hypothesis } from './_components/IdentityList';
import styles from './identity.module.css';

// Ordem e rótulos dos tipos de hipótese.
const TYPE_ORDER  = ['value', 'goal', 'motivation', 'interest', 'pattern', 'belief', 'fear'] as const;
const TYPE_LABELS: Record<string, string> = {
  value:      'Valores',
  goal:       'Objetivos',
  motivation: 'Motivações',
  interest:   'Interesses',
  pattern:    'Padrões',
  belief:     'Crenças',
  fear:       'Medos',
};

export default async function IdentityPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [hypoRes, evRes] = await Promise.all([
    supabase
      .from('identity_hypotheses')
      .select('id, type, label, description, confidence, status, evidence_count')
      .eq('user_id', user.id)
      .order('confidence', { ascending: false }),
    supabase
      .from('identity_evidence')
      .select('hypothesis_id, snippet, source_type')
      .eq('user_id', user.id),
  ]);

  const rows     = hypoRes.data ?? [];
  const evidence = evRes.data   ?? [];

  const evByHypo = new Map<string, { snippet: string; sourceType: string }[]>();
  for (const e of evidence) {
    if (!e.snippet) continue;
    const list = evByHypo.get(e.hypothesis_id) ?? [];
    list.push({ snippet: e.snippet, sourceType: e.source_type });
    evByHypo.set(e.hypothesis_id, list);
  }

  const hypotheses: Hypothesis[] = rows.map(h => ({
    id:            h.id,
    type:          h.type,
    label:         h.label,
    description:   h.description,
    confidence:    h.confidence,
    status:        h.status,
    evidenceCount: h.evidence_count,
    evidence:      evByHypo.get(h.id) ?? [],
  }));

  // Agrupa por tipo, na ordem definida; ignora rejeitadas no agrupamento principal.
  const visible = hypotheses.filter(h => h.status !== 'rejected');
  const groups: Group[] = TYPE_ORDER
    .map(type => ({
      type,
      label: TYPE_LABELS[type] ?? type,
      items: visible.filter(h => h.type === type),
    }))
    .filter(g => g.items.length > 0);

  const total     = visible.length;
  const confirmed = hypotheses.filter(h => h.status === 'confirmed').length;

  return (
    <main className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Identidade</h1>
        <p className={styles.summary}>
          {total === 0
            ? 'O sistema ainda não formou hipóteses sobre você.'
            : `${total} ${total === 1 ? 'hipótese observada' : 'hipóteses observadas'}` +
              (confirmed > 0 ? ` · ${confirmed} confirmada${confirmed === 1 ? '' : 's'}` : '')}
        </p>
      </div>

      {total === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Nada observado ainda</p>
          <p className={styles.emptyText}>
            Conforme você conversa e registra a vida, o Anima começa a formar hipóteses sobre
            seus valores, objetivos, interesses e padrões — sempre com as evidências de cada uma.
          </p>
          <a href="/chat" className={styles.emptyLink}>Abrir chat →</a>
        </div>
      ) : (
        <>
          <p className={styles.hint}>
            Hipóteses, não verdades. Confirme as que fazem sentido — elas ajudam o Anima a te entender.
          </p>
          <IdentityList groups={groups} />
        </>
      )}
    </main>
  );
}
