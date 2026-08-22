import { classifyTurnForDriver, type BacklogCycleResult, type BacklogCycleStopReason } from './autonomous-backlog-driver';
import type { SupervisorTurnOutcome } from './supervisor';

// ============================================================
// Host-turn do backlog autônomo — a CONTINUAÇÃO entre ciclos (V1).
//
// A continuidade DENTRO de uma volta bounded já existe: `runAutonomousBacklogCycle`
// re-planeja entre voltas até `maxTurns`. O que faltava era a continuação ENTRE
// ciclos: ao fim de um ciclo bounded, decidir de forma TIPADA se há mais trabalho
// elegível e, quando houver e for permitido, rodar o próximo ciclo — sozinho, sem
// scheduler humano, mas com um SEGUNDO limite estrutural (`maxCycles`) e uma parada
// tipada. Não é daemon, não é always-on: é UMA invocação de host que roda até N
// ciclos e explica por que parou.
//
// Dois níveis de bound (defesa em profundidade contra bug de política):
//   1. `maxTurns` por ciclo (dentro de `runAutonomousBacklogCycle`);
//   2. `maxCycles` por host-turn (aqui).
// Mesmo que a política insista em continuar, o produto `maxTurns × maxCycles` é o
// teto de execuções desta invocação — nunca loop infinito.
//
// `requiresAnotherTurn` do Supervisor é o análogo POR-VOLTA (era o sinal da era do
// turno único: "chame o supervisor de novo"); o driver o superou classificando por
// `outcome`. Este módulo PROMOVE o conceito ao nível do CICLO: um veredito de
// continuação sobre o backlog inteiro, que é o que um futuro runner/always-on
// consumirá. A SELEÇÃO/EXCLUSÃO continuam server-side; o desfecho máximo é `review`.
// ============================================================

export type BacklogContinuation =
  // O ciclo atingiu seu bound estrutural e AINDA há trabalho elegível → um host pode
  // (e, dentro de `maxCycles`, deve) rodar o próximo ciclo. Fora dos bounds, sinaliza
  // ao chamador que vale reinvocar em seguida.
  | 'continue'
  // Sem trabalho executável AGORA, mas há pendência transitória/recuperável
  // (alvo ocupado, execução em andamento, fronteira humana, pressão de recurso,
  // janela de orçamento, tentativa aberta) → voltar DEPOIS, não agora.
  | 'wait'
  // Nada mais a fazer por conta própria: fila drenada, cabeça quebrada, pausa
  // explícita do usuário, ou cancelado. Não reinvocar automaticamente.
  | 'stop';

export type BacklogHostStopReason = BacklogCycleStopReason | 'max_cycles_reached';

/**
 * Classifica a razão de parada de UM ciclo bounded em veredito de continuação — puro.
 *
 * Só `max_turns_reached` (o ciclo bateu no próprio bound) autoriza continuar: pode
 * haver mais trabalho. Razões definitivas param; razões transitórias/recuperáveis
 * pedem para voltar depois.
 */
export function classifyCycleContinuation(stopReason: BacklogCycleStopReason): BacklogContinuation {
  switch (stopReason) {
    case 'max_turns_reached':
      return 'continue';
    // Definitivas: reinvocar automaticamente não ajudaria (drenado, quebrado, pausado, cancelado).
    case 'no_eligible_work':
    case 'turn_not_executable':
    case 'control_applied':
    case 'cancelled':
      return 'stop';
    // Transitórias/recuperáveis: nada executável agora, mas o estado muda com o tempo.
    case 'awaiting_target':
    case 'work_in_progress':
    case 'awaiting_human_or_recovery':
    case 'resource_pressure':
    case 'budget_exhausted':
    case 'turn_incomplete':
      return 'wait';
  }
}

export interface BacklogHostTurnResult {
  /** Ciclos bounded realmente executados. */
  readonly cyclesExecuted: number;
  /** Soma de voltas do Supervisor em todos os ciclos. */
  readonly turnsExecuted: number;
  /** Itens distintos tocados em todos os ciclos. */
  readonly itemsTouched: number;
  readonly stopReason: BacklogHostStopReason;
  /** Veredito TIPADO de continuação: continue (há mais e permitido) | wait | stop. */
  readonly continuation: BacklogContinuation;
  /** Há trabalho elegível deixado por fazer por causa do bound de host (`maxCycles`). */
  readonly moreWorkAvailable: boolean;
  readonly lastOutcome: SupervisorTurnOutcome | null;
  /** Log por ciclo, para observabilidade/UI. */
  readonly cycles: readonly BacklogCycleResult[];
}

export interface BacklogHostTurnDependencies {
  /** Roda UM ciclo bounded (`runAutonomousBacklogCycle` com `maxTurns=maxTurnsPerCycle`). */
  readonly runCycle: (signal: AbortSignal) => Promise<BacklogCycleResult>;
  /**
   * Leitura READ-ONLY: há um `execute_next` AGORA (backlog elegível + host permite)?
   * Usada só no bound de `maxCycles`, para dizer se sobrou trabalho por fazer.
   */
  readonly peekMoreWork: () => Promise<boolean>;
  /** Segundo limite estrutural: ciclos por host-turn (anti-spin de host). NÃO é quota. */
  readonly maxCycles: number;
  /** Cancelamento cooperativo: atravessa host → ciclo → supervisor → executor. */
  readonly signal: AbortSignal;
}

/**
 * Roda um host-turn do backlog: até `maxCycles` ciclos bounded, continuando sozinho
 * enquanto um ciclo terminar em `max_turns_reached` (bound atingido, pode haver mais)
 * e parando com veredito tipado quando um ciclo termina definitivo/à-espera, quando o
 * cancelamento chega, ou quando o bound de host é atingido. Sem daemon, sem always-on.
 */
export async function runAutonomousBacklogHostTurn(deps: BacklogHostTurnDependencies): Promise<BacklogHostTurnResult> {
  const maxCycles = Number.isInteger(deps.maxCycles) && deps.maxCycles > 0 ? deps.maxCycles : 0;
  const cycles: BacklogCycleResult[] = [];
  const touched = new Set<string>();
  let lastOutcome: SupervisorTurnOutcome | null = null;

  const finish = (
    stopReason: BacklogHostStopReason,
    continuation: BacklogContinuation,
    moreWorkAvailable: boolean,
  ): BacklogHostTurnResult => ({
    cyclesExecuted: cycles.length,
    turnsExecuted: cycles.reduce((sum, cycle) => sum + cycle.turnsExecuted, 0),
    itemsTouched: touched.size,
    stopReason,
    continuation,
    moreWorkAvailable,
    lastOutcome,
    cycles,
  });

  for (;;) {
    // Cancelamento tem precedência sobre iniciar o próximo ciclo.
    if (deps.signal.aborted) return finish('cancelled', 'stop', false);

    // Bound de host atingido: peek read-only diz se sobrou trabalho elegível por fazer.
    if (cycles.length >= maxCycles) {
      const more = cycles.length > 0 ? await deps.peekMoreWork() : false;
      return finish('max_cycles_reached', more ? 'continue' : 'stop', more);
    }

    const result = await deps.runCycle(deps.signal);
    cycles.push(result);
    if (result.lastOutcome !== null) lastOutcome = result.lastOutcome;
    for (const turn of result.turns) {
      if (turn.workItemId && classifyTurnForDriver(turn.outcome).touched) touched.add(turn.workItemId);
    }

    const continuation = classifyCycleContinuation(result.stopReason);
    if (continuation !== 'continue') {
      // O ciclo parou por razão definitiva (`stop`) ou de espera (`wait`): o host para
      // com a MESMA razão do ciclo — nenhum trabalho executável agora deixado por fazer.
      return finish(result.stopReason, continuation, false);
    }
    // `continue`: o ciclo bateu no próprio bound; pode haver mais → próximo ciclo.
  }
}
