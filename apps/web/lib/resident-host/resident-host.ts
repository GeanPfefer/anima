import type {
  BacklogContinuation,
  BacklogHostStopReason,
} from '../work-orchestration/autonomous-backlog-host-turn';

// ============================================================
// Resident Local Host — engine V0 (ADR-003).
//
// O laço residente que elimina a última dependência humana do modo autônomo: o
// DISPARO. O host-turn bounded (`runAutonomousBacklogHostTurn`) já roda vários
// ciclos sozinho e para com veredito tipado; o gate real do Resource Governor já
// admite/adia por ciclo. Falta um PROCESSO que reconcilie, consulte o kill-switch,
// adquira identidade user-scoped, respeite o Governor, invoque o host-turn, classifique
// o desfecho, entre em quiescência e acorde quando houver trabalho — sem cron, sem
// recursão pós-terminal, sem service_role, sem daemon gigante.
//
// Esta engine é AGNÓSTICA DE TRANSPORTE: recebe todas as capacidades como PORTOS
// injetados (kill-switch, identidade, admissão do Governor, invocação do host-turn,
// wake, reconciliação). Assim ela é provável por doubles (as 15 regressões exigidas)
// sem rede nem banco, e o transporte real (HTTP à rota provada, no V0; in-process no
// futuro) troca sem tocar o laço. Nenhum estado efêmero novo é persistido: o DB/event
// log continua a autoridade do estado de trabalho; estes estados são só telemetria.
//
// Invariantes herdados (não afrouxados): desfecho máximo `review`; SELEÇÃO/EXCLUSÃO
// server-side (o host pode perder a corrida do claim sem duplicar); fail-closed em
// identidade ausente, kill-switch desligado, Governor não-`permit`; bounds estruturais
// dentro do host-turn; cancelamento atravessa runner → host-turn → ciclo → executor.
// ============================================================

/** Estados observáveis do lifecycle do resident host (ADR-003 §4). Só telemetria. */
export type ResidentHostState =
  | 'starting'
  | 'idle'
  | 'running'
  | 'waiting_resource'
  | 'waiting_human_or_recovery'
  | 'backoff'
  | 'disabled'
  | 'stopping'
  | 'stopped';

/** Veredito de admissão do Resource Governor (espelha `ResourceAdmissionDecision.verdict`
 * do core). Só `permit` inicia trabalho novo; `defer`/`fail_closed` adiam. */
export type AdmissionVerdict = 'permit' | 'defer' | 'fail_closed';

/** Por que o `waitForWake` resolveu. `poll` = intervalo lento (nudge de reavaliação);
 * `explicit` = sinal manual; `recovery` = condição de recuperação; `cancelled` = shutdown. */
export type WakeReason = 'poll' | 'explicit' | 'recovery' | 'cancelled';

/**
 * Identidade user-scoped adquirida pelo provider (ADR-003 §11). O `accessToken` é
 * OPACO para a engine — ela nunca o inspeciona nem o loga; só o repassa ao `runHostTurn`,
 * que autoriza a chamada como o usuário (Bearer → `auth.uid()` → RLS). NUNCA service_role.
 */
export interface ResidentIdentity {
  readonly userId: string;
  readonly accessToken: string;
}

/** Desfecho tipado de uma invocação do host-turn, decoplado do transporte. */
export type HostTurnOutcome =
  | {
      readonly ok: true;
      readonly continuation: BacklogContinuation;
      readonly stopReason: BacklogHostStopReason;
      readonly moreWorkAvailable: boolean;
      readonly cyclesExecuted: number;
    }
  | { readonly ok: false; readonly error: string };

type SuccessfulHostTurn = Extract<HostTurnOutcome, { ok: true }>;

/** Ação de continuação do resident host, derivada do desfecho de um host-turn — pura. */
export type ResidentAction = 'run_again' | 'idle' | 'wait_resource' | 'wait_human';

/**
 * Classifica o desfecho de UM host-turn na próxima ação do resident host — pura e
 * determinística, isolada para ser provada sozinha.
 *
 * - `run_again`: o host bateu no bound de ciclos e AINDA há trabalho elegível
 *   (`continue` + `moreWorkAvailable`) → reavaliar IMEDIATAMENTE (o topo do laço
 *   re-checa kill-switch e Governor). É o único caminho sem espera.
 * - `wait_resource`: o host parou por pressão de recurso → esperar e reamostrar o Governor.
 * - `wait_human`: `wait` de fronteira transitória/humana (alvo ocupado, execução em
 *   andamento, fronteira humana, janela de orçamento, tentativa aberta) → quiescer SEM SPIN.
 * - `idle`: `stop` definitivo (fila drenada, cabeça quebrada, pausa, cancelado) → quiescer.
 */
export function classifyResidentNext(outcome: SuccessfulHostTurn): ResidentAction {
  if (outcome.continuation === 'continue' && outcome.moreWorkAvailable) return 'run_again';
  if (outcome.stopReason === 'resource_pressure') return 'wait_resource';
  if (outcome.continuation === 'wait') return 'wait_human';
  return 'idle';
}

/** Política de backoff (ADR-003 §8). Base exponencial capada — determinística e pura;
 * o jitter, se houver, é responsabilidade do `waitForWake` (impuro, fora do núcleo). */
export interface BackoffPolicy {
  /** Intervalo de quiescência/poll quando não há erro (idle, espera humana). */
  readonly idleMs: number;
  /** Base do backoff de erro (dobra por erro consecutivo, até `maxMs`). */
  readonly errorBaseMs: number;
  /** Espera após adiamento do Governor (pressão de recurso). */
  readonly resourceMs: number;
  /** Teto absoluto de qualquer espera. */
  readonly maxMs: number;
}

export const DEFAULT_BACKOFF: BackoffPolicy = {
  idleMs: 15_000,
  errorBaseMs: 2_000,
  resourceMs: 30_000,
  maxMs: 300_000,
};

/** Backoff de erro: exponencial no número de erros CONSECUTIVOS, capado. Puro. */
export function errorBackoffMs(consecutiveErrors: number, policy: BackoffPolicy): number {
  const n = Math.max(1, Math.floor(consecutiveErrors));
  const raw = policy.errorBaseMs * 2 ** (n - 1);
  return Math.min(raw, policy.maxMs);
}

export interface ResidentStateDetail {
  readonly reason?: string;
  readonly outcome?: HostTurnOutcome;
  readonly backoffMs?: number;
  readonly wake?: WakeReason;
}

export interface ResidentHostDependencies {
  /**
   * Reconciliação de arranque/pós-wake (ADR-003 §10): resolve tentativas abertas/claims
   * expirados pelos contratos de recuperação EXISTENTES (SUP-04/SUP-05). O DB é a
   * autoridade — a engine nunca usa memória do processo como fonte da verdade. Recebe a
   * identidade porque é uma operação autenticada como o usuário.
   */
  readonly reconcile: (identity: ResidentIdentity, signal: AbortSignal) => Promise<void>;
  /** Kill-switch (ADR-003 §9): consultado antes de cada trabalho novo, fail-closed. */
  readonly checkAutonomyEnabled: () => boolean | Promise<boolean>;
  /** Provider de identidade user-scoped (ADR-003 §11). `null` ⇒ fail-closed (não age). */
  readonly acquireIdentity: () => Promise<ResidentIdentity | null>;
  /** Pré-gate do Resource Governor (ADR-003 §13): mesma política pura do por-ciclo. */
  readonly admitNewWork: () => AdmissionVerdict | Promise<AdmissionVerdict>;
  /** Invoca UM host-turn bounded como o usuário. Nunca lança: erros viram `{ok:false}`. */
  readonly runHostTurn: (identity: ResidentIdentity, signal: AbortSignal) => Promise<HostTurnOutcome>;
  /**
   * Espera até o PRIMEIRO de: wake explícito, intervalo de poll (`backoffMs`),
   * condição de recuperação, ou cancelamento. Devolve por que acordou. A elegibilidade
   * vem do domínio na próxima volta — o poll é só o nudge de "reavaliar".
   */
  readonly waitForWake: (input: { readonly backoffMs: number; readonly signal: AbortSignal }) => Promise<WakeReason>;
  /** Telemetria: chamado a cada transição de estado (ADR-003 §14). Sem UI no V0. */
  readonly onState?: (state: ResidentHostState, detail?: ResidentStateDetail) => void;
  readonly backoff?: BackoffPolicy;
  /** Cancelamento cooperativo: shutdown determinístico (ADR-003 §4). */
  readonly signal: AbortSignal;
  /** Teto estrutural de voltas do laço (defesa em profundidade / limite de teste).
   * Ausente ⇒ roda até o cancelamento (produção). Cada volta = uma passada do laço. */
  readonly maxIterations?: number;
}

export interface ResidentHostSummary {
  /** Host-turns realmente invocados. */
  readonly hostTurns: number;
  /** Sequência de estados entrados, para observabilidade/auditoria e prova. */
  readonly states: readonly ResidentHostState[];
  readonly finalState: ResidentHostState;
  readonly stopReason: 'cancelled' | 'max_iterations';
}

/**
 * Roda o resident host: um laço governado que, enquanto vivo, reconcilia, consulta o
 * kill-switch, adquire identidade, respeita o Governor, invoca o host-turn bounded,
 * classifica o desfecho e quiesce/backoff/acorda — determinístico ao cancelamento.
 * Não é `while(true)` ingovernável: cada não-`run_again` cede o controle ao `waitForWake`,
 * o cancelamento tem precedência, e `maxIterations` é o teto estrutural.
 */
export async function runResidentHost(deps: ResidentHostDependencies): Promise<ResidentHostSummary> {
  const policy = deps.backoff ?? DEFAULT_BACKOFF;
  const maxIterations = Number.isInteger(deps.maxIterations) ? deps.maxIterations! : Number.POSITIVE_INFINITY;
  const states: ResidentHostState[] = [];
  let hostTurns = 0;
  let consecutiveErrors = 0;
  // Reconciliar no arranque e após cada wake (ADR-003 §10, cenários 11 e 13); NÃO entre
  // voltas `run_again` imediatas (a reconciliação é recuperação de wake, não por-ciclo).
  let reconcileNeeded = true;

  const enter = (state: ResidentHostState, detail?: ResidentStateDetail): void => {
    states.push(state);
    deps.onState?.(state, detail);
  };

  const finish = (stopReason: ResidentHostSummary['stopReason']): ResidentHostSummary => {
    enter('stopping');
    enter('stopped');
    return { hostTurns, states, finalState: 'stopped', stopReason };
  };

  enter('starting');

  // Uma espera que cede o controle e propaga cancelamento como parada determinística.
  const waitAndContinue = async (backoffMs: number, detail?: ResidentStateDetail): Promise<'cancelled' | 'awoke'> => {
    const wake = await deps.waitForWake({ backoffMs, signal: deps.signal });
    reconcileNeeded = true;
    if (wake === 'cancelled' || deps.signal.aborted) return 'cancelled';
    return 'awoke';
  };

  for (let iteration = 0; ; iteration++) {
    if (deps.signal.aborted) return finish('cancelled');
    if (iteration >= maxIterations) return finish('max_iterations');

    // 1. Kill-switch FIRST — desligado congela trabalho novo (não mata o já iniciado).
    const enabled = await deps.checkAutonomyEnabled();
    if (!enabled) {
      enter('disabled', { reason: 'autonomy_disabled' });
      if ((await waitAndContinue(policy.idleMs)) === 'cancelled') return finish('cancelled');
      continue;
    }

    // 2. Identidade user-scoped — fail-closed sem identidade (NUNCA service_role fallback).
    const identity = await deps.acquireIdentity();
    if (identity === null) {
      enter('waiting_human_or_recovery', { reason: 'identity_unavailable' });
      // Backoff leve para não martelar o provider de auth; é condição de recuperação.
      if ((await waitAndContinue(errorBackoffMs(1, policy))) === 'cancelled') return finish('cancelled');
      continue;
    }

    // 3. Reconciliação de recuperação (arranque/pós-wake), como o usuário. Antes de trabalho novo.
    if (reconcileNeeded) {
      await deps.reconcile(identity, deps.signal);
      reconcileNeeded = false;
      if (deps.signal.aborted) return finish('cancelled');
    }

    // 4. Pré-gate do Resource Governor — mesma política pura do por-ciclo (defesa em profundidade).
    const verdict = await deps.admitNewWork();
    if (verdict !== 'permit') {
      enter('waiting_resource', { reason: `admission_${verdict}` });
      if ((await waitAndContinue(policy.resourceMs)) === 'cancelled') return finish('cancelled');
      continue;
    }

    // 5. Invocar UM host-turn bounded como o usuário.
    enter('running');
    const outcome = await deps.runHostTurn(identity, deps.signal);
    hostTurns++;

    if (!outcome.ok) {
      consecutiveErrors++;
      const backoffMs = errorBackoffMs(consecutiveErrors, policy);
      enter('backoff', { reason: 'host_turn_error', outcome, backoffMs });
      // Backoff crescente, NUNCA tight retry.
      if ((await waitAndContinue(backoffMs)) === 'cancelled') return finish('cancelled');
      continue;
    }
    consecutiveErrors = 0;

    const action = classifyResidentNext(outcome);
    if (action === 'run_again') {
      // Único caminho sem espera: há mais trabalho e o bound de host foi atingido.
      // reconcileNeeded permanece false — reconciliação é de wake, não por-ciclo.
      continue;
    }
    if (action === 'wait_resource') {
      enter('waiting_resource', { reason: 'host_turn_resource_pressure', outcome });
      if ((await waitAndContinue(policy.resourceMs)) === 'cancelled') return finish('cancelled');
      continue;
    }
    if (action === 'wait_human') {
      // Só fronteira transitória/humana — quiescer SEM SPIN até um wake.
      enter('waiting_human_or_recovery', { reason: 'host_turn_wait', outcome });
      if ((await waitAndContinue(policy.idleMs)) === 'cancelled') return finish('cancelled');
      continue;
    }
    // action === 'idle': fila drenada / parada definitiva — quiescer.
    enter('idle', { reason: 'host_turn_idle', outcome });
    if ((await waitAndContinue(policy.idleMs)) === 'cancelled') return finish('cancelled');
  }
}
