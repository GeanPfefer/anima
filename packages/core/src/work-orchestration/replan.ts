import type { Json } from '@anima/types';

/** Diagnóstico humano de testes, não saída confiável do coder. V1 não amplia produção. */
export const replanCorrectionKinds = ['resolve_imports', 'respect_api_types', 'assert_public_boundary'] as const;
export type ReplanCorrectionKind = typeof replanCorrectionKinds[number];
export interface ReplanDiagnosis {
  readonly schemaVersion: 1;
  readonly finding: 'test_code_incorrect';
  readonly evidenceReference: string;
  readonly corrections: readonly {
    readonly kind: ReplanCorrectionKind;
    readonly symbols: readonly string[];
    readonly instruction: string;
  }[];
}
export interface ReplanStrategy {
  readonly kind: ReplanCorrectionKind;
  readonly symbols: readonly string[];
}
const record = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null;
const exact = (v: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(v).length === keys.length && keys.every(k => k in v);

export function readReplanDiagnosis(value: unknown): ReplanDiagnosis | null {
  const d = record(value);
  if (!d || !exact(d, ['schemaVersion', 'finding', 'evidenceReference', 'corrections'])
    || d.schemaVersion !== 1 || d.finding !== 'test_code_incorrect'
    || typeof d.evidenceReference !== 'string'
    || !/^docs\/registros\/[A-Za-z0-9_-]+\.md$/.test(d.evidenceReference)
    || !Array.isArray(d.corrections) || d.corrections.length < 1 || d.corrections.length > 3) return null;
  const kinds = new Set<string>();
  for (const entry of d.corrections) {
    const c = record(entry);
    if (!c || !exact(c, ['kind', 'symbols', 'instruction'])
      || !replanCorrectionKinds.includes(c.kind as ReplanCorrectionKind) || kinds.has(String(c.kind))
      || typeof c.instruction !== 'string' || c.instruction.trim().length < 10 || c.instruction.length > 600
      || !Array.isArray(c.symbols) || c.symbols.length < 1 || c.symbols.length > 12
      || c.symbols.some(s => typeof s !== 'string' || !/^[A-Za-z_$][A-Za-z0-9_$]{0,79}$/.test(s))
      || new Set(c.symbols).size !== c.symbols.length) return null;
    kinds.add(String(c.kind));
  }
  return value as ReplanDiagnosis;
}

/** Comparação estrutural: ordem e redação NÃO concedem progresso. */
export function deriveReplanStrategy(diagnosis: ReplanDiagnosis): readonly ReplanStrategy[] {
  return diagnosis.corrections.map(c => ({ kind: c.kind, symbols: [...c.symbols].sort() }))
    .sort((a, b) => a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0);
}
export function hasMaterialReplanProgress(diagnosis: ReplanDiagnosis, prior: unknown): boolean {
  const next = deriveReplanStrategy(diagnosis);
  if (!Array.isArray(prior)) return prior === undefined || prior === null;
  const normalized = prior.map(entry => {
    const c = record(entry);
    return c && typeof c.kind === 'string' && Array.isArray(c.symbols)
      ? { kind: c.kind, symbols: [...c.symbols].sort() } : null;
  });
  if (normalized.some(c => c === null)) return false;
  normalized.sort((a, b) => a!.kind < b!.kind ? -1 : a!.kind > b!.kind ? 1 : 0);
  return JSON.stringify(normalized) !== JSON.stringify(next);
}
export function replanInstructions(diagnosis: ReplanDiagnosis): string {
  return [...diagnosis.corrections].sort((a,b) => a.kind < b.kind ? -1 : 1)
    .map(c => `${c.kind} (${[...c.symbols].sort().join(', ')}): ${c.instruction.trim()}`).join('\n');
}
export function replanDiagnosisJson(diagnosis: ReplanDiagnosis): Json {
  return JSON.parse(JSON.stringify(diagnosis)) as Json;
}
