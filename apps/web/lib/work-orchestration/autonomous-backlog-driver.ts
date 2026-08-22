import {
  planAutonomousBacklogTurn,
  type AutonomousQueueCandidate,
  type BacklogPending,
} from '@anima/core';
import type { SupervisorTurnOutcome, SupervisorTurnResult } from './supervisor';

// ============================================================
// Driver do laço de backlog autônomo (V1) — a ITERAÇÃO com efeito.
//
// A POLÍTICA de "o que fazer a seguir sobre o backlog" é pura e vive no core
// (`planAutonomousBacklogTurn`): dado o estado do backlog + um sinal de saúde do
// host, ela diz se há um próximo item a executar AGORA e, quando não há, POR QUÊ.
// Este DRIVER é o chamador que ela sempre previu: consome a decisão, executa
// EXATAMENTE UMA volta do Supervisor por iteração, observa o desfecho, decide se
// pode continuar e reavalia — dentro de um limite estrutural, cancelável e sem
// spin. Não é daemon, não é scheduler, não é "sempre ligado": é uma invocação
// explícita que processa vários turns elegíveis em sequência e devolve um
// resultado tipado explicando onde parou.
//
// Invariantes preservados:
// - A autonomia da SELEÇÃO e da EXCLUSÃO MÚTUA continua no banco. O driver pode
//   escolher tentar uma volta e PERDER a corrida do claim antes do início — isso
//   permanece seguro porque `runSupervisorTurn` seleciona e reivindica
//   server-side; o driver nunca duplica execução nem inventa lock caseiro.
// - Um item bloqueado/aguardando humano NUNCA congela o backlog (invariante da
//   política pura): se há um pronto e livre, ele roda; senão, o driver PARA com a
//   razão certa e cede a fronteira ao humano/recuperação.
// - O desfecho máximo de qualquer volta continua sendo um item em `review`. O
//   driver não aceita, autoriza, integra nem aplica resultado algum.
// ============================================================

export type BacklogCycleStopReason =
  // — Espelham a política pura (por que não há trabalho INICIÁVEL agora):
  | 'resource_pressure'
  | 'awaiting_target'
  | 'work_in_progress'
  | 'awaiting_human_or_recovery'
  | 'no_eligible_work'
  // — Estruturais/segurança do próprio driver (limite da iteração):
  | 'max_turns_reached'
  | 'cancelled'
  // — Desfechos de uma volta que encerram o ciclo SEM spin:
  //   a cabeça FIFO não virou entrada de executor; re-selecioná-la giraria em
  //   falso sobre o mesmo item quebrado — então paramos.
  | 'turn_not_executable'
  //   tentativa aberta sem terminal confiável (SUP-04): exige NOVA invocação
  //   (a reconciliação age por limite persistido), nunca um loop apertado.
  | 'turn_incomplete'
  //   orçamento aplicável atingido (INTEL-04). Para LOCAL não ocorre (budget V2
  //   admite); permanece para EXTERNO/pago.
  | 'budget_exhausted'
  //   pausa/cancelamento EXPLÍCITO do usuário aplicado num checkpoint (UX-01).
  | 'control_applied';

export interface BacklogCycleTurn {
  /** Item que a volta selecionou server-side, quando houve seleção. */
  readonly workItemId: string | null;
  readonly outcome: SupervisorTurnOutcome;
}

export interface BacklogCycleResult {
  /** Voltas do Supervisor realmente executadas nesta invocação. */
  readonly turnsExecuted: number;
  /** Itens distintos que uma tentativa/decisão de fato tocou. */
  readonly itemsTouched: number;
  readonly stopReason: BacklogCycleStopReason;
  /** Contagem por categoria do último planejamento (para explicar a parada). */
  readonly pending: BacklogPending;
  readonly lastOutcome: SupervisorTurnOutcome | null;
  /** Log por volta, para telemetria/auditoria do ciclo. */
  readonly turns: readonly BacklogCycleTurn[];
}

export interface BacklogCycleDependencies {
  /**
   * Fotografa o backlog do usuário como candidatos da fila (mesmo contrato de
   * `projectAutonomousQueue`). Chamado FRESCO a cada iteração, para que a
   * política reflita o estado pós-volta (o item que acabou de ir para `review`,
   * ficar `blocked` etc.). A projeção é read-only e NÃO é autoridade de exclusão.
   */
  readonly readBacklog: () => Promise<readonly AutonomousQueueCandidate[]>;
  /**
   * Sinal de saúde/segurança do host (Resource Governor / anti-concorrência):
   * `false` ⇒ não iniciar trabalho autônomo agora. É a camada existente que
   * decide — o driver apenas a RESPEITA, sem reimplementar governor.
   */
  readonly hostPermitsAutonomousWork: () => boolean | Promise<boolean>;
  /** Executa EXATAMENTE uma volta do Supervisor. Em produção envolve `runSupervisorTurn`. */
  readonly runTurn: (signal: AbortSignal) => Promise<SupervisorTurnResult>;
  /** Limite estrutural por invocação (anti-spin). NÃO é quota diária. */
  readonly maxTurns: number;
  /** Cancelamento cooperativo: checado no topo do laço e imediatamente antes de cada efeito. */
  readonly signal: AbortSignal;
  readonly now?: () => Date;
}

const EMPTY_PENDING: BacklogPending = { readyOccupied: 0, running: 0, awaitingHuman: 0, blocked: 0 };

export interface DriverVerdict {
  /** A volta tocou o item selecionado (uma tentativa começou ou um terminal/decisão foi registrado). */
  readonly touched: boolean;
  /** `null` ⇒ o driver pode continuar (reavaliar); caso contrário, encerra com esta razão. */
  readonly stop: BacklogCycleStopReason | null;
}

/**
 * Classifica o desfecho de UMA volta do Supervisor em veredito de iteração —
 * puro e determinístico, isolado para ser provado sozinho.
 *
 * O princípio anti-spin: só continua quem produziu PROGRESSO (o item saiu da
 * fila para uma fronteira/terminal) ou perdeu uma corrida cujo estado a próxima
 * leitura já reflete. Desfechos que re-selecionariam a mesma cabeça quebrada, ou
 * que deixam incerteza real, PARAM — nunca giram em falso.
 */
export function classifyTurnForDriver(outcome: SupervisorTurnOutcome): DriverVerdict {
  switch (outcome) {
    // Progresso: o item alcançou uma fronteira/terminal e deixou a fila autônoma.
    // Reavaliar pode revelar o próximo pronto; um item parado nunca congela a fila.
    case 'execution_completed': // chegou a `review` — a fronteira humana do item
    case 'execution_failed':
    case 'execution_cancelled':
    case 'decision_required':
    case 'resumption_requires_human':
      return { touched: true, stop: null };

    // Corrida perdida: outro dono assumiu o item/alvo. Reavaliar é seguro e
    // AUTO-LIMITADO — na próxima leitura o item aparece ocupado e a política para
    // por `awaiting_target`/`work_in_progress`. Nunca duplica execução.
    case 'claim_refused':
      return { touched: false, stop: null };
    case 'attempt_start_refused':
      return { touched: true, stop: null };

    // Fim de ciclo por fronteira/limite explícito — parar sem spin.
    case 'budget_interrupted':
      return { touched: true, stop: 'budget_exhausted' };
    case 'control_applied':
      return { touched: true, stop: 'control_applied' };

    // Incerteza real: tentativa aberta sem terminal confiável. Exige NOVA
    // invocação (reconciliação do SUP-04 por limite persistido), não um loop.
    case 'execution_interrupted':
    case 'terminal_refused':
      return { touched: true, stop: 'turn_incomplete' };

    // Cabeça FIFO inelegível/roteamento indisponível: a próxima seleção server-side
    // devolveria a MESMA cabeça → parar evita spin determinístico sobre item quebrado.
    case 'selection_not_executable':
    case 'routing_unavailable':
    case 'routing_refused':
      return { touched: false, stop: 'turn_not_executable' };

    // O servidor não achou trabalho elegível (fila vazia ou divergência com a
    // política). Nunca girar contra uma política que insiste em `execute_next`.
    case 'no_eligible_work':
      return { touched: false, stop: 'no_eligible_work' };
  }
}

/**
 * Roda o laço de backlog autônomo até uma parada tipada — a ITERAÇÃO com efeito
 * construída sobre a política pura.
 *
 * A cada iteração: (1) refotografa o backlog e consulta `planAutonomousBacklogTurn`;
 * se ela manda parar, para com a razão dela; (2) senão, executa UMA volta do
 * Supervisor; (3) classifica o desfecho e decide continuar ou parar. Limitado por
 * `maxTurns`, cancelável por `signal`, e sem spin por construção.
 */
export async function runAutonomousBacklogCycle(deps: BacklogCycleDependencies): Promise<BacklogCycleResult> {
  const clock = deps.now ?? (() => new Date());
  const maxTurns = Number.isInteger(deps.maxTurns) && deps.maxTurns > 0 ? deps.maxTurns : 0;
  const touched = new Set<string>();
  const turns: BacklogCycleTurn[] = [];
  let lastOutcome: SupervisorTurnOutcome | null = null;
  let lastPending: BacklogPending = EMPTY_PENDING;

  const stop = (reason: BacklogCycleStopReason): BacklogCycleResult => ({
    turnsExecuted: turns.length,
    itemsTouched: touched.size,
    stopReason: reason,
    pending: lastPending,
    lastOutcome,
    turns,
  });

  for (;;) {
    // Cancelamento e limite estrutural têm precedência sobre qualquer novo efeito.
    if (deps.signal.aborted) return stop('cancelled');
    if (turns.length >= maxTurns) return stop('max_turns_reached');

    const candidates = await deps.readBacklog();
    const hostPermits = await deps.hostPermitsAutonomousWork();
    const decision = planAutonomousBacklogTurn({
      candidates,
      now: clock(),
      hostPermitsAutonomousWork: hostPermits,
    });
    lastPending = decision.pending;
    if (decision.action === 'stop') return stop(decision.reason);

    // A política liberou uma volta. Re-checa o cancelamento imediatamente antes
    // do efeito, para nunca iniciar execução após um pedido de parada.
    if (deps.signal.aborted) return stop('cancelled');

    const result = await deps.runTurn(deps.signal);
    lastOutcome = result.outcome;
    turns.push({ workItemId: result.selection?.workItemId ?? null, outcome: result.outcome });

    const verdict = classifyTurnForDriver(result.outcome);
    if (verdict.touched && result.selection) touched.add(result.selection.workItemId);
    if (verdict.stop !== null) return stop(verdict.stop);
    // continue: reavalia o backlog na próxima iteração.
  }
}
