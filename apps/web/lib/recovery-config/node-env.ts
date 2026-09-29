// Borda de I/O mínima do checker: lê (sem imprimir) o arquivo de ambiente do mobile
// e testa existência de caminhos. Só leitura; nenhum valor sai daqui a não ser para o
// checker puro, que nunca os devolve.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Parser dotenv mínimo: `KEY=valor`, aspas simples/duplas, comentários `#` fora de aspas. */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1]!;
    let value = match[2]!;
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.indexOf(quote, 1) > 0) {
      value = value.slice(1, value.indexOf(quote, 1));
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    out[key] = value;
  }
  return out;
}

/** `apps/mobile/.env.local` visto a partir de `apps/web` (cwd da CLI) ou da raiz do repo. */
export function loadMobileEnv(cwd: string = process.cwd()): Record<string, string> | null {
  for (const candidate of [resolve(cwd, '..', 'mobile', '.env.local'), resolve(cwd, 'apps', 'mobile', '.env.local')]) {
    if (existsSync(candidate)) return parseDotEnv(readFileSync(candidate, 'utf8'));
  }
  return null;
}

/** `supabase/.env` (raiz JWT local) visto a partir de `apps/web` (cwd da CLI) ou da raiz do repo. */
export function loadSupabaseEnv(cwd: string = process.cwd()): Record<string, string> | null {
  for (const candidate of [resolve(cwd, '..', '..', 'supabase', '.env'), resolve(cwd, 'supabase', '.env')]) {
    if (existsSync(candidate)) return parseDotEnv(readFileSync(candidate, 'utf8'));
  }
  return null;
}

export const pathExists = (path: string): boolean => existsSync(path);
