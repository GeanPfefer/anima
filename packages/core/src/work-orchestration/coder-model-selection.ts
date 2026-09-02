// ============================================================
// Seleção GOVERNADA de modelo de coder local quando o modelo PREFERIDO (do
// execution_spec aprovado) não cabe na capacidade do hardware.
//
// PRINCÍPIO. Mudar o modelo de execução é uma decisão de EXECUÇÃO, não uma
// alteração silenciosa da intenção aprovada: o intent/execution_spec permanece
// intacto (o modelo preferido continua sendo o do contrato); o host, ao materializar
// o attempt, escolhe de forma DETERMINÍSTICA um modelo alternativo PERMITIDO e
// compatível quando o preferido não cabe, e REGISTRA o downgrade (preferido ×
// selecionado × razão × evidência de capacidade) na evidência host-observed do coder.
// Nunca esconde o downgrade; nunca usa modelo fora da allowlist; fail-closed quando
// nenhum modelo permitido cabe.
//
// A capacidade e a allowlist são CONFIGURADAS (capability já declarada pelo operador
// que conhece o hardware) — a política é pura e não observa GPU aqui; a observação de
// VRAM ao vivo é um refinamento futuro. Ausência de configuração ⇒ política DESLIGADA
// (usa o preferido como hoje).
// ============================================================

/** Um modelo de coder permitido e sua exigência aproximada de memória (GB) para caber. */
export interface CoderModelCandidate {
  readonly model: string;
  /** Memória (GB) que o modelo exige para caber (ex.: tamanho do peso). Positiva. */
  readonly requiresGb: number;
}

/** Política de capacidade CONFIGURADA: teto de memória do hardware + allowlist. */
export interface CoderCapacityPolicy {
  /** Teto de memória disponível para o coder (ex.: VRAM da GPU), em GB. */
  readonly capacityGb: number;
  /** Modelos PERMITIDOS. A seleção nunca sai desta lista. */
  readonly allowlist: readonly CoderModelCandidate[];
}

/** Evidência AUDITÁVEL da seleção — anexada à evidência host-observed do coder para
 * que o downgrade seja sempre observável, nunca silencioso. */
export interface CoderModelSelectionEvidenceV1 {
  readonly schemaVersion: 1;
  readonly preferred: string;
  readonly selected: string;
  readonly downgraded: boolean;
  readonly reason: CoderModelSelectionReason;
  readonly capacityGb: number;
  /** Exigência (GB) do modelo SELECIONADO. */
  readonly requiresGb: number;
}

export type CoderModelSelectionReason = 'preferred_fits' | 'preferred_exceeds_capacity';

export type CoderModelSelectionRefusal =
  | 'invalid_capacity'
  | 'empty_allowlist'
  | 'preferred_not_allowlisted'
  | 'no_compatible_model';

export type CoderModelSelectionResult =
  | { readonly ok: true; readonly evidence: CoderModelSelectionEvidenceV1 }
  | { readonly ok: false; readonly reason: CoderModelSelectionRefusal; readonly preferred: string; readonly capacityGb: number };

const validCandidate = (c: CoderModelCandidate): boolean =>
  typeof c.model === 'string' && c.model.trim().length > 0
  && typeof c.requiresGb === 'number' && Number.isFinite(c.requiresGb) && c.requiresGb > 0;

/**
 * Escolhe, de forma PURA e DETERMINÍSTICA, o modelo de coder a usar:
 *  - preferido PRECISA estar na allowlist (senão fail-closed: não roda modelo não permitido);
 *  - se o preferido cabe (`requiresGb <= capacityGb`) ⇒ usa o preferido (sem downgrade);
 *  - senão ⇒ o MAIOR modelo allowlistado que cabe (melhor capacidade que ainda cabe);
 *  - se nenhum modelo permitido cabe ⇒ fail-closed (`no_compatible_model`).
 * Empates de `requiresGb` são desempatados por ordem de declaração na allowlist (estável).
 */
export function selectGovernedCoderModel(preferred: string, policy: CoderCapacityPolicy): CoderModelSelectionResult {
  const capacityGb = policy.capacityGb;
  if (typeof capacityGb !== 'number' || !Number.isFinite(capacityGb) || capacityGb <= 0) {
    return { ok: false, reason: 'invalid_capacity', preferred, capacityGb };
  }
  const allowlist = policy.allowlist.filter(validCandidate);
  if (allowlist.length === 0) return { ok: false, reason: 'empty_allowlist', preferred, capacityGb };

  const preferredCandidate = allowlist.find(c => c.model === preferred);
  if (!preferredCandidate) return { ok: false, reason: 'preferred_not_allowlisted', preferred, capacityGb };

  if (preferredCandidate.requiresGb <= capacityGb) {
    return { ok: true, evidence: { schemaVersion: 1, preferred, selected: preferred, downgraded: false, reason: 'preferred_fits', capacityGb, requiresGb: preferredCandidate.requiresGb } };
  }

  // Preferido não cabe: maior allowlistado que cabe (estável por índice em empate).
  let best: CoderModelCandidate | null = null;
  for (const candidate of allowlist) {
    if (candidate.requiresGb > capacityGb) continue;
    if (best === null || candidate.requiresGb > best.requiresGb) best = candidate;
  }
  if (best === null) return { ok: false, reason: 'no_compatible_model', preferred, capacityGb };
  return { ok: true, evidence: { schemaVersion: 1, preferred, selected: best.model, downgraded: true, reason: 'preferred_exceeds_capacity', capacityGb, requiresGb: best.requiresGb } };
}
