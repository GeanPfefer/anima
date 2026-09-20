/** @jest-environment node */
// Proveniência de provider na correção interativa de propostas. A rota deve herdar
// a MESMA autoridade de provider do turno de criação (o seletor GPT × Local do Chat
// Dev), sem default de deploy e sem fallback silencioso. Usamos a factory REAL
// (`createChatProjectPlanner`) para provar o TIPO de planner injetado, espiando as
// chamadas; só `planExecutableProjectWorkRevision` é substituído (não queremos rodar
// o planejamento nem qualquer ida a provider).
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/work-orchestration/server', () => ({ createWorkOrchestrationService: jest.fn() }));
jest.mock('@/lib/ai/project-work-planner', () => {
  const actual = jest.requireActual('@/lib/ai/project-work-planner');
  return {
    ...actual,
    createChatProjectPlanner: jest.fn(actual.createChatProjectPlanner),
    planExecutableProjectWorkRevision: jest.fn(),
  };
});

import { createClient } from '@/lib/supabase/server';
import { createWorkOrchestrationService } from '@/lib/work-orchestration/server';
import {
  AdmissionGatedOpenAIPlanner,
  LocalOllamaProjectWorkPlanner,
  createChatProjectPlanner,
  planExecutableProjectWorkRevision,
} from '@/lib/ai/project-work-planner';
import { POST } from './route';

const OWNER = 'owner-1';
const WORK_ITEM_ID = '0898a0c2-80ec-4b4d-a7a3-9fd5239268f9';

const request = (body: Record<string, unknown>) =>
  ({ json: async () => body }) as unknown as Request;

const revisedItem = () => ({
  id: WORK_ITEM_ID,
  userId: OWNER,
  sourceMessageId: 'message-1',
  state: 'proposed',
  impactLevel: 'significant',
  capability: 'programming',
  originalRequest: 'pedido original',
  intent: {},
  proposal: { schemaVersion: 1, data: { summary: 's', objective: 'o', includedScope: [], excludedScope: [], expectedEffects: [], risks: [] } },
  proposalVersion: 2,
  createdAt: new Date('2026-09-19T00:00:00Z'),
  updatedAt: new Date('2026-09-19T00:00:00Z'),
});

const requestProposalRevision = jest.fn();
const getItem = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (createClient as jest.Mock).mockResolvedValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: OWNER } } }) },
  });
  (createWorkOrchestrationService as jest.Mock).mockReturnValue({ getItem, requestProposalRevision });
  getItem.mockResolvedValue({ ok: true, value: revisedItem() });
  requestProposalRevision.mockResolvedValue({ ok: true, value: revisedItem() });
  (planExecutableProjectWorkRevision as jest.Mock).mockResolvedValue({
    ok: true,
    revision: {
      requestedChanges: 'reduza o escopo',
      intent: { revision_feedback: 'reduza o escopo' },
      proposal: { schemaVersion: 1, data: { summary: 's', objective: 'o', includedScope: [], excludedScope: [], expectedEffects: [], risks: [] } },
    },
  });
});

const validBody = (over: Record<string, unknown> = {}) => ({
  workItemId: WORK_ITEM_ID,
  expectedProposalVersion: 2,
  requestedChanges: 'reduza o escopo',
  ...over,
});

describe('proposal-corrections — proveniência do provider interativo', () => {
  test('provider=ollama injeta o planejador LOCAL com o user.id real', async () => {
    const response = await POST(request(validBody({ provider: 'ollama' })));
    expect(response.status).toBe(200);
    expect(createChatProjectPlanner).toHaveBeenCalledWith('ollama', OWNER);
    const injectedPlanner = (planExecutableProjectWorkRevision as jest.Mock).mock.calls[0][2];
    expect(injectedPlanner).toBeInstanceOf(LocalOllamaProjectWorkPlanner);
    expect(requestProposalRevision).toHaveBeenCalledTimes(1);
  });

  test('provider=openai injeta o planejador OpenAI (admissão interativa) com o user.id real', async () => {
    const response = await POST(request(validBody({ provider: 'openai' })));
    expect(response.status).toBe(200);
    expect(createChatProjectPlanner).toHaveBeenCalledWith('openai', OWNER);
    const injectedPlanner = (planExecutableProjectWorkRevision as jest.Mock).mock.calls[0][2];
    // AdmissionGatedOpenAIPlanner NÃO carrega fallback local por construção: uma
    // recusa de admissão falha no próprio OpenAI, nunca troca para o modelo local.
    expect(injectedPlanner).toBeInstanceOf(AdmissionGatedOpenAIPlanner);
    expect(requestProposalRevision).toHaveBeenCalledTimes(1);
  });

  test('provider ausente falha fechado como input incompleto e NÃO cria planner (sem OpenAI)', async () => {
    const response = await POST(request(validBody()));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(createChatProjectPlanner).not.toHaveBeenCalled();
    expect(planExecutableProjectWorkRevision).not.toHaveBeenCalled();
    // Nem o serviço de trabalho é tocado: rejeição no gate de entrada.
    expect(createWorkOrchestrationService).not.toHaveBeenCalled();
  });

  test('provider inválido falha fechado e NÃO cria planner', async () => {
    const response = await POST(request(validBody({ provider: 'gpt' })));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(createChatProjectPlanner).not.toHaveBeenCalled();
    expect(planExecutableProjectWorkRevision).not.toHaveBeenCalled();
  });

  test('sem autenticação não planeja nem toca no provider', async () => {
    (createClient as jest.Mock).mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) },
    });
    const response = await POST(request(validBody({ provider: 'ollama' })));
    expect(response.status).toBe(401);
    expect(createChatProjectPlanner).not.toHaveBeenCalled();
    expect(planExecutableProjectWorkRevision).not.toHaveBeenCalled();
  });

  test('falha de planejamento propaga sem criar revisão (sem aprovação/attempt)', async () => {
    (planExecutableProjectWorkRevision as jest.Mock).mockResolvedValue({ ok: false, message: 'modelo indisponível' });
    const response = await POST(request(validBody({ provider: 'ollama' })));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: { code: 'project_planning_failed', message: 'modelo indisponível' } });
    expect(requestProposalRevision).not.toHaveBeenCalled();
  });
});
