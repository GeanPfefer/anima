// ============================================================
// Checker PURO do Toolchain Manifest V0: dadas as sondagens (já executadas pela borda)
// e a plataforma, diz o que está pronto. Nunca instala nem corrige. A saída só carrega
// ids de ferramenta, versões extraídas por regex, status e códigos fixos — nunca saída
// bruta de comando, caminho ou valor de ambiente.
// ============================================================

import {
  HOST_NEUTRAL_CONTRACT_FILES,
  TOOLCHAIN_GROUP_SPECS,
  TOOLCHAIN_MANIFEST,
  TOOLCHAIN_MANIFEST_SCHEMA,
  type PinType,
  type Platform,
  type ToolchainEntry,
  type ToolchainGroup,
  type VersionConstraint,
} from './manifest';

export type ToolchainItemStatus = 'present' | 'missing' | 'version_mismatch' | 'not_required' | 'unverified' | 'non_reproducible';

/** Saída bruta de UMA tentativa de comando (null = comando não encontrado/falhou). Nunca emitida. */
export type ProbeOutput = string | null;

export interface ToolchainCheckInput {
  readonly platform: Platform;
  /** Executa um comando FIXO do manifesto e devolve stdout+stderr, ou null. */
  readonly probe: (command: readonly string[]) => ProbeOutput;
  readonly repoFileExists: (path: string) => boolean;
  /** Conteúdo de um arquivo de contrato (para a varredura host-neutral), ou null. */
  readonly readRepoFile: (path: string) => string | null;
}

export interface ToolchainItemReport {
  readonly tool: string;
  readonly status: ToolchainItemStatus;
  readonly version: string | null;
  readonly constraint: string;
  readonly provenVersion: string | null;
  /** true/false quando há versão observada e versão de prova; null quando não comparável. */
  readonly matchesProven: boolean | null;
  readonly pinType: PinType;
  readonly reproducible: boolean;
  readonly requiredFor: readonly ToolchainGroup[];
  readonly reason: string | null;
}

export type ToolchainGroupState = 'ready' | 'not_ready';

export interface ToolchainGroupReport {
  readonly group: ToolchainGroup;
  readonly kind: 'core' | 'capability';
  readonly state: ToolchainGroupState;
  readonly reproducible: boolean;
  readonly blocking: readonly { readonly tool: string; readonly status: ToolchainItemStatus }[];
  readonly nonReproducible: readonly string[];
}

export type HostSpecificKind = 'windows_drive_path' | 'personal_home_path' | 'private_network_ip';

export interface HostSpecificFinding {
  readonly file: string;
  readonly kind: HostSpecificKind;
  readonly count: number;
}

export interface ToolchainReport {
  readonly schema: typeof TOOLCHAIN_MANIFEST_SCHEMA;
  readonly platform: Platform;
  readonly core: 'READY' | 'NOT_READY';
  readonly groups: readonly ToolchainGroupReport[];
  readonly items: readonly ToolchainItemReport[];
  /** Achados de hard-code de host em arquivos de contrato (só tipo e contagem, nunca o valor). */
  readonly hostSpecificFindings: readonly HostSpecificFinding[];
}

// ---------- versões ----------

function parts(version: string): number[] {
  const nums = version.split('.').map(n => Number.parseInt(n, 10));
  while (nums.length < 3) nums.push(0);
  return nums.slice(0, 3);
}

export function compareVersions(a: string, b: string): number {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
  return 0;
}

export function satisfies(version: string, constraint: VersionConstraint): boolean {
  switch (constraint.type) {
    case 'any': return true;
    case 'exact': return compareVersions(version, constraint.version) === 0;
    case 'minimum': return compareVersions(version, constraint.version) >= 0;
    case 'caret': return parts(version)[0] === parts(constraint.version)[0] && compareVersions(version, constraint.version) >= 0;
    case 'range': return compareVersions(version, constraint.min) >= 0 && compareVersions(version, constraint.maxExclusive) < 0;
  }
}

export function describeConstraint(constraint: VersionConstraint): string {
  switch (constraint.type) {
    case 'any': return 'any';
    case 'exact': return `=${constraint.version}`;
    case 'minimum': return `>=${constraint.version}`;
    case 'caret': return `^${constraint.version}`;
    case 'range': return `>=${constraint.min} <${constraint.maxExclusive}`;
  }
}

/** Primeira versão x.y[.z] capturada pelo padrão; normalizada para x.y.z. */
export function extractVersion(output: string, pattern: string): string | null {
  const match = new RegExp(pattern).exec(output);
  if (!match) return null;
  const captured = match.slice(1).find(group => group !== undefined);
  if (!captured) return null;
  return parts(captured).join('.');
}

// ---------- avaliação ----------

function evaluate(entry: ToolchainEntry, input: ToolchainCheckInput): Omit<ToolchainItemReport, 'tool' | 'constraint' | 'provenVersion' | 'pinType' | 'reproducible' | 'requiredFor'> {
  if (!entry.platform.includes(input.platform)) {
    return { status: 'not_required', version: null, matchesProven: null, reason: 'platform_not_applicable' };
  }
  const v = entry.validation;
  if (v.kind === 'repo_file') {
    return input.repoFileExists(v.path)
      ? { status: 'present', version: null, matchesProven: null, reason: null }
      : { status: 'missing', version: null, matchesProven: null, reason: 'repo_file_missing' };
  }
  if (v.kind === 'none') {
    return entry.pinType === 'mutable_tag'
      ? { status: 'non_reproducible', version: null, matchesProven: null, reason: 'mutable_tag' }
      : { status: 'unverified', version: null, matchesProven: null, reason: 'not_probed' };
  }
  let version: string | null = null;
  for (const command of v.commands) {
    const out = input.probe(command);
    if (out === null) continue;
    version = extractVersion(out, v.versionPattern);
    if (version !== null) break;
  }
  if (version === null) return { status: 'missing', version: null, matchesProven: null, reason: 'not_found' };
  const matchesProven = entry.provenVersion === null ? null : compareVersions(version, entry.provenVersion) === 0;
  if (!satisfies(version, entry.versionConstraint)) return { status: 'version_mismatch', version, matchesProven, reason: 'constraint_not_satisfied' };
  if (entry.pinType === 'mutable_tag') return { status: 'non_reproducible', version, matchesProven, reason: 'mutable_tag' };
  return { status: 'present', version, matchesProven, reason: null };
}

const HOST_PATTERNS: readonly { readonly kind: HostSpecificKind; readonly re: RegExp }[] = [
  { kind: 'windows_drive_path', re: /(?<![A-Za-z])[A-Za-z]:\\{1,2}[A-Za-z0-9_]/g },
  { kind: 'personal_home_path', re: /(?:\/home\/|\/Users\/|\\Users\\{1,2})[A-Za-z0-9_.-]+/g },
  // Tailscale/CGNAT 100.64.0.0/10, 10.0.0.0/8 e 192.168.0.0/16 — sempre 4 octetos (não confunde com semver).
  { kind: 'private_network_ip', re: /\b(?:100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}|10\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3})\.\d{1,3}\b/g },
];

export function scanHostSpecific(files: readonly string[], read: (path: string) => string | null): HostSpecificFinding[] {
  const findings: HostSpecificFinding[] = [];
  for (const file of files) {
    const text = read(file);
    if (text === null) continue;
    for (const { kind, re } of HOST_PATTERNS) {
      const count = (text.match(re) ?? []).length;
      if (count > 0) findings.push({ file, kind, count });
    }
  }
  return findings;
}

const BLOCKING: readonly ToolchainItemStatus[] = ['missing', 'version_mismatch', 'unverified'];

export function checkToolchain(input: ToolchainCheckInput, manifest: readonly ToolchainEntry[] = TOOLCHAIN_MANIFEST): ToolchainReport {
  const items: ToolchainItemReport[] = manifest.map(entry => ({
    tool: entry.tool,
    constraint: describeConstraint(entry.versionConstraint),
    provenVersion: entry.provenVersion,
    pinType: entry.pinType,
    reproducible: entry.reproducible,
    requiredFor: entry.requiredFor,
    ...evaluate(entry, input),
  }));

  const groups: ToolchainGroupReport[] = TOOLCHAIN_GROUP_SPECS.map(spec => {
    const required = items.filter(item => item.requiredFor.includes(spec.group) && item.status !== 'not_required');
    const blocking = required.filter(item => BLOCKING.includes(item.status)).map(item => ({ tool: item.tool, status: item.status }));
    const nonReproducible = required.filter(item => !item.reproducible).map(item => item.tool);
    return {
      group: spec.group,
      kind: spec.kind,
      state: blocking.length === 0 ? 'ready' : 'not_ready',
      reproducible: nonReproducible.length === 0,
      blocking,
      nonReproducible,
    };
  });

  const core = groups.find(g => g.group === 'core');
  return {
    schema: TOOLCHAIN_MANIFEST_SCHEMA,
    platform: input.platform,
    core: core?.state === 'ready' ? 'READY' : 'NOT_READY',
    groups,
    items,
    hostSpecificFindings: scanHostSpecific(HOST_NEUTRAL_CONTRACT_FILES, input.readRepoFile),
  };
}

export function renderToolchainReport(report: ToolchainReport): string {
  const lines: string[] = [];
  lines.push(`Toolchain (${report.schema}) · plataforma ${report.platform}`);
  lines.push(`CORE TOOLCHAIN ${report.core === 'READY' ? 'READY' : 'NOT READY'}`);
  lines.push('');
  lines.push('Capacidades:');
  for (const g of report.groups) {
    const why = g.blocking.length > 0 ? ` — ${g.blocking.map(b => `${b.tool}:${b.status}`).join(', ')}` : '';
    const repro = g.reproducible ? '' : ` [não reprodutível: ${g.nonReproducible.join(', ')}]`;
    lines.push(`  ${g.group.padEnd(18)} ${g.state === 'ready' ? 'READY' : 'NOT READY'}${why}${repro}`);
  }
  lines.push('');
  lines.push('Ferramentas:');
  for (const i of report.items) {
    const version = i.version ? ` ${i.version}` : '';
    const proven = i.matchesProven === false ? ` (prova: ${i.provenVersion})` : '';
    lines.push(`  ${i.status.padEnd(17)} ${i.tool}${version} [${i.constraint}; pin=${i.pinType}]${proven}`);
  }
  if (report.hostSpecificFindings.length > 0) {
    lines.push('');
    lines.push('Hard-codes de host em arquivos de contrato (valores omitidos):');
    for (const f of report.hostSpecificFindings) lines.push(`  ${f.file}: ${f.kind} ×${f.count}`);
  }
  return lines.join('\n');
}
