import { DEFAULT_CODER_HARNESS_POLICY_V1, resolveEffectiveCoderHarnessPolicy } from '@anima/core';
import { analyzeCoderOutputFiles, collectCoderOutputForHarness, isAnalyzableSourcePath, type CoderOutputFile, type CoderOutputSource } from './coder-output-analysis';

const POLICY = DEFAULT_CODER_HARNESS_POLICY_V1;
const file = (path: string, content: string): CoderOutputFile => ({ path, content });
const kinds = (files: CoderOutputFile[]): string[] => analyzeCoderOutputFiles(files, POLICY).violations.map(v => v.kind);
const analyze = (path: string, content: string) => analyzeCoderOutputFiles([file(path, content)], POLICY);

describe('runner incompatível — detecção estrutural (AST) em todas as formas', () => {
  test.each<[string, string]>([
    ['import normal', `import { test } from 'vitest';\n`],
    ['import default', `import vi from 'vitest';\n`],
    ['side-effect', `import 'vitest';\n`],
    ['dynamic import', `const m = await import('vitest');\n`],
    ['require', `const { test } = require('vitest');\n`],
    ['import equals', `import v = require('vitest');\n`],
    ['subpath', `import { defineConfig } from 'vitest/config';\n`],
    ['re-export', `export { test } from 'vitest';\n`],
    ['multiline', `import {\n  describe,\n  test,\n} from 'vitest';\n`],
  ])('vitest via %s ⇒ violação de runner', (_form, content) => {
    const r = analyze('apps/web/lib/settlement.test.ts', content);
    expect(r.ok).toBe(false);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]).toMatchObject({ kind: 'incompatible_test_runner', importedRunner: 'vitest', requiredRunner: 'jest' });
  });

  test('helper/setup NÃO-*.test* importando vitest também é violação (regra vale p/ todo script)', () => {
    expect(kinds([file('apps/web/test-setup.ts', `import 'vitest';\n`)])).toEqual(['incompatible_test_runner']);
    expect(kinds([file('apps/web/lib/helpers/vi-helper.ts', `import { vi } from 'vitest';\n`)])).toEqual(['incompatible_test_runner']);
  });

  test('Jest (@jest/globals) e globais NÃO são violação', () => {
    expect(analyze('a.test.ts', `import { test, expect } from '@jest/globals';\ntest('x', () => expect(1).toBe(1));\n`).ok).toBe(true);
    expect(analyze('b.test.ts', `describe('b', () => { test('t', () => { expect(2).toBe(2); }); });\n`).ok).toBe(true);
  });

  test('strings e comentários mencionando vitest NÃO disparam (AST, não texto)', () => {
    expect(analyze('a.test.ts', `const s = "import { test } from 'vitest'";\n`).ok).toBe(true);
    expect(analyze('a.test.ts', "const t = `import 'vitest'`;\n").ok).toBe(true);
    expect(analyze('a.test.ts', `// import { test } from 'vitest';\n`).ok).toBe(true);
    expect(analyze('a.test.ts', `/* import 'vitest' */\nexport const x = 1;\n`).ok).toBe(true);
  });

  test('reporta a linha correta do especificador', () => {
    const r = analyze('a.test.ts', `import { a } from './a';\n\nimport { test } from 'vitest';\n`);
    expect(r.violations[0]).toMatchObject({ kind: 'incompatible_test_runner', line: 3 });
  });
});

describe('fonte não autoritativa do backend — detecção estrutural (AST)', () => {
  test.each<[string, string]>([
    ['member access', `const r = entry.coderBackend === 'openai';\n`],
    ['optional chaining', `const r = entry?.coderBackend;\n`],
    ['non-null assertion', `const r = entry!.coderBackend;\n`],
    ['bracket double-quote', `const r = entry["coderBackend"];\n`],
    ['bracket single-quote', `const r = entry['coderBackend'];\n`],
    ['destructuring', `const { coderBackend } = entry;\n`],
    ['destructuring rename', `const { coderBackend: b } = entry;\n`],
    ['multiline access', `const r = entry\n  .coderBackend;\n`],
  ])('entry.coderBackend via %s ⇒ violação de backend', (_form, content) => {
    const r = analyze('apps/web/lib/route.ts', content);
    expect(r.ok).toBe(false);
    expect(r.violations.some(v => v.kind === 'non_authoritative_backend_source' && v.expression === 'entry.coderBackend')).toBe(true);
  });

  test('alias local simples (const e = entry; e.coderBackend) ⇒ violação', () => {
    expect(kinds([file('a.ts', `const e = entry;\nconst r = e.coderBackend;\n`)])).toEqual(['non_authoritative_backend_source']);
  });

  test('alias de alias (const e = entry; const f = e; f.coderBackend) ⇒ violação', () => {
    expect(kinds([file('a.ts', `const e = entry;\nconst f = e;\nconst r = f['coderBackend'];\n`)])).toEqual(['non_authoritative_backend_source']);
  });

  test('fontes AUTORITATIVAS não disparam (contract.coderBackend, computeDecision.selectedProvider)', () => {
    expect(analyze('a.ts', `const r = contract.coderBackend === 'openai';\nconst s = computeDecision.selectedProvider;\n`).ok).toBe(true);
  });

  test('strings / templates / comentários / mensagens NÃO disparam', () => {
    expect(analyze('a.ts', `const s = "entry.coderBackend";\n`).ok).toBe(true);
    expect(analyze('a.ts', "const t = `use entry.coderBackend`;\n").ok).toBe(true);
    expect(analyze('a.ts', `// entry.coderBackend não é autoritativa\nexport const x = 1;\n`).ok).toBe(true);
    expect(analyze('a.ts', `throw new Error('entry.coderBackend is forbidden');\n`).ok).toBe(true);
  });

  test('fronteira conservadora: cadeia profunda (obj.entry.coderBackend) e outra propriedade NÃO disparam', () => {
    expect(analyze('a.ts', `const r = obj.entry.coderBackend;\n`).ok).toBe(true);
    expect(analyze('a.ts', `const r = entry.somethingElse;\n`).ok).toBe(true);
    expect(analyze('a.ts', `const r = otherEntry.coderBackend;\n`).ok).toBe(true);
  });
});

describe('escopo de arquivos e combinação', () => {
  test('arquivos não-script (.md/.json) são ignorados (não parseados como TS)', () => {
    expect(isAnalyzableSourcePath('a.md')).toBe(false);
    expect(isAnalyzableSourcePath('a.json')).toBe(false);
    expect(isAnalyzableSourcePath('a.ts')).toBe(true);
    expect(isAnalyzableSourcePath('a.test.tsx')).toBe(true);
    expect(analyze('docs/notes.md', `entry.coderBackend e import 'vitest'\n`).ok).toBe(true);
  });

  test('ambos os modos juntos ⇒ ambas as violações; nada mascarado', () => {
    const r = analyze('a.test.ts', `import { test } from 'vitest';\nconst x = entry.coderBackend;\n`);
    expect(r.ok).toBe(false);
    expect(r.violations.map(v => v.kind).sort()).toEqual(['incompatible_test_runner', 'non_authoritative_backend_source']);
  });

  test('conjunto limpo ⇒ ok; lista vazia ⇒ ok', () => {
    expect(analyzeCoderOutputFiles([], POLICY).ok).toBe(true);
    expect(analyze('a.test.ts', `import { test, expect } from '@jest/globals';\ntest('ok', () => expect(1).toBe(1));\n`).ok).toBe(true);
  });

  test('política endurecida (superset) detecta runner/fonte extra', () => {
    const eff = resolveEffectiveCoderHarnessPolicy({ incompatibleTestRunners: ['mocha'], forbiddenBackendSources: ['queue.coderBackend'] });
    const r = analyzeCoderOutputFiles([file('a.test.ts', `import 'mocha';\nconst x = queue.coderBackend;\n`)], eff);
    expect(r.violations.map(v => v.kind).sort()).toEqual(['incompatible_test_runner', 'non_authoritative_backend_source']);
    // e as canônicas continuam valendo
    expect(analyzeCoderOutputFiles([file('b.test.ts', `import 'vitest';\n`)], eff).ok).toBe(false);
  });
});

describe('collectCoderOutputForHarness — leitura FAIL-CLOSED por status Git', () => {
  const source = (
    entries: readonly { status: string; path: string; oldPath?: string }[],
    contents: Record<string, string | null>,
  ): CoderOutputSource => ({
    changedEntriesSinceStart: async () => entries,
    readWorkspaceFile: async (p: string) => (p in contents ? contents[p]! : null),
  });

  test('A/M/R são lidos; D é pulado (deleção legitimamente sem conteúdo)', async () => {
    const res = await collectCoderOutputForHarness(source(
      [{ status: 'A', path: 'src/new.ts' }, { status: 'M', path: 'src/mod.ts' }, { status: 'R', path: 'src/renamed.ts', oldPath: 'src/old.ts' }, { status: 'D', path: 'src/gone.ts' }],
      { 'src/new.ts': 'export const a = 1;\n', 'src/mod.ts': 'export const b = 2;\n', 'src/renamed.ts': 'export const c = 3;\n' },
    ));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.files.map(f => f.path).sort()).toEqual(['src/mod.ts', 'src/new.ts', 'src/renamed.ts']);
  });

  test('A/M/R com leitura falha (null) ⇒ ok:false fail-closed, identificando o arquivo', async () => {
    const res = await collectCoderOutputForHarness(source(
      [{ status: 'M', path: 'src/ok.ts' }, { status: 'A', path: 'src/broken.ts' }],
      { 'src/ok.ts': 'export const a = 1;\n', 'src/broken.ts': null },
    ));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.unreadable).toEqual({ status: 'A', path: 'src/broken.ts' });
  });

  test('rename com destino ilegível ⇒ fail-closed (não passa silenciosamente)', async () => {
    const res = await collectCoderOutputForHarness(source(
      [{ status: 'R', path: 'src/renamed.ts', oldPath: 'src/old.ts' }],
      { 'src/renamed.ts': null },
    ));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.unreadable.status).toBe('R');
  });

  test('só deleções ⇒ ok com zero arquivos (nada a inspecionar, sem erro)', async () => {
    const res = await collectCoderOutputForHarness(source([{ status: 'D', path: 'src/gone.ts' }], {}));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.files).toEqual([]);
  });
});
