// Borda de I/O do checker de toolchain: executa SOMENTE os comandos fixos de versão do
// manifesto (nunca instala, nunca inicia daemon/provider/browser) e lê arquivos de
// contrato do repositório. A saída bruta só é entregue ao checker puro, que extrai a
// versão por regex e nunca a reemite.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Platform } from './manifest';

export function currentPlatform(platform: NodeJS.Platform = process.platform): Platform {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  return 'linux';
}

export function probeCommand(command: readonly string[]): string | null {
  const [bin, ...args] = command;
  if (!bin) return null;
  // Windows resolve npm/supabase via .cmd/.ps1 só com shell; os argumentos são constantes do manifesto.
  // (string única com shell evita o DEP0190 do Node 24 para args + shell).
  const options = { encoding: 'utf8' as const, timeout: 15_000, windowsHide: true };
  const result = process.platform === 'win32'
    ? spawnSync([bin, ...args].join(' '), { ...options, shell: true })
    : spawnSync(bin, args, options);
  if (result.error || result.status === null) return null;
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

export function repoRootFrom(cwd: string = process.cwd()): string {
  for (const candidate of [cwd, resolve(cwd, '..', '..')]) {
    if (existsSync(resolve(candidate, 'package-lock.json')) && existsSync(resolve(candidate, 'apps', 'web'))) return candidate;
  }
  return cwd;
}

export function repoFileExists(root: string): (path: string) => boolean {
  return path => existsSync(resolve(root, path));
}

export function readRepoFile(root: string): (path: string) => string | null {
  return path => {
    try { return readFileSync(resolve(root, path), 'utf8'); } catch { return null; }
  };
}
