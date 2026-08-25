import {
  applyEditOperations,
  parseEditOperations,
  sha256,
} from './ollama-protocol';
import {
  ExperimentalAnchorError,
  applyExperimentalAnchorOperations,
  createServedAnchor,
  parseExperimentalAnchorOperations,
  type ServedAnchor,
} from './ollama-anchor-experiment';

const FILE = 'packages/core/src/example.ts';
const OTHER = 'packages/core/src/other.ts';
const CYCLE = 'cycle:r2-test:1';

const source = [
  'export const before = 1;',
  'function target() {',
  '  const value = 10;',
  '  return value;',
  '}',
  'export const after = 2;',
  '',
].join('\n');

const allowed = new Set([FILE, OTHER]);

const anchor = (
  overrides: Partial<Parameters<typeof createServedAnchor>[0]> = {},
): ServedAnchor =>
  createServedAnchor({
    cycleId: CYCLE,
    ordinal: 0,
    path: FILE,
    fileContent: source,
    startLine: 2,
    endLine: 5,
    allowedPaths: allowed,
    ...overrides,
  });

const op = (anchorId: string, after = 'function target() {\n  return 20;\n}'): unknown => ({
  kind: 'replace_anchor',
  anchor_id: anchorId,
  after,
});

const expectCode = (fn: () => unknown, code: ExperimentalAnchorError['code']): void => {
  try {
    fn();
    throw new Error(`esperava ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ExperimentalAnchorError);
    expect((error as ExperimentalAnchorError).code).toBe(code);
  }
};

describe('R2 Fase A — contrato puro experimental de âncora host-mediada', () => {
  test('emissão de anchorId é determinística e ligada ao ciclo/snapshot/range', () => {
    const first = anchor();
    const same = anchor();
    const anotherOrdinal = anchor({ ordinal: 1 });
    const anotherCycle = anchor({ cycleId: 'cycle:r2-test:2' });

    expect(first.anchorId).toBe(same.anchorId);
    expect(first.anchorId).not.toBe(anotherOrdinal.anchorId);
    expect(first.anchorId).not.toBe(anotherCycle.anchorId);
    expect(first.path).toBe(FILE);
    expect(first.fileSha256).toBe(sha256(source));
    expect(first.rawSlice).toBe(
      'function target() {\n  const value = 10;\n  return value;\n}',
    );
    expect(first.rawSliceSha256).toBe(sha256(first.rawSlice));
  });

  test('âncora válida aplica exatamente o intervalo e preserva todo o resto byte a byte', () => {
    const served = anchor();
    const operations = parseExperimentalAnchorOperations([
      op(served.anchorId, 'function target() {\n  return 20;\n}'),
    ]);

    const changes = applyExperimentalAnchorOperations({
      operations,
      anchors: new Map([[served.anchorId, served]]),
      cycleId: CYCLE,
      allowedPaths: allowed,
      contentOf: path => path === FILE ? source : null,
    });

    expect(changes).toEqual([{
      path: FILE,
      kind: 'replace',
      newContent: [
        'export const before = 1;',
        'function target() {',
        '  return 20;',
        '}',
        'export const after = 2;',
        '',
      ].join('\n'),
    }]);
  });

  test('ID inexistente falha fechado', () => {
    const operations = parseExperimentalAnchorOperations([op('r2a_inexistente')]);

    expectCode(() => applyExperimentalAnchorOperations({
      operations,
      anchors: new Map(),
      cycleId: CYCLE,
      allowedPaths: allowed,
      contentOf: () => source,
    }), 'anchor_missing');
  });

  test('ID de outra sessão/ciclo falha fechado', () => {
    const served = anchor({ cycleId: 'cycle:outro' });
    const operations = parseExperimentalAnchorOperations([op(served.anchorId)]);

    expectCode(() => applyExperimentalAnchorOperations({
      operations,
      anchors: new Map([[served.anchorId, served]]),
      cycleId: CYCLE,
      allowedPaths: allowed,
      contentOf: () => source,
    }), 'anchor_cycle_mismatch');
  });

  test('SHA divergente falha fechado', () => {
    const served = anchor();
    const operations = parseExperimentalAnchorOperations([op(served.anchorId)]);

    expectCode(() => applyExperimentalAnchorOperations({
      operations,
      anchors: new Map([[served.anchorId, served]]),
      cycleId: CYCLE,
      allowedPaths: allowed,
      contentOf: () => `${source}// mudou\n`,
    }), 'anchor_stale_file');
  });

  test('conteúdo original divergente falha fechado mesmo se metadados forem adulterados', () => {
    const served = anchor();
    const forged: ServedAnchor = {
      ...served,
      rawSlice: `${served.rawSlice} adulterado`,
    };
    const operations = parseExperimentalAnchorOperations([op(served.anchorId)]);

    expectCode(() => applyExperimentalAnchorOperations({
      operations,
      anchors: new Map([[served.anchorId, forged]]),
      cycleId: CYCLE,
      allowedPaths: allowed,
      contentOf: () => source,
    }), 'anchor_content_mismatch');
  });

  test('path fora do escopo nunca pode ser criado nem obtido por âncora forjada', () => {
    expectCode(() => createServedAnchor({
      cycleId: CYCLE,
      ordinal: 0,
      path: '../secret.txt',
      fileContent: 'segredo',
      startLine: 1,
      endLine: 1,
      allowedPaths: allowed,
    }), 'anchor_outside_scope');

    const served = anchor();
    const forged: ServedAnchor = {
      ...served,
      path: 'fora/do/escopo.ts',
    };
    const operations = parseExperimentalAnchorOperations([op(served.anchorId)]);

    expectCode(() => applyExperimentalAnchorOperations({
      operations,
      anchors: new Map([[served.anchorId, forged]]),
      cycleId: CYCLE,
      allowedPaths: allowed,
      contentOf: () => source,
    }), 'anchor_outside_scope');
  });

  test('range inválido falha fechado na emissão e na resolução', () => {
    expectCode(() => createServedAnchor({
      cycleId: CYCLE,
      ordinal: 0,
      path: FILE,
      fileContent: source,
      startLine: 99,
      endLine: 100,
      allowedPaths: allowed,
    }), 'anchor_invalid_range');

    const served = anchor();
    const forged: ServedAnchor = {
      ...served,
      startLine: 99,
      endLine: 100,
    };
    const operations = parseExperimentalAnchorOperations([op(served.anchorId)]);

    expectCode(() => applyExperimentalAnchorOperations({
      operations,
      anchors: new Map([[served.anchorId, forged]]),
      cycleId: CYCLE,
      allowedPaths: allowed,
      contentOf: () => source,
    }), 'anchor_invalid_range');
  });

  test('operações sobrepostas falham fechado', () => {
    const first = createServedAnchor({
      cycleId: CYCLE,
      ordinal: 0,
      path: FILE,
      fileContent: source,
      startLine: 2,
      endLine: 4,
      allowedPaths: allowed,
    });
    const second = createServedAnchor({
      cycleId: CYCLE,
      ordinal: 1,
      path: FILE,
      fileContent: source,
      startLine: 4,
      endLine: 5,
      allowedPaths: allowed,
    });

    const operations = parseExperimentalAnchorOperations([
      op(first.anchorId, 'A'),
      op(second.anchorId, 'B'),
    ]);

    expectCode(() => applyExperimentalAnchorOperations({
      operations,
      anchors: new Map([
        [first.anchorId, first],
        [second.anchorId, second],
      ]),
      cycleId: CYCLE,
      allowedPaths: allowed,
      contentOf: () => source,
    }), 'anchor_overlap');
  });

  test('after fora do limite falha fechado', () => {
    const served = anchor();

    expectCode(() => parseExperimentalAnchorOperations([
      op(served.anchorId, 'x'.repeat(40_001)),
    ]), 'anchor_invalid_input');
  });

  test('no-op falha fechado', () => {
    const served = anchor();
    const operations = parseExperimentalAnchorOperations([
      op(served.anchorId, served.rawSlice),
    ]);

    expectCode(() => applyExperimentalAnchorOperations({
      operations,
      anchors: new Map([[served.anchorId, served]]),
      cycleId: CYCLE,
      allowedPaths: allowed,
      contentOf: () => source,
    }), 'anchor_no_effective_edits');
  });

  test('duas âncoras não sobrepostas aplicam sobre o snapshot original sem deslocar uma à outra', () => {
    const first = createServedAnchor({
      cycleId: CYCLE,
      ordinal: 0,
      path: FILE,
      fileContent: source,
      startLine: 1,
      endLine: 1,
      allowedPaths: allowed,
    });
    const second = createServedAnchor({
      cycleId: CYCLE,
      ordinal: 1,
      path: FILE,
      fileContent: source,
      startLine: 6,
      endLine: 6,
      allowedPaths: allowed,
    });

    const operations = parseExperimentalAnchorOperations([
      op(first.anchorId, 'export const before = 100;'),
      op(second.anchorId, 'export const after = 200;'),
    ]);

    const [change] = applyExperimentalAnchorOperations({
      operations,
      anchors: new Map([
        [first.anchorId, first],
        [second.anchorId, second],
      ]),
      cycleId: CYCLE,
      allowedPaths: allowed,
      contentOf: () => source,
    });

    expect(change!.newContent).toBe([
      'export const before = 100;',
      'function target() {',
      '  const value = 10;',
      '  return value;',
      '}',
      'export const after = 200;',
      '',
    ].join('\n'));
  });

  test('parser não aceita path/SHA/range fornecidos pelo modelo como autoridade alternativa', () => {
    const served = anchor();

    const parsed = parseExperimentalAnchorOperations([{
      kind: 'replace_anchor',
      anchor_id: served.anchorId,
      after: 'novo',
      path: '../../escape',
      expected_file_sha256: 'f'.repeat(64),
      start_line: 1,
      end_line: 999,
    }]);

    expect(parsed).toEqual([{
      kind: 'replace_anchor',
      anchorId: served.anchorId,
      after: 'novo',
    }]);
  });

  test('replace_exact de produção permanece com a semântica anterior', () => {
    const original = 'inicio\nALVO\nfim\n';
    const operations = parseEditOperations([{
      kind: 'replace_exact',
      path: FILE,
      expected_file_sha256: sha256(original),
      before: 'ALVO',
      after: 'EDITADO',
      expected_occurrences: 1,
    }], new Set([FILE]));

    const changes = applyEditOperations(
      operations,
      path => path === FILE ? original : null,
    );

    expect(changes).toEqual([{
      path: FILE,
      kind: 'replace',
      newContent: 'inicio\nEDITADO\nfim\n',
    }]);
  });
});
