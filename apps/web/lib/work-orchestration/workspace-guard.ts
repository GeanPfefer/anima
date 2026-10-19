import { realpath as realpathCallback } from 'node:fs';
import { lstat, mkdir, open, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

// ============================================================
// Guarda do HOST sobre o workspace do CANDIDATO.
//
// O executor (Codex/Ollama/…) escreve na worktree e pode plantar symlinks, junctions e hardlinks. O Host (control plane, com as
// credenciais e os direitos do usuário) lê, escreve, indexa (`git add -A`) e limpa (`git clean -fdx`, `rm -r`) essa árvore. Qualquer
// componente de caminho que seja um reparse point, ou qualquer arquivo com mais de um nome, transforma o Host em "confused deputy":
// ele leria/gravaria/apagaria fora do workspace com os direitos dele.
//
// Regras (fail-closed; nada aqui segue link):
//   - NENHUM componente do caminho, da raiz ao alvo, pode ser symlink/junction (lstat por componente) E o realpath do alvo tem de ser
//     exatamente `realpath(raiz) + resto` (pega o que o lstat isolado não vê: 8.3, caixa, mount points, componente trocado).
//   - Arquivo regular com nlink > 1 é recusado (hardlink para fora do workspace); verificado no handle aberto.
//   - Os únicos links permitidos são os criados pelo próprio Host (node_modules → repositório autorizado), e só se o destino atual
//     ainda for o esperado (o candidato pode apagar e recriar o link apontando para outro lugar).
// Limites conhecidos: TOCTOU entre a checagem e o uso (o candidato já não executa quando o Host opera; processos órfãos do sandbox
// são cobertos pelo término da árvore de processos em runProcess); reparse points de tipos que o Node não classifica como link
// (p.ex. symlinks LX do WSL) não são detectáveis aqui.
// ============================================================

export type WorkspaceViolationKind = 'link' | 'hardlink' | 'escape' | 'unverifiable' | 'not_regular_file';

export interface WorkspaceViolation {
  readonly path: string;
  readonly kind: WorkspaceViolationKind;
  readonly detail?: string;
}

/** Link criado pelo Host e portanto permitido, desde que ainda aponte para `target`. */
export interface AllowedWorkspaceLink {
  readonly link: string;
  readonly target: string;
}

const MAX_ENTRIES = 500_000;
const ci = (value: string): string => (process.platform === 'win32' ? value.toLowerCase() : value);
const samePath = (a: string, b: string): boolean => ci(resolve(a)) === ci(resolve(b));

async function real(path: string): Promise<string | null> {
  return new Promise(done => realpathCallback.native(path, (error, resolved) => done(error ? null : resolved)));
}

async function isAllowedLink(path: string, allowed: readonly AllowedWorkspaceLink[]): Promise<boolean> {
  const entry = allowed.find(item => samePath(item.link, path));
  if (!entry) return false;
  const [actual, expected] = await Promise.all([real(path), real(entry.target)]);
  return actual !== null && expected !== null && samePath(actual, expected);
}

/**
 * Valida um caminho (existente ou a criar) sob `root`. Todos os componentes existentes têm de ser diretórios/arquivo reais.
 * Devolve o caminho absoluto confirmado ou a violação.
 */
export async function guardWorkspacePath(
  root: string,
  target: string,
  allowed: readonly AllowedWorkspaceLink[] = [],
): Promise<{ readonly ok: true; readonly path: string; readonly exists: boolean } | { readonly ok: false; readonly violation: WorkspaceViolation }> {
  const absRoot = resolve(root);
  const absTarget = resolve(target);
  const rel = relative(absRoot, absTarget);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return { ok: false, violation: { path: absTarget, kind: 'escape', detail: 'fora da raiz' } };
  const realRoot = await real(absRoot);
  if (!realRoot) return { ok: false, violation: { path: absRoot, kind: 'unverifiable', detail: 'raiz sem realpath' } };

  const parts = rel.split(sep);
  let current = absRoot;
  let resolvedSoFar = realRoot;
  for (const part of parts) {
    current = join(current, part);
    let info;
    try { info = await lstat(current); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR') {
        return { ok: true, path: absTarget, exists: false };
      }
      return { ok: false, violation: { path: current, kind: 'unverifiable', detail: (error as NodeJS.ErrnoException).code ?? 'lstat' } };
    }
    if (info.isSymbolicLink()) {
      if (await isAllowedLink(current, allowed)) return { ok: true, path: absTarget, exists: true };
      return { ok: false, violation: { path: current, kind: 'link' } };
    }
    const actual = await real(current);
    resolvedSoFar = join(resolvedSoFar, part);
    if (!actual || !samePath(actual, resolvedSoFar)) {
      return { ok: false, violation: { path: current, kind: 'escape', detail: `realpath=${actual ?? 'indisponível'}` } };
    }
  }
  return { ok: true, path: absTarget, exists: true };
}

/** Leitura UTF-8 de arquivo do candidato sem seguir links; `null` ⇒ recusado/inexistente/ilegível. */
export async function readGuardedFile(root: string, target: string, allowed: readonly AllowedWorkspaceLink[] = []): Promise<string | null> {
  const guarded = await guardWorkspacePath(root, target, allowed);
  if (!guarded.ok || !guarded.exists) return null;
  let handle;
  try {
    handle = await open(guarded.path, 'r');
    const info = await handle.stat();
    if (!info.isFile() || info.nlink > 1) return null;
    const content = await handle.readFile('utf8');
    const again = await guardWorkspacePath(root, target, allowed);
    return again.ok ? content : null;
  } catch { return null; }
  finally { await handle?.close().catch(() => {}); }
}

/** Escrita confinada: valida os ancestrais, cria os diretórios faltantes, recusa sobrescrever link/hardlink e revalida o destino. */
export async function writeGuardedFile(root: string, target: string, content: string, allowed: readonly AllowedWorkspaceLink[] = []): Promise<boolean> {
  const before = await guardWorkspacePath(root, target, allowed);
  if (!before.ok) return false;
  const parent = resolve(before.path, '..');
  if (!samePath(parent, root)) {
    await mkdir(parent, { recursive: true });
    const parentCheck = await guardWorkspacePath(root, parent, allowed);
    if (!parentCheck.ok) return false;
  }
  try {
    const info = await lstat(before.path).catch(() => null);
    if (info && (!info.isFile() || info.isSymbolicLink() || info.nlink > 1)) return false;
  } catch { return false; }
  await writeFile(before.path, content, { encoding: 'utf8' });
  const after = await guardWorkspacePath(root, before.path, allowed);
  if (!after.ok) return false;
  const final = await lstat(after.path).catch(() => null);
  return !!final && final.isFile() && final.nlink <= 1;
}

export interface WorkspaceScan {
  readonly ok: boolean;
  readonly violations: readonly WorkspaceViolation[];
  readonly entries: number;
}

async function walk(
  dir: string,
  root: string,
  allowed: readonly AllowedWorkspaceLink[],
  out: WorkspaceViolation[],
  counter: { n: number },
): Promise<void> {
  let names: string[];
  try { names = await readdir(dir); } catch (error) {
    out.push({ path: dir, kind: 'unverifiable', detail: (error as NodeJS.ErrnoException).code ?? 'readdir' });
    return;
  }
  for (const name of names) {
    if (dir === root && name === '.git') continue; // o Host nunca lê o `.git` da worktree (usa --git-dir confiável)
    if (++counter.n > MAX_ENTRIES) { out.push({ path: dir, kind: 'unverifiable', detail: 'limite de entradas' }); return; }
    const path = join(dir, name);
    let info;
    try { info = await lstat(path); } catch { out.push({ path, kind: 'unverifiable', detail: 'lstat' }); continue; }
    if (info.isSymbolicLink()) {
      if (!(await isAllowedLink(path, allowed))) out.push({ path, kind: 'link' });
      continue; // nunca desce por link
    }
    if (info.isDirectory()) { await walk(path, root, allowed, out, counter); continue; }
    if (info.isFile() && info.nlink > 1) out.push({ path, kind: 'hardlink', detail: `nlink=${info.nlink}` });
  }
}

/** Varre a árvore inteira (sem seguir links) e lista tudo que o Host não pode tocar. */
export async function scanWorkspaceTree(root: string, allowed: readonly AllowedWorkspaceLink[] = []): Promise<WorkspaceScan> {
  const violations: WorkspaceViolation[] = [];
  const counter = { n: 0 };
  await walk(resolve(root), resolve(root), allowed, violations, counter);
  return { ok: violations.length === 0, violations, entries: counter.n };
}

/**
 * Remove os próprios links/hardlinks hostis (nunca os alvos): symlink/junction via rmdir/unlink do LINK; hardlink via unlink do NOME.
 * Chamado antes de `git clean -fdx`/remoção recursiva, que no Windows podem recursar por junctions.
 */
export async function removeHostileWorkspaceLinks(root: string, allowed: readonly AllowedWorkspaceLink[] = []): Promise<readonly WorkspaceViolation[]> {
  const scan = await scanWorkspaceTree(root, allowed);
  const removed: WorkspaceViolation[] = [];
  for (const violation of scan.violations) {
    if (violation.kind !== 'link' && violation.kind !== 'hardlink') continue;
    try {
      const info = await lstat(violation.path);
      if (info.isSymbolicLink() && info.isDirectory()) await rmdir(violation.path).catch(() => unlink(violation.path));
      else await unlink(violation.path).catch(() => rmdir(violation.path));
      removed.push(violation);
    } catch { /* já ausente */ }
  }
  return removed;
}

export class WorkspaceBoundaryError extends Error {
  constructor(readonly violations: readonly WorkspaceViolation[]) {
    super(`Workspace do candidato viola a fronteira do Host: ${violations.slice(0, 5).map(v => `${v.kind}:${v.path}`).join('; ')}${violations.length > 5 ? ` (+${violations.length - 5})` : ''}`);
    this.name = 'WorkspaceBoundaryError';
  }
}
