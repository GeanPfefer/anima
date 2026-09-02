import type { CoderCapacityPolicy, CoderModelCandidate } from '@anima/core';

// Resolve a política de capacidade de coder CONFIGURADA pelo operador (que conhece o
// hardware). Fonte de verdade: variáveis de ambiente. AUSENTE ou malformada ⇒ política
// DESLIGADA (`null`) — o fluxo usa o modelo preferido como sempre (backward-compatible).
//
//   ANIMA_CODER_VRAM_GB          teto de memória do coder (ex.: VRAM da GPU), em GB.
//   ANIMA_CODER_MODEL_ALLOWLIST  JSON: [{ "model": "qwen2.5-coder:14b", "requiresGb": 10 }, ...]
//
// A allowlist DEVE conter o modelo preferido (senão a seleção governada falha fechado:
// não se roda modelo fora da allowlist). Isto é config, não observação de GPU ao vivo
// (refinamento futuro): a autoridade é a capacidade declarada.

const parseAllowlist = (raw: string): readonly CoderModelCandidate[] | null => {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(parsed)) return null;
  const out: CoderModelCandidate[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) return null;
    const record = entry as Record<string, unknown>;
    const model = record['model'];
    const requiresGb = record['requiresGb'];
    if (typeof model !== 'string' || model.trim().length === 0) return null;
    if (typeof requiresGb !== 'number' || !Number.isFinite(requiresGb) || requiresGb <= 0) return null;
    out.push({ model, requiresGb });
  }
  return out.length > 0 ? out : null;
};

export function resolveCoderCapacityPolicy(env: NodeJS.ProcessEnv = process.env): CoderCapacityPolicy | null {
  const capRaw = env.ANIMA_CODER_VRAM_GB;
  const listRaw = env.ANIMA_CODER_MODEL_ALLOWLIST;
  if (!capRaw || !listRaw) return null;
  const capacityGb = Number(capRaw);
  if (!Number.isFinite(capacityGb) || capacityGb <= 0) return null;
  const allowlist = parseAllowlist(listRaw);
  if (allowlist === null) return null;
  return { capacityGb, allowlist };
}
