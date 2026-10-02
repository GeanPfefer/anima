/** @jest-environment node */
// Fidelidade canônica Work Item → coder (CoderTaskSpecV1), SEM provider real.
//
// Prova a cadeia inteira: proposta aprovada + execution_spec → WorkExecutorRequest
// (buildExecutorRequest) → CoderEditRequest (WorktreeExecutorAdapter real, worktree
// git real) → payload final do Ollama → payload OpenAI simulado → composeHarnessTask
// (DeepSeek Harness). Antes desta fatia, expectedEffects/covers/proof/claimKind/
// targetPaths/riscos/Verifier e critérios sem comando eram perdidos antes do coder.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readAutonomousExecutionSpec,
  type AutonomousExecutionSpecV1,
  type WorkExecutorRequest,
  type WorkExecutorSignal,
  type WorkItem,
} from '@anima/core';
import type { OpenAIAdmissionControl } from '@/lib/ai/openai-paid-transport';
import { renderCoderTaskSection, type CoderBackend, type CoderEditRequest, type CoderWorkspace } from './coder-backend';
import { DeepSeekHarnessCoderBackend, type HarnessRunTurnInput } from './deepseek-harness-coder';
import { buildExecutorRequest } from './execution';
import { GptCoderBackend } from './gpt-coder';
import { composeHarnessTask } from './harness/deepseek-harness-runtime';
import { OllamaCoderBackend } from './ollama-coder';
import { runProcess } from './worktree';
import { WorktreeExecutorAdapter, type WorktreeTargetResolver } from './worktree-executor';

// Worktree git real + baseline npm: sob carga ampla do jest o beforeAll passa de 60s.
jest.setTimeout(180_000);

const git = (repo: string, args: readonly string[]) => runProcess('git', ['-C', repo, ...args], { cwd: repo, timeoutMs: 30_000 });

/** Repo mínimo com workspace `apps/web` cujo `npm test` passa (baseline advisory barato). */
async function makeRepo(): Promise<{ resolver: WorktreeTargetResolver; cleanup: () => Promise<void> }> {
  const repo = await mkdtemp(join(tmpdir(), 'anima-taskspec-'));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.name', 'test']);
  await git(repo, ['config', 'user.email', 'test@anima.local']);
  await git(repo, ['config', 'commit.gpgsign', 'false']);
  await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'fixture', private: true, workspaces: ['apps/web'] }, null, 2));
  await mkdir(join(repo, 'apps', 'web', 'cli'), { recursive: true });
  await writeFile(join(repo, 'apps', 'web', 'package.json'), JSON.stringify({ name: 'web', private: true, scripts: { test: 'node -e "process.exit(0)"' } }, null, 2));
  await writeFile(join(repo, 'apps', 'web', 'cli', 'args.ts'), 'export const parseArgs = () => ({ ok: true });\n');
  await writeFile(join(repo, 'apps', 'web', 'cli', 'args.test.ts'), 'export {};\n');
  await writeFile(join(repo, '.gitignore'), 'node_modules/\n');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'inicial']);
  const sha = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  return {
    resolver: { resolve: reference => reference === 'anima' ? { repoRoot: repo, sha } : null },
    cleanup: () => rm(repo, { recursive: true, force: true }),
  };
}

const CAPTURED = 'captura do CoderEditRequest concluída';

/** Executa o WorktreeExecutorAdapter REAL e captura o CoderEditRequest entregue ao coder. */
async function captureCoderEditRequest(request: WorkExecutorRequest): Promise<{ edit: CoderEditRequest; signals: WorkExecutorSignal[] }> {
  const ctx = await makeRepo();
  let captured: CoderEditRequest | null = null;
  const backend: CoderBackend = { id: 'capture', edit: async req => { captured = req; throw new Error(CAPTURED); } };
  const signals: WorkExecutorSignal[] = [];
  try {
    for await (const signal of new WorktreeExecutorAdapter({ targets: ctx.resolver, backend }).execute(request, new AbortController().signal)) {
      signals.push(signal);
    }
  } finally { await ctx.cleanup(); }
  if (!captured) throw new Error(`o coder não foi chamado: ${JSON.stringify(signals.at(-1))}`);
  return { edit: captured, signals };
}

const memoryWorkspace = (rootPath?: string): CoderWorkspace => ({
  readFile: async () => null,
  writeFile: async () => true,
  ...(rootPath ? { rootPath } : {}),
});

/** Todas as strings de um corpo JSON enviado ao provider, concatenadas (payload final). */
const payloadText = (body: string): string => {
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(JSON.parse(body));
  return out.join('\n');
};

const STOP = 'payload capturado';

async function ollamaPayload(edit: CoderEditRequest): Promise<string> {
  const bodies: string[] = [];
  const fetchImpl = (async (_url: unknown, init: { body: string }) => { bodies.push(init.body); throw new Error(STOP); }) as unknown as typeof fetch;
  await expect(new OllamaCoderBackend({ model: 'fixture', fetchImpl }).edit(edit, memoryWorkspace(), new AbortController().signal)).rejects.toThrow();
  expect(bodies.length).toBeGreaterThan(0);
  return payloadText(bodies[0]!);
}

const grant: OpenAIAdmissionControl = { admit: async intent => ({ consumer: intent.consumer, authorizationRef: 'test-auth', reservationId: 'r1' }) };

async function gptPayload(edit: CoderEditRequest): Promise<string> {
  const bodies: string[] = [];
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => { bodies.push(String(init!.body)); throw new Error(STOP); }) as typeof fetch;
  await expect(new GptCoderBackend({ model: 'gpt-fixture', apiKey: 'k', fetchImpl, admission: grant }).edit(edit, memoryWorkspace(), new AbortController().signal)).rejects.toThrow();
  expect(bodies.length).toBeGreaterThan(0);
  return payloadText(bodies[0]!);
}

async function dshTask(edit: CoderEditRequest): Promise<string> {
  let input: HarnessRunTurnInput | null = null;
  const backend = new DeepSeekHarnessCoderBackend({
    model: 'fixture',
    runtime: { runTurn: async value => { input = value; throw new Error(STOP); } },
  });
  await expect(backend.edit(edit, memoryWorkspace('/fixture/worktree'), new AbortController().signal)).rejects.toThrow(STOP);
  expect(input).not.toBeNull();
  return composeHarnessTask(input!);
}

const workItem = (fields: Pick<WorkItem, 'id' | 'proposalVersion' | 'capability' | 'proposal' | 'intent'>): WorkItem => ({
  ...fields,
  userId: 'fixture-user', sourceMessageId: 'fixture-message', state: 'approved', impactLevel: 'low',
  originalRequest: 'fixture', createdAt: new Date(0), updatedAt: new Date(0),
});

async function chain(item: WorkItem, spec: AutonomousExecutionSpecV1) {
  const request = buildExecutorRequest({ item, spec, attemptId: `att-${Date.now()}-${Math.random().toString(36).slice(2)}`, contextReferences: [{ kind: 'context_snapshot', id: 'snap-1' }] });
  const { edit } = await captureCoderEditRequest(request);
  const section = renderCoderTaskSection(edit);
  expect(section).not.toBeNull();
  return { request, edit, section: section!, ollama: await ollamaPayload(edit), gpt: await gptPayload(edit), dsh: await dshTask(edit) };
}

// ------------------------------------------------------------------
// 1. Fixture sintética: a informação DECISIVA só existe em expectedEffects/critérios.
// ------------------------------------------------------------------
describe('CoderTaskSpecV1 — cadeia proposta → executor → coder → payloads', () => {
  const effects = [
    'parseRange("3..1") retorna ok:false com code RANGE_INVERTED (DECISIVO-1).',
    'parseRange("1..3") continua retornando [1,2,3] (DECISIVO-2).',
    'Nenhum arquivo fora de apps/web/cli muda (DECISIVO-3).',
  ];
  const criteria = [
    { label: 'gate-range', command: 'npm test --workspace=apps/web -- cli/args.test.ts', covers: [effects[0]!, effects[1]!], proof: 'gate' as const, claimKind: 'substantive' as const, targetPaths: ['apps/web/cli/args.ts', 'apps/web/cli/args.test.ts'] },
    { label: 'escopo-preservado', covers: [effects[2]!], proof: 'scope' as const },
  ];
  const item = workItem({
    id: 'item-fidelity', proposalVersion: 4, capability: 'programming',
    // Objetivo propositalmente vago: sem os aceites, o coder não sabe o que entregar.
    proposal: { schemaVersion: 1, data: {
      summary: 'Ajuste do parser de intervalos', objective: 'Ajustar o parser',
      includedScope: ['apps/web/cli/args.ts', 'apps/web/cli/args.test.ts'], excludedScope: ['apps/web/cli/app.ts', 'packages/core'],
      expectedEffects: effects, risks: ['RISCO-DECISIVO: outros comandos dependem de parseRange.'],
    } },
    intent: { execution_spec: { verifier_requirement: 'required_fail_closed' } },
  });
  const spec: AutonomousExecutionSpecV1 = {
    schemaVersion: 1, target: { kind: 'project', reference: 'anima' }, permissions: ['workspace_read', 'workspace_write_isolated'],
    validationCriteria: criteria, limits: { maxAttempts: 1, maxDurationMinutes: 30 }, dependsOnWorkItemIds: [],
  };
  let run: Awaited<ReturnType<typeof chain>>;
  beforeAll(async () => { run = await chain(item, spec); });

  test('WorkExecutorRequest carrega a projeção completa, derivada da versão aprovada', () => {
    expect(run.request.taskSpec).toEqual({
      schemaVersion: 1, workItemId: 'item-fidelity', approvedProposalVersion: 4,
      summary: 'Ajuste do parser de intervalos', objective: 'Ajustar o parser',
      includedScope: ['apps/web/cli/args.ts', 'apps/web/cli/args.test.ts'], excludedScope: ['apps/web/cli/app.ts', 'packages/core'],
      expectedEffects: effects, risks: ['RISCO-DECISIVO: outros comandos dependem de parseRange.'],
      validationCriteria: criteria, verifierRequirement: 'required_fail_closed',
      contextReferences: [{ kind: 'context_snapshot', id: 'snap-1' }],
    });
  });

  test('CoderEditRequest recebe a MESMA projeção e os comandos autorizados seguem separados', () => {
    expect(run.edit.taskSpec).toEqual(run.request.taskSpec);
    expect(run.edit.validationCommands).toEqual([expect.objectContaining({ label: 'gate-range', program: 'npm', args: ['test', '--workspace=apps/web', '--', 'cli/args.test.ts'] })]);
    // Autoridade intacta: escopo de escrita continua vindo do includedScope.
    expect(run.edit.workspaceAccessPolicy?.writeScope).toEqual(['apps/web/cli/args.ts', 'apps/web/cli/args.test.ts']);
  });

  test.each(['ollama', 'gpt', 'dsh'] as const)('payload final %s contém a seção canônica idêntica e todos os campos decisivos', backend => {
    const payload = run[backend];
    expect(payload).toContain(run.section);
    for (const [index, effect] of effects.entries()) expect(payload).toContain(`E${index + 1}. ${effect}`);
    expect(payload).toContain('Resumo: Ajuste do parser de intervalos');
    expect(payload).toContain('  - RISCO-DECISIVO: outros comandos dependem de parseRange.');
    expect(payload).toContain('Escopo excluído (não tocar):\n  - apps/web/cli/app.ts\n  - packages/core');
    // Critério COM comando: comando, prova, claimKind, alvos e covers.
    expect(payload).toContain([
      '  V1. gate-range',
      '      comando: npm test --workspace=apps/web -- cli/args.test.ts',
      '      prova: gate',
      '      claimKind: substantive',
      '      alvos: apps/web/cli/args.ts, apps/web/cli/args.test.ts',
      '      cobre: E1, E2',
    ].join('\n'));
    // Critério SEM comando continua visível (antes era descartado no flatMap).
    expect(payload).toContain([
      '  V2. escopo-preservado',
      '      comando: (sem comando)',
      '      prova: scope',
      '      claimKind: (não declarado)',
      '      alvos: (não declarados)',
      '      cobre: E3',
    ].join('\n'));
    expect(payload).toContain('  - gate-range: npm test --workspace=apps/web -- cli/args.test.ts');
    expect(payload).toContain('Requisito do Verifier: required_fail_closed');
    expect(payload).toContain('  - context_snapshot:snap-1');
  });
});

test('executor recusa projeção divergente da autoridade ANTES de criar worktree ou chamar o coder', async () => {
  const item = workItem({
    id: 'item-mismatch', proposalVersion: 1, capability: 'programming',
    proposal: { schemaVersion: 1, data: { summary: 's', objective: 'o', includedScope: ['src/a.ts'], excludedScope: ['src/b.ts'], expectedEffects: ['e'], risks: [] } },
    intent: {},
  });
  const spec: AutonomousExecutionSpecV1 = {
    schemaVersion: 1, target: { kind: 'project', reference: 'anima' }, permissions: ['workspace_read', 'workspace_write_isolated'],
    validationCriteria: [{ label: 'v', command: 'npm test' }], limits: { maxDurationMinutes: 1 }, dependsOnWorkItemIds: [],
  };
  const valid = buildExecutorRequest({ item, spec, attemptId: 'att-mismatch', contextReferences: [] });
  const request: WorkExecutorRequest = { ...valid, taskSpec: { ...valid.taskSpec, includedScope: ['src/a.ts', 'src/escalada.ts'] } };
  const edit = jest.fn();
  const signals: WorkExecutorSignal[] = [];
  const adapter = new WorktreeExecutorAdapter({ targets: { resolve: () => ({ repoRoot: '/nao-usado', sha: 'deadbeef' }) }, backend: { id: 'never', edit } });
  for await (const signal of adapter.execute(request, new AbortController().signal)) signals.push(signal);
  expect(signals).toEqual([expect.objectContaining({ kind: 'error', code: 'invalid_request', message: expect.stringMatching(/escopo/) })]);
  expect(edit).not.toHaveBeenCalled();
});

// ------------------------------------------------------------------
// 2. Regressão TPC-01 com o export REAL — sem modelo, sem provider.
// ------------------------------------------------------------------
describe('TPC-01 — export real chega íntegro a Ollama, GPT e DSH', () => {
  const fixture = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'tpc01-approved-export.json'), 'utf8')) as {
    item: Pick<WorkItem, 'id' | 'proposalVersion' | 'capability' | 'proposal' | 'intent'>;
    spec: AutonomousExecutionSpecV1;
  };
  const item = workItem(fixture.item);
  const effects = item.proposal.data.expectedEffects;
  let run: Awaited<ReturnType<typeof chain>>;
  beforeAll(async () => { run = await chain(item, fixture.spec); });

  test('o spec exportado é exatamente o derivado do execution_spec real', () => {
    expect(readAutonomousExecutionSpec(item.intent)).toEqual(fixture.spec);
    expect(effects).toHaveLength(4);
  });

  test.each(['ollama', 'gpt', 'dsh'] as const)('%s recebe os quatro aceites canônicos, o gate focal e o Verifier', backend => {
    const payload = run[backend];
    expect(payload).toContain(run.section);
    // 1. mais de um <id> nos oito comandos é inválido
    expect(effects[0]).toContain('work approve|accept|retry|show|evidence|correct|request-changes|withdraw');
    expect(payload).toContain(`E1. ${effects[0]}`);
    // 2. --reason nos seis comandos relevantes é inválido
    expect(effects[1]).toContain('`--reason` passado a `work approve|accept|retry|show|evidence|correct`');
    expect(payload).toContain(`E2. ${effects[1]}`);
    // 3. formas válidas existentes continuam funcionando
    expect(payload).toContain(`E3. ${effects[2]}`);
    // 4. testes focais passam
    expect(payload).toContain(`E4. ${effects[3]}`);
    expect(payload).toContain('      cobre: E1, E2, E3, E4');
    expect(payload).toContain('      claimKind: substantive');
    expect(payload).toContain('  - validate-parseArgs: npm test --workspace=apps/web -- cli/args.test.ts');
    expect(payload).toContain('Requisito do Verifier: required_fail_closed');
  });

  test('DSH recebe o gate focal como INFORMAÇÃO de validação (o host segue julgando)', () => {
    expect(run.dsh).toContain('Comandos de validação autorizados pelo host (informativos; o host executa e julga):\n  - validate-parseArgs: npm test --workspace=apps/web -- cli/args.test.ts');
  });
});
