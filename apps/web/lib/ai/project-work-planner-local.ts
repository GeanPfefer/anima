import { executeProjectTool } from './project-tools';
import {
  buildPlannerUserPrompt,
  coercePlannerArrayFields,
  includedScopeAnchoredInProject,
  parseProposal,
  PLANNER_CHAT_TOOLS,
  PLANNER_SYSTEM_INSTRUCTIONS,
  PLANNER_TOOL_CALL_LIMIT,
  SUBMIT_CHAT_TOOL,
  SUBMIT_TOOL_NAME,
  timeoutSignal,
  type ProjectWorkPlanner,
  type PlannerProposalResult,
} from './project-work-planner-shared';

// ============================================================
// Planejador LOCAL (Ollama, OpenAI-compat /v1/chat/completions). Mesmo contrato
// da porta: investiga com as ferramentas READ-ONLY e devolve os ARGUMENTOS BRUTOS
// do submit. NÃO edita arquivos, NÃO usa subprocesso/worktree, NÃO recebe nenhuma
// credencial de nuvem — o único endpoint é o Ollama local (sem Authorization). O
// host valida e monta o execution_spec depois, com a MESMA autoridade de sempre.
//
// Segredos: a requisição carrega apenas as instruções, a mensagem do usuário e as
// saídas das ferramentas read-only (dados não sensíveis do repo). Nenhuma variável
// de ambiente secreta (OPENAI_API_KEY/DEEPSEEK_API_KEY/etc.) é lida ou enviada.
// ============================================================

type ChatToolCall = { id?: string; type?: string; function?: { name?: string; arguments?: unknown } };
type ChatMessage = { role: string; content?: string | null; tool_calls?: ChatToolCall[]; tool_call_id?: string };
type ChatResponse = { choices?: Array<{ message?: ChatMessage }>; error?: { message?: string } };

const argString = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value ?? {});

export interface LocalPlannerDeps {
  readonly fetchImpl?: typeof fetch;
  readonly executeTool?: (name: string, rawArguments: string) => Promise<string>;
  readonly baseUrl?: string;
  readonly model?: string;
  /** Limite de TURNOS (rodadas de chat) — barreira dura contra loop do modelo. */
  readonly maxTurns?: number;
  /** Após N chamadas de evidência, força o submit (tools = só submit). O modelo
   * local tende a sobre-investigar; forçar mais cedo é mais confiável e barato. */
  readonly forceAfterEvidence?: number;
}

export class LocalOllamaProjectWorkPlanner implements ProjectWorkPlanner {
  readonly id = 'local_ollama_project_tools_v1';
  private readonly fetchImpl: typeof fetch;
  private readonly executeTool: (name: string, rawArguments: string) => Promise<string>;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly maxTurns: number;
  private readonly forceAfterEvidence: number;

  constructor(deps: LocalPlannerDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.executeTool = deps.executeTool ?? executeProjectTool;
    this.baseUrl = (deps.baseUrl ?? process.env.OLLAMA_URL ?? 'http://localhost:11434').replace(/\/+$/, '');
    this.model = deps.model ?? process.env.ANIMA_PROJECT_PLANNER_MODEL ?? 'qwen3-coder:latest';
    this.maxTurns = deps.maxTurns ?? 16;
    this.forceAfterEvidence = deps.forceAfterEvidence ?? 4;
  }

  async proposeArguments(message: string): Promise<PlannerProposalResult> {
    const messages: ChatMessage[] = [
      { role: 'system', content: PLANNER_SYSTEM_INSTRUCTIONS },
      { role: 'user', content: buildPlannerUserPrompt(message) },
    ];
    let evidenceCalls = 0;
    let totalCalls = 0;
    let noProgress = 0;
    let directedToSubmit = false;

    for (let turn = 0; turn < this.maxTurns; turn += 1) {
      const forceSubmit = evidenceCalls >= this.forceAfterEvidence;
      // Ao forçar, RETIRAMOS as ferramentas de investigação: o modelo só pode chamar
      // submit. Mais robusto que tool_choice (o Ollama nem sempre o honra) e evita o
      // loop de investigação infinita observado ao vivo com o qwen3-coder.
      if (forceSubmit && !directedToSubmit) {
        messages.push({
          role: 'user',
          content: 'Você já reuniu evidência suficiente. Pare de investigar e chame AGORA submit_project_work_proposal com todos os campos exigidos (summary, objective, included_scope, excluded_scope, expected_effects, risks, validation_label, validation_command).',
        });
        directedToSubmit = true;
      }
      let response: Response | null = null;
      let transportFailure: unknown = null;
      try {
        response = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
          method: 'POST',
          signal: timeoutSignal(90_000),
          // SEM Authorization: o endpoint é o Ollama local; nenhum segredo é enviado.
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.model,
            stream: false,
            temperature: 0,
            messages,
            tools: forceSubmit ? [SUBMIT_CHAT_TOOL] : PLANNER_CHAT_TOOLS,
            tool_choice: forceSubmit
              ? { type: 'function', function: { name: SUBMIT_TOOL_NAME } }
              : 'auto',
          }),
        });
      } catch (error) {
        transportFailure = error;
      }

      if (!response?.ok) {
        if (transportFailure) {
          const name = transportFailure instanceof Error ? transportFailure.name : '';
          const timedOut = name === 'AbortError' || name === 'TimeoutError';
          return {
            ok: false,
            message: timedOut
              ? 'O planejador local excedeu o tempo limite de 90 segundos em uma rodada do modelo.'
              : 'Não foi possível comunicar com o modelo local durante o planejamento.',
          };
        }
        const details = response ? await response.json().catch(() => null) as ChatResponse | null : null;
        return { ok: false, message: details?.error?.message ?? 'O modelo local recusou a requisição de planejamento sem fornecer detalhes.' };
      }
      const body = await response.json() as ChatResponse;
      const assistant = body.choices?.[0]?.message;
      if (!assistant) return { ok: false, message: 'O modelo local não retornou uma resposta utilizável.' };

      const toolCalls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : [];
      if (toolCalls.length === 0) {
        // Sem tool call: o modelo conversou. Cutuca para submeter (se já investigou)
        // ou para investigar; fail-closed se não progredir.
        noProgress += 1;
        if (noProgress > 2) return { ok: false, message: 'O modelo local não produziu uma proposta estruturada.' };
        messages.push({ role: 'assistant', content: assistant.content ?? '' });
        messages.push({
          role: 'user',
          content: evidenceCalls > 0
            ? 'Chame agora a ferramenta submit_project_work_proposal com todos os campos exigidos (summary, objective, included_scope, excluded_scope, expected_effects, risks, validation_label, validation_command).'
            : 'Use as ferramentas read-only para investigar o repositório e depois chame submit_project_work_proposal.',
        });
        continue;
      }

      totalCalls += toolCalls.length;
      if (totalCalls > PLANNER_TOOL_CALL_LIMIT) return { ok: false, message: 'O planejamento local excedeu o limite de consultas.' };

      const submitted = toolCalls.find(call => call.function?.name === SUBMIT_TOOL_NAME);
      if (submitted && evidenceCalls > 0) {
        // Normaliza o quirk escalar→lista e valida a proposta ainda no adapter local.
        // O host autoritativo revalida depois em planExecutableProjectWork.
        const rawArguments = coercePlannerArrayFields(argString(submitted.function?.arguments));
        const parsed = parseProposal(rawArguments);

        if (parsed && includedScopeAnchoredInProject(parsed.included_scope)) {
          return { ok: true, rawArguments };
        }

        // Mantém a conversa viva: o modelo precisa investigar/corrigir o escopo
        // em vez de transformar caminhos inventados em proposta executável.
        messages.push({
          role: 'assistant',
          content: assistant.content ?? '',
          tool_calls: toolCalls.map((call, index) => ({
            id: call.id ?? `call_${turn}_${index}`,
            type: 'function',
            function: {
              name: call.function?.name,
              arguments: argString(call.function?.arguments),
            },
          })),
        });
        messages.push({
          role: 'tool',
          tool_call_id: submitted.id ?? `call_${turn}_submit`,
          content: JSON.stringify({
            ok: false,
            error: 'O included_scope não está ancorado na topologia real do repositório. Investigue os caminhos e submeta novamente.',
          }),
        });
        noProgress = 0;
        continue;
      }

      // Espelha o turno do assistente e responde CADA tool call (o protocolo exige
      // um `tool` por `tool_call_id`), senão a próxima rodada fica incoerente.
      const echoed: ChatToolCall[] = toolCalls.map((call, index) => ({
        id: call.id ?? `call_${turn}_${index}`,
        type: 'function',
        function: { name: call.function?.name, arguments: argString(call.function?.arguments) },
      }));
      messages.push({ role: 'assistant', content: assistant.content ?? '', tool_calls: echoed });

      for (const [index, call] of toolCalls.entries()) {
        const id = echoed[index]!.id!;
        const name = call.function?.name ?? '';
        if (name === SUBMIT_TOOL_NAME) {
          messages.push({ role: 'tool', tool_call_id: id, content: JSON.stringify({ ok: false, error: 'Investigue o repositório antes de enviar a proposta.' }) });
          continue;
        }
        const output = await this.executeTool(name, argString(call.function?.arguments));

        try {
          const parsedOutput = JSON.parse(output) as { ok?: unknown };
          if (parsedOutput.ok === true) evidenceCalls += 1;
        } catch {
          // Saída de tool inválida nunca conta como evidência.
        }

        messages.push({ role: 'tool', tool_call_id: id, content: output });
      }
      noProgress = 0;
    }
    return { ok: false, message: 'O planejamento local não chegou a uma proposta terminal.' };
  }
}
