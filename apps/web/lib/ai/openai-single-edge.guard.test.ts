/** @jest-environment node */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ============================================================
// PROVA ESTRUTURAL da invariante desta frente: não existe caminho de produção que
// alcance o provider OpenAI sem passar pela borda financeira única. A URL do
// provider (marcador definitivo de "faz uma chamada HTTP à OpenAI") só pode existir
// em `lib/ai/openai-paid-transport.ts`. Qualquer outro arquivo de produção que a
// contenha é um bypass — este teste falha e nomeia o infrator.
// ============================================================

const WEB_ROOT = join(__dirname, '..', '..'); // apps/web
const SCAN_DIRS = ['lib', 'app'];
const EDGE_REL = 'lib/ai/openai-paid-transport.ts';
const PROVIDER_URL = 'api.openai.com';

function* productionTsFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      yield* productionTsFiles(full);
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
      yield full;
    }
  }
}

describe('borda financeira única da OpenAI — invariante estrutural', () => {
  test('a URL do provider pago só aparece no módulo da borda (nenhum bypass de produção)', () => {
    const offenders: string[] = [];
    for (const scanDir of SCAN_DIRS) {
      for (const file of productionTsFiles(join(WEB_ROOT, scanDir))) {
        const rel = file.slice(WEB_ROOT.length + 1).replace(/\\/g, '/');
        if (rel === EDGE_REL) continue;
        if (readFileSync(file, 'utf8').includes(PROVIDER_URL)) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('o módulo da borda realmente contém a URL (sanidade do marcador)', () => {
    expect(readFileSync(join(WEB_ROOT, EDGE_REL), 'utf8')).toContain('https://api.openai.com/v1/responses');
  });
});
