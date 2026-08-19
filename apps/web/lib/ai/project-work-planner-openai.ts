import { executeProjectTool, OPENAI_PROJECT_TOOLS } from './project-tools';
import {
  buildPlannerUserPrompt,
  FORCE_SUBMISSION_AFTER_EVIDENCE,
  nonBlank,
  PLANNER_SYSTEM_INSTRUCTIONS,
  PLANNER_TOOL_CALL_LIMIT,
  SUBMIT_TOOL_NAME,
  SUBMIT_TOOL_RESPONSES,
  timeoutSignal,
  type ProjectWorkPlanner,
  type PlannerProposalResult,
} from './project-work-planner-shared';

// ============================================================
// Planejador OpenAI (Responses API + tools de investigação read-only). Extraído
// sem mudança de comportamento do planejador original. Produz somente os
// ARGUMENTOS BRUTOS do submit; o host valida e monta o execution_spec.
// ============================================================

type OutputItem = {
  type?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  content?: Array<{ type?: string; text?: string }>;
};
type OpenAIResponse = { output?: OutputItem[]; error?: { message?: string } };

export interface OpenAIPlannerDeps {
  readonly fetchImpl?: typeof fetch;
  readonly executeTool?: (name: string, rawArguments: string) => Promise<string>;
  readonly apiKey?: string;
  readonly model?: string;
}

export class OpenAIProjectWorkPlanner implements ProjectWorkPlanner {
  readonly id = 'openai_project_tools_v1';
  private readonly fetchImpl: typeof fetch;
  private readonly executeTool: (name: string, rawArguments: string) => Promise<string>;

  constructor(private readonly deps: OpenAIPlannerDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.executeTool = deps.executeTool ?? executeProjectTool;
  }

  async proposeArguments(message: string): Promise<PlannerProposalResult> {
    const apiKey = this.deps.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) return { ok: false, message: 'A chave da OpenAI não está configurada.' };
    const model = this.deps.model ?? process.env.OPENAI_MODEL ?? 'gpt-5.6-terra';
    const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

    let input: unknown[] = [{ role: 'user', content: buildPlannerUserPrompt(message) }];
    let localEvidenceCalls = 0;
    let totalCalls = 0;

    while (totalCalls <= PLANNER_TOOL_CALL_LIMIT) {
      const response = await this.fetchImpl('https://api.openai.com/v1/responses', {
        method: 'POST',
        signal: timeoutSignal(90_000),
        headers,
        body: JSON.stringify({
          model,
          store: false,
          stream: false,
          instructions: PLANNER_SYSTEM_INSTRUCTIONS,
          input,
          tools: [...OPENAI_PROJECT_TOOLS, SUBMIT_TOOL_RESPONSES],
          tool_choice: localEvidenceCalls >= FORCE_SUBMISSION_AFTER_EVIDENCE
            ? { type: 'function', name: SUBMIT_TOOL_NAME }
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

      const submitted = calls.find(call => call.name === SUBMIT_TOOL_NAME);
      if (submitted && localEvidenceCalls > 0) {
        return { ok: true, rawArguments: submitted.arguments };
      }

      const toolOutputs = await Promise.all(calls.map(async call => {
        if (call.name === SUBMIT_TOOL_NAME) {
          return { type: 'function_call_output', call_id: call.call_id, output: JSON.stringify({ ok: false, error: 'Investigue o repositório antes de enviar a proposta.' }) };
        }
        localEvidenceCalls += 1;
        return { type: 'function_call_output', call_id: call.call_id, output: await this.executeTool(call.name, call.arguments) };
      }));
      input = [...input, ...output, ...toolOutputs];
    }
    return { ok: false, message: 'O planejamento não chegou a uma proposta terminal.' };
  }
}
