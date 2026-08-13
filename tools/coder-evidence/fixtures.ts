// Fixtures sintéticas das 7 classes de tarefa da campanha de evidência do coder
// local (registro 2026-08-12). São PROXIES pequenos e determinísticos, não o
// repositório real — limitação assumida e documentada no README. Cada fixture
// entrega um workspace inicial em memória, o CoderEditRequest e um predicado
// SEMÂNTICO (`achieved`) que verifica se a mudança pretendida ocorreu de fato —
// métrica secundária, separada do desfecho primário (o host aceitou a edição?).

export interface Fixture {
  readonly id: string;
  readonly description: string;
  /** Conteúdo inicial do workspace (caminho → conteúdo). */
  readonly files: Readonly<Record<string, string>>;
  readonly objective: string;
  readonly includedScope: readonly string[];
  readonly excludedScope: readonly string[];
  /** Verificação semântica da mudança pretendida (métrica secundária). */
  achieved(final: ReadonlyMap<string, string>): boolean;
}

const dedent = (s: string): string => {
  const lines = s.replace(/^\n/, '').replace(/\n[ \t]*$/, '\n').split('\n');
  return lines.join('\n');
};

export const FIXTURES: readonly Fixture[] = [
  {
    id: 'single_min',
    description: '1 arquivo, edição mínima de um valor constante',
    files: {
      'config.ts': dedent(`
export const MAX_RETRIES = 3;

export function retryBudget(): number {
  return MAX_RETRIES;
}
`),
    },
    objective: 'Em config.ts, altere o valor de MAX_RETRIES de 3 para 5. Não toque em mais nada.',
    includedScope: ['config.ts'],
    excludedScope: ['dist/'],
    achieved: final => /MAX_RETRIES\s*=\s*5\b/.test(final.get('config.ts') ?? ''),
  },
  {
    id: 'multi_locate',
    description: 'múltiplos arquivos, localizar a função certa entre eles',
    files: {
      'a.ts': dedent(`
export function formatName(first: string, last: string): string {
  return first + ' ' + last;
}
`),
      'b.ts': dedent(`
export function computeTotal(values: number[]): number {
  let sum = 0;
  for (const v of values) sum = sum + v;
  return sum;
}
`),
      'c.ts': dedent(`
export function isEven(n: number): boolean {
  return n % 2 === 0;
}
`),
    },
    objective: 'Localize a função computeTotal (ela está em um dos arquivos do escopo) e faça-a retornar o dobro da soma (multiplique o resultado final por 2). Não altere as outras funções.',
    includedScope: ['a.ts', 'b.ts', 'c.ts'],
    excludedScope: ['node_modules/'],
    achieved: final => {
      const b = final.get('b.ts') ?? '';
      const a = final.get('a.ts') ?? '';
      const c = final.get('c.ts') ?? '';
      const doubled = /\*\s*2\b/.test(b) || /2\s*\*/.test(b) || /sum\s*\+\s*sum/.test(b);
      const othersIntact = a.includes('first + \' \' + last') && c.includes('n % 2 === 0');
      return doubled && othersIntact;
    },
  },
  {
    id: 'indent_nested',
    description: 'edição de linha em indentação profunda, preservando a indentação',
    files: {
      'handler.ts': dedent(`
export function handler(a: boolean, xs: number[], y: boolean): string {
  if (a) {
    for (const x of xs) {
      if (y) {
        return 'old';
      }
    }
  }
  return 'default';
}
`),
    },
    objective: "Em handler.ts, na linha profundamente aninhada que faz return 'old', troque 'old' por 'new'. Preserve a indentação existente.",
    includedScope: ['handler.ts'],
    excludedScope: ['dist/'],
    achieved: final => {
      const h = final.get('handler.ts') ?? '';
      return h.includes("return 'new';") && h.includes("        return 'new';") && !h.includes("return 'old'");
    },
  },
  {
    id: 'multiline_before',
    description: 'âncora `before` que abrange várias linhas',
    files: {
      'decls.ts': dedent(`
// bloco de declarações
const a = 1;
const b = 2;
const c = 3;
// fim do bloco
export const total = a + b + c;
`),
    },
    objective: 'Em decls.ts, substitua as três linhas de declaração separadas (const a = 1; / const b = 2; / const c = 3;) por uma única linha: const a = 1, b = 2, c = 3;',
    includedScope: ['decls.ts'],
    excludedScope: ['dist/'],
    achieved: final => {
      const d = final.get('decls.ts') ?? '';
      return /const a = 1, b = 2, c = 3;/.test(d) && !/^const b = 2;$/m.test(d);
    },
  },
  {
    id: 'create_new',
    description: 'criar arquivo novo (não existente no escopo)',
    files: {
      'utils/index.ts': dedent(`
export { clamp } from './clamp';
`),
    },
    objective: "Crie um arquivo NOVO em utils/greet.ts contendo exatamente: export function greet(name: string): string { return 'Olá ' + name; }",
    includedScope: ['utils/greet.ts', 'utils/index.ts'],
    excludedScope: ['dist/'],
    achieved: final => {
      const g = final.get('utils/greet.ts') ?? '';
      return /export function greet\s*\(/.test(g) && g.includes('Olá');
    },
  },
  {
    id: 'structural_add',
    description: 'adicionar um export novo, com export parecido já presente (âncora não-única)',
    files: {
      'flags.ts': dedent(`
export const featureA = true;
export const featureB = false;
`),
    },
    objective: 'Em flags.ts, adicione uma nova linha após featureB: export const featureC = true; Mantenha featureA e featureB exatamente como estão.',
    includedScope: ['flags.ts'],
    excludedScope: ['dist/'],
    achieved: final => {
      const f = final.get('flags.ts') ?? '';
      return /export const featureC = true;/.test(f)
        && /export const featureA = true;/.test(f)
        && /export const featureB = false;/.test(f);
    },
  },
  {
    id: 'cleanup',
    description: 'encolher um bloco redundante',
    files: {
      'redundant.ts': dedent(`
export function value(): number {
  const x = 1;
  const x2 = 1;
  const x3 = 1;
  return x;
}
`),
    },
    objective: 'Em redundant.ts, remova as duas declarações redundantes (const x2 = 1; e const x3 = 1;), mantendo apenas const x = 1; e o return x.',
    includedScope: ['redundant.ts'],
    excludedScope: ['dist/'],
    achieved: final => {
      const r = final.get('redundant.ts') ?? '';
      return !r.includes('x2') && !r.includes('x3') && /const x = 1;/.test(r) && /return x;/.test(r);
    },
  },
];

export const FIXTURE_IDS = FIXTURES.map(f => f.id);
