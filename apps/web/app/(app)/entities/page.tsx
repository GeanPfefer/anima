import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import styles from './entities.module.css';

const TYPE_LABELS: Record<string, string> = {
  pessoa:     'Pessoa',
  lugar:      'Lugar',
  projeto:    'Projeto',
  ferramenta: 'Ferramenta',
  habito:     'Hábito',
  conceito:   'Conceito',
};

type Entity = {
  id: string;
  name: string;
  entity_type: string | null;
  context: unknown;
  occurrence_count: number;
};

export default async function EntitiesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [entitiesRes, linksRes, pillarsRes] = await Promise.all([
    supabase
      .from('semantic_entities')
      .select('id, name, entity_type, context, occurrence_count')
      .eq('user_id', user.id)
      .order('occurrence_count', { ascending: false }),
    supabase.from('entity_pillars').select('entity_id, pillar_id').eq('user_id', user.id),
    supabase.from('user_pillars').select('id, name').eq('user_id', user.id),
  ]);

  const entities   = (entitiesRes.data ?? []) as Entity[];
  const links      = linksRes.data ?? [];
  const pillarName = new Map((pillarsRes.data ?? []).map(p => [p.id, p.name]));
  const entityById = new Map(entities.map(e => [e.id, e]));

  // Agrupa entidades por pilar (uma entidade pode estar em vários).
  const byPillar = new Map<string, Entity[]>();
  const linked   = new Set<string>();
  for (const l of links) {
    const e = entityById.get(l.entity_id);
    if (!e) continue;
    linked.add(l.entity_id);
    const list = byPillar.get(l.pillar_id) ?? [];
    list.push(e);
    byPillar.set(l.pillar_id, list);
  }
  const unlinked = entities.filter(e => !linked.has(e.id));

  const groups = [...byPillar.entries()]
    .map(([pid, ents]) => ({ name: pillarName.get(pid) ?? 'Pilar', entities: ents }))
    .sort((a, b) => b.entities.length - a.entities.length);

  const total = entities.length;

  return (
    <main className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Entidades</h1>
        {total > 0 && (
          <p className={styles.summary}>
            {total} {total === 1 ? 'entidade aprendida' : 'entidades aprendidas'}
          </p>
        )}
      </div>

      {total === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Nada aprendido ainda</p>
          <p className={styles.emptyText}>
            Conforme você menciona pessoas, obras, lugares e ferramentas no chat, o Anima
            mapeia tudo aqui — e liga cada uma ao pilar de vida correspondente.
          </p>
          <a href="/chat" className={styles.emptyLink}>Abrir chat →</a>
        </div>
      ) : (
        <div className={styles.groups}>
          {groups.map(g => (
            <EntityGroup key={g.name} label={g.name} entities={g.entities} />
          ))}
          {unlinked.length > 0 && (
            <EntityGroup label="Sem pilar" entities={unlinked} muted />
          )}
        </div>
      )}
    </main>
  );
}

function EntityGroup({ label, entities, muted }: { label: string; entities: Entity[]; muted?: boolean }) {
  return (
    <div className={styles.group}>
      <div className={styles.groupHeader}>
        <span className={`${styles.groupLabel} ${muted ? styles.groupLabelMuted : ''}`}>{label}</span>
        <span className={styles.groupCount}>{entities.length}</span>
      </div>
      <div className={styles.chips}>
        {entities.map(e => {
          const type = e.entity_type ?? 'conceito';
          const ctx  = typeof e.context === 'string' && e.context.trim() ? e.context : undefined;
          return (
            <div key={e.id} className={styles.chip} title={ctx}>
              <span className={`${styles.dot} ${styles[`type_${type}`] ?? ''}`} />
              <span className={styles.chipName}>{e.name}</span>
              <span className={styles.chipMeta}>
                {TYPE_LABELS[type] ?? type}
                {e.occurrence_count > 1 ? ` · ${e.occurrence_count}×` : ''}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
