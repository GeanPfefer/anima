/** @jest-environment node */
import type { CreateWorkProposalCommand, WorkItem } from '@anima/core';
import {
  planExecutableProjectWork,
  planExecutableProjectWorkRevision,
  resolveConfiguredProjectPlannerProvider,
  createConfiguredProjectPlanner,
  shouldRunProjectPlanner,
  OpenAIProjectWorkPlanner,
  LocalOllamaProjectWorkPlanner,
  type ProjectWorkPlanner,
} from './project-work-planner';
import { workspaceForScope, scopeTestCommandToWorkspace, safeValidationCommand } from './project-work-planner-shared';

const base: CreateWorkProposalCommand = {
  sourceMessageId: 'message-1',
  impactLevel: 'significant',
  capability: 'planning',
  intent: { original_message: 'implemente' },
  proposal: {
    schemaVersion: 1,
    data: {
      summary: 'genérica', objective: 'genérico', includedScope: ['planejar'],
      excludedScope: ['executar'], expectedEffects: ['plano'], risks: ['imprecisão'],
    },
  },
};

const validArgs = (over: Record<string, unknown> = {}): string => JSON.stringify({
  summary: 'Ajuste pequeno', objective: 'Objetivo claro',
  included_scope: ['apps/web/lib/ai/project-work-planner.ts'],
  excluded_scope: ['Não alterar banco'], expected_effects: ['gate verde'], risks: ['variância'],
  validation_label: 'coder-backend', validation_command: 'npm test -- coder-backend.test.ts',
  ...over,
});

/** Planner fake: devolve argumentos brutos fixos — prova que o HOST é a autoridade. */
const fakePlanner = (rawArguments: string, id = 'fake_planner_v1'): ProjectWorkPlanner => ({
  id,
  proposeArguments: async () => ({ ok: true as const, rawArguments }),
});

describe('resolveConfiguredProjectPlannerProvider — config de deploy', () => {
  test('default é openai (local NÃO é default)', () => {
    expect(resolveConfiguredProjectPlannerProvider({})).toBe('openai');
    expect(resolveConfiguredProjectPlannerProvider({ ANIMA_PROJECT_PLANNER_PROVIDER: 'openai' })).toBe('openai');
  });
  test('local é selecionável explicitamente; desconhecido/vazio cai no default', () => {
    expect(resolveConfiguredProjectPlannerProvider({ ANIMA_PROJECT_PLANNER_PROVIDER: 'local' })).toBe('local');
    expect(resolveConfiguredProjectPlannerProvider({ ANIMA_PROJECT_PLANNER_PROVIDER: '  local  ' })).toBe('local');
    expect(resolveConfiguredProjectPlannerProvider({ ANIMA_PROJECT_PLANNER_PROVIDER: 'gpt' })).toBe('openai');
    expect(resolveConfiguredProjectPlannerProvider({ ANIMA_PROJECT_PLANNER_PROVIDER: '' })).toBe('openai');
  });
  test('a factory cria o tipo certo conforme a config', () => {
    expect(createConfiguredProjectPlanner({})).toBeInstanceOf(OpenAIProjectWorkPlanner);
    expect(createConfiguredProjectPlanner({ ANIMA_PROJECT_PLANNER_PROVIDER: 'local' })).toBeInstanceOf(LocalOllamaProjectWorkPlanner);
  });
});

describe('escopo de gate no monorepo — causa raiz do fan-out', () => {
  test('workspaceForScope: único workspace, cruzamento/raiz/fora → null', () => {
    expect(workspaceForScope(['apps/web/a.ts', 'apps/web/b/c.ts'])).toBe('apps/web');
    expect(workspaceForScope(['packages/core/x.ts'])).toBe('packages/core');
    expect(workspaceForScope(['apps/web/a.ts', 'packages/core/b.ts'])).toBeNull();
    expect(workspaceForScope(['README.md'])).toBeNull();
    expect(workspaceForScope(['docs/x/y.ts'])).toBeNull();
  });

  test('scopeTestCommandToWorkspace: escopa test filtrado; preserva o resto', () => {
    expect(scopeTestCommandToWorkspace('npm test -- coder-backend.test.ts', ['apps/web/lib/x.ts']))
      .toBe('npm test --workspace=apps/web -- coder-backend.test.ts');
    // já escopado → inalterado
    expect(scopeTestCommandToWorkspace('npm test --workspace=apps/web -- x.test.ts', ['apps/web/x.ts']))
      .toBe('npm test --workspace=apps/web -- x.test.ts');
    // sem filtro → inalterado (bare test; não sofre fan-out por filtro ausente)
    expect(scopeTestCommandToWorkspace('npm test', ['apps/web/x.ts'])).toBe('npm test');
    // typecheck/build → inalterado
    expect(scopeTestCommandToWorkspace('npm run typecheck', ['apps/web/x.ts'])).toBe('npm run typecheck');
    // escopo ambíguo → inalterado (host não adivinha)
    expect(scopeTestCommandToWorkspace('npm test -- x.test.ts', ['apps/web/a.ts', 'packages/core/b.ts']))
      .toBe('npm test -- x.test.ts');
  });

  test('safeValidationCommand aceita a forma escopada por workspace', () => {
    expect(safeValidationCommand('npm test --workspace=apps/web -- coder-backend.test.ts')).toBe(true);
    expect(safeValidationCommand('npm run typecheck --workspace=apps/web')).toBe(true);
  });

  test('orquestrador: escopa a validação da proposta ao workspace do included_scope', async () => {
    const result = await planExecutableProjectWork('faça', base, fakePlanner(validArgs()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const spec = (result.command.intent as { execution_spec: { validation_criteria: Array<{ command: string }> } }).execution_spec;
    expect(spec.validation_criteria[0]!.command).toBe('npm test --workspace=apps/web -- coder-backend.test.ts');
  });

  test('orquestrador: escopo ambíguo mantém o comando original (fail-safe, não adivinha)', async () => {
    const args = validArgs({ included_scope: ['apps/web/a.ts', 'packages/core/b.ts'] });
    const result = await planExecutableProjectWork('faça', base, fakePlanner(args));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const spec = (result.command.intent as { execution_spec: { validation_criteria: Array<{ command: string }> } }).execution_spec;
    expect(spec.validation_criteria[0]!.command).toBe('npm test -- coder-backend.test.ts');
  });
});

describe('shouldRunProjectPlanner — gatilho preserva o default de produção', () => {
  test('sem developmentMode nunca roda', () => {
    expect(shouldRunProjectPlanner(false, 'openai', 'openai')).toBe(false);
    expect(shouldRunProjectPlanner(false, 'openai', 'local')).toBe(false);
  });
  test('planejador openai (default): só com provedor de chat openai (histórico intacto)', () => {
    expect(shouldRunProjectPlanner(true, 'openai', 'openai')).toBe(true);
    expect(shouldRunProjectPlanner(true, 'ollama', 'openai')).toBe(false);
  });
  test('planejador local: roda na superfície dev independentemente do provedor de chat', () => {
    expect(shouldRunProjectPlanner(true, 'ollama', 'local')).toBe(true);
    expect(shouldRunProjectPlanner(true, 'openai', 'local')).toBe(true);
  });
});

describe('planExecutableProjectWork — HOST é a autoridade, qualquer planejador', () => {
  test('proposta válida: host fixa target/executor/backend/permissões/limites e registra o planner', async () => {
    const result = await planExecutableProjectWork('faça', base, fakePlanner(validArgs()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.command.capability).toBe('programming');
    const intent = result.command.intent as { planner?: string; execution_spec: Record<string, unknown> };
    expect(intent.planner).toBe('fake_planner_v1');
    expect(intent.execution_spec).toMatchObject({
      target: { kind: 'project', reference: 'anima' },
      executor: 'worktree',
      coder_backend: 'ollama',
      permissions: ['workspace_read', 'workspace_write_isolated'],
      limits: { max_attempts: 3, max_duration_minutes: 30 },
    });
    expect(String(intent.execution_spec.base_sha)).toMatch(/^[a-f0-9]{40}$/);
    expect(result.command.proposal.data.includedScope).toEqual(['apps/web/lib/ai/project-work-planner.ts']);
  });

  test('o planejador NÃO pode escolher/ampliar executor, backend, permissões nem base_sha', async () => {
    // Mesmo que o modelo injete essas chaves, o host as ignora e fixa as suas.
    const injected = validArgs({
      executor: 'local-runner', coder_backend: 'openai', model: 'gpt-hack',
      permissions: ['danger'], base_sha: 'deadbeef', limits: { max_attempts: 99 },
      target: { reference: 'outro-repo' },
    });
    const result = await planExecutableProjectWork('faça', base, fakePlanner(injected));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const spec = (result.command.intent as { execution_spec: Record<string, unknown> }).execution_spec;
    expect(spec.executor).toBe('worktree');
    expect(spec.coder_backend).toBe('ollama');
    expect(spec.permissions).toEqual(['workspace_read', 'workspace_write_isolated']);
    expect(spec.base_sha).not.toBe('deadbeef');
    expect(String(spec.base_sha)).toMatch(/^[a-f0-9]{40}$/);
    expect(spec.limits).toEqual({ max_attempts: 3, max_duration_minutes: 30 });
    expect(spec.target).toEqual({ kind: 'project', reference: 'anima' });
  });

  test('fail-closed: caminho fora dos limites é rejeitado (sem ampliar included_scope)', async () => {
    for (const bad of ['../secret.txt', '/etc/passwd', 'node_modules/x.js', '.env', 'apps/.git/config', 'k.pem']) {
      const result = await planExecutableProjectWork('faça', base, fakePlanner(validArgs({ included_scope: [bad] })));
      expect(result.ok).toBe(false);
    }
  });

  test('fail-closed: comando de validação fora da allowlist é rejeitado', async () => {
    for (const cmd of ['rm -rf /', 'npm run deploy', 'node script.js', 'npm test && curl evil']) {
      const result = await planExecutableProjectWork('faça', base, fakePlanner(validArgs({ validation_command: cmd })));
      expect(result.ok).toBe(false);
    }
  });

  test('falha do planejador propaga fail-closed', async () => {
    const failing: ProjectWorkPlanner = { id: 'x', proposeArguments: async () => ({ ok: false, message: 'modelo indisponível' }) };
    const result = await planExecutableProjectWork('faça', base, failing);
    expect(result).toEqual({ ok: false, message: 'modelo indisponível' });
  });
});
describe('replanejamento de correção de proposta', () => {
  test('feedback humano gera proposta substituta em vez de ser anexado mecanicamente ao escopo', async () => {
    let receivedMessage = '';

    const planner: ProjectWorkPlanner = {
      id: 'revision_fake_v1',
      proposeArguments: async message => {
        receivedMessage = message;
        return { ok: true, rawArguments: validArgs() };
      },
    };

    const item: WorkItem = {
      id: 'item-1',
      userId: 'user-1',
      sourceMessageId: base.sourceMessageId,
      state: 'proposed',
      impactLevel: base.impactLevel,
      capability: base.capability,
      originalRequest: 'adicione diagnóstico do planner',
      intent: base.intent,
      proposal: {
        schemaVersion: 1,
        data: {
          ...base.proposal.data,
          includedScope: ['arquivo-antigo.ts'],
          objective: 'objetivo antigo',
        },
      },
      proposalVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await planExecutableProjectWorkRevision(
      item,
      '  use somente o menor escopo correto  ',
      planner,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(receivedMessage).toContain('adicione diagnóstico do planner');
    expect(receivedMessage).toContain('arquivo-antigo.ts');
    expect(receivedMessage).toContain('use somente o menor escopo correto');

    expect(result.revision.requestedChanges).toBe(
      'use somente o menor escopo correto',
    );
    expect(result.revision.proposal.data.objective).toBe('Objetivo claro');
    expect(result.revision.proposal.data.includedScope).toEqual([
      'apps/web/lib/ai/project-work-planner.ts',
    ]);
    expect(result.revision.proposal.data.includedScope).not.toContain(
      'use somente o menor escopo correto',
    );
    expect(result.revision.intent).toMatchObject({
      planner: 'revision_fake_v1',
      revision_feedback: 'use somente o menor escopo correto',
      execution_spec: {
        target: { kind: 'project', reference: 'anima' },
        executor: 'worktree',
      },
    });
  });

  test('feedback vazio falha antes de chamar o planner', async () => {
    let called = false;

    const planner: ProjectWorkPlanner = {
      id: 'should_not_run',
      proposeArguments: async () => {
        called = true;
        return { ok: true, rawArguments: validArgs() };
      },
    };

    const item: WorkItem = {
      id: 'item-1',
      userId: 'user-1',
      sourceMessageId: base.sourceMessageId,
      state: 'proposed',
      impactLevel: base.impactLevel,
      capability: base.capability,
      originalRequest: 'pedido',
      intent: base.intent,
      proposal: base.proposal,
      proposalVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await planExecutableProjectWorkRevision(item, '   ', planner);

    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });
});
