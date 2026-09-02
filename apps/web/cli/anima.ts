import { randomUUID } from 'node:crypto';
import type { ResultReviewDecision } from '@anima/core';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import { correctReviewedWorkItem } from '@/lib/work-orchestration/review-correction-orchestration';
import { readWorkRetryReadiness } from '@/lib/work-orchestration/retry-readiness';
import { parseArgs, USAGE, type ParsedCommand } from './args';
import { resolveCliIdentity } from './identity';
import { runStatus, runWorkApprove, runWorkCorrect, runWorkEvidence, runWorkList, runWorkReview, runWorkShow, runWorkWithdraw, runWorkRetry, type CommandResult, type WorkRetryCapability } from './app';
import { renderHuman } from './render';
import { EXIT, type ExitCode } from './exit-codes';

// ============================================================
// `anima` — entrypoint FINO da CLI operacional do Anima (adapter oficial).
//
// Roda por Node puro (Node 24, TS nativo) sem bundler, EXATAMENTE como o resident
// host, resolvendo o grafo @anima/@/ pelo loader `--import ./scripts/ts-resolve.mjs`
// + `--experimental-transform-types` e lendo `apps/web/.env.local`:
//   node --experimental-transform-types --import ./scripts/ts-resolve.mjs \
//        --env-file-if-exists=.env.local cli/anima.ts <args>
//
// Este arquivo só faz: parse → identidade → dispatch → imprimir → exit code.
// NENHUMA regra de negócio: elas vivem no core/serviço/RPC, compartilhadas com a web.
// A CLI NÃO fala com localhost:3000 — opera direto sobre os application services, então
// continua funcional com o Next parado.
// ============================================================

function jsonFlag(command: ParsedCommand): boolean {
  return command.kind !== 'help' && command.json;
}

async function dispatch(command: ParsedCommand): Promise<CommandResult> {
  if (command.kind === 'help') return { exitCode: EXIT.OK, payload: { ok: true, kind: 'help', usage: USAGE } };

  const identity = await resolveCliIdentity();
  if (!identity.ok) return { exitCode: EXIT.ERROR, payload: { ok: false, kind: 'error', error: identity.error, code: 'authentication_required' } };
  const { client, userId } = identity.identity;
  const service = createWorkOrchestrationService(client);

  switch (command.kind) {
    case 'status': return runStatus(service, userId, process.env);
    case 'work-list': return runWorkList(service);
    case 'work-show': return runWorkShow(service, command.id);
    case 'work-evidence': return runWorkEvidence(service, command.id);
    case 'work-request-changes': {
      const decision: ResultReviewDecision = { type: 'request_changes', requestedChanges: command.reason };
      return runWorkReview(service, command.id, decision);
    }
    case 'work-correct':
      return runWorkCorrect((workItemId) => correctReviewedWorkItem(client, workItemId), command.id);
    case 'work-approve':
      return runWorkApprove(service, command.id);
    case 'work-accept':
      return runWorkReview(service, command.id, { type: 'accept' });
    case 'work-withdraw':
      return runWorkWithdraw(service, command.id, command.reason);
    case 'work-retry': {
      const retry: WorkRetryCapability = {
        readReadiness: (workItemId) => readWorkRetryReadiness(client, workItemId),
        requestRetry: async ({ workItemId, expectedProposalVersion, failureEventId, retryRequestId }) => {
          const res = await client.rpc('request_work_retry', { p_work_item_id: workItemId, p_expected_proposal_version: expectedProposalVersion, p_failure_event_id: failureEventId, p_retry_request_id: retryRequestId });
          if (res.error) return { ok: false, code: res.error.code ?? null, message: res.error.message };
          const data = res.data as { replayed?: unknown } | null;
          return { ok: true, replayed: data?.replayed === true };
        },
      };
      return runWorkRetry(retry, command.id, () => randomUUID());
    }
  }
}

// Encerramento SEM `process.exit()` no caminho normal: só define `process.exitCode`
// e deixa o event loop drenar. `process.exit()` corre com o fechamento dos sockets
// keep-alive do undici (usados pelo supabase-js via fetch) e dispara uma assertion
// do libuv no Windows (`UV_HANDLE_CLOSING`), que aborta com código 127 e mascara o
// exit code real — quebrando o contrato para automação. Fechar o dispatcher global do
// undici (best-effort, sem quebrar tipos) faz o processo terminar imediatamente.
function finish(code: ExitCode): void {
  process.exitCode = code;
  try {
    const dispatcher = (globalThis as Record<symbol, unknown>)[Symbol.for('undici.globalDispatcher.1')];
    if (dispatcher && typeof (dispatcher as { close?: unknown }).close === 'function') {
      void (dispatcher as { close: () => Promise<void> }).close().catch(() => { /* best-effort */ });
    }
  } catch {
    /* sem undici acessível: o loop drena naturalmente. */
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.error}\n\n${USAGE}\n`);
    finish(EXIT.USAGE);
    return;
  }

  const result = await dispatch(parsed.command);
  const asJson = jsonFlag(parsed.command);
  const text = asJson ? JSON.stringify(result.payload, null, 2) : renderHuman(result.payload);
  const stream = result.payload.ok ? process.stdout : process.stderr;
  stream.write(`${text}\n`);
  finish(result.exitCode);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`erro fatal: ${message}\n`);
  finish(EXIT.ERROR);
});
