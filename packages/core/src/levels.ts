import type { Era, EraName } from '@anima/types';

export const MAX_LEVEL = 50;
export const MIN_LEVEL = 1;

export const ERAS: Era[] = [
  { name: 'Despertar',  minLevel: 1,  maxLevel: 10, approximateTotalXP: 300,    estimatedTime: '~2 semanas' },
  { name: 'Construção', minLevel: 11, maxLevel: 20, approximateTotalXP: 2800,   estimatedTime: '~3 meses' },
  { name: 'Expansão',   minLevel: 21, maxLevel: 35, approximateTotalXP: 18000,  estimatedTime: '~1,5 anos' },
  { name: 'Maestria',   minLevel: 36, maxLevel: 45, approximateTotalXP: 55000,  estimatedTime: '~5 anos' },
  { name: 'Lenda',      minLevel: 46, maxLevel: 50, approximateTotalXP: 100000, estimatedTime: '~10 anos' },
];

/**
 * Curva exponencial: começo rápido, meio desafiador, topo quase inalcançável.
 * Retorna o XP necessário para passar do nível (level-1) para (level).
 */
export function getXPForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.round(10 * Math.pow(1.6, level - 1));
}

/** XP total acumulado ao atingir o nível informado (a partir do nível 1). */
export function getTotalXPForLevel(level: number): number {
  let total = 0;
  for (let l = 2; l <= level; l++) {
    total += getXPForLevel(l);
  }
  return total;
}

/** Deriva o nível atual a partir do XP total acumulado. */
export function getLevelFromTotalXP(totalXP: number): number {
  for (let level = MAX_LEVEL; level >= MIN_LEVEL; level--) {
    if (totalXP >= getTotalXPForLevel(level)) {
      return level;
    }
  }
  return MIN_LEVEL;
}

/** XP necessário para o próximo nível a partir do XP atual. */
export function getXPToNextLevel(totalXP: number): number {
  const current = getLevelFromTotalXP(totalXP);
  if (current >= MAX_LEVEL) return 0;
  return getTotalXPForLevel(current + 1) - totalXP;
}

export function getEraForLevel(level: number): Era {
  return ERAS.find((e) => level >= e.minLevel && level <= e.maxLevel) ?? ERAS[0]!;
}

/** Nível do personagem = média aritmética dos níveis de todos os pilares ativos. */
export function getCharacterLevel(pillarLevels: number[]): number {
  if (pillarLevels.length === 0) return MIN_LEVEL;
  const avg = pillarLevels.reduce((sum, l) => sum + l, 0) / pillarLevels.length;
  return Math.max(MIN_LEVEL, Math.round(avg));
}

/**
 * XP efetivo de cada pilar = XP próprio + XP de TODOS os descendentes
 * (propagação 100% para os ancestrais, conforme o design de sub-pilares).
 * Calculado em tempo de leitura — sempre consistente com a hierarquia atual,
 * sem denormalização. Seguro para múltiplos pais ("diamantes": cada descendente
 * é contado uma vez por ancestral) e para ciclos (conjunto de visitados).
 */
export function computeEffectiveXP(
  pillars: { id: string; xp_total: number }[],
  relations: { parent_id: string; child_id: string }[],
): Record<string, number> {
  const ownXP = new Map(pillars.map((p) => [p.id, p.xp_total]));
  const childrenOf = new Map<string, string[]>();
  for (const r of relations) {
    const list = childrenOf.get(r.parent_id) ?? [];
    list.push(r.child_id);
    childrenOf.set(r.parent_id, list);
  }

  const effective: Record<string, number> = {};
  for (const p of pillars) {
    // Semeia com o próprio nó: conta-o uma vez e evita recontagem via ciclo.
    const visited = new Set<string>([p.id]);
    const stack = [...(childrenOf.get(p.id) ?? [])];
    while (stack.length > 0) {
      const c = stack.pop()!;
      if (visited.has(c)) continue;
      visited.add(c);
      for (const gc of childrenOf.get(c) ?? []) stack.push(gc);
    }
    let sum = 0;
    for (const id of visited) sum += ownXP.get(id) ?? 0;
    effective[p.id] = sum;
  }
  return effective;
}
