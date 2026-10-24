import type { ChangeAuthorizationFactsV1, ObservedCoderInput, ObservedGateInput } from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { persistHostObservedGateEvidence } from './gate-evidence';
import { persistHostObservedCoderEvidence } from './coder-evidence';
import { persistHostObservedExecutionContext, resolveExecutionContextClaim, type ExecutionContextClaim } from './execution-context-evidence';
import { observeAndPersistHostGitEvidence } from './host-evidence';
import { defaultTrustedSystemWriter, type TrustedSystemWriter } from './trusted-system-writer';
import { MANDATED_VERIFIER_TIMEOUT_MS, TIMEOUT, withTimeout, verifyAndReleaseCandidate, type MandatedVerificationOutcome } from './mandated-verification';
import { projectRoot, type ExecutionContract } from './executor-selection';
import { verifyExternalTargetForContract } from './external-target-resolver';
import { createWorkOrchestrationService } from './server';
import type { SupervisorTurnResult } from './supervisor';
import { worktreeBranchFor } from './worktree-executor';

// ============================================================
// Observação host-side pós-volta — a mesma para o turno único (rota
// `supervisor-turn`) e para o driver do backlog. É o que torna uma volta
// autônoma AUDITÁVEL e o `review` confiável: o host persiste sua evidência de
// primeira parte (gate/coder cronometrados, git observado na worktree) e o
// Verifier registra seu parecer sobre o estado FRESCO.
//
// O fluxo global conserva fail-open. Single-Item exige evidências e parecer
// persistidos antes de reportar sucesso. Não aceita, integra nem aplica.
// ============================================================

export interface PostTurnObservationInput {
  readonly singleItem?: boolean;
  readonly finalizationTimeoutMs?: number;
  readonly client: SupabaseClient<Database>;
  readonly result: SupervisorTurnResult;
  /** Contrato do executor desta volta (null quando não há caminho worktree). */
  readonly contract: ExecutionContract | null;
  /** Durações de gate cronometradas pelo host ao redor de cada gate rodado. */
  readonly gateObservations: readonly ObservedGateInput[];
  /** Durações wall-clock do coder cronometradas pelo host ao redor de `backend.edit()`. */
  readonly coderObservations: readonly ObservedCoderInput[];
  /** Fatos de AUTORIZAÇÃO DE MUDANÇA host-observados na execução (escopo autorizado +
   * arquivos alterados). OPCIONAL: ausente ⇒ evidência de gate sem change authorization. */
  readonly changeAuthorization?: ChangeAuthorizationFactsV1;
  /** Trusted System Writer V0: única porta dos fatos de SISTEMA (evidência + parecer).
   * Default = writer do processo (env do servidor); ausente ⇒ todo sink recusa. */
  readonly systemWriter?: TrustedSystemWriter;
  /** Declaração de modo/ator/runner (A2-0 R1). Ausente ⇒ resolvida do ambiente do servidor + RLS; `null` ⇒ sem
   * declaração, nenhum fato é registrado. O banco decide se a declaração é sustentada pelo ledger. */
  readonly executionContext?: ExecutionContextClaim | null;
  /** Injeção de teste da verificação de identidade do target externo (default: resolver real). */
  readonly verifyExternalTarget?: typeof verifyExternalTargetForContract;
}

/**
 * Persiste a evidência observada pelo host e o parecer do Verifier de uma volta
 * que iniciou uma tentativa. Idempotente e fail-open. Só age quando a volta
 * produziu uma tentativa correlacionada (attempt + selection).
 */
export async function persistPostTurnHostObservations(input: PostTurnObservationInput): Promise<MandatedVerificationOutcome | null> {
  const { client, result, contract, gateObservations, coderObservations, changeAuthorization } = input;
  if (!result.attemptId || !result.selection) return null;
  // `author=system` é fronteira de confiança: estes fatos NUNCA são gravados com a sessão
  // humana/residente (`client`), só pelo writer de sistema. `client` segue lendo estado.
  const writer = input.systemWriter ?? defaultTrustedSystemWriter();

  const strict = input.singleItem === true && result.terminalKind === 'result';
  const held = (): MandatedVerificationOutcome => ({ status: 'held', reason: 'persist_failed' });
  if (strict && (!gateObservations.length || !coderObservations.length || contract?.executor !== 'worktree' || !contract.baseSha)) return held();
  const correlation = {
    workItemId: result.selection.workItemId,
    attemptId: result.attemptId,
    approvedProposalVersion: result.selection.approvedProposalVersion,
  };

  // (-1) CONTEXTO DE EXECUÇÃO (A2-0 R1): fato de modo/ator correlacionado à attempt. Fail-open e fora do
  // caminho do Verifier — nunca retém nem libera candidato, nunca altera o desfecho da volta.
  {
    const claim = input.executionContext !== undefined ? input.executionContext
      : await resolveExecutionContextClaim(client, correlation.workItemId).catch(() => null);
    await persistHostObservedExecutionContext(correlation, claim, writer.executionContext).catch(() => null);
  }

  // (0) GATE observado pelo host — persiste INCLUSIVE em terminal de erro (um gate
  // falho é a evidência mais valiosa: contradiz um executor que minta que passou).
  if (gateObservations.length > 0) {
    const persisted = await persistHostObservedGateEvidence(correlation, gateObservations, writer.gateEvidence, undefined, changeAuthorization).catch(() => null);
    if (strict && !persisted?.ok) return held();
  }

  // (0b) CODER observado pelo host — UMA evidência por tentativa, agregando a
  // duração wall-clock de todas as chamadas `backend.edit()` observadas.
  if (coderObservations.length > 0) {
    const persisted = await persistHostObservedCoderEvidence(correlation, coderObservations, writer.coderEvidence).catch(() => null);
    if (strict && !persisted?.ok) return held();
  }

  // (1) GIT observado pelo host. Só o caminho worktree deixa uma branch real; o
  // host inspeciona `anima-work/<attempt>` contra o SHA-base do contrato e persiste
  // o que o git de fato registrou — nunca o que o executor atestou. Persiste
  // INCLUSIVE em terminal de ERRO (gate falho): quando a tentativa deixou um
  // checkpoint durável na branch, essa evidência é o que torna o checkpoint de uma
  // tentativa FALHA disponível para diagnóstico e retomada (decomposição governada).
  // observeHostGitEvidence é fail-closed em base==commit — sem checkpoint durável,
  // nada é gravado —, então um erro sem edit efetivo não fabrica evidência.
  if ((result.terminalKind === 'result' || result.terminalKind === 'error')
      && contract?.executor === 'worktree' && contract.baseSha) {
    // Target externo: o Git observado é o do repositório VERIFICADO (identidade autorizada ×
    // vivo), nunca o do Anima. Divergência ⇒ nenhuma evidência é fabricada e o candidato é retido.
    let observedRoot: string | null = contract.targetSpec ? null : projectRoot();
    if (contract.targetSpec) {
      const verified = await (input.verifyExternalTarget ?? verifyExternalTargetForContract)(contract).catch(() => null);
      observedRoot = verified?.ok ? verified.repoRoot : null;
    }
    const persisted = observedRoot === null ? null : await observeAndPersistHostGitEvidence(
      {
        repoRoot: observedRoot,
        baseSha: contract.baseSha,
        startSha: contract.resumeCheckpointCommitSha ?? contract.baseSha,
        branch: worktreeBranchFor(result.attemptId),
        ...correlation,
      },
      writer.hostEvidence,
    ).catch(() => null);
    if (strict && !persisted?.ok) return held();
  }

  // (2) PARECER do Verifier sobre o estado FRESCO — só no terminal `result` (sem
  // handoff durável de sucesso não há parecer). Inclui as evidências observadas
  // recém-persistidas (passos 0–1 acima, na ordem obrigatória). Lane advisory:
  // recomputável e fail-open, como antes. Lane com Verifier obrigatório (V0.1): o
  // resultado é CANDIDATO até o parecer persistido liberar para `review`; timeout
  // explícito e releitura — qualquer falha deixa o candidato retido.
  if (result.terminalKind !== 'result') return null;
  const service = createWorkOrchestrationService(client);
  return verifyAndReleaseCandidate(correlation.workItemId, {
    getItem: (id) => service.getItem(id),
    listEvents: (id) => service.listEvents(id),
    sink: writer.verifierOpinion,
    ...(strict ? { requireVerified: true } : {}),
  });
}

/** Somente terminal já persistido: sem criar attempts, retries ou manutenção. */
export async function finalizeSingleItemTurn(input: PostTurnObservationInput): Promise<SupervisorTurnResult> {
  const turn = input.result;
  if (!turn.terminalKind || !turn.claimId || !turn.attemptId || !turn.selection || turn.claimReleased) return turn;
  let verification: MandatedVerificationOutcome | null = null;
  let failure: string | null = null;
  const coder = input.contract?.coderBackend;
  if (coder === 'codex-cli' && input.coderObservations.some(o => o.backendId !== 'codex-cli:default')) {
    failure = 'single_item_executor_mismatch';
  } else {
    try {
      const observed = await withTimeout(persistPostTurnHostObservations({ ...input, singleItem: true }),
        Math.max(1, Math.min(MANDATED_VERIFIER_TIMEOUT_MS, input.finalizationTimeoutMs ?? MANDATED_VERIFIER_TIMEOUT_MS)));
      if (observed === TIMEOUT) failure = 'single_item_verification_timeout';
      else verification = observed;
    }
    catch { failure = 'single_item_evidence_failed'; }
  }
  if (turn.terminalKind === 'result' && (!verification || verification.status !== 'released' || verification.verdict !== 'verified')) {
    failure ??= 'single_item_verification_failed';
  }
  // O executor já encerrou e há terminal durável; falha de Verifier não mantém
  // posse de execução fictícia. O resultado continua não aprovado e é reportado.
  let releaseFailure: string | null = null;
  try {
    const released = await withTimeout(Promise.resolve(input.client.rpc('release_work_claim', { claim_id: turn.claimId, reason: 'attempt_finished' })),
      Math.max(1, Math.min(MANDATED_VERIFIER_TIMEOUT_MS, input.finalizationTimeoutMs ?? MANDATED_VERIFIER_TIMEOUT_MS)));
    if (released === TIMEOUT) releaseFailure = 'claim release timeout; outcome unknown';
    else if (released.error) releaseFailure = released.error.message;
    else {
      const row = Array.isArray(released.data) && released.data.length === 1 ? released.data[0] : released.data;
      if (!row || typeof row !== 'object' || Array.isArray(row)
        || row.id !== turn.claimId || row.work_item_id !== turn.selection.workItemId
        || row.attempt_id !== turn.attemptId || row.approved_proposal_version !== turn.selection.approvedProposalVersion
        || row.release_reason !== 'attempt_finished' || typeof row.released_at !== 'string'
        || !Number.isFinite(Date.parse(row.released_at))) releaseFailure = 'claim release not confirmed by correlated response';
    }
  } catch { releaseFailure = 'claim release unavailable'; }
  return { ...turn, outcome: failure || releaseFailure ? 'execution_interrupted' : turn.terminalKind === 'result' ? 'execution_completed' : turn.outcome,
    claimReleased: !releaseFailure, requiresAnotherTurn: false,
    refusal: releaseFailure ? { code: 'single_item_claim_release_failed', message: releaseFailure }
      : failure ? { code: failure, message: 'Finalização incompleta; nenhuma nova attempt ou integração autorizada.' } : null };
}
