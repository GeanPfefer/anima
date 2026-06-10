'use client';

import { useState } from 'react';
import { getXPToNextLevel, getTotalXPForLevel, getEraForLevel, getCharacterLevel } from '@anima/core';
import LifeRadar from './LifeRadar';
import LogActivityModal from './LogActivityModal';
import InsightCard from './InsightCard';
import PendingPillarsWidget from './PendingPillarsWidget';
import styles from '../home.module.css';
import dash from './HomeDashboard.module.css';

// ─── Tipos ────────────────────────────────────────────────────

export type DisplayMode = 'game' | 'analytical' | 'minimal';

export type Pillar = {
  id: string;
  name: string;
  xp_rate: number;
  xp_total: number;
  level: number;
  is_active: boolean;
  is_priority: boolean;
};

export type PillarWithChildren = Pillar & { children: Pillar[] };

export type PendingPillar = {
  id: string;
  name: string;
  pending_activity: { durationMinutes: number; note: string } | null;
};

export type XPRecord = {
  id: string;
  pillar_id: string;
  duration_minutes: number;
  total_xp: number;
  note: string | null;
  activity_date: string;
};

export type HomeDashboardProps = {
  profileName:         string;
  initialMode:         DisplayMode;
  rootPillars:         PillarWithChildren[];
  allPillarsForModal:  { id: string; name: string; xp_rate: number }[];
  latestInsight:       { id: string; text: string; generated_at: string } | null;
  shouldTriggerInsight: boolean;
  pendingPillars:      PendingPillar[];
  weeklyXpByPillar:    Record<string, number>;
  recentActivities:    XPRecord[];
  pillarMap:           Record<string, string>;
};

// ─── Mode toggle ─────────────────────────────────────────────

const MODE_LABELS: Record<DisplayMode, string> = {
  game:       'Game',
  analytical: 'Analítico',
  minimal:    'Minimal',
};

function ModeToggle({ mode, onChange }: { mode: DisplayMode; onChange: (m: DisplayMode) => void }) {
  return (
    <div className={dash.modeToggle}>
      {(['game', 'analytical', 'minimal'] as DisplayMode[]).map(m => (
        <button
          key={m}
          className={`${dash.modeBtn} ${mode === m ? dash.modeBtnActive : ''}`}
          onClick={() => onChange(m)}
        >
          {MODE_LABELS[m]}
        </button>
      ))}
    </div>
  );
}

// ─── PillarCard ───────────────────────────────────────────────

function PillarCard({ p, sub = false }: { p: Pillar; sub?: boolean }) {
  const levelStart = getTotalXPForLevel(p.level);
  const levelEnd   = getTotalXPForLevel(p.level + 1);
  const progress   = levelEnd > levelStart
    ? Math.max(0, (p.xp_total - levelStart) / (levelEnd - levelStart))
    : 1;
  const xpToNext   = getXPToNextLevel(p.xp_total);

  return (
    <div className={[
      sub ? styles.subPillarCard : styles.pillarCard,
      p.is_priority && !sub ? styles.pillarPriority : '',
    ].filter(Boolean).join(' ')}>
      <div className={styles.pillarTop}>
        <span className={sub ? styles.subPillarName : styles.pillarName}>{p.name}</span>
        <span className={styles.pillarLevel}>Nv. {p.level}</span>
      </div>
      <div className={sub ? styles.subXpBar : styles.xpBar}>
        <div className={styles.xpFill} style={{ width: `${Math.min(progress * 100, 100).toFixed(1)}%` }} />
      </div>
      <div className={styles.pillarBottom}>
        <span className={styles.xpTotal}>{p.xp_total.toLocaleString('pt-BR')} XP</span>
        {p.level < 50 && (
          <span className={styles.xpToNext}>+{xpToNext} para Nv. {p.level + 1}</span>
        )}
        {p.is_priority && !sub && <span className={styles.priorityBadge}>foco</span>}
      </div>
    </div>
  );
}

// ─── GameView ─────────────────────────────────────────────────

function GameView({ rootPillars }: { rootPillars: PillarWithChildren[] }) {
  return (
    <div className={styles.content}>
      <section className={styles.radarSection}>
        <p className={styles.sectionLabel}>Radar de vida</p>
        {rootPillars.length >= 3
          ? <LifeRadar pillars={rootPillars} />
          : <p className={styles.empty}>Nenhum pilar registrado.</p>}
      </section>

      <section className={styles.pillarsSection}>
        <p className={styles.sectionLabel}>Pilares</p>
        {rootPillars.length === 0
          ? <p className={styles.empty}>Complete o onboarding para ver seus pilares.</p>
          : (
            <div className={styles.pillarList}>
              {rootPillars.map(p => (
                <div key={p.id} className={styles.pillarGroup}>
                  <PillarCard p={p} />
                  {p.children.length > 0 && (
                    <div className={styles.subPillarList}>
                      {p.children.map(child => <PillarCard key={child.id} p={child} sub />)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
      </section>
    </div>
  );
}

// ─── AnalyticalView ──────────────────────────────────────────

function AnalyticalView({
  rootPillars,
  weeklyXpByPillar,
}: {
  rootPillars:      PillarWithChildren[];
  weeklyXpByPillar: Record<string, number>;
}) {
  const allPillars = rootPillars.flatMap(p => [p, ...p.children]);

  return (
    <div className={dash.analyticalView}>
      <p className={styles.sectionLabel}>Pilares — estatísticas</p>
      <div className={dash.statsTable}>
        <div className={dash.statsHeader}>
          <span>Pilar</span>
          <span>Nível</span>
          <span>XP Total</span>
          <span>XP (7d)</span>
        </div>
        {allPillars.map(p => (
          <div key={p.id} className={dash.statsRow}>
            <span className={dash.statsPillarName}>{p.name}</span>
            <span className={dash.statsValue}>{p.level}</span>
            <span className={dash.statsValue}>{p.xp_total.toLocaleString('pt-BR')}</span>
            <span className={dash.statsValue}>
              {(weeklyXpByPillar[p.id] ?? 0) > 0
                ? `+${(weeklyXpByPillar[p.id] ?? 0).toLocaleString('pt-BR')}`
                : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── MinimalView ──────────────────────────────────────────────

function MinimalView({
  rootPillars,
  recentActivities,
  pillarMap,
}: {
  rootPillars:      PillarWithChildren[];
  recentActivities: XPRecord[];
  pillarMap:        Record<string, string>;
}) {
  function formatDate(dateStr: string) {
    const d     = new Date(dateStr + 'T12:00:00');
    const today = new Date();
    const diff  = Math.floor((today.getTime() - d.getTime()) / 86400_000);
    if (diff === 0) return 'hoje';
    if (diff === 1) return 'ontem';
    return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
  }

  return (
    <div className={dash.minimalView}>
      <section className={dash.minimalSection}>
        <p className={styles.sectionLabel}>Pilares</p>
        <ul className={dash.minimalPillarList}>
          {rootPillars.map(p => (
            <li key={p.id} className={dash.minimalPillarItem}>
              <span className={dash.minimalPillarName}>{p.name}</span>
              <span className={dash.minimalPillarLevel}>Nv. {p.level}</span>
            </li>
          ))}
        </ul>
      </section>

      {recentActivities.length > 0 && (
        <section className={dash.minimalSection}>
          <p className={styles.sectionLabel}>Registros recentes</p>
          <ul className={dash.minimalList}>
            {recentActivities.map(r => (
              <li key={r.id} className={dash.minimalEntry}>
                <span className={dash.minimalDate}>{formatDate(r.activity_date)}</span>
                <span className={dash.minimalPillar}>{pillarMap[r.pillar_id] ?? '?'}</span>
                {r.note && <span className={dash.minimalNote}>{r.note}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ─── HomeDashboard ────────────────────────────────────────────

export default function HomeDashboard({
  profileName,
  initialMode,
  rootPillars,
  allPillarsForModal,
  latestInsight,
  shouldTriggerInsight,
  pendingPillars,
  weeklyXpByPillar,
  recentActivities,
  pillarMap,
}: HomeDashboardProps) {
  const [mode, setMode] = useState<DisplayMode>(initialMode);

  const characterLevel = getCharacterLevel(rootPillars.map(p => p.level));
  const era            = getEraForLevel(characterLevel);

  async function handleModeChange(m: DisplayMode) {
    setMode(m);
    fetch('/api/profile/display-mode', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ mode: m }),
    }).catch(() => {});
  }

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.name}>{profileName}</h1>
          {mode === 'game' && (
            <div className={styles.characterMeta}>
              <span className={styles.level}>Nível {characterLevel}</span>
              <span className={styles.separator}>·</span>
              <span className={styles.era}>{era.name}</span>
            </div>
          )}
        </div>
        <ModeToggle mode={mode} onChange={handleModeChange} />
      </header>

      <PendingPillarsWidget pillars={pendingPillars} />

      <InsightCard insight={latestInsight} shouldTrigger={shouldTriggerInsight} />

      {mode === 'game'       && <GameView rootPillars={rootPillars} />}
      {mode === 'analytical' && (
        <AnalyticalView rootPillars={rootPillars} weeklyXpByPillar={weeklyXpByPillar} />
      )}
      {mode === 'minimal'    && (
        <MinimalView
          rootPillars={rootPillars}
          recentActivities={recentActivities}
          pillarMap={pillarMap}
        />
      )}

      <div className={styles.footer}>
        <LogActivityModal pillars={allPillarsForModal} />
      </div>
    </main>
  );
}
