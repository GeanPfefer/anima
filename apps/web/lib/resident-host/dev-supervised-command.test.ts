import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Contrato de WIRING do comando Dev composto `npm run dev:supervised` (Parte 2). O
// launcher em si é um .mjs (entrypoint de processo) verificado por harness node fora
// do jest; aqui garantimos, na suíte normal, que o comando existe, reusa os DOIS
// processos canônicos (Web + Resident Host) e declara o contrato de execução.
const root = resolve(__dirname, '../../../../');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
const launcher = readFileSync(resolve(root, 'tools/dev-supervised.mjs'), 'utf8');

describe('comando Dev composto dev:supervised — wiring web + Resident Host', () => {
  test('dev:supervised existe e roda o launcher canônico', () => {
    expect(pkg.scripts['dev:supervised']).toBe('node tools/dev-supervised.mjs');
  });
  test('reusa os dois processos canônicos e não implementa outro host', () => {
    expect(pkg.scripts['dev:web']).toBeDefined();
    expect(pkg.scripts['local-host']).toBeDefined();
    expect(launcher).toContain("['run', 'dev:web']");
    expect(launcher).toContain("['run', 'local-host']");
  });
  test('declara o contrato de execução: stdio herdado e encerramento por sinal', () => {
    expect(launcher).toContain("stdio: 'inherit'");
    expect(launcher).toContain("'SIGINT'");
    expect(launcher).toContain("'SIGTERM'");
  });
});
