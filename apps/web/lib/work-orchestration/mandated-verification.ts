import { readVerifierRequirement, type VerifierOpinionV1, type WorkEvent, type WorkItem, type WorkOperationResult } from '@anima/core';
import { computeAndPersistVerifierOpinion, type VerifierOpinionOutcome, type VerifierOpinionSink } from './verifier-opinion';

// ============================================================
// Mandated Verifier Enforcement V0.1 — verificação OBRIGATÓRIA do resultado candidato.
//
// No lane com `execution_spec.verifier_requirement = required_fail_closed` o terminal
// grava o resultado como CANDIDATO (item continua `in_progress`). Este módulo é o passo
// host-side que falta para o candidato ficar elegível a `review`:
//
//   evidência já persistida (git/gate/coder) → Verifier computa → parecer PERSISTIDO
//   (a RPC libera para `review` na MESMA transação, só com parecer conclusivo e
//   correlação completa) → RELEITURA do item: só `review` observado conta.
//
// Timeout explícito e limitado (não depende de timeout incidental de transporte).
// Qualquer falha — não rodou, lançou, estourou o tempo, persistência recusada, parecer
// não conclusivo, liberação não observada, releitura falha — deixa o candidato RETIDO
// (fora de `review`); a reconciliação o relata e a próxima volta re-verifica.
// Lanes advisory mantêm o comportamento anterior (fail-open, sem releitura).
// ============================================================

/** Teto do Verifier obrigatório (compute + persistência). */
export const MANDATED_VERIFIER_TIMEOUT_MS = 60_000;

export type MandatedVerificationHoldReason =
  | 'item_read_failed'
  | 'verifier_skipped'
  | 'verifier_threw'
  | 'verifier_timeout'
  | 'persist_failed'
  | 'not_conclusive'
  | 'release_not_observed'
  | 'readback_failed';

export type MandatedVerificationOutcome =
  | { readonly status: 'advisory'; readonly opinion: VerifierOpinionOutcome | null }
  | { readonly status: 'released'; readonly verdict: VerifierOpinionV1['verdict'] }
  | { readonly status: 'held'; readonly reason: MandatedVerificationHoldReason; readonly detail?: string };

export interface MandatedVerificationDeps {
  readonly getItem: (id: string) => Promise<WorkOperationResult<WorkItem>>;
  readonly listEvents: (id: string) => Promise<WorkOperationResult<readonly WorkEvent[]>>;
  readonly sink: VerifierOpinionSink;
  readonly timeoutMs?: number;
  /** Injetável para teste; default = `computeAndPersistVerifierOpinion`. */
  readonly computeAndPersist?: typeof computeAndPersistVerifierOpinion;
}

const TIMEOUT = Symbol('timeout');

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => { timer = setTimeout(() => resolve(TIMEOUT), ms); });
  return Promise.race([promise, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}

/**
 * Verifica o resultado mais recente do item e, no lane obrigatório, confirma pela
 * RELEITURA que ele foi liberado para `review`. Nunca lança; nunca aceita nem integra.
 */
export async function verifyAndReleaseCandidate(workItemId: string, deps: MandatedVerificationDeps): Promise<MandatedVerificationOutcome> {
  const compute = deps.computeAndPersist ?? computeAndPersistVerifierOpinion;
  const held = (reason: MandatedVerificationHoldReason, detail?: string): MandatedVerificationOutcome =>
    ({ status: 'held', reason, ...(detail ? { detail } : {}) });

  let item: WorkItem;
  let events: readonly WorkEvent[];
  try {
    const [itemRead, eventsRead] = await Promise.all([deps.getItem(workItemId), deps.listEvents(workItemId)]);
    if (!itemRead.ok || !eventsRead.ok) {
      // Sem ler o item não se prova o lane: para o lane obrigatório isso é retenção;
      // para advisory, é o mesmo "sem parecer" silencioso de antes.
      return held('item_read_failed');
    }
    item = itemRead.value;
    events = eventsRead.value;
  } catch (error) {
    return held('item_read_failed', error instanceof Error ? error.message : String(error));
  }

  if (readVerifierRequirement(item.intent) === 'advisory') {
    // Comportamento anterior: parecer advisory, fail-open, sem releitura.
    const opinion = await compute({ item, events }, deps.sink).catch(() => null);
    return { status: 'advisory', opinion };
  }

  let outcome: VerifierOpinionOutcome | typeof TIMEOUT;
  try {
    outcome = await withTimeout(compute({ item, events }, deps.sink), deps.timeoutMs ?? MANDATED_VERIFIER_TIMEOUT_MS);
  } catch (error) {
    return held('verifier_threw', error instanceof Error ? error.message : String(error));
  }
  if (outcome === TIMEOUT) return held('verifier_timeout');
  if (!outcome.ok) return held(outcome.stage === 'skipped' ? 'verifier_skipped' : 'persist_failed', outcome.reason);

  // Só o parecer PERSISTIDO conta, e só o estado RELIDO prova a liberação.
  try {
    const reread = await deps.getItem(workItemId);
    if (!reread.ok) return held('readback_failed', reread.error.message);
    if (reread.value.state === 'review') return { status: 'released', verdict: outcome.opinion.verdict };
    return outcome.opinion.verdict === 'inconclusive' ? held('not_conclusive') : held('release_not_observed', reread.value.state);
  } catch (error) {
    return held('readback_failed', error instanceof Error ? error.message : String(error));
  }
}
