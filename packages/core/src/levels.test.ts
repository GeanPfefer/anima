import { MAX_LEVEL, MIN_LEVEL, getEraForLevel } from './levels';

describe('getEraForLevel', () => {
  it.each([
    [MIN_LEVEL, 'Despertar'],
    [10, 'Despertar'],
    [11, 'Construção'],
    [20, 'Construção'],
    [21, 'Expansão'],
    [35, 'Expansão'],
    [36, 'Maestria'],
    [45, 'Maestria'],
    [46, 'Lenda'],
    [MAX_LEVEL, 'Lenda'],
  ] as const)('retorna a era correta para o nível %i', (level, expectedEra) => {
    expect(getEraForLevel(level).name).toBe(expectedEra);
  });
});
