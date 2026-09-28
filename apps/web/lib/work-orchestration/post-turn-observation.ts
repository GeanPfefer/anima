import type { ChangeAuthorizationFactsV1, ObservedCoderInput, ObservedGateInput } from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { gateEvidenceSinkFor, persistHostObservedGateEvidence } from './gate-evidence';
import { coderEvidenceSinkFor, persistHostObservedCoderEvidence } from './coder-evidence';
import { hostEvidenceSinkFor, observeAndPersistHostGitEvidence } from './host-evidence';
import { verifierOpinionSinkFor } from './verifier-opinion';
import { verifyAndReleaseCandidate, type MandatedVerificationOutcome } from './mandated-verification';
import { projectRoot, type ExecutionContract } from './executor-selection';
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
// TUDO fail-open: persistir evidência ou parecer NUNCA altera o desfecho da
// tentativa nem a resposta. Um defeito de telemetria vira evidência AUSENTE,
// jamais um erro que contamine o turno. Não aceita, autoriza, integra nem aplica.
// ============================================================

export interface PostTurnObservationInput {
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
}

/**
 * Persiste a evidência observada pelo host e o parecer do Verifier de uma volta
 * que iniciou uma tentativa. Idempotente e fail-open. Só age quando a volta
 * produziu uma tentativa correlacionada (attempt + selection).
 */
export async function persistPostTurnHostObservations(input: PostTurnObservationInput): Promise<MandatedVerificationOutcome | null> {
  const { client, result, contract, gateObservations, coderObservations, changeAuthorization } = input;
  if (!result.attemptId || !result.selection) return null;

  const correlation = {
    workItemId: result.selection.workItemId,
    attemptId: result.attemptId,
    approvedProposalVersion: result.selection.approvedProposalVersion,
  };

  // (0) GATE observado pelo host — persiste INCLUSIVE em terminal de erro (um gate
  // falho é a evidência mais valiosa: contradiz um executor que minta que passou).
  if (gateObservations.length > 0) {
    await persistHostObservedGateEvidence(correlation, gateObservations, gateEvidenceSinkFor(client), undefined, changeAuthorization).catch(() => undefined);
  }

  // (0b) CODER observado pelo host — UMA evidência por tentativa, agregando a
  // duração wall-clock de todas as chamadas `backend.edit()` observadas.
  if (coderObservations.length > 0) {
    await persistHostObservedCoderEvidence(correlation, coderObservations, coderEvidenceSinkFor(client)).catch(() => undefined);
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
    await observeAndPersistHostGitEvidence(
      {
        repoRoot: projectRoot(),
        baseSha: contract.baseSha,
        startSha: contract.resumeCheckpointCommitSha ?? contract.baseSha,
        branch: worktreeBranchFor(result.attemptId),
        ...correlation,
      },
      hostEvidenceSinkFor(client),
    ).catch(() => undefined);
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
    sink: verifierOpinionSinkFor(client),
  });
}
