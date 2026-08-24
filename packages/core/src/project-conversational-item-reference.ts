import type { ProjectAdvisoryAnswer } from './project-advisor';
import type { OperationalProjectSnapshot } from './project-operational-snapshot';

const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const UUID = new RegExp(`^${UUID_SOURCE}$`, 'i');
const UUIDS = new RegExp(`\\b${UUID_SOURCE}\\b`, 'ig');
const MAX_REFERENCES = 20;

export const PRESENTED_ITEM_ROLES = ['active_item', 'unresolved_failure', 'review_item', 'blocked_item'] as const;
export type PresentedItemRole = typeof PRESENTED_ITEM_ROLES[number];
export type PresentedItemReference = {
  readonly workItemId: string;
  readonly ordinal: number;
  readonly role: PresentedItemRole;
};

export type ConversationalItemResolution =
  | { readonly kind: 'resolved'; readonly itemId: string; readonly basis: 'presented_ordinal' | 'presented_anaphora' | 'presented_failure' }
  | { readonly kind: 'clarification_required'; readonly references: readonly PresentedItemReference[] }
  | { readonly kind: 'not_contextual' };

const normalize = (value: string) => value.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const roleFor = (id: string, snapshot: OperationalProjectSnapshot): PresentedItemRole | null => {
  if (snapshot.recentlyFailed.some(item => item.itemRef === id)) return 'unresolved_failure';
  if (snapshot.awaitingReview.some(item => item.itemRef === id)) return 'review_item';
  if (snapshot.blocked.some(item => item.itemRef === id)) return 'blocked_item';
  if (snapshot.activeWork.some(item => item.itemRef === id)) return 'active_item';
  return null;
};

export function derivePresentedItemReferences(
  answer: ProjectAdvisoryAnswer,
  snapshot: OperationalProjectSnapshot,
): readonly PresentedItemReference[] {
  const claims = [...answer.facts, ...answer.provenCapabilities, ...answer.unprovenFrontiers,
    ...answer.canonicalDirections, answer.recommendation, ...answer.rationale];
  const seen = new Set<string>();
  const references: PresentedItemReference[] = [];
  for (const claim of claims) {
    for (const raw of claim.statement.match(UUIDS) ?? []) {
      const id = raw.toLowerCase();
      const role = roleFor(id, snapshot);
      if (!role || seen.has(id)) continue;
      seen.add(id);
      references.push({ workItemId: id, ordinal: references.length + 1, role });
      if (references.length === MAX_REFERENCES) return references;
    }
  }
  return references;
}

export function parsePresentedItemReferences(value: unknown): readonly PresentedItemReference[] {
  if (!Array.isArray(value) || value.length > MAX_REFERENCES) return [];
  const parsed: PresentedItemReference[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const entry = raw as Record<string, unknown>;
    if (typeof entry.workItemId !== 'string' || !UUID.test(entry.workItemId)
      || entry.ordinal !== index + 1
      || typeof entry.role !== 'string' || !PRESENTED_ITEM_ROLES.includes(entry.role as PresentedItemRole)
      || seen.has(entry.workItemId.toLowerCase())
      || Object.keys(entry).some(key => !['workItemId', 'ordinal', 'role'].includes(key))) return [];
    seen.add(entry.workItemId.toLowerCase());
    parsed.push({ workItemId: entry.workItemId.toLowerCase(), ordinal: index + 1, role: entry.role as PresentedItemRole });
  }
  return parsed;
}

const ordinal = (message: string): number | null => {
  const value = normalize(message);
  const words: readonly [RegExp, number][] = [
    [/\b(?:o|a)?\s*primeir[oa]\b/, 1], [/\b(?:o|a)?\s*segund[oa]\b/, 2],
    [/\b(?:o|a)?\s*terceir[oa]\b/, 3], [/\b(?:o|a)?\s*quart[oa]\b/, 4], [/\b(?:o|a)?\s*quint[oa]\b/, 5],
  ];
  return words.find(([pattern]) => pattern.test(value))?.[1] ?? null;
};

export function resolveConversationalItemReference(
  message: string,
  references: readonly PresentedItemReference[],
): ConversationalItemResolution {
  const contextual = parsePresentedItemReferences(references);
  if (contextual.length === 0) return { kind: 'not_contextual' };
  const value = normalize(message.trim());
  if (new RegExp(UUID_SOURCE, 'i').test(value) || /\b[0-9a-f]{8,12}\b/i.test(value)) return { kind: 'not_contextual' };
  const wantsFailure = /\bfalha\b|\bfalhou\b/.test(value);
  const candidates = wantsFailure ? contextual.filter(reference => reference.role === 'unresolved_failure') : contextual;
  const position = ordinal(value);
  if (position !== null) {
    const selected = candidates[position - 1];
    return selected ? { kind: 'resolved', itemId: selected.workItemId, basis: 'presented_ordinal' }
      : candidates.length > 0 ? { kind: 'clarification_required', references: candidates } : { kind: 'not_contextual' };
  }
  if (/\bessa falha\b|\baquela falha\b|\bfalha que (?:voce )?mencionou\b/.test(value)) {
    return candidates.length === 1 ? { kind: 'resolved', itemId: candidates[0]!.workItemId, basis: 'presented_failure' }
      : candidates.length > 1 ? { kind: 'clarification_required', references: candidates } : { kind: 'not_contextual' };
  }
  if (/\besse item\b|\bdesse item\b|\bneste item\b|\bo item que (?:voce )?mencionou\b|\b(?:e|é) esse\b|\bdele\b|\bpor que ele\b/.test(value)) {
    return contextual.length === 1 ? { kind: 'resolved', itemId: contextual[0]!.workItemId, basis: 'presented_anaphora' }
      : { kind: 'clarification_required', references: contextual };
  }
  return { kind: 'not_contextual' };
}

export function isConversationalItemReferenceQuestion(message: string): boolean {
  const value = normalize(message.trim());
  return /\b(?:primeir[oa]|segund[oa]|terceir[oa]|quart[oa])\b|\b(?:esse|desse|neste) item\b|\b(?:essa|aquela) falha\b|\bitem que (?:voce )?mencionou\b|\bfalha que (?:voce )?mencionou\b|\bultima tentativa dele\b|\bpor que ele\b|\b(?:e|é) esse\b/.test(value);
}
