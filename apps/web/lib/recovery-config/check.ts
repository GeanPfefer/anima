// ============================================================
// Checker PURO da Recovery Configuration V0: dado o ambiente (web + mobile) e um
// verificador de existência de caminho, diz o que está pronto — sem NUNCA expor
// valor, prefixo, sufixo, comprimento ou hash de nenhuma chave. A saída só carrega
// nomes de chave, classes, status e códigos de motivo fixos.
// ============================================================

import { posix, win32 } from 'node:path';
import {
  READINESS_GROUP_SPECS,
  RECOVERY_CONFIG_KEY_PREFIXES,
  RECOVERY_CONFIG_MANIFEST,
  RECOVERY_CONFIG_MANIFEST_SCHEMA,
  type ReadinessGroup,
  type RecoveryConfigClass,
  type RecoveryConfigCondition,
  type RecoveryConfigEntry,
  type RecoveryConfigEnvFile,
  type RecoveryConfigValidation,
} from './manifest';

export type RecoveryConfigEnv = Readonly<Record<string, string | undefined>>;

export type RecoveryConfigItemStatus = 'present' | 'missing' | 'derived' | 'invalid' | 'not_required';

/** Motivos FIXOS: nenhum deles carrega nada do valor. */
export type RecoveryConfigIssue =
  | 'placeholder'
  | 'not_url'
  | 'not_email'
  | 'not_absolute_path'
  | 'path_not_found'
  | 'not_in_allowed_values'
  | 'not_integer_in_range'
  | 'not_positive_number'
  | 'not_uuid_list'
  | 'not_slug'
  | 'not_json_targets'
  | 'env_file_missing';

export interface RecoveryConfigItemReport {
  readonly key: string;
  readonly envFile: RecoveryConfigEnvFile;
  readonly classes: readonly RecoveryConfigClass[];
  readonly secret: boolean;
  readonly status: RecoveryConfigItemStatus;
  readonly requiredBy: readonly ReadinessGroup[];
  readonly issue: RecoveryConfigIssue | null;
  readonly replacedBy: string | null;
}

export type ReadinessGroupState = 'ready' | 'not_ready' | 'disabled';

export interface ReadinessGroupReport {
  readonly group: ReadinessGroup;
  readonly kind: 'core' | 'capability';
  readonly state: ReadinessGroupState;
  readonly blocking: readonly string[];
}

export interface RecoveryConfigReport {
  readonly schema: typeof RECOVERY_CONFIG_MANIFEST_SCHEMA;
  readonly core: 'READY' | 'NOT_READY';
  /** Grupo que atende o chat principal conforme ANIMA_AI_PROVIDER (mesma regra do runtime). */
  readonly primaryChatGroup: 'chat-openai' | 'local-ai';
  readonly groups: readonly ReadinessGroupReport[];
  readonly items: readonly RecoveryConfigItemReport[];
  readonly deprecatedPresent: readonly string[];
  /** Nomes (nunca valores) de chaves com prefixo do Anima que o manifesto não conhece. */
  readonly unknownKeys: readonly string[];
}

export interface RecoveryConfigCheckInput {
  readonly web: RecoveryConfigEnv;
  /** `null` = apps/mobile/.env.local não existe. */
  readonly mobile: RecoveryConfigEnv | null;
  readonly pathExists: (path: string) => boolean;
}

const PLACEHOLDER = /<[^>]*>|\byour[-_]|change[-_]?me|\/path\/to\/|\\path\\to\\/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const nonEmpty = (value: string | undefined): value is string => typeof value === 'string' && value.trim().length > 0;
const isAbsolutePath = (value: string): boolean => win32.isAbsolute(value) || posix.isAbsolute(value);

function conditionHolds(condition: RecoveryConfigCondition, env: RecoveryConfigEnv): boolean {
  const raw = env[condition.key]?.trim();
  const effective = raw === undefined || raw === '' ? condition.whenUnset : raw;
  if (effective === undefined) return false;
  const normalize = (s: string): string => (condition.caseInsensitive ? s.toLowerCase() : s);
  return condition.in.map(normalize).includes(normalize(effective));
}

function validate(value: string, rule: RecoveryConfigValidation, pathExists: (path: string) => boolean): RecoveryConfigIssue | null {
  const v = value.trim();
  if (PLACEHOLDER.test(v)) return 'placeholder';
  switch (rule.kind) {
    case 'non_empty':
      return null;
    case 'url':
      try {
        const url = new URL(v);
        return url.protocol === 'http:' || url.protocol === 'https:' ? null : 'not_url';
      } catch {
        return 'not_url';
      }
    case 'email':
      return /^[^\s@]+@[^\s@]+$/.test(v) ? null : 'not_email';
    case 'absolute_path':
      if (!isAbsolutePath(v)) return 'not_absolute_path';
      return rule.mustExist && !pathExists(v) ? 'path_not_found' : null;
    case 'enum': {
      const norm = (s: string): string => (rule.caseInsensitive ? s.toLowerCase() : s);
      return rule.values.map(norm).includes(norm(v)) ? null : 'not_in_allowed_values';
    }
    case 'integer': {
      const n = Number(v);
      return Number.isInteger(n) && n >= rule.min && n <= rule.max ? null : 'not_integer_in_range';
    }
    case 'number_positive': {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? null : 'not_positive_number';
    }
    case 'uuid_list': {
      const ids = v.split(',').map(s => s.trim()).filter(s => s !== '');
      return ids.length > 0 && ids.every(id => UUID.test(id)) ? null : 'not_uuid_list';
    }
    case 'slug':
      return /^[a-z0-9][a-z0-9-]{0,62}$/.test(v) ? null : 'not_slug';
    case 'json_targets':
      try {
        const parsed: unknown = JSON.parse(v);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return 'not_json_targets';
        const entries = Object.entries(parsed as Record<string, unknown>);
        const ok = entries.length > 0 && entries.every(([ref, path]) => ref.trim() !== '' && typeof path === 'string' && isAbsolutePath(path) && !PLACEHOLDER.test(path));
        return ok ? null : 'not_json_targets';
      } catch {
        return 'not_json_targets';
      }
  }
}

function envFor(entry: RecoveryConfigEntry, input: RecoveryConfigCheckInput): RecoveryConfigEnv | null {
  return entry.envFile === 'web' ? input.web : input.mobile;
}

export function checkRecoveryConfig(
  input: RecoveryConfigCheckInput,
  manifest: readonly RecoveryConfigEntry[] = RECOVERY_CONFIG_MANIFEST,
): RecoveryConfigReport {
  const enabled = new Map<ReadinessGroup, boolean>(
    READINESS_GROUP_SPECS.map(spec => [
      spec.group,
      spec.enabledWhenAny === undefined || spec.enabledWhenAny.some(condition => conditionHolds(condition, input.web)),
    ]),
  );

  const items: RecoveryConfigItemReport[] = manifest.map(entry => {
    const env = envFor(entry, input);
    const value = env?.[entry.key];
    const isDeprecated = entry.classes.includes('deprecated');
    const requiredBy = isDeprecated
      ? []
      : entry.requiredFor
          .filter(req => enabled.get(req.group) === true && (req.when === undefined || conditionHolds(req.when, input.web)))
          .map(req => req.group);

    let status: RecoveryConfigItemStatus;
    let issue: RecoveryConfigIssue | null = null;
    if (nonEmpty(value)) {
      issue = validate(value, entry.validation, input.pathExists);
      status = issue === null ? 'present' : 'invalid';
    } else if (entry.derivation?.status === 'wired') {
      status = 'derived';
    } else if (requiredBy.length > 0) {
      status = 'missing';
      if (env === null) issue = 'env_file_missing';
    } else {
      status = 'not_required';
    }
    return {
      key: entry.key,
      envFile: entry.envFile,
      classes: entry.classes,
      secret: entry.secret,
      status,
      requiredBy,
      issue,
      replacedBy: entry.deprecated?.replacedBy ?? null,
    };
  });

  const byKey = new Map(manifest.map(entry => [entry.key, entry]));
  const groups: ReadinessGroupReport[] = READINESS_GROUP_SPECS.map(spec => {
    if (enabled.get(spec.group) !== true) return { group: spec.group, kind: spec.kind, state: 'disabled', blocking: [] };
    const blocking = items
      .filter(item => {
        const entry = byKey.get(item.key);
        if (!entry || entry.classes.includes('deprecated')) return false;
        if (item.requiredBy.includes(spec.group)) return item.status === 'missing' || item.status === 'invalid';
        // Um ajuste INVÁLIDO quebra a capacidade que ele ajusta, mas nunca o core.
        return spec.kind !== 'core' && item.status === 'invalid' && (entry.tunes ?? []).includes(spec.group);
      })
      .map(item => item.key);
    return { group: spec.group, kind: spec.kind, state: blocking.length === 0 ? 'ready' : 'not_ready', blocking };
  });

  const known = new Set(manifest.map(entry => entry.key));
  const candidateKeys = [...Object.keys(input.web), ...Object.keys(input.mobile ?? {})];
  const unknownKeys = [...new Set(candidateKeys)]
    .filter(key => !known.has(key) && RECOVERY_CONFIG_KEY_PREFIXES.some(prefix => key.startsWith(prefix)))
    .sort();

  const core = groups.find(g => g.group === 'core');
  return {
    schema: RECOVERY_CONFIG_MANIFEST_SCHEMA,
    core: core?.state === 'ready' ? 'READY' : 'NOT_READY',
    primaryChatGroup: input.web.ANIMA_AI_PROVIDER === 'ollama' ? 'local-ai' : 'chat-openai',
    groups,
    items,
    deprecatedPresent: items.filter(item => item.classes.includes('deprecated') && item.status !== 'not_required').map(item => item.key),
    unknownKeys,
  };
}

const GROUP_LABEL: Record<ReadinessGroupState, string> = { ready: 'READY', not_ready: 'NOT READY', disabled: 'disabled' };

/** Render humano: só nomes, classes, status e motivos fixos. */
export function renderRecoveryConfigReport(report: RecoveryConfigReport): string {
  const lines: string[] = [];
  lines.push(`Recovery configuration (${report.schema})`);
  lines.push(`CORE ${report.core === 'READY' ? 'READY' : 'NOT READY'}`);
  lines.push(`Chat principal → ${report.primaryChatGroup}`);
  lines.push('');
  lines.push('Capacidades:');
  for (const group of report.groups) {
    const suffix = group.blocking.length > 0 ? ` — bloqueando: ${group.blocking.join(', ')}` : '';
    lines.push(`  ${group.group.padEnd(20)} ${GROUP_LABEL[group.state]}${suffix}`);
  }
  lines.push('');
  lines.push('Chaves (sem valores):');
  for (const item of report.items) {
    if (item.status === 'not_required') continue;
    const tags = [item.secret ? 'secret' : null, item.issue, item.replacedBy ? `use ${item.replacedBy}` : null].filter(Boolean).join(', ');
    lines.push(`  ${item.status.padEnd(12)} ${item.key}${tags ? ` (${tags})` : ''}`);
  }
  const notRequired = report.items.filter(item => item.status === 'not_required').length;
  lines.push(`  (${notRequired} chaves opcionais ausentes/não exigidas omitidas; use --json para a lista completa)`);
  if (report.deprecatedPresent.length > 0) lines.push(`Deprecated presentes (não bloqueiam): ${report.deprecatedPresent.join(', ')}`);
  if (report.unknownKeys.length > 0) lines.push(`Chaves desconhecidas pelo manifesto: ${report.unknownKeys.join(', ')}`);
  return lines.join('\n');
}
