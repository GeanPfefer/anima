import { appendFileSync } from 'node:fs';
import {
  runResidentHost,
  DEFAULT_BACKOFF,
  type AdmissionVerdict,
  type BackoffPolicy,
  type HostTurnOutcome,
  type MaterializationAttempt,
  type ResidentIdentity,
  type WakeReason,
} from '../lib/resident-host/resident-host.ts';
import {
  createGoTrueIdentityProvider,
  createHttpHostTurnPort,
  createKillSwitch,
} from '../lib/resident-host/ports.ts';
import { createWakeCoordinator } from '../lib/resident-host/wake.ts';

// ============================================================
// `anima local-host start` — a primeira superfície do Resident Local Host V0 (ADR-003).
//
// Gean inicia UMA VEZ; o processo fica residente e quiescente; quando há trabalho
// elegível e é permitido, acorda, o Governor (por-ciclo, dentro da rota) permite, o
// qwen3-coder executa, o gate passa, a evidência host-observed é persistida, o Verifier
// aprova, o item chega a `review`, e o runner volta a idle. Sem cron, sem serviço do
// Windows, sem auto-start no boot, sem service_role.
//
// Roda por Node 24 (TS nativo), sem bundler:
//   node --env-file-if-exists=.env.local apps/web/scripts/resident-host.ts
// A engine é agnóstica de transporte; aqui compomos os portos REAIS (Bearer/GoTrue,
// kill-switch de control-plane local, host-turn por HTTP). O pré-gate do Governor no
// transporte HTTP é `permit` — a autoridade real roda POR CICLO dentro da rota; a
// engine ainda o consulta como seam (defesa em profundidade ativa no transporte
// in-process futuro). Ver ADR-003 §13.
// ============================================================

// Telemetria durável mínima (ADR-003 §14): além do stdout, um LOG APPEND-ONLY local
// (JSONL) quando `ANIMA_RESIDENT_LOG_FILE` está setado — para não depender só do stdout
// do processo. Eventos do HOST não pertencem a um work_item específico, então NÃO vão para
// `work_events`; um host log local é a menor arquitetura coerente. Best-effort: falha de
// escrita não derruba o runner. NUNCA inclui o accessToken.
const LOG_FILE = process.env.ANIMA_RESIDENT_LOG_FILE ?? null;
const log = (event: string, data: Record<string, unknown> = {}): void => {
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...data });
  process.stdout.write(`${line}\n`);
  if (LOG_FILE) {
    try { appendFileSync(LOG_FILE, `${line}\n`); } catch { /* durabilidade best-effort */ }
  }
};

const positiveInt = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

// --- Cancelamento cooperativo: SIGINT/SIGTERM → parada determinística. ---
const controller = new AbortController();
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => { log('signal', { signal: sig }); controller.abort(); });
}

// --- Wake: EVENT-DRIVEN primário (Realtime de work_events, fiado em main()) + wake
//     explícito (linha "wake" no stdin) + fallback de poll (safety net) + cancelamento.
//     O coordenador COALESCE sinais e a elegibilidade vem do domínio na próxima volta —
//     evento perdido/duplicado é seguro. O wake por stdin é OPCIONAL. ---
const wake = createWakeCoordinator();
try {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    if (chunk.toLowerCase().includes('wake')) wake.signal('explicit');
  });
  if (typeof process.stdin.unref === 'function') process.stdin.unref(); // não segura o processo no encerramento.
} catch {
  // stdin indisponível: wake explícito por stdin fica desabilitado; evento/poll bastam.
}
// Telemetria de wakeSource: envolve o coordenador para logar POR QUE acordou (event|poll|
// explicit|cancelled), distinguindo o evento real do timer de fallback.
const waitForWake = async (input: { backoffMs: number; signal: AbortSignal }): Promise<WakeReason> => {
  const reason = await wake.wait(input);
  if (reason !== 'cancelled') log('wake', { wakeSource: reason });
  return reason;
};

async function main(): Promise<void> {
  const baseUrl = process.env.ANIMA_RESIDENT_ROUTE_BASE ?? 'http://localhost:3000';
  const maxTurnsPerCycle = positiveInt(process.env.ANIMA_RESIDENT_MAX_TURNS_PER_CYCLE, 1);
  const maxCycles = positiveInt(process.env.ANIMA_RESIDENT_MAX_CYCLES, 2);
  const killFile = process.env.ANIMA_AUTONOMY_FILE ?? null;
  // Transporte do host-turn: `in_process` (default — compõe a aplicação diretamente, SEM
  // depender do Next server) ou `http` (POST à rota provada; requer localhost:3000 vivo).
  const transport = (process.env.ANIMA_RESIDENT_TRANSPORT ?? 'in_process').toLowerCase() === 'http' ? 'http' : 'in_process';
  const ownerInstanceId = process.env.ANIMA_SUPERVISOR_INSTANCE_ID ?? 'supervisor-v0';

  const backoff: BackoffPolicy = {
    ...DEFAULT_BACKOFF,
    idleMs: positiveInt(process.env.ANIMA_RESIDENT_IDLE_MS, DEFAULT_BACKOFF.idleMs),
    resourceMs: positiveInt(process.env.ANIMA_RESIDENT_RESOURCE_MS, DEFAULT_BACKOFF.resourceMs),
  };

  // Teto opcional de voltas do laço — para provas vivas BOUNDED que se encerram sozinhas
  // (sem depender da entrega de sinal). Ausente ⇒ roda até o cancelamento (produção).
  const maxIterationsEnv = Number(process.env.ANIMA_RESIDENT_MAX_ITERATIONS);
  const maxIterations = Number.isInteger(maxIterationsEnv) && maxIterationsEnv > 0 ? maxIterationsEnv : undefined;

  if (!process.env.ANIMA_RESIDENT_EMAIL || !process.env.ANIMA_RESIDENT_PASSWORD) {
    log('warn', { message: 'ANIMA_RESIDENT_EMAIL/PASSWORD ausentes — identidade fail-closed; o runner ficará em waiting_human_or_recovery.' });
  }

  log('starting', {
    transport,
    ...(transport === 'http' ? { baseUrl } : {}),
    maxTurnsPerCycle, maxCycles, idleMs: backoff.idleMs,
    killSwitch: killFile ? { source: 'file', filePath: killFile } : { source: 'env', var: 'ANIMA_AUTONOMY_ENABLED' },
    wake: 'event-driven (Realtime work_events) + poll fallback + stdin "wake"',
    durableLog: LOG_FILE ?? 'stdout-only (set ANIMA_RESIDENT_LOG_FILE to persist)',
    note: 'pare com Ctrl+C (SIGINT).',
  });

  const acquireIdentity = createGoTrueIdentityProvider({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    email: process.env.ANIMA_RESIDENT_EMAIL,
    password: process.env.ANIMA_RESIDENT_PASSWORD,
  });
  const checkAutonomyEnabled = createKillSwitch({ filePath: killFile, envValue: process.env.ANIMA_AUTONOMY_ENABLED });

  // Porto do host-turn conforme o transporte. IN-PROCESS compõe a aplicação diretamente
  // (sem Next server), via import dinâmico — o grafo @anima é resolvido pelo loader
  // `--import ./scripts/ts-resolve.mjs` + `--experimental-transform-types`. HTTP mantém a
  // rota provada. Ambos user-scoped por Bearer; NUNCA service_role.
  let runHostTurn: (identity: ResidentIdentity, signal: AbortSignal) => Promise<HostTurnOutcome>;
  if (transport === 'in_process') {
    const { createInProcessHostTurnPort } = await import('../lib/resident-host/in-process-host-turn.ts');
    runHostTurn = createInProcessHostTurnPort({ ownerInstanceId, maxTurnsPerCycle, maxCycles });
  } else {
    runHostTurn = createHttpHostTurnPort({ baseUrl, maxTurnsPerCycle, maxCycles });
  }

  // Reconciliação: a recuperação SUP-04/SUP-05 acontece dentro da primeira volta do
  // Supervisor do host-turn. O porto existe como seam (a engine o chama no arranque e
  // após cada wake); uma chamada de recuperação dedicada é recorte futuro.
  const reconcile = async (identity: ResidentIdentity): Promise<void> => {
    log('reconcile', { note: 'recuperação SUP-04/SUP-05 ocorre dentro da volta do host-turn' });
    // Reconciliação de LEASES PAGAS órfãs (recurso pago pode ter sobrevivido a um crash). Roda
    // ANTES da volta, sob a identidade do usuário (Bearer/RLS, sem service_role). Best-effort:
    // falha aqui não derruba o runner (backoff cobre). Sem cloud/gasto quando não há órfão.
    try {
      const { createBearerClient } = await import('../lib/supabase/bearer.ts');
      const { reconcilePaidComputeLeasesFor } = await import('../lib/work-orchestration/paid-compute-lease-reconciler-deps.ts');
      const report = await reconcilePaidComputeLeasesFor(createBearerClient(identity.accessToken));
      if (report.results.length > 0) {
        log('paid-lease-reconcile', { tornDown: report.tornDown, retriable: report.retriable, leftAwaiting: report.leftAwaiting });
      }
    } catch (error) {
      log('paid-lease-reconcile-error', { message: error instanceof Error ? error.message : 'reconcile_failed' });
    }
  };

  // OPCIONAL: quando a fila operacional esvazia, materializar UM candidato do backlog
  // CANÔNICO em `proposed` e, causalmente, avaliar/persistir a autorização autônoma estreita.
  // A execução continua exclusivamente no próximo host-turn/Supervisor existente. Gated por
  // `ANIMA_RESIDENT_MATERIALIZE_DOCUMENT` (docs/….md sob a raiz). Composição in-process
  // (loader ativo); sob a identidade do usuário (Bearer/RLS), sem service_role.
  const materializeDocument = process.env.ANIMA_RESIDENT_MATERIALIZE_DOCUMENT ?? null;
  let materializeWhenIdle: ((identity: ResidentIdentity, signal: AbortSignal) => Promise<MaterializationAttempt>) | undefined;
  if (materializeDocument && /^docs\/[A-Za-z0-9_./-]+\.md$/.test(materializeDocument) && !materializeDocument.includes('..')) {
    const { readFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    const { parseCanonicalBacklog } = await import('@anima/core');
    const { projectRoot } = await import('../lib/work-orchestration/executor-selection.ts');
    const { createBearerClient } = await import('../lib/supabase/bearer.ts');
    const { buildCanonicalMaterializerDeps } = await import('../lib/work-orchestration/canonical-materializer-deps.ts');
    const { materializeNextCanonicalCandidate } = await import('../lib/work-orchestration/canonical-materializer.ts');
    const { autoApproveAutonomousWork } = await import('../lib/work-orchestration/auto-approval.ts');
    const { readResourceAdmission } = await import('../lib/work-orchestration/resource-governor.ts');
    log('materialize-source', { document: materializeDocument });
    materializeWhenIdle = async (identity) => {
      try {
        const markdown = await readFile(resolve(projectRoot(), materializeDocument), 'utf8');
        const allCandidates = parseCanonicalBacklog({ document: materializeDocument, markdown });
        const client = createBearerClient(identity.accessToken);
        const deps = buildCanonicalMaterializerDeps(client, identity.userId);
        const r = await materializeNextCanonicalCandidate({ allCandidates }, deps);
        if (!r.ok) return { materialized: false, detail: r.reason };
        const authorization = await autoApproveAutonomousWork({
          client,
          workItemId: r.workItemId,
          readGovernorVerdict: () => readResourceAdmission().verdict,
        });
        return {
          materialized: true,
          detail: r.sourceId,
          workItemId: r.workItemId,
          authorization: authorization.action,
          authorizationDetail: authorization.action === 'human_required'
            ? authorization.reason
            : authorization.action === 'already_approved' ? 'no_op' : String(authorization.eventSeq),
        };
      } catch (error) {
        return { materialized: false, detail: error instanceof Error ? error.message : 'materialize_failed' };
      }
    };
  }

  // Pré-gate do Governor no transporte HTTP: `permit` (autoridade real por-ciclo na rota).
  const admitNewWork = (): AdmissionVerdict => 'permit';

  // Wake EVENT-DRIVEN (primário): assina o Realtime de `work_events` com uma identidade
  // inicial. Fonte do wake ≠ decisão — só sinaliza "acorde"; a engine reconcilia e a
  // política decide. Best-effort: se identidade/assinatura falhar, o fallback de poll do
  // coordenador cobre (safety net). Usa o token do usuário (RLS por assinante), sem service_role.
  let realtimeWakeDispose: (() => void) | null = null;
  try {
    const initialIdentity = await acquireIdentity();
    if (initialIdentity) {
      const { createBearerClient } = await import('../lib/supabase/bearer.ts');
      const { subscribeWorkEventsWake } = await import('../lib/resident-host/realtime-wake.ts');
      const realtimeClient = createBearerClient(initialIdentity.accessToken);
      const handle = subscribeWorkEventsWake({
        client: realtimeClient,
        accessToken: initialIdentity.accessToken,
        onWake: () => wake.signal('event'),
        onStatus: (status) => log('realtime', { status }),
      });
      realtimeWakeDispose = handle.dispose;
      log('wake-source', { mode: 'event_driven_realtime', table: 'work_events', fallback: 'poll' });
    } else {
      log('wake-source', { mode: 'poll_fallback_only', reason: 'identity_unavailable_at_startup' });
    }
  } catch (error) {
    log('wake-source', { mode: 'poll_fallback_only', reason: error instanceof Error ? error.message : 'realtime_setup_failed' });
  }

  const summary = await runResidentHost({
    reconcile,
    checkAutonomyEnabled,
    acquireIdentity,
    admitNewWork,
    runHostTurn,
    waitForWake,
    ...(materializeWhenIdle ? { materializeWhenIdle } : {}),
    onState: (state, detail) => log('state', {
      state,
      reason: detail?.reason,
      outcome: detail?.outcome,
      backoffMs: detail?.backoffMs,
      // "qual work item?" no topo do log durável (além de dentro de `outcome`).
      workItems: detail?.outcome && detail.outcome.ok ? detail.outcome.workItemIds : undefined,
      materialization: detail?.materialization,
    }),
    backoff,
    signal: controller.signal,
    maxIterations,
  });

  // Shutdown determinístico das fontes de wake (assinatura Realtime + coordenador).
  realtimeWakeDispose?.();
  wake.dispose();

  log('summary', {
    hostTurns: summary.hostTurns,
    finalState: summary.finalState,
    stopReason: summary.stopReason,
    states: summary.states,
  });
  process.exit(0);
}

main().catch((error: unknown) => {
  log('fatal', { message: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
