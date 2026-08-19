/** @jest-environment node */
import type { CreateWorkProposalCommand } from '@anima/core';
import {
  planExecutableProjectWork,
  resolveConfiguredProjectPlannerProvider,
  createConfiguredProjectPlanner,
  shouldRunProjectPlanner,
  OpenAIProjectWorkPlanner,
  LocalOllamaProjectWorkPlanner,
  type ProjectWorkPlanner,
} from './project-work-planner';

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
