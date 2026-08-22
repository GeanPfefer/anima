import { projectAutonomousQueue, type AutonomousQueueCandidate, type AutonomousQueueEntry } from './autonomous-queue';

// Backlog autônomo — a DECISÃO de "o que fazer a seguir" sobre o backlog inteiro.
//
// O backlog NÃO é uma tabela nova: é a mesma fonte de verdade dos `work_items`
// (proposto = aguardando aprovação humana; approved+elegível = pronto para o
// executor; blocked/in_progress/review = fronteira humana ou em andamento). A
// seleção do próximo item elegível já existe em `projectAutonomousQueue` (espelho
// de `autonomous_work_queue`). O que faltava era a POLÍTICA de laço: dado o estado
// do backlog + um sinal de saúde/segurança do host, decidir se há um próximo item
// para executar AGORA e, quando não há, POR QUÊ — para que um DRIVER (o chamador,
// nunca um daemon aqui) saiba continuar, esperar ou parar, sem ficar preso.
//
// É PURA e read-only: não executa nada, não adquire posse, não inventa estado.
// Invariante central (ratificado): um item bloqueado NUNCA congela o backlog — se
// existe um item pronto e livre, ele é escolhido, independentemente dos bloqueados.
// A autonomia da execução em si continua com o Supervisor/Executor; parar em
// `review`/proposta/decisão continua sendo a fronteira humana.

export type BacklogStopReason =
  // O host não permite iniciar trabalho autônomo agora (Resource Governor /
  // anti-concorrência / saúde da máquina). Injetado; não é decisão daqui.
  | 'resource_pressure'
  // Há item elegível, mas o alvo está ocupado agora (transitório: reavaliar depois).
  | 'awaiting_target'
  // Uma tentativa já corre; nada novo a iniciar sem duplicar execução.
  | 'work_in_progress'
  // Há trabalho, mas na fronteira humana (proposta/revisão/decisão) ou aguardando
  // recuperação (bloqueio temporal por orçamento) — não é iniciável autonomamente.
  | 'awaiting_human_or_recovery'
  // Não há nenhum trabalho autônomo a considerar (backlog autônomo vazio).
  | 'no_eligible_work';

export interface BacklogPending {
  /** Elegíveis, porém com o alvo ocupado agora. */
  readonly readyOccupied: number;
  /** Em execução (in_progress). */
  readonly running: number;
  /** Aguardando o humano: proposed | review | changes_requested. */
  readonly awaitingHuman: number;
  /** Bloqueados (decisão humana OU recuperável por orçamento/reserva). */
  readonly blocked: number;
}

export type BacklogTurnDecision =
  | { readonly action: 'execute_next'; readonly entry: AutonomousQueueEntry; readonly pending: BacklogPending }
  | { readonly action: 'stop'; readonly reason: BacklogStopReason; readonly pending: BacklogPending };

export interface BacklogTurnInput {
  /** TODOS os itens não encerrados do usuário (mesmo contrato de `projectAutonomousQueue`). */
  readonly candidates: readonly AutonomousQueueCandidate[];
  readonly now: Date;
  /** Sinal de saúde/segurança do host, injetado (Resource Governor/anti-concorrência):
   * false ⇒ não iniciar trabalho autônomo agora. Ausente ⇒ true (permite). */
  readonly hostPermitsAutonomousWork?: boolean;
}

const HUMAN_FRONTIER_STATES: ReadonlySet<string> = new Set(['proposed', 'review', 'changes_requested']);

/**
 * Decide o próximo passo do laço de backlog autônomo — puro e sem efeito.
 *
 * `execute_next` devolve o item PRONTO e livre de maior prioridade (FIFO pela
 * aprovação, via `projectAutonomousQueue`); um item bloqueado/aguardando humano
 * jamais impede isso. `stop` explica por que não há ação autônoma agora, com a
 * contagem por categoria, para o driver decidir reavaliar (target/execução),
 * aguardar (humano/recuperação) ou encerrar (vazio) — sem daemon aqui.
 */
export function planAutonomousBacklogTurn(input: BacklogTurnInput): BacklogTurnDecision {
  const { candidates, now } = input;
  const hostPermits = input.hostPermitsAutonomousWork ?? true;
  const queue = projectAutonomousQueue(candidates, now);

  const pending: BacklogPending = {
    readyOccupied: queue.filter(entry => entry.targetOccupied).length,
    running: candidates.filter(candidate => candidate.item.state === 'in_progress').length,
    awaitingHuman: candidates.filter(candidate => HUMAN_FRONTIER_STATES.has(candidate.item.state)).length,
    blocked: candidates.filter(candidate => candidate.item.state === 'blocked').length,
  };

  // Saúde/segurança do host tem precedência: não iniciar trabalho sob pressão.
  if (!hostPermits) return { action: 'stop', reason: 'resource_pressure', pending };

  // Um item PRONTO e livre sempre vence — bloqueados nunca congelam o backlog.
  const readyFree = queue.find(entry => !entry.targetOccupied);
  if (readyFree) return { action: 'execute_next', entry: readyFree, pending };

  if (pending.readyOccupied > 0) return { action: 'stop', reason: 'awaiting_target', pending };
  if (pending.running > 0) return { action: 'stop', reason: 'work_in_progress', pending };
  if (pending.awaitingHuman > 0 || pending.blocked > 0) return { action: 'stop', reason: 'awaiting_human_or_recovery', pending };
  return { action: 'stop', reason: 'no_eligible_work', pending };
}
