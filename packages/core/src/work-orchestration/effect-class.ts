/** Effect isolation is distinct from confidentiality: read_only does not confine reads. */
export type WorkEffectClass = 'read_only' | 'mutating';
export type EffectClassResult = { readonly ok: true; readonly value: WorkEffectClass } | { readonly ok: false; readonly reason: string };
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function parseEffectClass(value: unknown): EffectClassResult {
  if (value === undefined) return { ok: true, value: 'mutating' };
  if (value === 'read_only') return { ok: true, value };
  return { ok: false, reason: 'effect_class_invalid' };
}

export function readEffectClass(intent: unknown): EffectClassResult {
  const root = object(intent);
  if (!root) return { ok: false, reason: 'intent_invalid' };
  if (root.execution_spec === undefined) return parseEffectClass(undefined);
  const spec = object(root.execution_spec);
  return spec ? parseEffectClass(spec.effect_class) : { ok: false, reason: 'execution_spec_invalid' };
}

/** Only the explicitly supported read permission is accepted; unknown permissions fail closed. */
export function validateEffectClassCoherence(effect: unknown, permissions: readonly string[], executor: string): string | null {
  // `mutating` is the normalized legacy value, never an accepted persisted field.
  const parsed: EffectClassResult = effect === 'mutating' ? { ok: true, value: 'mutating' } : parseEffectClass(effect);
  if (!parsed.ok) return parsed.reason;
  if (parsed.value === 'read_only') {
    if (permissions.length !== 1 || permissions[0] !== 'workspace_read') return 'read_only_permissions_invalid';
    return executor === 'investigation-v1' ? null : 'read_only_executor_invalid';
  }
  return executor === 'investigation-v1' ? 'investigation_requires_read_only' : null;
}
