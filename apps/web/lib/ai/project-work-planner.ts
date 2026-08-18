import type { CreateWorkProposalCommand } from '@anima/core';
import { executeProjectTool, OPENAI_PROJECT_TOOLS } from './project-tools';
import { readAuthorizedBaseSha } from '@/lib/work-orchestration/executor-selection';
import { resolveConfiguredCoderBackend } from '@/lib/work-orchestration/coder-backend';

const PLANNER_TOOL_CALL_LIMIT = 24;
const FORCE_SUBMISSION_AFTER_EVIDENCE = 8;

function timeoutSignal(milliseconds: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  (timer as NodeJS.Timeout).unref?.();
  return controller.signal;
}

type PlannerArguments = {
  summary: string;
  objective: string;
  included_scope: string[];
  excluded_scope: string[];
  expected_effects: string[];
  risks: string[];
  validation_label: string;
  validation_command: string;
};

type OutputItem = {
  type?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  content?: Array<{ type?: string; text?: string }>;
};

type OpenAIResponse = {
  output?: OutputItem[];
  error?: { message?: string };
};

export type ProjectWorkPlanningResult =
  | { ok: true; command: CreateWorkProposalCommand }
  | { ok: false; message: string };

const SUBMIT_TOOL = {
  type: 'function',
  name: 'submit_project_work_proposal',
  description: 'Entrega uma proposta executável somente depois de investigar o repositório. Cada item de included_scope deve ser um caminho relativo exato de arquivo que poderá ser criado ou alterado.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      objective: { type: 'string' },
      included_scope: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 12 },
      excluded_scope: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 12 },
      expected_effects: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 8 },
      risks: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 8 },
      validation_label: { type: 'string' },
      validation_command: { type: 'string', description: 'Um único comando npm de teste, typecheck ou build.' },
    },
    required: ['summary', 'objective', 'included_scope', 'excluded_scope', 'expected_effects', 'risks', 'validation_label', 'validation_command'],
    additionalProperties: false,
  },
} as const;

const nonBlank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const textList = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.every(nonBlank);

const safePath = (value: string): boolean => {
  const normalized = value.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return false;
  const segments = normalized.toLowerCase().split('/');
  return !segments.includes('..')
    && !segments.includes('.git')
    && !segments.includes('node_modules')
    && !segments.includes('.next')
    && !segments.includes('.worktrees')
    && !segments.some(segment => segment === '.env' || segment.startsWith('.env.'))
    && !/\.(?:pem|key|p12|pfx)$/i.test(normalized);
};

const safeValidationCommand = (value: string): boolean =>
  /^npm(?:\.cmd)? (?:run (?:typecheck|test|build)(?: -- [\w./()\\:-]+)*|test(?: -- [\w./()\\:*?-]+)*)$/i.test(value.trim());

function parseProposal(raw: string): PlannerArguments | null {
  try {
    const value = JSON.parse(raw) as Partial<PlannerArguments>;
    if (!nonBlank(value.summary) || !nonBlank(value.objective) || !textList(value.included_scope)
      || !textList(value.excluded_scope) || !textList(value.expected_effects) || !textList(value.risks)
      || !nonBlank(value.validation_label) || !nonBlank(value.validation_command)) return null;
    if (value.included_scope.length > 12 || !value.included_scope.every(safePath) || !safeValidationCommand(value.validation_command)) return null;
    return value as PlannerArguments;
  } catch {
    return null;
  }
}

export async function planExecutableProjectWork(
  message: string,
  base: CreateWorkProposalCommand,
): Promise<ProjectWorkPlanningResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, message: 'A chave da OpenAI não está configurada.' };
  const model = process.env.OPENAI_MODEL ?? 'gpt-5.6-terra';
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  let input: unknown[] = [{
    role: 'user',
    content: `Prepare uma proposta executável para este pedido:\n\n${message}\n\nInvestigue primeiro o repositório com as ferramentas locais. Leia AGENTS.md e os arquivos relevantes. Não altere nada. O alvo será fixado pelo servidor como anima. Escolha somente caminhos exatos de arquivos necessários. O comando de validação deve ser um único npm test, npm run typecheck, npm run test ou npm run build. Quando houver informação suficiente, chame submit_project_work_proposal.`,
  }];
  let localEvidenceCalls = 0;
  let totalCalls = 0;

  while (totalCalls <= PLANNER_TOOL_CALL_LIMIT) {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: timeoutSignal(90_000),
      headers,
      body: JSON.stringify({
        model,
        store: false,
        stream: false,
        instructions: 'Você é a capacidade interna de planejamento técnico do Anima. Produza uma proposta pequena, concreta, verificável e compatível com as regras encontradas no repositório. Nunca alegue execução. A aprovação e a execução ocorrerão depois, por contratos locais.',
        input,
        tools: [...OPENAI_PROJECT_TOOLS, SUBMIT_TOOL],
        tool_choice: localEvidenceCalls >= FORCE_SUBMISSION_AFTER_EVIDENCE
          ? { type: 'function', name: SUBMIT_TOOL.name }
          : 'auto',
      }),
    }).catch(() => null);

    if (!response?.ok) {
      const details = response ? await response.json().catch(() => null) as OpenAIResponse | null : null;
      return { ok: false, message: details?.error?.message ?? 'Não foi possível planejar o trabalho com a OpenAI.' };
    }
    const body = await response.json() as OpenAIResponse;
    const output = body.output ?? [];
    const calls = output.filter((item): item is OutputItem & { call_id: string; name: string; arguments: string } =>
      item.type === 'function_call' && nonBlank(item.call_id) && nonBlank(item.name) && typeof item.arguments === 'string');
    if (calls.length === 0) return { ok: false, message: 'O GPT não produziu uma proposta estruturada.' };

    totalCalls += calls.length;
    if (totalCalls > PLANNER_TOOL_CALL_LIMIT) return { ok: false, message: 'O planejamento excedeu o limite de consultas locais.' };

    const submitted = calls.find(call => call.name === SUBMIT_TOOL.name);
    if (submitted && localEvidenceCalls > 0) {
      const proposal = parseProposal(submitted.arguments);
      if (!proposal) return { ok: false, message: 'O GPT produziu uma proposta fora dos limites locais permitidos.' };
      // Captura e persiste o SHA-base autorizado no momento da proposta. A
      // execução criará a worktree exatamente deste SHA, nunca do HEAD futuro.
      const baseSha = await readAuthorizedBaseSha();
      if (!baseSha) return { ok: false, message: 'Não foi possível capturar o SHA-base autorizado do repositório.' };
      return {
        ok: true,
        command: {
          ...base,
          capability: 'programming',
          intent: {
            ...base.intent,
            planner: 'openai_project_tools_v1',
            execution_spec: {
              schema_version: 1,
              target: { kind: 'project', reference: 'anima' },
              // Executor e backend persistidos no contrato (ADR-001): project:anima
              // usa a worktree isolada com o backend de código local selecionável.
              executor: 'worktree',
              // Backend de código = config de DEPLOY (ANIMA_WORKTREE_CODER_BACKEND),
              // não escolha por-proposta do usuário. Default 'ollama' (Harness não é default).
              coder_backend: resolveConfiguredCoderBackend(),
              model: process.env.ANIMA_WORKTREE_CODER_MODEL ?? 'qwen3-coder:latest',
              base_sha: baseSha,
              permissions: ['workspace_read', 'workspace_write_isolated'],
              validation_criteria: [{ label: proposal.validation_label, command: proposal.validation_command }],
              limits: { max_attempts: 3, max_duration_minutes: 30 },
            },
          },
          proposal: {
            schemaVersion: 1,
            data: {
              summary: proposal.summary,
              objective: proposal.objective,
              includedScope: proposal.included_scope,
              excludedScope: proposal.excluded_scope,
              expectedEffects: proposal.expected_effects,
              risks: proposal.risks,
            },
          },
        },
      };
    }

    const toolOutputs = await Promise.all(calls.map(async call => {
      if (call.name === SUBMIT_TOOL.name) {
        return { type: 'function_call_output', call_id: call.call_id, output: JSON.stringify({ ok: false, error: 'Investigue o repositório antes de enviar a proposta.' }) };
      }
      localEvidenceCalls += 1;
      return { type: 'function_call_output', call_id: call.call_id, output: await executeProjectTool(call.name, call.arguments) };
    }));
    input = [...input, ...output, ...toolOutputs];
  }
  return { ok: false, message: 'O planejamento não chegou a uma proposta terminal.' };
}
