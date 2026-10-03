import type { PillarConfig } from '@anima/types';
import {
  MEANINGFUL_CONNECTION_XP,
  PHYSICAL_ACHIEVEMENT_XP,
  calculateActivityXP,
  calculateBonusMultiplier,
  calculateFinancialEventXP,
  calculateStateChangeDeltaXP,
} from './xp';

const buildPillar = (xpRate: number): PillarConfig => ({
  id: 'mente',
  name: 'Mente',
  xpRate,
  isDefault: true,
  isCustom: false,
});

describe('calculateBonusMultiplier', () => {
  it('retorna 1 quando não há bônus', () => {
    expect(calculateBonusMultiplier([])).toBe(1);
  });

  it.each([
    ['forgotten_pillar', 1.5],
    ['active_streak', 1.3],
    ['first_of_day', 1.2],
    ['active_quest', 1.4],
  ] as const)('aplica a taxa do bônus %s', (bonus, expected) => {
    expect(calculateBonusMultiplier([bonus])).toBeCloseTo(expected, 10);
  });

  it('soma as taxas de bônus de tipos diferentes', () => {
    expect(calculateBonusMultiplier(['first_of_day', 'active_streak'])).toBeCloseTo(1.5, 10);
    expect(calculateBonusMultiplier(['forgotten_pillar', 'active_quest'])).toBeCloseTo(1.9, 10);
  });
});

describe('calculateActivityXP', () => {
  it('arredonda o XP base e o XP total', () => {
    const result = calculateActivityXP(7, buildPillar(1.3), ['first_of_day']);

    expect(result.baseXP).toBe(9);
    expect(result.bonusMultiplier).toBeCloseTo(1.2, 10);
    expect(result.totalXP).toBe(11);
  });

  it('mantém o XP base quando não há bônus', () => {
    expect(calculateActivityXP(30, buildPillar(1), [])).toEqual({
      baseXP: 30,
      bonusMultiplier: 1,
      totalXP: 30,
    });
  });
});

describe('calculateFinancialEventXP', () => {
  it('converte valor positivo em XP (valor ÷ 10, arredondado)', () => {
    expect(calculateFinancialEventXP(100)).toBe(10);
    expect(calculateFinancialEventXP(249)).toBe(25);
  });

  it('usa o valor absoluto para valores negativos', () => {
    expect(calculateFinancialEventXP(-100)).toBe(10);
    expect(calculateFinancialEventXP(-249)).toBe(25);
  });

  it('retorna 0 para valor zero', () => {
    expect(calculateFinancialEventXP(0)).toBe(0);
  });
});

describe('calculateStateChangeDeltaXP', () => {
  it.each([
    [10, 10],
    [-10, 10],
    [3.4, 3],
    [-3.4, 3],
    [0, 0],
  ])('converte o delta %p em %p XP', (delta, expected) => {
    expect(calculateStateChangeDeltaXP(delta)).toBe(expected);
  });
});

describe('constantes de XP', () => {
  it('PHYSICAL_ACHIEVEMENT_XP vale 300', () => {
    expect(PHYSICAL_ACHIEVEMENT_XP).toBe(300);
  });

  it('MEANINGFUL_CONNECTION_XP vale 80', () => {
    expect(MEANINGFUL_CONNECTION_XP).toBe(80);
  });
});
