import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ProjectAdvisorContext, ProjectAuthorityLevel, ProjectContextSource } from '@anima/core';

type GovernedSource = {
  readonly id: string;
  readonly path: string;
  readonly authority: ProjectAuthorityLevel;
  readonly terms: readonly string[];
  readonly temporalRole: ProjectContextSource['temporalRole'];
};

const MAX_SOURCE_CHARS = 2_500;
const MAX_TOTAL_CHARS = 28_000;
const SECRET_VALUE = /\b(?:sk-[A-Za-z0-9_-]{12,}|(?:api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+)/gi;
const BLOCKED_STATUS_PATH = /(?:^|[\\/\s])(?:\.claude|\.worktrees|\.git)(?:[\\/]|$)|(?:^|[\\/\s])\.env(?:\.|$)/i;

const GOVERNED_SOURCES: readonly GovernedSource[] = [
  { id: 'manifesto', path: 'anima-manifesto.md', authority: 'canonical', temporalRole: 'canonical', terms: ['decisão', 'proatividade', 'interface', 'capacidade'] },
  { id: 'prd-live', path: 'anima-prd.md', authority: 'observed_state', temporalRole: 'historical_snapshot', terms: ['Estágio atual', 'estado atual', 'Fase G', 'maturidade', 'próximo'] },
  { id: 'autonomy-plan', path: 'docs/planos/002-modo-autonomo-v0.md', authority: 'observed_state', temporalRole: 'historical_snapshot', terms: ['Estado atual', 'ratificado', 'próximo', 'pendente', 'Fase G'] },
  { id: 'autonomy-backlog', path: 'docs/planos/002-modo-autonomo-v0-backlog.md', authority: 'observed_state', temporalRole: 'historical_snapshot', terms: ['Status:', 'done', 'awaiting_review', 'Fase G', 'UX-'] },
  { id: 'work-architecture', path: 'docs/arquitetura/orquestracao-de-trabalho.md', authority: 'canonical', temporalRole: 'canonical', terms: ['evidência', 'classificação', 'advisory', 'decisão', 'autoridade'] },
  { id: 'identity-compute', path: 'docs/arquitetura/visao-identidade-compute-distribuido.md', authority: 'canonical', temporalRole: 'canonical', terms: ['proveniência', 'advisory', 'identidade', 'provider', 'decisão'] },
  { id: 'canonical-remote-proof', path: 'docs/registros/2026-08-24-execucao-canonica-no-remoto.md', authority: 'evidence', temporalRole: 'historical_snapshot', terms: ['PASS', 'Meta-prova viva', 'Verifier', 'estado final', 'gates'] },
] as const;

function projectRoot(): string {
  return resolve(process.env.ANIMA_PROJECT_ROOT ?? resolve(process.cwd(), '..', '..'));
}

function selectLines(content: string, terms: readonly string[]): string {
  const lines = content.split(/\r?\n/);
  const selected = new Set<number>();
  for (let index = 0; index < lines.length; index++) {
    if (terms.some(term => lines[index]?.toLocaleLowerCase('pt-BR').includes(term.toLocaleLowerCase('pt-BR')))) {
      for (let cursor = Math.max(0, index - 2); cursor <= Math.min(lines.length - 1, index + 4); cursor++) selected.add(cursor);
    }
  }
  return sanitizeProjectContext([...selected].sort((a, b) => a - b).map(index => `${index + 1}: ${lines[index]}`).join('\n')).slice(0, MAX_SOURCE_CHARS);
}

export function sanitizeProjectContext(value: string): string {
  return value.replace(SECRET_VALUE, '[REDACTED]');
}

export function sanitizeProjectGitStatus(value: string): string {
  return value.split(/\r?\n/).filter(line => !BLOCKED_STATUS_PATH.test(line)).join('\n');
}

function git(args: readonly string[]): Promise<string> {
  return new Promise(resolveResult => {
    execFile('git', [...args], { cwd: projectRoot(), windowsHide: true, timeout: 10_000 }, (error, stdout) => {
      resolveResult(error ? 'indisponível' : String(stdout).trim());
    });
  });
}

async function latestRecords(): Promise<ProjectContextSource | null> {
  const directory = resolve(projectRoot(), 'docs', 'registros');
  const names = (await readdir(directory)).filter(name => /^\d{4}-\d{2}-\d{2}-.+\.md$/.test(name)).sort().slice(-3);
  const parts = await Promise.all(names.map(async name => {
    const content = await readFile(resolve(directory, name), 'utf8');
    return `# ${name}\n${selectLines(content, ['objetivo', 'resultado', 'prova', 'gate', 'estado final', 'próximo'])}`;
  }));
  if (parts.length === 0) return null;
  return { id: 'latest-records', authority: 'historical_record', temporalRole: 'historical_snapshot', provenance: `docs/registros/{${names.join(',')}}`, content: parts.join('\n\n').slice(0, MAX_SOURCE_CHARS) };
}

export async function buildProjectAdvisorContext(
  question: string,
  liveSources: readonly ProjectContextSource[] = [],
): Promise<ProjectAdvisorContext> {
  const sources: ProjectContextSource[] = await Promise.all(GOVERNED_SOURCES.map(async source => ({
    id: source.id,
    authority: source.authority,
    temporalRole: source.temporalRole,
    provenance: source.path,
    content: selectLines(await readFile(resolve(projectRoot(), source.path), 'utf8'), source.terms),
  } satisfies ProjectContextSource)));
  const [branch, head, status, records] = await Promise.all([
    git(['branch', '--show-current']),
    git(['rev-parse', 'HEAD']),
    git(['status', '--short']),
    latestRecords(),
  ]);
  sources.push({
    id: 'git-observation',
    authority: 'evidence',
    provenance: 'git read-only observation',
    observedAt: new Date().toISOString(),
    temporalRole: 'current_projection',
    content: `branch=${branch}\nhead=${head}\nstatus=${sanitizeProjectGitStatus(status) || '(clean)'}`,
  });
  sources.push(...liveSources.map(source => ({ ...source, content: sanitizeProjectContext(source.content).slice(0, MAX_SOURCE_CHARS) })));
  if (records) sources.push(records);

  let used = 0;
  const bounded = sources.flatMap(source => {
    const remaining = MAX_TOTAL_CHARS - used;
    if (remaining <= 0 || !source.content.trim()) return [];
    const content = source.content.slice(0, remaining);
    used += content.length;
    return [{ ...source, content }];
  });
  return { question, sources: bounded };
}

export const PROJECT_ADVISOR_SOURCE_PATHS = GOVERNED_SOURCES.map(source => source.path);
