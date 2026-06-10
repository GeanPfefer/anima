import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getXPToNextLevel, getTotalXPForLevel, getEraForLevel, getCharacterLevel } from '@anima/core';
import LifeRadar from './_components/LifeRadar';
import LogActivityModal from './_components/LogActivityModal';
import InsightCard from './_components/InsightCard';
import PendingPillarsWidget from './_components/PendingPillarsWidget';
import styles from './home.module.css';

type Pillar = {
  id: string;
  name: string;
  xp_rate: number;
  xp_total: number;
  level: number;
  is_active: boolean;
  is_priority: boolean;
};

type PillarWithChildren = Pillar & { children: Pillar[] };

export default async function HomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/(onboarding)/welcome');

  const { data: profile } = await supabase
    .from('profiles')
    .select('name')
    .eq('id', user.id)
    .single();

  if (!profile) redirect('/(onboarding)/welcome');

  // ── Insight mais recente não dispensado ───────────────────────
  const { data: latestInsight } = await supabase
    .from('insights')
    .select('id, text, generated_at')
    .eq('user_id', user.id)
    .is('dismissed_at', null)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Condição para disparar nova geração (cliente decide, server apenas conta)
  const { count: recentEntryCount } = await supabase
    .from('xp_records')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gt(
      'created_at',
      latestInsight?.generated_at ?? new Date(0).toISOString(),
    );

  const shouldTriggerInsight =
    !latestInsight &&
    (recentEntryCount ?? 0) >= 5;

  // Pilares pendentes — detectados pela IA, aguardando confirmação do usuário
  const { data: pendingPillarsData } = await supabase
    .from('user_pillars')
    .select('id, name, pending_activity')
    .eq('user_id', user.id)
    .eq('status', 'pending');

  type PendingPillar = { id: string; name: string; pending_activity: { durationMinutes: number; note: string } | null };
  const pendingPillars = (pendingPillarsData ?? []) as PendingPillar[];

  const { data: pillarsData } = await supabase
    .from('user_pillars')
    .select('id, name, xp_rate, xp_total, level, is_active, is_priority')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .order('sort_order');

  const pillars: Pillar[] = pillarsData ?? [];

  // Busca todas as relações pai→filho do usuário
  const { data: relationsData } = await supabase
    .from('pillar_relationships')
    .select('parent_id, child_id')
    .in('parent_id', pillars.map((p) => p.id));

  const relations = relationsData ?? [];

  // Conjunto de ids que são filhos (têm pelo menos um pai)
  const childIds = new Set(relations.map((r) => r.child_id));

  // Mapa filho → pais para montagem da árvore
  const childrenByParent = new Map<string, string[]>();
  for (const r of relations) {
    const list = childrenByParent.get(r.parent_id) ?? [];
    list.push(r.child_id);
    childrenByParent.set(r.parent_id, list);
  }

  const pillarMap = new Map(pillars.map((p) => [p.id, p]));

  // Pilares raiz (sem pais)
  const rootPillars: PillarWithChildren[] = pillars
    .filter((p) => !childIds.has(p.id))
    .map((p) => ({
      ...p,
      children: (childrenByParent.get(p.id) ?? [])
        .map((cid) => pillarMap.get(cid))
        .filter((c): c is Pillar => c !== undefined),
    }));

  // Radar só usa pilares raiz
  const radarPillars = rootPillars;
  const characterLevel = getCharacterLevel(rootPillars.map((p) => p.level));
  const era = getEraForLevel(characterLevel);

  // Todos os pilares disponíveis para o modal de registro (raiz + filhos)
  const allPillarsForModal = pillars.map((p) => ({ id: p.id, name: p.name, xp_rate: p.xp_rate }));

  function PillarCard({ p, sub = false }: { p: Pillar; sub?: boolean }) {
    const levelStart = getTotalXPForLevel(p.level);
    const levelEnd = getTotalXPForLevel(p.level + 1);
    const progress =
      levelEnd > levelStart
        ? Math.max(0, (p.xp_total - levelStart) / (levelEnd - levelStart))
        : 1;
    const xpToNext = getXPToNextLevel(p.xp_total);

    return (
      <div
        className={[
          sub ? styles.subPillarCard : styles.pillarCard,
          p.is_priority && !sub ? styles.pillarPriority : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className={styles.pillarTop}>
          <span className={sub ? styles.subPillarName : styles.pillarName}>{p.name}</span>
          <span className={styles.pillarLevel}>Nv. {p.level}</span>
        </div>
        <div className={sub ? styles.subXpBar : styles.xpBar}>
          <div
            className={styles.xpFill}
            style={{ width: `${Math.min(progress * 100, 100).toFixed(1)}%` }}
          />
        </div>
        <div className={styles.pillarBottom}>
          <span className={styles.xpTotal}>
            {p.xp_total.toLocaleString('pt-BR')} XP
          </span>
          {p.level < 50 && (
            <span className={styles.xpToNext}>
              +{xpToNext} para Nv. {p.level + 1}
            </span>
          )}
          {p.is_priority && !sub && (
            <span className={styles.priorityBadge}>foco</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.name}>{profile.name}</h1>
        <div className={styles.characterMeta}>
          <span className={styles.level}>Nível {characterLevel}</span>
          <span className={styles.separator}>·</span>
          <span className={styles.era}>{era.name}</span>
        </div>
      </header>

      {/* Pilares detectados pela IA aguardando confirmação */}
      <PendingPillarsWidget pillars={pendingPillars} />

      {/* Insight automático (Camada 4) */}
      <InsightCard
        insight={latestInsight ?? null}
        shouldTrigger={shouldTriggerInsight}
      />

      <div className={styles.content}>
        <section className={styles.radarSection}>
          <p className={styles.sectionLabel}>Radar de vida</p>
          {radarPillars.length >= 3 ? (
            <LifeRadar pillars={radarPillars} />
          ) : (
            <p className={styles.empty}>Nenhum pilar registrado.</p>
          )}
        </section>

        <section className={styles.pillarsSection}>
          <p className={styles.sectionLabel}>Pilares</p>
          {rootPillars.length === 0 ? (
            <p className={styles.empty}>Complete o onboarding para ver seus pilares.</p>
          ) : (
            <div className={styles.pillarList}>
              {rootPillars.map((p) => (
                <div key={p.id} className={styles.pillarGroup}>
                  <PillarCard p={p} />
                  {p.children.length > 0 && (
                    <div className={styles.subPillarList}>
                      {p.children.map((child) => (
                        <PillarCard key={child.id} p={child} sub />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className={styles.footer}>
        <LogActivityModal pillars={allPillarsForModal} />
      </div>
    </main>
  );
}
