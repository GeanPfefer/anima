import {
  readReplanDiagnosis,
  deriveReplanStrategy,
  hasMaterialReplanProgress,
  replanInstructions,
  replanDiagnosisJson,
  type ReplanDiagnosis,
} from './replan';

// Diagnóstico humano canônico (Plano 007): unidade mínima de teste, testes
// incorretos, correção semântica declarada. A prova aqui é PURA e determinística:
// ordem/redação não concedem progresso; só a estratégia estrutural conta.
const REF = 'docs/registros/2026-09-02-diagnostico-semantico-pin02.md';
const diagnosis = (overrides: Partial<ReplanDiagnosis> = {}): ReplanDiagnosis => ({
  schemaVersion: 1,
  finding: 'test_code_incorrect',
  evidenceReference: REF,
  corrections: [
    { kind: 'resolve_imports', symbols: ['serialize', 'parse'], instruction: 'Importar os símbolos da API pública antes de chamar.' },
  ],
  ...overrides,
});

describe('readReplanDiagnosis — validação fail-closed', () => {
  test('aceita um diagnóstico bem-formado e o devolve verbatim', () => {
    const d = diagnosis();
    expect(readReplanDiagnosis(d)).toBe(d);
  });

  test('aceita até três correções de kinds distintos', () => {
    const d = diagnosis({
      corrections: [
        { kind: 'resolve_imports', symbols: ['parse'], instruction: 'Importar da API pública.' },
        { kind: 'respect_api_types', symbols: ['SchemaV1'], instruction: 'Usar os tipos exportados sem recriá-los.' },
        { kind: 'assert_public_boundary', symbols: ['decode'], instruction: 'Exercitar apenas a composição pública.' },
      ],
    });
    expect(readReplanDiagnosis(d)).toBe(d);
  });

  test.each([
    ['não é objeto', 42],
    ['é array', []],
    ['é nulo', null],
    ['chave extra', { ...diagnosis(), extra: 1 }],
    ['schemaVersion errado', { ...diagnosis(), schemaVersion: 2 }],
    ['finding fora do domínio', { ...diagnosis(), finding: 'implementation_incorrect' }],
    ['evidenceReference fora de docs/registros', { ...diagnosis(), evidenceReference: 'notas/diag.md' }],
    ['evidenceReference sem .md', { ...diagnosis(), evidenceReference: 'docs/registros/diag.txt' }],
    ['corrections vazio', { ...diagnosis(), corrections: [] }],
    ['corrections além de três', {
      ...diagnosis(), corrections: [
        { kind: 'resolve_imports', symbols: ['a'], instruction: 'instrução válida x' },
        { kind: 'respect_api_types', symbols: ['b'], instruction: 'instrução válida y' },
        { kind: 'assert_public_boundary', symbols: ['c'], instruction: 'instrução válida z' },
        { kind: 'resolve_imports', symbols: ['d'], instruction: 'instrução válida w' },
      ],
    }],
    ['kind duplicado', {
      ...diagnosis(), corrections: [
        { kind: 'resolve_imports', symbols: ['a'], instruction: 'instrução válida x' },
        { kind: 'resolve_imports', symbols: ['b'], instruction: 'instrução válida y' },
      ],
    }],
    ['kind inválido', { ...diagnosis(), corrections: [{ kind: 'rewrite_everything', symbols: ['a'], instruction: 'instrução válida x' }] }],
    ['instrução curta demais', { ...diagnosis(), corrections: [{ kind: 'resolve_imports', symbols: ['a'], instruction: 'curta' }] }],
    ['symbols vazio', { ...diagnosis(), corrections: [{ kind: 'resolve_imports', symbols: [], instruction: 'instrução válida x' }] }],
    ['symbol com caractere ilegal', { ...diagnosis(), corrections: [{ kind: 'resolve_imports', symbols: ['a b'], instruction: 'instrução válida x' }] }],
    ['symbol duplicado', { ...diagnosis(), corrections: [{ kind: 'resolve_imports', symbols: ['a', 'a'], instruction: 'instrução válida x' }] }],
    ['correção com chave extra', { ...diagnosis(), corrections: [{ kind: 'resolve_imports', symbols: ['a'], instruction: 'instrução válida x', extra: 1 }] }],
  ])('recusa quando %s', (_label, value) => {
    expect(readReplanDiagnosis(value)).toBeNull();
  });

  test('recusa instrução acima do teto de 600 caracteres', () => {
    expect(readReplanDiagnosis(diagnosis({ corrections: [{ kind: 'resolve_imports', symbols: ['a'], instruction: 'x'.repeat(601) }] }))).toBeNull();
  });

  test('recusa mais de doze símbolos', () => {
    const symbols = Array.from({ length: 13 }, (_v, i) => `s${i}`);
    expect(readReplanDiagnosis(diagnosis({ corrections: [{ kind: 'resolve_imports', symbols, instruction: 'instrução válida x' }] }))).toBeNull();
  });
});

describe('deriveReplanStrategy — canônica: ordem e redação não são progresso', () => {
  test('normaliza ordem de símbolos e de correções para uma forma estável', () => {
    const a = deriveReplanStrategy(diagnosis({
      corrections: [
        { kind: 'respect_api_types', symbols: ['b', 'a'], instruction: 'instrução válida x' },
        { kind: 'resolve_imports', symbols: ['z', 'y'], instruction: 'instrução válida y' },
      ],
    }));
    const b = deriveReplanStrategy(diagnosis({
      corrections: [
        { kind: 'resolve_imports', symbols: ['y', 'z'], instruction: 'REDAÇÃO totalmente diferente aqui' },
        { kind: 'respect_api_types', symbols: ['a', 'b'], instruction: 'outra prosa qualquer' },
      ],
    }));
    expect(a).toEqual(b);
    expect(a).toEqual([
      { kind: 'resolve_imports', symbols: ['y', 'z'] },
      { kind: 'respect_api_types', symbols: ['a', 'b'] },
    ]);
  });
});

describe('hasMaterialReplanProgress — mesmo plano disfarçado é recusado', () => {
  test('qualquer diagnóstico é progresso quando não há estratégia anterior', () => {
    expect(hasMaterialReplanProgress(diagnosis(), undefined)).toBe(true);
    expect(hasMaterialReplanProgress(diagnosis(), null)).toBe(true);
  });

  test('estratégia anterior idêntica (reordenada/reescrita) NÃO é progresso', () => {
    const prior = deriveReplanStrategy(diagnosis({
      corrections: [{ kind: 'resolve_imports', symbols: ['parse', 'serialize'], instruction: 'prosa distinta, mesma estratégia' }],
    }));
    expect(hasMaterialReplanProgress(diagnosis(), prior)).toBe(false);
  });

  test('estratégia com símbolo diferente É progresso', () => {
    const prior = deriveReplanStrategy(diagnosis({
      corrections: [{ kind: 'resolve_imports', symbols: ['parse'], instruction: 'instrução válida x' }],
    }));
    expect(hasMaterialReplanProgress(diagnosis(), prior)).toBe(true);
  });

  test('estratégia com kind diferente É progresso', () => {
    const prior = deriveReplanStrategy(diagnosis({
      corrections: [{ kind: 'respect_api_types', symbols: ['parse', 'serialize'], instruction: 'instrução válida x' }],
    }));
    expect(hasMaterialReplanProgress(diagnosis(), prior)).toBe(true);
  });

  test('fail-closed: prior de forma desconhecida ou malformada não concede progresso', () => {
    expect(hasMaterialReplanProgress(diagnosis(), 'sei lá')).toBe(false);
    expect(hasMaterialReplanProgress(diagnosis(), [{ kind: 'resolve_imports' }])).toBe(false);
  });
});

describe('replanInstructions — formatação determinística', () => {
  test('ordena por kind e símbolos independentemente da entrada', () => {
    const text = replanInstructions(diagnosis({
      corrections: [
        { kind: 'respect_api_types', symbols: ['b', 'a'], instruction: '  Respeitar os tipos.  ' },
        { kind: 'resolve_imports', symbols: ['z', 'y'], instruction: 'Importar da API.' },
      ],
    }));
    expect(text).toBe('resolve_imports (y, z): Importar da API.\nrespect_api_types (a, b): Respeitar os tipos.');
  });
});

describe('replanDiagnosisJson — serialização estável', () => {
  test('produz JSON simples que faz round-trip', () => {
    const d = diagnosis();
    const json = replanDiagnosisJson(d);
    expect(JSON.parse(JSON.stringify(json))).toEqual(d);
  });
});
