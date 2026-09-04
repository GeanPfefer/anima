import { executeProjectTool, OPENAI_PROJECT_TOOLS } from './project-tools';
import {
  fetchAdmittedOpenAIResponses,
  OpenAIAdmissionDenied,
  type OpenAIAdmissionControl,
} from './openai-paid-transport';
import {
  buildPlannerUserPrompt,
  FORCE_SUBMISSION_AFTER_EVIDENCE,
  includedScopeAnchoredInProject,
  nonBlank,
  parseProposal,
  PLANNER_SYSTEM_INSTRUCTIONS,
  PLANNER_TOOL_CALL_LIMIT,
  SUBMIT_TOOL_NAME,
  SUBMIT_TOOL_RESPONSES,
  timeoutSignal,
  type ProjectWorkPlanner,
  type PlannerProposalResult,
} from './project-work-planner-shared';

// ============================================================
// Planejador OpenAI (Responses API + tools de investigação read-only). Toda ida ao
// provider passa pela BORDA FINANCEIRA ÚNICA (`fetchAdmittedOpenAIResponses`): a
// admissão roda antes do fetch e a chave/URL vivem só na borda. Uma recusa de
// admissão (`OpenAIAdmissionDenied`) PROPAGA — o orquestrador (`project-work-planner`)
// cai no planejador LOCAL, nunca numa chamada paga silenciosa. Produz apenas os
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
  /** Admissão financeira OBRIGATÓRIA (borda única). Sem autoridade, `admit` recusa
   * e a recusa propaga para o orquestrador cair no planejador local. */
  readonly admission: OpenAIAdmissionControl;
  /** Dono da chamada, carregado no envelope. Interativo: amarra o usuário. */
  readonly userId?: string;
  readonly fetchImpl?: typeof fetch;
  readonly executeTool?: (name: string, rawArguments: string) => Promise<string>;
  /** Chave explícita só para teste determinístico; produção lê do env NA BORDA. */
  readonly apiKey?: string;
  readonly model?: string;
}

export class OpenAIProjectWorkPlanner implements ProjectWorkPlanner {
  readonly id = 'openai_project_tools_v1';
  private readonly fetchImpl: typeof fetch;
  private readonly executeTool: (name: string, rawArguments: string) => Promise<string>;

  constructor(private readonly deps: OpenAIPlannerDeps) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.executeTool = deps.executeTool ?? executeProjectTool;
  }

  async proposeArguments(message: string): Promise<PlannerProposalResult> {
    const model = this.deps.model ?? process.env.OPENAI_MODEL ?? 'gpt-5.6-terra';
    const intent = { consumer: 'planner' as const, userId: this.deps.userId ?? 'unknown', model };

    let input: unknown[] = [{ role: 'user', content: buildPlannerUserPrompt(message) }];
    let localEvidenceCalls = 0;
    let totalCalls = 0;

    while (totalCalls <= PLANNER_TOOL_CALL_LIMIT) {
      let response: Response | null;
      try {
        ({ response } = await fetchAdmittedOpenAIResponses({
          admission: this.deps.admission,
          intent,
          body: {
            model,
            store: false,
            stream: false,
            instructions: PLANNER_SYSTEM_INSTRUCTIONS,
            input,
            tools: [...OPENAI_PROJECT_TOOLS, SUBMIT_TOOL_RESPONSES],
            tool_choice: localEvidenceCalls >= FORCE_SUBMISSION_AFTER_EVIDENCE
              ? { type: 'function', name: SUBMIT_TOOL_NAME }
              : 'auto',
          },
          signal: timeoutSignal(90_000),
          fetchImpl: this.fetchImpl,
          ...(this.deps.apiKey !== undefined ? { apiKey: this.deps.apiKey } : {}),
        }));
      } catch (error) {
        // Recusa de admissão paga PROPAGA: o orquestrador cai no planejador local.
        if (error instanceof OpenAIAdmissionDenied) throw error;
        response = null;
      }

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
        const parsed = parseProposal(submitted.arguments);

        if (parsed && includedScopeAnchoredInProject(parsed.included_scope)) {
          return { ok: true, rawArguments: submitted.arguments };
        }
      }

      const toolOutputs = await Promise.all(calls.map(async call => {
        if (call.name === SUBMIT_TOOL_NAME) {
          return {
            type: 'function_call_output',
            call_id: call.call_id,
            output: JSON.stringify({
              ok: false,
              error: localEvidenceCalls > 0
                ? 'O included_scope não está ancorado na topologia real do repositório. Investigue os caminhos e submeta novamente.'
                : 'Investigue o repositório antes de enviar a proposta.',
            }),
          };
        }

        const output = await this.executeTool(call.name, call.arguments);

        try {
          const parsedOutput = JSON.parse(output) as { ok?: unknown };
          if (parsedOutput.ok === true) localEvidenceCalls += 1;
        } catch {
          // Saída inválida nunca conta como evidência.
        }

        return {
          type: 'function_call_output',
          call_id: call.call_id,
          output,
        };
      }));
      input = [...input, ...output, ...toolOutputs];
    }
    return { ok: false, message: 'O planejamento não chegou a uma proposta terminal.' };
  }
}
