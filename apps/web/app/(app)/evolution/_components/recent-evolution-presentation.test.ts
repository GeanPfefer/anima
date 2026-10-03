import { ANIMA_CAPABILITY_REGISTRY_V0, EVOLUTION_BASELINE, listRecentEvolution } from '@anima/core';
import { groupRecentEvolution, recentDateLabel, recentEventPresentation } from './recent-evolution-presentation';

test('agrupamento não altera dados, empates, cronologia ou quantidade', () => {
  const entries = listRecentEvolution(ANIMA_CAPABILITY_REGISTRY_V0, EVOLUTION_BASELINE.date);
  const before = JSON.stringify(entries);
  const groups = groupRecentEvolution(entries);
  expect(groups.flatMap(group => group.entries)).toEqual(entries);
  expect(entries).toHaveLength(45);
  expect(JSON.stringify(entries)).toBe(before);
  expect(groups.map(group => group.date)).toEqual([...new Set(entries.map(item => item.entry.at))]);
  expect(groups[0]!.title).toBe('Claude Code governado · AKT-04 · Codex governado · AKT-03');
  expect(groups[1]!.title).toBe('Akita Baseline V1 COMPLETE');
  expect(recentDateLabel('2026-10-03')).toBe('03 OUT 2026');
  expect(groupRecentEvolution([])).toEqual([]);
});

test('destaque de marco exige identidade, data, tipo e ref exatos; não interpreta texto', () => {
  const entries = listRecentEvolution(ANIMA_CAPABILITY_REGISTRY_V0, EVOLUTION_BASELINE.date);
  const milestone = entries.find(item => item.capabilityId === 'agency.codex-cli' && item.entry.at === '2026-10-03')!;
  expect(recentEventPresentation(milestone).kind).toBe('milestone');
  expect(recentEventPresentation({ ...milestone, entry: { ...milestone.entry, refs: [] } }).kind).toBe('proof');
  expect(recentEventPresentation({ ...milestone, capabilityId: 'other' }).kind).toBe('proof');
  expect(recentEventPresentation({ ...milestone, entry: { ...milestone.entry, at: '2026-10-02' } }).kind).toBe('proof');
  for (const [change, kind] of [['introduced', 'capability'], ['maturity_changed', 'maturity'], ['proof_added', 'proof'], ['relation_added', 'relation']] as const) {
    expect(recentEventPresentation({ capabilityId: 'other', entry: { ...milestone.entry, change } }).kind).toBe(kind);
  }
});
