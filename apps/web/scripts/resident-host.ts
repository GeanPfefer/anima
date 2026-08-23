import {
  runResidentHost,
  DEFAULT_BACKOFF,
  type AdmissionVerdict,
  type BackoffPolicy,
  type HostTurnOutcome,
  type ResidentIdentity,
  type WakeReason,
} from '../lib/resident-host/resident-host.ts';
import {
  createGoTrueIdentityProvider,
  createHttpHostTurnPort,
  createKillSwitch,
} from '../lib/resident-host/ports.ts';

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

const log = (event: string, data: Record<string, unknown> = {}): void => {
  // Log estruturado (ADR-003 §14). NUNCA inclui o accessToken.
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), event, ...data })}\n`);
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

// --- Wake: intervalo de poll (nudge) OU wake explícito (linha "wake" no stdin) OU
//     cancelamento. A elegibilidade vem do domínio na próxima volta, não do relógio.
//     O wake por stdin é OPCIONAL: se o stdin não for legível (redirecionado/ausente),
//     poll + sinais continuam funcionando. ---
const wakeBus = new EventTarget();
try {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    if (chunk.toLowerCase().includes('wake')) wakeBus.dispatchEvent(new Event('wake'));
  });
  if (typeof process.stdin.unref === 'function') process.stdin.unref(); // não segura o processo no encerramento.
} catch {
  // stdin indisponível: wake explícito por stdin fica desabilitado; poll/sinais bastam.
}

const waitForWake = ({ backoffMs, signal }: { backoffMs: number; signal: AbortSignal }): Promise<WakeReason> =>
  new Promise<WakeReason>((resolve) => {
    if (signal.aborted) return resolve('cancelled');
    let settled = false;
    const settle = (reason: WakeReason): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      wakeBus.removeEventListener('wake', onWake);
      resolve(reason);
    };
    const timer = setTimeout(() => settle('poll'), backoffMs);
    const onAbort = (): void => settle('cancelled');
    const onWake = (): void => settle('explicit');
    signal.addEventListener('abort', onAbort, { once: true });
    wakeBus.addEventListener('wake', onWake, { once: true });
  });

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
    note: 'wake: envie a linha "wake" no stdin; pare com Ctrl+C (SIGINT).',
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
  const reconcile = async (_identity: ResidentIdentity): Promise<void> => {
    log('reconcile', { note: 'recuperação SUP-04/SUP-05 ocorre dentro da volta do host-turn' });
  };

  // Pré-gate do Governor no transporte HTTP: `permit` (autoridade real por-ciclo na rota).
  const admitNewWork = (): AdmissionVerdict => 'permit';

  const summary = await runResidentHost({
    reconcile,
    checkAutonomyEnabled,
    acquireIdentity,
    admitNewWork,
    runHostTurn,
    waitForWake,
    onState: (state, detail) => log('state', {
      state,
      reason: detail?.reason,
      outcome: detail?.outcome,
      backoffMs: detail?.backoffMs,
    }),
    backoff,
    signal: controller.signal,
    maxIterations,
  });

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
