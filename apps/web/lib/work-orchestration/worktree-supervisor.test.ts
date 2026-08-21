/** @jest-environment node */
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from '@anima/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkItem } from '@anima/core';
import { runSupervisorTurn, type SupervisorReader } from './supervisor';
import { runProcess } from './worktree';
import { ScriptedCoderBackend } from './coder-backend';
import { WorktreeExecutorAdapter } from './worktree-executor';

// Operações git reais podem ficar lentas sob carga paralela; folga o timeout
// para não flakar por contenção (o padrão de 5s do jest é curto demais aqui).
jest.setTimeout(30_000);

// Prova de integração determinística: o Supervisor real dirige o executor de
// worktree real (repositório git temporário + backend determinístico) por um
// fake enxuto do caminho feliz. Cobre a costura seleção→worktree no SHA
// autorizado→edição→gate npm real→checkpoint persistido→terminal→review, com o
// workspace original comprovadamente intacto — sem Supabase nem HTTP.

const git = (repo: string, args: readonly string[]) => runProcess('git', ['-C', repo, ...args], { cwd: repo, timeoutMs: 30_000 });

async function makeNpmRepo(): Promise<{ repo: string; sha: string; cleanup: () => Promise<void> }> {
  const repo = await mkdtemp(join(tmpdir(), 'anima-sup-'));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.name', 'test']);
  await git(repo, ['config', 'user.email', 'test@anima.local']);
  await git(repo, ['config', 'commit.gpgsign', 'false']);
  await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'fix', version: '0.0.0', private: true, scripts: { test: 'node -e "process.exit(0)"' } }, null, 2));
  await mkdir(join(repo, 'src'), { recursive: true });
  await writeFile(join(repo, 'src', 'existing.ts'), 'export const one = 1;\n');
  await writeFile(join(repo, '.gitignore'), 'node_modules/\n');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'inicial']);
  return { repo, sha: (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim(), cleanup: () => rm(repo, { recursive: true, force: true }) };
}

type Rpc = { data: unknown; error: { code: string; message: string } | null };

class HappyFake {
  readonly calls: string[] = [];
  readonly item = { id: 'wt-item', version: 1, state: 'approved', target: 'anima-test' };
  claimReleased = false;
  private routedExecutor: string | null = null;
  private maxCp: number | undefined;

  readonly rpc = (name: string, args: Record<string, unknown> = {}): Promise<Rpc> => {
    this.calls.push(name);
    const ok = (data: unknown): Rpc => ({ data, error: null });
    const no = (message: string): Rpc => ({ data: null, error: { code: '55000', message } });
    switch (name) {
      case 'reconcile_supervised_work': return Promise.resolve(ok([]));
      case 'readmit_budget_blocked_work': return Promise.resolve(ok([]));
      case 'readmit_budget_interrupted_work': return Promise.resolve(ok([]));
      case 'budget_interruption_resumption_source': return Promise.resolve(ok(null));
      case 'next_autonomous_work': return Promise.resolve(ok(this.item.state === 'approved'
        ? [{ work_item_id: this.item.id, approved_proposal_version: this.item.version, approval_seq: 1, approved_at: new Date().toISOString(), capability: 'programming', target_reference: this.item.target, selection_policy: 'x', queue_size: 1, runner_up_approval_seq: null, skipped_occupied_targets: 0 }]
        : []));
      case 'autonomous_work_budget_status': return Promise.resolve(ok({ schemaVersion: 1, policyVersion: 'v1', admitted: true, reason: null }));
      case 'human_decision_resumption_source': return Promise.resolve(ok(null));
      case 'abandoned_work_resumption_source': return Promise.resolve(ok({ kind: 'new_execution' }));
      case 'current_work_intelligence_classification': return Promise.resolve(ok({ classification: { schemaVersion: 1, complexity: 'routine', risk: 'low', reversibility: 'reversible', planClarity: 'clear', urgency: 'normal', provenance: { kind: 'human_confirmed', classifiedAt: '2026-08-04T00:00:00-03:00', classifierId: 'user:test' } } }));
      case 'work_routing_adjustment_context': return Promise.resolve(ok({ schemaVersion: 1, attempts: [], latestCheckpoint: null }));
      case 'record_work_routing_adjustment': return Promise.resolve(ok({ action: 'recorded' }));
      case 'record_work_routing_decision': this.routedExecutor = (args['p_decision'] as { selected: { executorId: string } }).selected.executorId; return Promise.resolve(ok({ action: 'recorded' }));
      case 'acquire_work_claim': return Promise.resolve(ok({ id: args['claim_id'] }));
      case 'start_claimed_work_attempt':
        if (args['executor_id'] !== this.routedExecutor) return Promise.resolve(no('work routing executor mismatch'));
        this.item.state = 'in_progress';
        return Promise.resolve(ok(this.item));
      case 'record_work_checkpoint': { const seq = (args['signal'] as { sequence: number }).sequence; this.maxCp = seq; return Promise.resolve(ok({ action: 'recorded', checkpoint_sequence: seq })); }
      case 'apply_work_control_at_checkpoint': return Promise.resolve(ok({ applied: false }));
      case 'interrupt_work_on_budget': return Promise.resolve(ok({ interrupted: false }));
      case 'record_commanded_work_terminal': {
        const signal = args['signal'] as { kind: string; sequence: number };
        if (this.maxCp !== undefined && signal.sequence <= this.maxCp) return Promise.resolve(no('terminal sequence must follow the latest checkpoint'));
        this.item.state = signal.kind === 'result' ? 'review' : signal.kind === 'cancelled' ? 'cancelled' : 'failed';
        return Promise.resolve(ok(this.item));
      }
      case 'release_work_claim': this.claimReleased = true; return Promise.resolve(ok({}));
      default: throw new Error(`RPC inesperada: ${name}`);
    }
  };

  asClient(): SupabaseClient<Database> { return { rpc: this.rpc } as unknown as SupabaseClient<Database>; }
}

const ids = (values: readonly string[]) => { let index = 0; return () => values[index++]!; };

const workItem = (target: string, baseSha: string): WorkItem => ({
  id: 'wt-item', userId: 'u', sourceMessageId: 'm', state: 'approved', impactLevel: 'low', capability: 'programming',
  originalRequest: 'Adicionar função', createdAt: new Date(), updatedAt: new Date(), proposalVersion: 1,
  intent: {
    execution_spec: {
      schema_version: 1, executor: 'worktree', coder_backend: 'scripted', base_sha: baseSha,
      target: { kind: 'project', reference: target }, permissions: ['workspace_read', 'workspace_write_isolated'],
      validation_criteria: [{ label: 'testes', command: 'npm test' }], limits: { max_attempts: 3, max_duration_minutes: 5 },
    },
  } as WorkItem['intent'],
  proposal: { schemaVersion: 1, data: { summary: 's', objective: 'Adicionar função pura', includedScope: ['src/added.ts'], excludedScope: ['deploy'], expectedEffects: ['função criada'], risks: [] } },
});

const reader = (item: WorkItem): SupervisorReader => ({
  getItem: (id: string) => Promise.resolve(id === item.id ? { ok: true as const, value: item } : { ok: false as const, error: { code: 'not_found' as const, message: 'x' } }),
  listContexts: () => Promise.resolve({ ok: true as const, value: [] }),
}) as unknown as SupervisorReader;

describe('Supervisor → executor de worktree (integração determinística)', () => {
  let ctx: Awaited<ReturnType<typeof makeNpmRepo>>;
  beforeAll(async () => { ctx = await makeNpmRepo(); });
  afterAll(async () => { await ctx.cleanup(); });

  test('a volta seleciona o worktree, valida pelo gate real e leva o item a review; original intacto', async () => {
    const target = 'anima-test';
    const adapter = new WorktreeExecutorAdapter({
      targets: { resolve: ref => ref === target ? { repoRoot: ctx.repo, sha: ctx.sha } : null },
      backend: new ScriptedCoderBackend([{ path: 'src/added.ts', content: 'export const added = 2;\n' }]),
      emitCheckpoint: true, linkNodeModules: false,
    });
    const fake = new HappyFake();
    const result = await runSupervisorTurn({
      client: fake.asClient(),
      routes: [{
        adapter,
        candidate: { schemaVersion: 1, routeId: 'worktree-v1:configured', executorId: adapter.id, providerRef: 'worktree-host', modelRef: 'scripted', effort: 'strong', capabilities: ['programming'], availability: 'available', latency: 'normal', priority: 100 },
      }],
      ownerInstanceId: 'sup-test', newId: ids(['claim-1', 'attempt-1']),
      signal: new AbortController().signal, reader: reader(workItem(target, ctx.sha)),
    });

    expect(result.outcome).toBe('execution_completed');
    expect(result.terminalKind).toBe('result');
    expect(fake.item.state).toBe('review');
    expect(fake.claimReleased).toBe(true);
    // O worktree emitiu um checkpoint que o laço persistiu antes do terminal.
    expect(fake.calls).toContain('record_work_checkpoint');
    expect(fake.calls).toContain('record_commanded_work_terminal');
    // O executor de worktree foi o escolhido (não o runner Python).
    expect(adapter.id).toBe('worktree-v1');

    // Workspace ORIGINAL intacto: nenhum src/added.ts, árvore limpa.
    await expect(stat(join(ctx.repo, 'src', 'added.ts'))).rejects.toBeTruthy();
    expect((await git(ctx.repo, ['status', '--porcelain'])).stdout.trim()).toBe('');
    await git(ctx.repo, ['branch', '-D', 'anima-work/attempt-1']).catch(() => {});
  }, 60_000);
});
