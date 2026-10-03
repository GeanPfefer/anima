import type { RecentEvolutionEntry } from '@anima/core';

// Editorial UI only: these highlights identify existing records exactly.
// No inference from note text, today's maturity, or file timestamps.
const MILESTONES = [
  { capabilityId: 'agency.claude-code', at: '2026-10-03', ref: 'docs/registros/2026-10-03-evolution-pos-akt04.md', title: 'Claude Code governado · AKT-04' },
  { capabilityId: 'agency.codex-cli', at: '2026-10-03',
    ref: 'docs/registros/2026-10-03-evolution-pos-akita-governed-codex.md', title: 'Codex governado · AKT-03' },
  { capabilityId: 'agency.akita-baseline-v1', at: '2026-10-02',
    ref: 'docs/registros/2026-10-02-akita-baseline-v1-ai-memory-live-proof.md', title: 'Akita Baseline V1 COMPLETE' },
] as const;

const CHANGE_PRESENTATION = {
  introduced: { kind: 'capability', glyph: '+', label: 'Capacidade' },
  maturity_changed: { kind: 'maturity', glyph: '↑', label: 'Maturidade' },
  proof_added: { kind: 'proof', glyph: '●', label: 'Prova' },
  relation_added: { kind: 'relation', glyph: '↔', label: 'Relação' },
} as const;

export function recentEventPresentation(item: RecentEvolutionEntry) {
  const milestone = MILESTONES.find(m => m.capabilityId === item.capabilityId
    && m.at === item.entry.at && item.entry.change === 'proof_added'
    && item.entry.refs.some(ref => ref.kind === 'record' && ref.ref === m.ref));
  return milestone
    ? { kind: 'milestone' as const, glyph: '◆', label: 'Marco', title: milestone.title }
    : { ...CHANGE_PRESENTATION[item.entry.change], title: undefined };
}

export function groupRecentEvolution(entries: readonly RecentEvolutionEntry[]) {
  const groups: { date: string; entries: RecentEvolutionEntry[]; title: string }[] = [];
  // Preserve the canonical chronological order, including ties and every entry.
  for (const item of entries) {
    let group = groups[groups.length - 1];
    if (!group || group.date !== item.entry.at) {
      group = { date: item.entry.at, entries: [], title: '' };
      groups.push(group);
    }
    group.entries.push(item);
  }
  for (const group of groups) {
    const milestones = group.entries.map(recentEventPresentation).flatMap(p => p.title ? [p.title] : []);
    const kinds = [...new Set(group.entries.map(item => recentEventPresentation(item).label))];
    group.title = milestones.length ? milestones.join(' · ') : kinds.join(' · ');
  }
  return groups;
}

export function recentDateLabel(date: string): string {
  const [year, month, day] = date.split('-');
  const months = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
  return `${day} ${months[Number(month) - 1]} ${year}`;
}
