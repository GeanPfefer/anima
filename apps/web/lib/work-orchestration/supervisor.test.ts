import type { WorkCheckpointV1, WorkContextSnapshot, WorkExecutorAdapter, WorkExecutorRequest, WorkExecutorSignal, WorkItem, WorkRoutingAdjustmentContextV1 } from '@anima/core';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runSupervisorTurn, type SupervisorReader } from './supervisor';

// ============================================================
// Modelo fiel das fronteiras ratificadas.
//
// O fake reproduz as invariantes que o banco garante — posse única por item,
// alvo ocupado por claim ativo ou item `in_progress` (SUP-03/SUP-05), replay
// idempotente do terminal e liberação idempotente por razão. Sem esse modelo,
// um teste de laço provaria apenas que a aplicação chama funções na ordem certa,
// e não que ela respeita as recusas de quem manda.
// ============================================================

type Rpc = { data: unknown; error: { code: string; message: string } | null };
const ok = (data: unknown): Rpc => ({ data, error: null });
const fail = (code: string, message: string): Rpc => ({ data: null, error: { code, message } });

type FakeClassification = 'missing' | 'incomplete' | 'complete';
interface FakeItem {
  readonly id: string;
  version: number;
  state: string;
  readonly target: string;
  readonly approvalSeq: number;
  /** Ausência do campo modela banco/fake sem suporte e falha fechado. */
  readonly classification?: FakeClassification;
}
interface FakeClaim { readonly id: string; readonly itemId: string; readonly target: string; attemptId: string | null; released: boolean; reason: string | null; }

interface FakeOptions {
  readonly items: readonly FakeItem[];
  readonly reconciliation?: readonly Record<string, unknown>[];
  /** Modela a leitura não bloqueante do SUP-02: a seleção ignora posse já adquirida. */
  readonly staleSelection?: boolean;
  readonly failReconcile?: boolean;
  readonly failReadmit?: boolean;
  /** Corrida de alvo perdida entre a aquisição da posse e o início da tentativa. */
  readonly startRefusal?: { readonly code: string; readonly message: string };
  /** Simula falha de persistência de um checkpoint na sequência indicada. */
  readonly failCheckpointAtSequence?: number;
  /** Faz todo record_work_checkpoint devolver `replayed` (idempotente, sem novo evento). */
  readonly replayCheckpoints?: boolean;
  readonly resumptionSource?: Record<string, unknown>;
  readonly decisionResumptionSource?: Record<string, unknown>;
  readonly routingAdjustmentContext?: WorkRoutingAdjustmentContextV1;
  readonly budgetReason?: string;
  /** Ids de itens `blocked` por orçamento cuja janela recuperou: a re-admissão os devolve a `approved`. */
  readonly readmitBudgetBlocked?: readonly string[];
  /** Ids de interrupções de orçamento EM tentativa cuja janela recuperou. */
  readonly readmitBudgetInterrupted?: readonly string[];
  /** Fonte de retomada por interrupção de orçamento devolvida ao Supervisor. */
  readonly budgetInterruptionSource?: Record<string, unknown>;
  readonly interruptBudgetAfterCheckpoint?: string;
  /** UX-01: modela um pedido de pausa/cancelamento pendente aplicável no checkpoint. */
  readonly controlAfterCheckpoint?: 'pause' | 'cancel';
}

class FakeDatabase {
  readonly calls: string[] = [];
  readonly events: { itemId: string; type: string; attemptId: string | null; reason?: string }[] = [];
  readonly claims = new Map<string, FakeClaim>();
  readonly items = new Map<string, FakeItem>();
  private readonly terminals = new Map<string, string>();
  private readonly routing = new Map<string, { executorId: string; serialized: string }>();
  private readonly routingAdjustments = new Map<string, string>();
  // Maior sequência de checkpoint e sinal bruto por tentativa (para replay/conflito).
  private readonly checkpointSeq = new Map<string, number>();
  private readonly checkpointSignals = new Map<string, string>();

  constructor(private readonly options: FakeOptions) {
    for (const item of options.items) this.items.set(item.id, { ...item });
  }

  private activeClaimOfItem(itemId: string): FakeClaim | undefined {
    return [...this.claims.values()].find(claim => claim.itemId === itemId && !claim.released);
  }
  private activeClaimOfTarget(target: string, exceptItem: string): FakeClaim | undefined {
    return [...this.claims.values()].find(claim => claim.target === target && !claim.released && claim.itemId !== exceptItem);
  }
  private runningOnTarget(target: string, exceptItem: string): FakeItem | undefined {
    return [...this.items.values()].find(item => item.target === target && item.id !== exceptItem && item.state === 'in_progress');
  }

  readonly client = {
    rpc: (name: string, args?: Record<string, unknown>): Promise<Rpc> => {
      this.calls.push(name);
      return Promise.resolve(this.dispatch(name, args ?? {}));
    },
  };

  private dispatch(name: string, args: Record<string, unknown>): Rpc {
    switch (name) {
      case 'reconcile_supervised_work':
        return this.options.failReconcile ? fail('55000', 'reconciliação indisponível') : ok(this.options.reconciliation ?? []);

      case 'next_autonomous_work': {
        // `staleSelection` modela a leitura não bloqueante do SUP-02: a fila
        // devolve a mesma cabeça que outro supervisor já está disputando,
        // porque selecionar não trava nada.
        const visible = this.options.staleSelection
          ? [...this.items.values()].filter(item => item.classification === 'complete')
          : [...this.items.values()]
              .filter(item => item.state === 'approved')
              .filter(item => item.classification === 'complete')
              .filter(item => !this.activeClaimOfItem(item.id) && !this.activeClaimOfTarget(item.target, item.id))
              .filter(item => !this.runningOnTarget(item.target, item.id));
        const queue = visible.sort((left, right) => left.approvalSeq - right.approvalSeq);
        const head = queue[0];
        if (!head) return ok([]);
        return ok([{
          work_item_id: head.id, approved_proposal_version: head.version, approval_seq: head.approvalSeq,
          approved_at: new Date().toISOString(), capability: 'programming', target_reference: head.target,
          selection_policy: 'oldest_approval_first', queue_size: queue.length,
          runner_up_approval_seq: queue[1]?.approvalSeq ?? null, skipped_occupied_targets: 0,
        }]);
      }

      case 'select_autonomous_work': {
        const requested = this.items.get(args['p_work_item_id'] as string);
        const eligible = requested?.state === 'approved'
          && requested.classification === 'complete'
          && requested.version === args['p_expected_proposal_version']
          && !this.activeClaimOfItem(requested.id)
          && !this.activeClaimOfTarget(requested.target, requested.id)
          && !this.runningOnTarget(requested.target, requested.id);
        if (!requested || !eligible) return ok([]);
        return ok([{
          work_item_id: requested.id, approved_proposal_version: requested.version,
          approval_seq: requested.approvalSeq, approved_at: new Date().toISOString(),
          capability: 'programming', target_reference: requested.target,
          selection_policy: 'explicit_card_selection', queue_size: 1,
          runner_up_approval_seq: null, skipped_occupied_targets: 0,
        }]);
      }

      case 'autonomous_work_budget_status':
        return ok({
          schemaVersion: 1,
          policyVersion: 'autonomous-work-budget-v1',
          admitted: this.options.budgetReason === undefined,
          reason: this.options.budgetReason ?? null,
        });

      case 'block_work_on_budget': {
        const item = this.items.get(args['p_work_item_id'] as string)!;
        item.state = 'blocked';
        this.events.push({
          itemId: item.id,
          type: 'work_blocked',
          attemptId: null,
          reason: this.options.budgetReason,
        });
        return ok({ blocked: true, reason: this.options.budgetReason });
      }

      case 'readmit_budget_blocked_work': {
        if (this.options.failReadmit) return fail('55000', 're-admissão de orçamento indisponível');
        // Reconciliação de orçamento: itens cuja janela móvel liberou voltam de
        // `blocked` para `approved`, sem inventar entrada humana.
        const readmitted: { work_item_id: string; budget_reason: string }[] = [];
        for (const id of this.options.readmitBudgetBlocked ?? []) {
          const item = this.items.get(id);
          if (item && item.state === 'blocked') {
            item.state = 'approved';
            this.events.push({ itemId: id, type: 'work_approved', attemptId: null, reason: 'budget_window_recovered' });
            readmitted.push({ work_item_id: id, budget_reason: 'user_attempt_budget_exhausted' });
          }
        }
        return ok(readmitted);
      }

      case 'readmit_budget_interrupted_work': {
        // Interrupção de orçamento EM tentativa cuja janela liberou volta a
        // `approved`; a retomada do checkpoint é resolvida pela fonte abaixo.
        const readmitted: { work_item_id: string; budget_reason: string }[] = [];
        for (const id of this.options.readmitBudgetInterrupted ?? []) {
          const item = this.items.get(id);
          if (item && item.state === 'blocked') {
            item.state = 'approved';
            this.events.push({ itemId: id, type: 'work_approved', attemptId: null, reason: 'budget_window_recovered' });
            readmitted.push({ work_item_id: id, budget_reason: 'user_runtime_budget_exhausted' });
          }
        }
        return ok(readmitted);
      }
      case 'budget_interruption_resumption_source':
        return ok(this.options.budgetInterruptionSource ?? null);
      case 'begin_budget_interruption_resumed_attempt': {
        const item = this.items.get(args['work_item_id'] as string)!;
        const claim: FakeClaim = {
          id: args['claim_id'] as string, itemId: item.id, target: item.target,
          attemptId: args['attempt_id'] as string, released: false, reason: null,
        };
        this.claims.set(claim.id, claim);
        item.state = 'in_progress';
        this.events.push({ itemId: item.id, type: 'execution_started', attemptId: claim.attemptId, reason: 'budget_resumed' });
        return ok(item);
      }

      case 'abandoned_work_resumption_source':
        return ok(this.options.resumptionSource ?? { kind: 'new_execution' });
      case 'human_decision_resumption_source':
        return ok(this.options.decisionResumptionSource ?? null);

      case 'current_work_intelligence_classification': {
        const item = this.items.get(args['p_work_item_id'] as string);
        if (!item || item.classification !== 'complete') return ok(null);
        return ok({
          work_item_id: item.id,
          approved_proposal_version: item.version,
          classification_revision: 1,
          classification: {
            schemaVersion: 1,
            complexity: 'routine',
            risk: 'low',
            reversibility: 'reversible',
            planClarity: 'clear',
            urgency: 'normal',
            provenance: {
              kind: 'human_confirmed',
              classifiedAt: '2026-07-28T18:00:00-03:00',
              classifierId: 'user:test',
            },
          },
        });
      }

      case 'work_routing_adjustment_context':
        return ok(this.options.routingAdjustmentContext ?? {
          schemaVersion: 1, attempts: [], latestCheckpoint: null,
        });

      case 'record_work_routing_adjustment': {
        const attemptId = args['p_attempt_id'] as string;
        const serialized = JSON.stringify(args['p_adjustment']);
        const previous = this.routingAdjustments.get(attemptId);
        if (previous) return previous === serialized
          ? ok({ action: 'replayed', attempt_id: attemptId })
          : fail('55000', 'work routing adjustment conflict');
        this.routingAdjustments.set(attemptId, serialized);
        this.events.push({
          itemId: args['p_work_item_id'] as string,
          type: 'work_routing_adjusted', attemptId,
        });
        return ok({ action: 'recorded', attempt_id: attemptId });
      }

      case 'record_work_routing_decision': {
        const attemptId = args['p_attempt_id'] as string;
        const decision = args['p_decision'] as { selected: { executorId: string } };
        const serialized = JSON.stringify(decision);
        const previous = this.routing.get(attemptId);
        if (previous) return previous.serialized === serialized
          ? ok({ action: 'replayed', attempt_id: attemptId })
          : fail('55000', 'work routing decision conflict');
        this.routing.set(attemptId, { executorId: decision.selected.executorId, serialized });
        const itemId = args['p_work_item_id'] as string;
        this.events.push({ itemId, type: 'work_routing_decided', attemptId });
        return ok({ action: 'recorded', attempt_id: attemptId });
      }

      case 'begin_resumed_work_attempt': {
        const item = this.items.get(args['work_item_id'] as string)!;
        if (item.classification !== 'complete') {
          return fail('55000', item.classification === 'incomplete'
            ? 'work_intelligence_classification_incomplete'
            : 'work_intelligence_classification_missing');
        }
        const claim: FakeClaim = {
          id: args['claim_id'] as string, itemId: item.id, target: item.target,
          attemptId: args['attempt_id'] as string, released: false, reason: null,
        };
        const routing = this.routing.get(args['attempt_id'] as string);
        if (!this.routingAdjustments.has(args['attempt_id'] as string)) return fail('55000', 'work routing adjustment missing');
        if (!routing) return fail('55000', 'work routing decision missing');
        if (routing.executorId !== args['executor_id']) return fail('55000', 'work routing executor mismatch');
        this.claims.set(claim.id, claim);
        item.state = 'in_progress';
        this.events.push({ itemId: item.id, type: 'execution_started', attemptId: claim.attemptId, reason: 'resumed_execution' });
        return ok(item);
      }

      case 'acquire_work_claim': {
        const item = this.items.get(args['work_item_id'] as string)!;
        if (item.classification !== 'complete') {
          return fail('55000', item.classification === 'incomplete'
            ? 'work_intelligence_classification_incomplete'
            : 'work_intelligence_classification_missing');
        }
        if (item.state !== 'approved') return fail('55000', 'work item is not eligible for an autonomous claim');
        if (this.activeClaimOfItem(item.id)) return fail('55000', 'work item is held by an active claim');
        if (this.runningOnTarget(item.target, item.id)) return fail('55000', 'work target is busy with a running attempt');
        if (this.activeClaimOfTarget(item.target, item.id)) return fail('55000', 'work target is held by an active claim');
        const claim: FakeClaim = { id: args['claim_id'] as string, itemId: item.id, target: item.target, attemptId: null, released: false, reason: null };
        this.claims.set(claim.id, claim);
        this.events.push({ itemId: item.id, type: 'work_claimed', attemptId: null });
        return ok(claim);
      }

      case 'start_claimed_work_attempt': {
        if (this.options.startRefusal) return fail(this.options.startRefusal.code, this.options.startRefusal.message);
        const claim = this.claims.get(args['claim_id'] as string);
        if (!claim) return fail('P0002', 'claim not found');
        const item = this.items.get(claim.itemId)!;
        const routing = this.routing.get(args['attempt_id'] as string);
        if (!this.routingAdjustments.has(args['attempt_id'] as string)) return fail('55000', 'work routing adjustment missing');
        if (!routing) return fail('55000', 'work routing decision missing');
        if (routing.executorId !== args['executor_id']) return fail('55000', 'work routing executor mismatch');
        if (item.classification !== 'complete') {
          return fail('55000', item.classification === 'incomplete'
            ? 'work_intelligence_classification_incomplete'
            : 'work_intelligence_classification_missing');
        }
        // SUP-05: a exclusividade de alvo vive no início, não na aquisição.
        if (this.runningOnTarget(item.target, item.id)) return fail('55000', 'work target is busy with a running attempt');
        if (claim.attemptId && claim.attemptId !== args['attempt_id']) return fail('55000', 'claim already started another attempt');
        if (claim.attemptId === args['attempt_id']) return ok(item); // replay
        claim.attemptId = args['attempt_id'] as string;
        item.state = 'in_progress';
        this.events.push({ itemId: item.id, type: 'execution_started', attemptId: claim.attemptId });
        return ok(item);
      }

      case 'record_commanded_work_terminal': {
        const attemptId = args['attempt_id'] as string;
        const item = this.items.get(args['work_item_id'] as string)!;
        const signal = args['signal'] as { kind: string; sequence: number };
        const serialized = JSON.stringify(signal);
        const previous = this.terminals.get(attemptId);
        if (previous !== undefined) {
          if (previous === serialized) return ok(item); // replay idempotente
          return fail('55000', 'attempt already finished with different signal');
        }
        // Só result/error/cancelled são terminais persistíveis; decision_required é recusado.
        if (!['result', 'error', 'cancelled'].includes(signal.kind)) return fail('22023', 'terminal signal correlation mismatch');
        // Etapa 2B.1: o terminal vem depois do maior checkpoint persistido.
        const maxCp = this.checkpointSeq.get(attemptId);
        if (maxCp !== undefined && signal.sequence <= maxCp) return fail('55000', 'terminal sequence must follow the latest checkpoint');
        if (item.state !== 'in_progress') return fail('55000', 'work item state or proposal version changed');
        this.terminals.set(attemptId, serialized);
        item.state = signal.kind === 'result' ? 'review' : signal.kind === 'cancelled' ? 'cancelled' : 'failed';
        this.events.push({
          itemId: item.id, attemptId,
          type: signal.kind === 'result' ? 'result_submitted' : signal.kind === 'cancelled' ? 'work_cancelled' : 'execution_failed',
        });
        return ok(item);
      }
      case 'begin_human_decision_resumed_attempt': {
        const item = this.items.get(args['work_item_id'] as string)!;
        const claim:FakeClaim={id:args['claim_id'] as string,itemId:item.id,target:item.target,
          attemptId:args['attempt_id'] as string,released:false,reason:null};
        if(!this.routingAdjustments.has(claim.attemptId!))return fail('55000','work routing adjustment missing');
        if(!this.routing.has(claim.attemptId!))return fail('55000','work routing decision missing');
        this.claims.set(claim.id,claim);item.state='in_progress';
        this.events.push({itemId:item.id,type:'execution_started',attemptId:claim.attemptId,reason:'human_decision_resumed'});
        return ok(item);
      }
      case 'record_work_decision_required': {
        const attemptId = args['p_attempt_id'] as string;
        const item = this.items.get(args['p_work_item_id'] as string)!;
        const signal = args['p_signal'] as { kind: string; sequence: number };
        const maxCp = this.checkpointSeq.get(attemptId);
        if (signal.kind !== 'decision_required' || maxCp === undefined || signal.sequence <= maxCp) return fail('55000', 'decision must follow a persisted checkpoint');
        item.state = 'blocked';
        const claim = [...this.claims.values()].find(value => value.attemptId === attemptId);
        if (claim) claim.released = true;
        this.events.push({ itemId: item.id, attemptId, type: 'input_requested' }, { itemId: item.id, attemptId, type: 'work_blocked' });
        return ok({ requestEventId: 'decision-1', claimReleased: claim !== undefined });
      }

      case 'record_work_checkpoint': {
        const attemptId = args['attempt_id'] as string;
        const item = this.items.get(args['work_item_id'] as string)!;
        const signal = args['signal'] as { kind: string; sequence: number; workItemId: string; attemptId: string };
        if (this.options.failCheckpointAtSequence === signal.sequence) return fail('58000', 'persistência de checkpoint indisponível');
        if (signal.attemptId !== attemptId || signal.workItemId !== item.id) return fail('22023', 'checkpoint signal correlation mismatch');
        // Fato persistido: tentativa iniciada, sem terminal, item em execução.
        if (!this.events.some(event => event.type === 'execution_started' && event.attemptId === attemptId)) return fail('P0002', 'attempt not found');
        if (this.terminals.has(attemptId)) return fail('55000', 'attempt already finished');
        if (item.state !== 'in_progress') return fail('55000', 'work item state or proposal version changed');
        if (this.options.replayCheckpoints) return ok({ action: 'replayed', checkpoint_sequence: signal.sequence });
        const serialized = JSON.stringify(signal);
        const last = this.checkpointSeq.get(attemptId);
        const key = `${attemptId}:${signal.sequence}`;
        if (last !== undefined) {
          if (signal.sequence < last) return fail('55000', 'checkpoint sequence regressed');
          if (signal.sequence === last) {
            return this.checkpointSignals.get(key) === serialized
              ? ok({ action: 'replayed', checkpoint_sequence: signal.sequence })
              : fail('55000', 'checkpoint conflict at the same sequence');
          }
        }
        this.checkpointSeq.set(attemptId, signal.sequence);
        this.checkpointSignals.set(key, serialized);
        this.events.push({ itemId: item.id, type: 'checkpoint_recorded', attemptId });
        return ok({ action: 'recorded', checkpoint_sequence: signal.sequence });
      }

      case 'apply_work_control_at_checkpoint': {
        // Sem pedido pendente: no-op idempotente, o laço segue consumindo.
        if (!this.options.controlAfterCheckpoint) return ok({ applied: false });
        const attemptId = args['p_attempt_id'] as string;
        const item = this.items.get(args['p_work_item_id'] as string)!;
        // Fato exigido pela RPC real: um checkpoint da tentativa já persistido.
        if (!this.events.some(event => event.type === 'checkpoint_recorded' && event.attemptId === attemptId)) {
          return ok({ applied: false });
        }
        const action = this.options.controlAfterCheckpoint;
        const claim = this.activeClaimOfItem(item.id);
        item.state = action === 'pause' ? 'blocked' : 'cancelled';
        if (claim) {
          claim.released = true;
          claim.reason = 'attempt_finished';
          this.events.push({ itemId: item.id, type: 'work_claim_released', attemptId, reason: 'attempt_finished' });
        }
        this.events.push({
          itemId: item.id,
          type: action === 'pause' ? 'work_paused' : 'work_cancelled',
          attemptId,
          reason: action === 'pause' ? 'paused_by_user' : 'cancelled_by_user',
        });
        return ok({ applied: true, action, claimReleased: claim !== undefined });
      }

      case 'interrupt_work_on_budget': {
        if (!this.options.interruptBudgetAfterCheckpoint) {
          return ok({ interrupted: false });
        }
        const attemptId = args['p_attempt_id'] as string;
        const item = this.items.get(args['p_work_item_id'] as string)!;
        const claim = this.activeClaimOfItem(item.id);
        item.state = 'blocked';
        if (claim) {
          claim.released = true;
          claim.reason = 'attempt_finished';
          this.events.push({
            itemId: item.id,
            type: 'work_claim_released',
            attemptId,
            reason: 'attempt_finished',
          });
        }
        this.events.push({ itemId: item.id, type: 'work_blocked', attemptId, reason: this.options.interruptBudgetAfterCheckpoint });
        return ok({
          interrupted: true,
          reason: this.options.interruptBudgetAfterCheckpoint,
          claimReleased: claim !== undefined,
        });
      }

      case 'release_work_claim': {
        const claim = this.claims.get(args['claim_id'] as string);
        if (!claim) return fail('P0002', 'claim not found');
        const reason = args['reason'] as string;
        if (claim.released) {
          return claim.reason === reason ? ok(claim) : fail('55000', 'claim already released with a different reason');
        }
        if (reason === 'attempt_finished' && claim.attemptId === null) return fail('22023', 'no attempt was started under this claim');
        if (reason === 'released_without_attempt' && claim.attemptId !== null) return fail('22023', 'an attempt was started under this claim');
        claim.released = true; claim.reason = reason;
        this.events.push({ itemId: claim.itemId, type: 'work_claim_released', attemptId: claim.attemptId, reason });
        return ok(claim);
      }

      default:
        throw new Error(`RPC inesperada no laço do Supervisor: ${name}`);
    }
  }

  asClient(): SupabaseClient<Database> { return this.client as unknown as SupabaseClient<Database>; }
}

// ---------- fixtures ----------

const workItem = (id: string, overrides: Partial<{ target: string; limits: Record<string, number>; spec: unknown }> = {}): WorkItem => ({
  id, userId: 'user-1', sourceMessageId: 'msg-1', state: 'approved', impactLevel: 'low', capability: 'programming',
  originalRequest: 'Corrija a soma.', createdAt: new Date(), updatedAt: new Date(), proposalVersion: 1,
  intent: {
    execution_spec: overrides.spec !== undefined ? overrides.spec : {
      schema_version: 1,
      target: { kind: 'project', reference: overrides.target ?? `alvo-${id}` },
      permissions: ['workspace_read', 'workspace_write_isolated'],
      validation_criteria: [{ label: 'testes', command: 'python -m unittest' }],
      limits: overrides.limits ?? { max_attempts: 1, max_duration_minutes: 5 },
    },
  } as WorkItem['intent'],
  proposal: {
    schemaVersion: 1,
    data: {
      summary: 'Corrigir soma', objective: 'Corrigir a função de soma', includedScope: ['calculator.py'],
      excludedScope: ['deploy'], expectedEffects: ['soma correta'], risks: [],
    },
  },
});

const reader = (items: readonly WorkItem[], contexts: readonly WorkContextSnapshot[] = []): SupervisorReader => ({
  getItem: (id: string) => Promise.resolve(
    items.find(item => item.id === id)
      ? { ok: true as const, value: items.find(item => item.id === id)! }
      : { ok: false as const, error: { code: 'not_found' as const, message: 'Item inválido.' } },
  ),
  listContexts: () => Promise.resolve({ ok: true as const, value: contexts }),
}) as unknown as SupervisorReader;

const terminalSignal = (request: WorkExecutorRequest, kind: 'result' | 'error' | 'cancelled'): WorkExecutorSignal => ({
  attemptId: request.attemptId, workItemId: request.workItemId, approvedProposalVersion: request.approvedProposalVersion,
  origin: 'executor', sequence: 1,
  ...(kind === 'result'
    ? { kind, summary: 'Resultado produzido para revisão.', resultReferences: ['runner-bundle:r.zip'], validations: [{ label: 'testes', outcome: 'passed' }], limitations: [], handoffReference: 'local-runner:alvo:r.zip' }
    : kind === 'cancelled'
      ? { kind, acknowledged: true, handoffReference: 'checkpoint:cancelled' }
      : { kind, code: 'execution_failed', message: 'Runner terminou com código 6.', retryable: false, handoffReference: 'checkpoint:runner-failed' }),
} as WorkExecutorSignal);

const executor = (kind: 'result' | 'error' | 'cancelled' = 'result', hook?: () => Promise<void>) => {
  const calls: WorkExecutorRequest[] = [];
  const adapter: WorkExecutorAdapter = {
    id: 'local-runner-v1',
    async *execute(request: WorkExecutorRequest) {
      calls.push(request);
      if (hook) await hook();
      yield terminalSignal(request, kind);
    },
  };
  return { adapter, calls };
};

const throwingExecutor = (): WorkExecutorAdapter => ({
  id: 'local-runner-v1',
  // eslint-disable-next-line require-yield
  async *execute() { throw new Error('processo do runner morreu'); },
});

// ---------- executor roteirizado para a Etapa 2B.1 (progress/checkpoint/terminal) ----------

const sampleCheckpoint = (nextStep: string): WorkCheckpointV1 => ({
  schemaVersion: 1, handoffReference: 'runner-bundle:cp', completedSteps: ['feito'], remainingSteps: ['resta'],
  nextStep, decisions: [], risks: [], touchedResources: [], validations: [{ label: 'testes', outcome: 'passed' }],
  failures: [], evidenceReferences: [],
});

type SignalSpec = { readonly kind: 'progress' | 'checkpoint' | 'decision_required' | 'result' | 'error' | 'cancelled' };

const attachSpec = (request: WorkExecutorRequest, sequence: number, spec: SignalSpec): WorkExecutorSignal => {
  const base = { attemptId: request.attemptId, workItemId: request.workItemId, approvedProposalVersion: request.approvedProposalVersion, origin: 'executor' as const, sequence };
  switch (spec.kind) {
    case 'progress': return { ...base, kind: 'progress', message: `progresso ${sequence}` } as WorkExecutorSignal;
    case 'checkpoint': return { ...base, kind: 'checkpoint', checkpoint: sampleCheckpoint(`passo ${sequence}`) } as WorkExecutorSignal;
    case 'decision_required': return { ...base, kind: 'decision_required', reason: 'architectural_decision', explanation: 'Escolha a fronteira.', options: [{ id: 'seguir', label: 'Seguir', effect: 'resume' }, { id: 'parar', label: 'Parar', effect: 'cancel' }] } as WorkExecutorSignal;
    case 'result': return { ...base, kind: 'result', summary: 'ok', resultReferences: [], validations: [{ label: 'testes', outcome: 'passed' }], limitations: [], handoffReference: 'runner-bundle:r' } as WorkExecutorSignal;
    case 'cancelled': return { ...base, kind: 'cancelled', acknowledged: true, handoffReference: 'checkpoint:cancelled' } as WorkExecutorSignal;
    default: return { ...base, kind: 'error', code: 'execution_failed', message: 'falhou', retryable: false, handoffReference: 'checkpoint:err' } as WorkExecutorSignal;
  }
};

const scriptedExecutor = (specs: readonly SignalSpec[], opts: { readonly throwAtIndex?: number } = {}) => {
  const calls: WorkExecutorRequest[] = [];
  const adapter: WorkExecutorAdapter = {
    id: 'local-runner-v1',
    async *execute(request: WorkExecutorRequest) {
      calls.push(request);
      for (let index = 0; index < specs.length; index += 1) {
        if (opts.throwAtIndex === index) throw new Error('processo do runner morreu');
        yield attachSpec(request, index + 1, specs[index]!);
      }
    },
  };
  return { adapter, calls };
};

const ids = (values: readonly string[]) => { let index = 0; return () => values[index++]!; };

const turn = (database: FakeDatabase, adapter: WorkExecutorAdapter, items: readonly WorkItem[], identifiers: readonly string[], contexts?: readonly WorkContextSnapshot[], requestedWork?: { readonly workItemId: string; readonly expectedProposalVersion: number }) =>
  runSupervisorTurn({
    client: database.asClient(),
    routes: [{
      adapter,
      candidate: {
        schemaVersion: 1, routeId: 'test-route', executorId: adapter.id,
        providerRef: 'test-provider', modelRef: 'test-model', effort: 'standard',
        capabilities: ['programming'], availability: 'available', latency: 'normal', priority: 1,
      },
    }],
    ownerInstanceId: 'supervisor-test',
    newId: ids(identifiers), signal: new AbortController().signal, reader: reader(items, contexts),
    requestedWork,
  });

// ============================================================
// Testes
// ============================================================

test('fila vazia encerra a volta sem posse, tentativa ou executor', async () => {
  const database = new FakeDatabase({ items: [] });
  const { adapter, calls } = executor();
  const result = await turn(database, adapter, [], ['claim-1', 'attempt-1']);

  expect(result.outcome).toBe('no_eligible_work');
  expect(result.selection).toBeNull();
  expect(result.requiresAnotherTurn).toBe(false);
  expect(calls).toHaveLength(0);
  expect(database.claims.size).toBe(0);
  expect(database.events).toHaveLength(0);
});

test('seleção explícita nunca substitui o cartão solicitado pela cabeça da fila', async () => {
  const first = { id: 'item-1', version: 1, state: 'approved', target: 'alvo-1', approvalSeq: 10, classification: 'complete' as const };
  const requested = { id: 'item-2', version: 1, state: 'approved', target: 'alvo-2', approvalSeq: 20, classification: 'complete' as const };
  const database = new FakeDatabase({ items: [first, requested] });
  const runner = executor();
  const result = await turn(
    database, runner.adapter, [workItem('item-1'), workItem('item-2')],
    ['claim-2', 'attempt-2'], undefined,
    { workItemId: 'item-2', expectedProposalVersion: 1 },
  );

  expect(database.calls[3]).toBe('select_autonomous_work');
  expect(result.selection?.workItemId).toBe('item-2');
  expect(runner.calls[0]?.workItemId).toBe('item-2');
});

test('seleção explícita obsoleta falha fechada sem cair para outro trabalho', async () => {
  const database = new FakeDatabase({ items: [
    { id: 'item-1', version: 1, state: 'approved', target: 'alvo-1', approvalSeq: 10, classification: 'complete' },
    { id: 'item-2', version: 2, state: 'approved', target: 'alvo-2', approvalSeq: 20, classification: 'complete' },
  ] });
  const runner = executor();
  const result = await turn(
    database, runner.adapter, [workItem('item-1'), workItem('item-2')],
    ['claim-x', 'attempt-x'], undefined,
    { workItemId: 'item-2', expectedProposalVersion: 1 },
  );

  expect(result.outcome).toBe('no_eligible_work');
  expect(database.calls).toEqual(['reconcile_supervised_work', 'readmit_budget_blocked_work', 'readmit_budget_interrupted_work', 'select_autonomous_work']);
  expect(runner.calls).toHaveLength(0);
});

test.each<FakeClassification>(['missing', 'incomplete'])(
  'classificação %s impede seleção, claim, tentativa e executor',
  async (classification) => {
    const fakeItem: FakeItem = {
      id: 'item-1', version: 1, state: 'approved', target: 'alvo-1',
      approvalSeq: 10, classification,
    };
    const database = new FakeDatabase({ items: [fakeItem] });
    const runner = executor();
    const result = await turn(database, runner.adapter, [workItem('item-1')], ['claim-1', 'attempt-1']);

    expect(result.outcome).toBe('no_eligible_work');
    expect(runner.calls).toHaveLength(0);
    expect(database.claims.size).toBe(0);
    expect(database.events).toHaveLength(0);
    expect(database.calls).toEqual(['reconcile_supervised_work', 'readmit_budget_blocked_work', 'readmit_budget_interrupted_work', 'next_autonomous_work']);
  },
);

test('FakeDatabase sem suporte explícito à classificação falha fechado', async () => {
  const database = new FakeDatabase({
    items: [{ id: 'item-1', version: 1, state: 'approved', target: 'alvo-1', approvalSeq: 10 }],
  });
  const runner = executor();
  const result = await turn(database, runner.adapter, [workItem('item-1')], ['claim-1', 'attempt-1']);

  expect(result.outcome).toBe('no_eligible_work');
  expect(runner.calls).toHaveLength(0);
  expect(database.claims.size).toBe(0);
  expect(database.events).toHaveLength(0);
});

test('reconcilia antes de selecionar e relata o que a reconciliação produziu', async () => {
  const database = new FakeDatabase({
    items: [],
    reconciliation: [{ work_item_id: 'item-x', attempt_id: 'a-1', claim_id: null, finding: 'attempt_abandoned', action: 'attempt_abandoned', item_state: 'approved', detail: {} }],
  });
  const result = await turn(database, executor().adapter, [], ['claim-1', 'attempt-1']);

  expect(database.calls[0]).toBe('reconcile_supervised_work');
  expect(database.calls[1]).toBe('readmit_budget_blocked_work');
  expect(database.calls[2]).toBe('readmit_budget_interrupted_work');
  expect(database.calls[3]).toBe('next_autonomous_work');
  expect(result.reconciliation).toEqual([
    { workItemId: 'item-x', attemptId: 'a-1', claimId: null, finding: 'attempt_abandoned', action: 'attempt_abandoned', itemState: 'approved' },
  ]);
});

test('reconciliação recusada interrompe a volta antes de qualquer seleção', async () => {
  const database = new FakeDatabase({ items: [{ id: 'item-1', version: 1, state: 'approved', target: 'alvo-1', approvalSeq: 10, classification: 'complete' }], failReconcile: true });
  const { adapter, calls } = executor();
  const result = await turn(database, adapter, [workItem('item-1')], ['claim-1', 'attempt-1']);

  expect(result.outcome).toBe('selection_not_executable');
  expect(database.calls).toEqual(['reconcile_supervised_work']);
  expect(calls).toHaveLength(0);
});

test('executa a cabeça FIFO e percorre claim, início supervisionado, terminal e liberação', async () => {
  const database = new FakeDatabase({
    items: [
      { id: 'item-novo', version: 1, state: 'approved', target: 'alvo-b', approvalSeq: 90, classification: 'complete' },
      { id: 'item-antigo', version: 1, state: 'approved', target: 'alvo-a', approvalSeq: 10, classification: 'complete' },
    ],
  });
  const { adapter, calls } = executor('result');
  const result = await turn(database, adapter, [workItem('item-antigo', { target: 'alvo-a' }), workItem('item-novo', { target: 'alvo-b' })], ['claim-1', 'attempt-1']);

  // FIFO pela sequência da aprovação: o mais antigo primeiro.
  expect(result.selection?.workItemId).toBe('item-antigo');
  expect(result.outcome).toBe('execution_completed');
  expect(result.terminalKind).toBe('result');
  expect(result.claimReleased).toBe(true);
  expect(result.refusal).toBeNull();

  // Ordem canônica das fronteiras, e nunca o início comandado.
  expect(database.calls).toEqual([
    'reconcile_supervised_work', 'readmit_budget_blocked_work', 'readmit_budget_interrupted_work', 'next_autonomous_work', 'autonomous_work_budget_status', 'human_decision_resumption_source','budget_interruption_resumption_source','abandoned_work_resumption_source',
    'current_work_intelligence_classification', 'work_routing_adjustment_context',
    'record_work_routing_adjustment', 'record_work_routing_decision', 'acquire_work_claim',
    'start_claimed_work_attempt', 'record_commanded_work_terminal', 'release_work_claim',
  ]);
  expect(database.calls).not.toContain('start_commanded_work_attempt');

  // Executor acionado exatamente uma vez, com a entrada delimitada da proposta.
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ workItemId: 'item-antigo', attemptId: 'attempt-1', includedScope: ['calculator.py'], target: { reference: 'alvo-a' } });

  // Liberação depois do terminal, com a razão que o contrato exige.
  expect(database.events.map(event => event.type)).toEqual([
    'work_routing_adjusted', 'work_routing_decided', 'work_claimed',
    'execution_started', 'result_submitted', 'work_claim_released',
  ]);
  expect(database.events.at(-1)).toMatchObject({ reason: 'attempt_finished' });
  expect(database.items.get('item-antigo')!.state).toBe('review');
});

test('aplica escalonamento persistido ao esforço mínimo antes de tomar posse', async () => {
  const database = new FakeDatabase({
    items: [{ id: 'item-1', version: 1, state: 'approved', target: 'alvo-1', approvalSeq: 10, classification: 'complete' }],
    routingAdjustmentContext: {
      schemaVersion: 1,
      attempts: [
        { attemptId: 'old-1', outcome: 'attempt_abandoned', selectedEffort: 'light', adjustment: 'none' },
        { attemptId: 'old-2', outcome: 'execution_failed', selectedEffort: 'light', adjustment: 'none' },
      ],
      latestCheckpoint: null,
    },
  });
  const runner = executor('result');
  const result = await turn(database, runner.adapter, [workItem('item-1')], ['claim-3', 'attempt-3']);

  expect(result.outcome).toBe('execution_completed');
  expect(result.routingAdjustment).toMatchObject({
    kind: 'escalated', baselineEffort: 'light', effectiveEffort: 'standard',
    consecutiveFailures: 2,
  });
  expect(result.routingDecision).toMatchObject({
    requiredEffort: 'standard', selected: { effort: 'standard' },
  });
  expect(database.calls.indexOf('record_work_routing_adjustment'))
    .toBeLessThan(database.calls.indexOf('acquire_work_claim'));
});

test('segunda volta seleciona o item seguinte, sem sobrepor o primeiro', async () => {
  const database = new FakeDatabase({
    items: [
      { id: 'item-1', version: 1, state: 'approved', target: 'alvo-1', approvalSeq: 10, classification: 'complete' },
      { id: 'item-2', version: 1, state: 'approved', target: 'alvo-2', approvalSeq: 20, classification: 'complete' },
    ],
  });
  const items = [workItem('item-1', { target: 'alvo-1' }), workItem('item-2', { target: 'alvo-2' })];

  const first = await turn(database, executor().adapter, items, ['claim-1', 'attempt-1']);
  const second = await turn(database, executor().adapter, items, ['claim-2', 'attempt-2']);
  const third = await turn(database, executor().adapter, items, ['claim-3', 'attempt-3']);

  expect(first.selection?.workItemId).toBe('item-1');
  expect(second.selection?.workItemId).toBe('item-2');
  expect(third.outcome).toBe('no_eligible_work');
  expect([...database.claims.values()].every(claim => claim.released)).toBe(true);
});

test('falha do executor produz terminal de falha e libera a posse', async () => {
  const database = new FakeDatabase({ items: [{ id: 'item-1', version: 1, state: 'approved', target: 'alvo-1', approvalSeq: 10, classification: 'complete' }] });
  const result = await turn(database, executor('error').adapter, [workItem('item-1', { target: 'alvo-1' })], ['claim-1', 'attempt-1']);

  expect(result.outcome).toBe('execution_failed');
  expect(result.terminalKind).toBe('error');
  expect(result.claimReleased).toBe(true);
  expect(database.items.get('item-1')!.state).toBe('failed');
  expect(database.events.map(event => event.type)).toContain('execution_failed');
});

test('executor que lança deixa a órfã para a reconciliação, sem inventar terminal nem soltar posse', async () => {
  const database = new FakeDatabase({ items: [{ id: 'item-1', version: 1, state: 'approved', target: 'alvo-1', approvalSeq: 10, classification: 'complete' }] });
  const result = await turn(database, throwingExecutor(), [workItem('item-1', { target: 'alvo-1' })], ['claim-1', 'attempt-1']);

  expect(result.outcome).toBe('execution_interrupted');
  expect(result.requiresAnotherTurn).toBe(true);
  expect(result.claimReleased).toBe(false);
  expect(database.calls).not.toContain('record_commanded_work_terminal');
  expect(database.calls).not.toContain('release_work_claim');
  // O item permanece exatamente como a interrupção o deixou: é o caso do SUP-04.
  expect(database.items.get('item-1')!.state).toBe('in_progress');
  expect(database.claims.get('claim-1')!.released).toBe(false);
});

test('duas invocações concorrentes não executam o mesmo item duas vezes', async () => {
  const database = new FakeDatabase({ items: [{ id: 'item-1', version: 1, state: 'approved', target: 'alvo-1', approvalSeq: 10, classification: 'complete' }] });
  const items = [workItem('item-1', { target: 'alvo-1' })];
  let release = (): void => {};
  const gate = new Promise<void>(resolve => { release = resolve; });

  const slow = executor('result', () => gate);
  const other = executor('result');

  const first = turn(database, slow.adapter, items, ['claim-a', 'attempt-a']);
  // Deixa a primeira volta chegar ao executor e segurar a posse.
  for (let step = 0; step < 20; step += 1) await Promise.resolve();

  const second = await turn(database, other.adapter, items, ['claim-b', 'attempt-b']);
  release();
  const firstResult = await first;

  expect(firstResult.outcome).toBe('execution_completed');
  // A perdedora não executa nada e sai com desfecho tipado e seguro.
  expect(second.outcome).toBe('no_eligible_work');
  expect(other.calls).toHaveLength(0);
  expect(slow.calls).toHaveLength(1);
  expect([...database.claims.keys()]).toEqual(['claim-a']);
  expect(database.events.filter(event => event.type === 'execution_started')).toHaveLength(1);
});

test('seleção obsoleta sobre tentativa em curso perde a corrida com recusa tipada', async () => {
  // Cenário documentado no SUP-02: dois supervisores leem a mesma cabeça porque
  // a seleção não bloqueia. O perdedor chega depois do início da tentativa.
  const database = new FakeDatabase({ items: [{ id: 'item-1', version: 1, state: 'approved', target: 'alvo-1', approvalSeq: 10, classification: 'complete' }], staleSelection: true });
  const items = [workItem('item-1', { target: 'alvo-1' })];
  let release = (): void => {};
  const gate = new Promise<void>(resolve => { release = resolve; });

  const winner = executor('result', () => gate);
  const loser = executor('result');
  const first = turn(database, winner.adapter, items, ['claim-a', 'attempt-a']);
  for (let step = 0; step < 20; step += 1) await Promise.resolve();
  const second = await turn(database, loser.adapter, items, ['claim-b', 'attempt-b']);
  release();
  await first;

  expect(second.outcome).toBe('claim_refused');
  expect(second.refusal).toEqual({ code: '55000', message: 'work item is not eligible for an autonomous claim' });
  expect(loser.calls).toHaveLength(0);
  expect(database.events.filter(event => event.type === 'execution_started')).toHaveLength(1);
  expect([...database.claims.keys()]).toEqual(['claim-a']);
});

test('posse alheia ainda não iniciada recusa a segunda aquisição do mesmo item', async () => {
  // A janela mais estreita: outro supervisor já tem a posse mas ainda não
  // iniciou a tentativa, então o item continua `approved`.
  const database = new FakeDatabase({ items: [{ id: 'item-1', version: 1, state: 'approved', target: 'alvo-1', approvalSeq: 10, classification: 'complete' }], staleSelection: true });
  await database.client.rpc('acquire_work_claim', { work_item_id: 'item-1', expected_proposal_version: 1, claim_id: 'claim-alheio', owner_instance_id: 'outro', lease_seconds: 600 });

  const { adapter, calls } = executor();
  const result = await turn(database, adapter, [workItem('item-1', { target: 'alvo-1' })], ['claim-b', 'attempt-b']);

  expect(result.outcome).toBe('claim_refused');
  expect(result.refusal).toEqual({ code: '55000', message: 'work item is held by an active claim' });
  expect(calls).toHaveLength(0);
  // A posse alheia permanece intocada: o laço não rouba nem libera claim de terceiros.
  expect(database.claims.get('claim-alheio')).toMatchObject({ released: false, attemptId: null });
});

test('dois itens no mesmo alvo respeitam a exclusividade no início da tentativa', async () => {
  const database = new FakeDatabase({
    items: [
      { id: 'item-2', version: 1, state: 'approved', target: 'alvo-comum', approvalSeq: 20, classification: 'complete' },
      { id: 'item-1', version: 1, state: 'in_progress', target: 'alvo-comum', approvalSeq: 30, classification: 'complete' },
    ],
    staleSelection: true,
  });
  const { adapter, calls } = executor();
  const result = await turn(database, adapter, [workItem('item-2', { target: 'alvo-comum' })], ['claim-2', 'attempt-2']);

  expect(result.outcome).toBe('claim_refused');
  expect(result.refusal?.message).toBe('work target is busy with a running attempt');
  expect(calls).toHaveLength(0);
});

test('início recusado devolve a posse sem tentativa e não aciona o executor', async () => {
  // A posse é adquirida; a corrida do alvo é perdida entre a aquisição e o início.
  const database = new FakeDatabase({
    items: [{ id: 'item-1', version: 1, state: 'approved', target: 'alvo-1', approvalSeq: 10, classification: 'complete' }],
    startRefusal: { code: '55000', message: 'work target is held by an active claim' },
  });
  const { adapter, calls } = executor();
  const result = await turn(database, adapter, [workItem('item-1', { target: 'alvo-1' })], ['claim-1', 'attempt-1']);

  expect(result.outcome).toBe('attempt_start_refused');
  expect(result.claimReleased).toBe(true);
  expect(calls).toHaveLength(0);
  expect(database.claims.get('claim-1')).toMatchObject({ released: true, reason: 'released_without_attempt', attemptId: null });
});

test('item que a fila ofereceu mas o domínio recusa não chega ao executor nem toma posse', async () => {
  const database = new FakeDatabase({ items: [{ id: 'item-1', version: 1, state: 'approved', target: 'alvo-1', approvalSeq: 10, classification: 'complete' }] });
  const { adapter, calls } = executor();
  // Sem limites declarados: o predicado do AUTO-01 reprova.
  const invalid = workItem('item-1', { spec: { schema_version: 1, target: { kind: 'project', reference: 'alvo-1' }, permissions: [], validation_criteria: [{ label: 'testes' }], limits: {} } });
  const result = await turn(database, adapter, [invalid], ['claim-1', 'attempt-1']);

  expect(result.outcome).toBe('selection_not_executable');
  expect(result.refusal?.code).toBe('eligibility_divergence');
  expect(result.gaps.map(entry => entry.code)).toContain('limits_missing');
  expect(calls).toHaveLength(0);
  expect(database.claims.size).toBe(0);
  expect(database.calls).not.toContain('acquire_work_claim');
});

test('replay do mesmo terminal não duplica efeito persistido', async () => {
  const database = new FakeDatabase({ items: [{ id: 'item-1', version: 1, state: 'approved', target: 'alvo-1', approvalSeq: 10, classification: 'complete' }] });
  const items = [workItem('item-1', { target: 'alvo-1' })];
  await turn(database, executor().adapter, items, ['claim-1', 'attempt-1']);

  const terminals = database.events.filter(event => event.type === 'result_submitted');
  const released = database.events.filter(event => event.type === 'work_claim_released');
  expect(terminals).toHaveLength(1);
  expect(released).toHaveLength(1);

  // Reentrega idêntica pela mesma fronteira: idempotente, sem novo evento.
  const replay = await database.client.rpc('record_commanded_work_terminal', {
    work_item_id: 'item-1', expected_proposal_version: 1, attempt_id: 'attempt-1',
    signal: JSON.parse(JSON.stringify(terminalSignal({ attemptId: 'attempt-1', workItemId: 'item-1', approvedProposalVersion: 1 } as WorkExecutorRequest, 'result'))),
  });
  const rereleased = await database.client.rpc('release_work_claim', { claim_id: 'claim-1', reason: 'attempt_finished' });
  expect(replay.error).toBeNull();
  expect(rereleased.error).toBeNull();
  expect(database.events.filter(event => event.type === 'result_submitted')).toHaveLength(1);
  expect(database.events.filter(event => event.type === 'work_claim_released')).toHaveLength(1);
});

test('a volta nunca aceita, autoriza, integra ou aplica resultado algum', async () => {
  const database = new FakeDatabase({ items: [{ id: 'item-1', version: 1, state: 'approved', target: 'alvo-1', approvalSeq: 10, classification: 'complete' }] });
  const result = await turn(database, executor().adapter, [workItem('item-1', { target: 'alvo-1' })], ['claim-1', 'attempt-1']);

  expect(result.outcome).toBe('execution_completed');
  // O desfecho máximo é `review`: a decisão humana continua soberana (INT-03).
  expect(database.items.get('item-1')!.state).toBe('review');
  expect(database.events.map(event => event.type)).not.toContain('result_accepted');
  for (const forbidden of ['review_work_result', 'complete_work_review', 'resolve_approval']) {
    expect(database.calls).not.toContain(forbidden);
  }
});

test('tentativa abandonada retoma com IDs novos e carriedContext sem cenário inventado', async () => {
  const source = {
    kind: 'abandoned_checkpoint', item_state: 'approved', source_attempt_id: 'attempt-antiga',
    source_claim_id: 'claim-antigo', approved_proposal_version: 1,
    abandonment_event_seq: 41, abandonment_reason: 'lease_expired',
    abandoned_at: '2026-07-27T12:00:00.000Z', previous_attempt_ids: ['attempt-antiga'],
    checkpoint: {
      checkpoint_event_seq: 40, checkpoint_signal_sequence: 4,
      data: {
        schemaVersion: 1, handoffReference: 'runner-bundle:cp', completedSteps: ['feito'],
        remainingSteps: ['resta'], nextStep: 'continuar', decisions: [], risks: ['risco'],
        touchedResources: ['calculator.py'], validations: [], failures: ['falha anterior'], evidenceReferences: [],
      },
    },
  };
  const item = workItem('item-1', { limits: { max_attempts: 3, max_duration_minutes: 5 } });
  const database = new FakeDatabase({
    items: [{ id: 'item-1', version: 1, state: 'approved', target: 'alvo-item-1', approvalSeq: 1, classification: 'complete' }],
    resumptionSource: source,
  });
  const { adapter, calls } = executor();
  const result = await turn(database, adapter, [item], ['claim-novo', 'attempt-nova']);

  expect(result.outcome).toBe('execution_completed');
  expect(database.calls).toContain('begin_resumed_work_attempt');
  expect(database.calls).not.toContain('acquire_work_claim');
  expect(calls[0]?.attemptId).toBe('attempt-nova');
  expect(calls[0]?.carriedContext).toEqual(expect.objectContaining({
    isNewAttempt: true, continueFromCheckpoint: true, remainingSteps: ['resta'],
    nextStep: 'continuar', previousFailures: ['falha anterior'],
  }));
  expect(calls[0]?.carriedContext).not.toHaveProperty('scenario');
});

test('decisão humana consumida retoma do handoff persistido com novo claim e nova tentativa',async()=>{
  const source={kind:'human_decision_checkpoint',input_requested_event_id:'request-1',input_provided_event_id:'answer-1',
    previous_attempt_ids:['attempt-antiga'],handoff:{schemaVersion:1,workItemId:'item-1',attemptId:'attempt-antiga',
      approvedProposalVersion:1,claimId:'claim-antigo',status:'paused',stopReason:'human_input_required',
      handoffReference:'ux02-proof:checkpoint-1',completedSteps:['iniciado'],remainingSteps:['concluir'],
      decisions:[],risks:['decisão necessária'],nextStep:'continuar',touchedResources:['calculator.py'],
      validations:[{label:'checkpoint',outcome:'passed'}],failures:[],evidenceReferences:['ux02-proof:checkpoint-1']}};
  const database=new FakeDatabase({items:[{id:'item-1',version:1,state:'approved',target:'alvo-1',approvalSeq:1,classification:'complete'}],
    decisionResumptionSource:source});
  const{adapter,calls}=executor();
  const result=await turn(database,adapter,[workItem('item-1',{target:'alvo-1',limits:{max_attempts:3,max_duration_minutes:5}})],['claim-novo','attempt-nova']);
  expect(result.outcome).toBe('execution_completed');
  expect(database.calls).toContain('begin_human_decision_resumed_attempt');
  expect(database.calls).not.toContain('acquire_work_claim');
  expect(calls[0]).toMatchObject({attemptId:'attempt-nova',carriedContext:{isNewAttempt:true,continueFromCheckpoint:true,
    remainingSteps:['concluir'],nextStep:'continuar',risks:['decisão necessária'],touchedResources:['calculator.py'],previousFailures:[]}});
});

describe('Etapa 2B.1 — persistência de checkpoint em stream', () => {
  const readerItems = () => [workItem('item-1', { target: 'alvo-1' })];
  const db = (extra: Partial<FakeOptions> = {}) =>
    new FakeDatabase({ items: [{ id: 'item-1', version: 1, state: 'approved', target: 'alvo-1', approvalSeq: 10, classification: 'complete' }], ...extra });

  test('executor sem checkpoint não chama record_work_checkpoint e chega a review', async () => {
    const database = db();
    const { adapter } = scriptedExecutor([{ kind: 'progress' }, { kind: 'result' }]);
    const result = await turn(database, adapter, readerItems(), ['claim-1', 'attempt-1']);
    expect(result.outcome).toBe('execution_completed');
    expect(database.calls).not.toContain('record_work_checkpoint');
    expect(database.items.get('item-1')!.state).toBe('review');
  });

  test('checkpoint único é persistido ANTES do terminal', async () => {
    const database = db();
    const { adapter } = scriptedExecutor([{ kind: 'checkpoint' }, { kind: 'result' }]);
    await turn(database, adapter, readerItems(), ['claim-1', 'attempt-1']);
    const cpCall = database.calls.indexOf('record_work_checkpoint');
    const termCall = database.calls.indexOf('record_commanded_work_terminal');
    expect(cpCall).toBeGreaterThanOrEqual(0);
    expect(cpCall).toBeLessThan(termCall);
    const types = database.events.map(event => event.type);
    expect(types.indexOf('checkpoint_recorded')).toBeLessThan(types.indexOf('result_submitted'));
  });

  test('decisão necessária após checkpoint bloqueia, libera posse e não grava terminal comum', async () => {
    const database = db();
    const { adapter } = scriptedExecutor([{ kind: 'checkpoint' }, { kind: 'decision_required' }]);
    const result = await turn(database, adapter, readerItems(), ['claim-1', 'attempt-1']);
    expect(result).toMatchObject({ outcome: 'decision_required', claimReleased: true, requiresAnotherTurn: false });
    expect(database.items.get('item-1')!.state).toBe('blocked');
    expect(database.calls).toContain('record_work_decision_required');
    expect(database.calls).not.toContain('record_commanded_work_terminal');
  });

  test('múltiplos checkpoints persistidos na ordem; progress não vira checkpoint', async () => {
    const database = db();
    const { adapter } = scriptedExecutor([{ kind: 'progress' }, { kind: 'checkpoint' }, { kind: 'progress' }, { kind: 'checkpoint' }, { kind: 'result' }]);
    const result = await turn(database, adapter, readerItems(), ['claim-1', 'attempt-1']);
    expect(result.outcome).toBe('execution_completed');
    expect(database.calls.filter(name => name === 'record_work_checkpoint')).toHaveLength(2);
    expect(database.events.filter(event => event.type === 'checkpoint_recorded')).toHaveLength(2);
    const termIndex = database.events.findIndex(event => event.type === 'result_submitted');
    const cpIndexes = database.events.flatMap((event, index) => event.type === 'checkpoint_recorded' ? [index] : []);
    expect(cpIndexes.every(index => index < termIndex)).toBe(true);
  });

  test('replay idempotente permite continuar até o terminal', async () => {
    const database = db({ replayCheckpoints: true });
    const { adapter } = scriptedExecutor([{ kind: 'checkpoint' }, { kind: 'result' }]);
    const result = await turn(database, adapter, readerItems(), ['claim-1', 'attempt-1']);
    expect(result.outcome).toBe('execution_completed');
    expect(database.items.get('item-1')!.state).toBe('review');
    expect(database.events.filter(event => event.type === 'checkpoint_recorded')).toHaveLength(0);
  });

  test('falha de persistência de checkpoint interrompe: sem terminal, posse retida', async () => {
    const database = db({ failCheckpointAtSequence: 2 });
    const { adapter } = scriptedExecutor([{ kind: 'progress' }, { kind: 'checkpoint' }, { kind: 'result' }]);
    const result = await turn(database, adapter, readerItems(), ['claim-1', 'attempt-1']);
    expect(result.outcome).toBe('execution_interrupted');
    expect(result.refusal?.code).toBe('checkpoint_persist_failed');
    expect(result.requiresAnotherTurn).toBe(true);
    expect(database.calls).not.toContain('record_commanded_work_terminal');
    expect(database.calls).not.toContain('release_work_claim');
    expect(database.claims.get('claim-1')!.released).toBe(false);
    expect(database.items.get('item-1')!.state).toBe('in_progress');
  });

  test('executor lança após um checkpoint: o checkpoint permanece registrado, tentativa aberta', async () => {
    const database = db();
    const { adapter } = scriptedExecutor([{ kind: 'checkpoint' }, { kind: 'result' }], { throwAtIndex: 1 });
    const result = await turn(database, adapter, readerItems(), ['claim-1', 'attempt-1']);
    expect(result.outcome).toBe('execution_interrupted');
    expect(result.refusal?.code).toBe('executor_threw');
    expect(database.events.filter(event => event.type === 'checkpoint_recorded')).toHaveLength(1);
    expect(database.calls).not.toContain('record_commanded_work_terminal');
    expect(database.claims.get('claim-1')!.released).toBe(false);
    expect(database.items.get('item-1')!.state).toBe('in_progress');
  });

  test('stream termina sem terminal: checkpoint permanece, tentativa aberta', async () => {
    const database = db();
    const { adapter } = scriptedExecutor([{ kind: 'checkpoint' }]);
    const result = await turn(database, adapter, readerItems(), ['claim-1', 'attempt-1']);
    expect(result.outcome).toBe('execution_interrupted');
    expect(result.refusal?.code).toBe('executor_contract_violation');
    expect(database.events.filter(event => event.type === 'checkpoint_recorded')).toHaveLength(1);
    expect(database.calls).not.toContain('record_commanded_work_terminal');
    expect(database.items.get('item-1')!.state).toBe('in_progress');
  });

  test('checkpoint depois do terminal é recusado pelo validador e não é persistido', async () => {
    const database = db();
    const { adapter } = scriptedExecutor([{ kind: 'result' }, { kind: 'checkpoint' }]);
    const result = await turn(database, adapter, readerItems(), ['claim-1', 'attempt-1']);
    expect(result.outcome).toBe('execution_interrupted');
    expect(result.refusal?.code).toBe('executor_contract_violation');
    expect(database.calls).not.toContain('record_work_checkpoint');
    expect(database.calls).not.toContain('record_commanded_work_terminal');
  });

  test('terminal error após checkpoint chega a failed', async () => {
    const database = db();
    const { adapter } = scriptedExecutor([{ kind: 'checkpoint' }, { kind: 'error' }]);
    const result = await turn(database, adapter, readerItems(), ['claim-1', 'attempt-1']);
    expect(result.outcome).toBe('execution_failed');
    expect(database.events.filter(event => event.type === 'checkpoint_recorded')).toHaveLength(1);
    expect(database.items.get('item-1')!.state).toBe('failed');
  });

  test('terminal cancelled após checkpoint chega a cancelled, checkpoint preservado', async () => {
    const database = db();
    const { adapter } = scriptedExecutor([{ kind: 'checkpoint' }, { kind: 'cancelled' }]);
    const result = await turn(database, adapter, readerItems(), ['claim-1', 'attempt-1']);
    expect(result.outcome).toBe('execution_cancelled');
    expect(database.events.filter(event => event.type === 'checkpoint_recorded')).toHaveLength(1);
    expect(database.items.get('item-1')!.state).toBe('cancelled');
  });

  test('volta com checkpoint mantém requiresAnotherTurn e não aceita/integra resultado', async () => {
    const database = db();
    const { adapter } = scriptedExecutor([{ kind: 'checkpoint' }, { kind: 'result' }]);
    const result = await turn(database, adapter, readerItems(), ['claim-1', 'attempt-1']);
    expect(result.outcome).toBe('execution_completed');
    expect(result.requiresAnotherTurn).toBe(true);
    expect(result.claimReleased).toBe(true);
    expect(database.items.get('item-1')!.state).toBe('review');
    expect(database.events.map(event => event.type)).not.toContain('result_accepted');
  });
});

describe('INTEL-04 — orçamento no laço do Supervisor', () => {
  test('orçamento indisponível interrompe antes de roteamento, claim e executor', async () => {
    const database = new FakeDatabase({
      items: [{ id: 'item-1', version: 1, state: 'approved', target: 'alvo-1', approvalSeq: 1, classification: 'complete' }],
      budgetReason: 'user_attempt_budget_exhausted',
    });
    const { adapter, calls } = executor('result');
    const result = await turn(database, adapter, [workItem('item-1')], ['claim-1', 'attempt-1']);

    expect(result).toMatchObject({
      outcome: 'budget_interrupted',
      requiresAnotherTurn: false,
      refusal: { code: 'user_attempt_budget_exhausted' },
    });
    expect(calls).toHaveLength(0);
    expect(database.items.get('item-1')?.state).toBe('blocked');
    expect(database.calls).toContain('block_work_on_budget');
    expect(database.calls).not.toContain('record_work_routing_decision');
    expect(database.calls).not.toContain('acquire_work_claim');
  });

  test('limite de tempo após checkpoint bloqueia o item e não consome o terminal', async () => {
    const database = new FakeDatabase({
      items: [{ id: 'item-1', version: 1, state: 'approved', target: 'alvo-1', approvalSeq: 1, classification: 'complete' }],
      interruptBudgetAfterCheckpoint: 'interactive_reserve_protected',
    });
    const { adapter } = scriptedExecutor([{ kind: 'checkpoint' }, { kind: 'result' }]);
    const result = await turn(database, adapter, [workItem('item-1')], ['claim-1', 'attempt-1']);

    expect(result).toMatchObject({
      outcome: 'budget_interrupted',
      requiresAnotherTurn: false,
      claimReleased: true,
      refusal: { code: 'interactive_reserve_protected' },
    });
    expect(database.items.get('item-1')?.state).toBe('blocked');
    expect(database.events.map(event => event.type)).toContain('checkpoint_recorded');
    expect(database.events.map(event => event.type)).toContain('work_blocked');
    expect(database.events.map(event => event.type)).not.toContain('result_submitted');
    expect(database.calls).not.toContain('record_commanded_work_terminal');
  });

  test('item bloqueado por orçamento cuja janela recuperou é re-admitido antes da seleção e executa', async () => {
    // Coerência V0: o bloqueio por orçamento é temporal. Uma nova volta do
    // Supervisor re-admite (blocked -> approved) o item cuja janela liberou,
    // sem entrada humana, e prossegue para executá-lo pelo caminho normal.
    const database = new FakeDatabase({
      items: [{ id: 'item-1', version: 1, state: 'blocked', target: 'alvo-1', approvalSeq: 1, classification: 'complete' }],
      readmitBudgetBlocked: ['item-1'],
    });
    const { adapter, calls } = executor('result');
    const result = await turn(
      database, adapter, [workItem('item-1')], ['claim-1', 'attempt-1'], undefined,
      { workItemId: 'item-1', expectedProposalVersion: 1 },
    );

    expect(result.outcome).toBe('execution_completed');
    // A re-admissão roda ANTES da seleção; sem ela o item bloqueado nunca seria selecionável.
    const readmitIndex = database.calls.indexOf('readmit_budget_blocked_work');
    const selectIndex = database.calls.indexOf('select_autonomous_work');
    expect(readmitIndex).toBeGreaterThanOrEqual(0);
    expect(selectIndex).toBeGreaterThan(readmitIndex);
    // Voltou a `approved` por evento tipado, nunca por decisão humana falsa.
    expect(database.events.some(event => event.type === 'work_approved' && event.reason === 'budget_window_recovered')).toBe(true);
    expect(database.items.get('item-1')!.state).toBe('review');
    expect(calls).toHaveLength(1);
  });

  test('interrupção de orçamento EM tentativa cuja janela recuperou retoma DO CHECKPOINT, não do zero', async () => {
    // A tentativa foi interrompida por limite temporal com checkpoint válido; a
    // recuperação re-admite e RESUME do checkpoint (novas identidades), jamais um
    // restart cego e jamais o caminho de decisão humana ou de abandono.
    const source = {
      kind: 'budget_interruption_checkpoint', interruption_event_seq: 50, checkpoint_event_seq: 40,
      budget_reason: 'user_runtime_budget_exhausted', previous_attempt_ids: ['attempt-antiga'],
      handoff: {
        schemaVersion: 1, workItemId: 'item-1', attemptId: 'attempt-antiga', approvedProposalVersion: 1,
        claimId: 'claim-antigo', status: 'paused', stopReason: 'time_limit_reached',
        handoffReference: 'worktree:alvo-1:anima-work/attempt-antiga', completedSteps: ['isolou a workspace'],
        remainingSteps: ['reexecutar o gate'], decisions: [], risks: ['tempo excedido'], nextStep: 'reexecutar o gate',
        touchedResources: ['calculator.py'], validations: [{ label: 'gate', outcome: 'failed' }],
        failures: ['gate incompleto'], evidenceReferences: [],
      },
    };
    const database = new FakeDatabase({
      items: [{ id: 'item-1', version: 1, state: 'blocked', target: 'alvo-1', approvalSeq: 1, classification: 'complete' }],
      readmitBudgetInterrupted: ['item-1'], budgetInterruptionSource: source,
    });
    const { adapter, calls } = executor('result');
    const result = await turn(
      database, adapter, [workItem('item-1', { target: 'alvo-1', limits: { max_attempts: 3, max_duration_minutes: 5 } })],
      ['claim-novo', 'attempt-nova'],
    );

    expect(result.outcome).toBe('execution_completed');
    // Re-admitido e retomado DO CHECKPOINT — nunca restart cego nem outra via.
    expect(database.calls).toContain('readmit_budget_interrupted_work');
    expect(database.calls).toContain('begin_budget_interruption_resumed_attempt');
    expect(database.calls).not.toContain('acquire_work_claim');
    expect(database.calls).not.toContain('begin_resumed_work_attempt');
    expect(database.calls).not.toContain('begin_human_decision_resumed_attempt');
    expect(database.events.some(event => event.type === 'work_approved' && event.reason === 'budget_window_recovered')).toBe(true);
    // O contexto do checkpoint atravessa a interrupção, com nova identidade de tentativa.
    expect(calls[0]).toMatchObject({ attemptId: 'attempt-nova', carriedContext: {
      isNewAttempt: true, continueFromCheckpoint: true, remainingSteps: ['reexecutar o gate'],
      nextStep: 'reexecutar o gate', previousFailures: ['gate incompleto'] } });
  });

  test('re-admissão recusada interrompe a volta antes da seleção', async () => {
    const database = new FakeDatabase({
      items: [{ id: 'item-1', version: 1, state: 'approved', target: 'alvo-1', approvalSeq: 1, classification: 'complete' }],
      failReadmit: true,
    });
    const { adapter, calls } = executor('result');
    const result = await turn(database, adapter, [workItem('item-1')], ['claim-1', 'attempt-1']);

    expect(result.outcome).toBe('selection_not_executable');
    expect(result.requiresAnotherTurn).toBe(true);
    expect(calls).toHaveLength(0);
    expect(database.calls).toEqual(['reconcile_supervised_work', 'readmit_budget_blocked_work']);
  });
});

describe('UX-01 — controle cooperativo no laço', () => {
  const items = () => [workItem('item-1', { target: 'alvo-1' })];
  const db = (extra: Partial<FakeOptions> = {}) =>
    new FakeDatabase({ items: [{ id: 'item-1', version: 1, state: 'approved', target: 'alvo-1', approvalSeq: 10, classification: 'complete' }], ...extra });

  test('pausa pendente é aplicada no checkpoint: item blocked, posse liberada, terminal não consumido', async () => {
    const database = db({ controlAfterCheckpoint: 'pause' });
    const { adapter } = scriptedExecutor([{ kind: 'checkpoint' }, { kind: 'result' }]);
    const result = await turn(database, adapter, items(), ['claim-1', 'attempt-1']);

    expect(result.outcome).toBe('control_applied');
    expect(result.requiresAnotherTurn).toBe(false);
    expect(result.claimReleased).toBe(true);
    expect(result.refusal?.code).toBe('pause');
    // Aplicado DEPOIS do checkpoint e ANTES do gate de orçamento; sem terminal.
    const cp = database.calls.indexOf('record_work_checkpoint');
    const apply = database.calls.indexOf('apply_work_control_at_checkpoint');
    expect(cp).toBeGreaterThanOrEqual(0);
    expect(apply).toBeGreaterThan(cp);
    expect(database.calls.indexOf('interrupt_work_on_budget')).toBe(-1);
    expect(database.calls).not.toContain('record_commanded_work_terminal');
    expect(database.items.get('item-1')!.state).toBe('blocked');
    expect(database.events.map(event => event.type)).toContain('checkpoint_recorded');
    expect(database.events.map(event => event.type)).toContain('work_paused');
    expect(database.events.map(event => event.type)).toContain('work_claim_released');
    expect(database.events.map(event => event.type)).not.toContain('result_submitted');
  });

  test('cancelamento pendente é aplicado no checkpoint: item cancelled, sem resultado', async () => {
    const database = db({ controlAfterCheckpoint: 'cancel' });
    const { adapter } = scriptedExecutor([{ kind: 'checkpoint' }, { kind: 'result' }]);
    const result = await turn(database, adapter, items(), ['claim-1', 'attempt-1']);

    expect(result.outcome).toBe('control_applied');
    expect(result.refusal?.code).toBe('cancel');
    expect(database.items.get('item-1')!.state).toBe('cancelled');
    expect(database.events.map(event => event.type)).toContain('work_cancelled');
    expect(database.events.map(event => event.type)).not.toContain('result_submitted');
    expect(database.calls).not.toContain('record_commanded_work_terminal');
  });

  test('sem pedido pendente, o checkpoint não interrompe: a volta chega a review', async () => {
    const database = db();
    const { adapter } = scriptedExecutor([{ kind: 'checkpoint' }, { kind: 'result' }]);
    const result = await turn(database, adapter, items(), ['claim-1', 'attempt-1']);

    expect(result.outcome).toBe('execution_completed');
    // A RPC de controle é consultada, mas devolve applied:false e o laço segue.
    expect(database.calls).toContain('apply_work_control_at_checkpoint');
    expect(database.items.get('item-1')!.state).toBe('review');
    expect(database.events.map(event => event.type)).toContain('result_submitted');
  });
});
