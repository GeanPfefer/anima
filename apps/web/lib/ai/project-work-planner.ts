import type { CreateWorkProposalCommand, RequestProposalRevisionCommand, WorkItem } from '@anima/core';
import { readAuthorizedBaseSha } from '@/lib/work-orchestration/executor-selection';
import { resolveConfiguredCoderBackend } from '@/lib/work-orchestration/coder-backend';
import { parseProposal, scopeTestCommandToWorkspace, type PlannerProposalResult, type ProjectWorkPlanner } from './project-work-planner-shared';
import { OpenAIProjectWorkPlanner } from './project-work-planner-openai';
import { LocalOllamaProjectWorkPlanner } from './project-work-planner-local';
import { OpenAIAdmissionDenied } from './openai-paid-transport';
import { createInteractiveOpenAIAdmission } from './openai-interactive-admission';

// ============================================================
// Orquestrador do planejamento de trabalho de projeto. AUTORIDADE DO HOST: dado o
// resultado do planejador (provider-específico), o host VALIDA (parseProposal →
// safePath/safeValidationCommand), CAPTURA o base_sha autorizado e MONTA o
// execution_spec (target/executor/coder_backend/model/permissions/limits). O
// planejador local NUNCA escolhe nem amplia nenhuma dessas autoridades.
// ============================================================

export type { ProjectWorkPlanner } from './project-work-planner-shared';
export { OpenAIProjectWorkPlanner } from './project-work-planner-openai';
export { LocalOllamaProjectWorkPlanner } from './project-work-planner-local';

export type ProjectWorkPlannerProvider = 'openai' | 'local';

export type ProjectWorkPlanningResult =
  | { ok: true; command: CreateWorkProposalCommand }
  | { ok: false; message: string };

/**
 * Provedor do PLANEJADOR por config de DEPLOY (`ANIMA_PROJECT_PLANNER_PROVIDER`),
 * espelhando `resolveConfiguredCoderBackend`. Default `openai` (o local NÃO é
 * default). Valor não reconhecido cai no default seguro.
 */
export function resolveConfiguredProjectPlannerProvider(
  env: Record<string, string | undefined> = process.env,
): ProjectWorkPlannerProvider {
  return env.ANIMA_PROJECT_PLANNER_PROVIDER?.trim() === 'local' ? 'local' : 'openai';
}

/**
 * O planejador deve rodar nesta requisição? Preserva o default de produção: com o
 * planejador OpenAI (default) o gatilho continua exigindo o provedor de chat
 * `openai` (comportamento histórico intacto). Com o planejador LOCAL configurado,
 * o planejamento roda na superfície de desenvolvimento independentemente do
 * provedor de chat — o modelo local não usa o caminho OpenAI. Puro e testável.
 */
export function shouldRunProjectPlanner(
  developmentMode: boolean,
  chatProvider: string,
  plannerProvider: ProjectWorkPlannerProvider = resolveConfiguredProjectPlannerProvider(),
): boolean {
  if (!developmentMode) return false;
  if (plannerProvider === 'local') return true;
  return chatProvider === 'openai';
}

/**
 * Planejador OpenAI com FALLBACK AUTOMÁTICO para o planejador local (política
 * auto-local). Tenta o caminho pago; se a admissão financeira recusar
 * (`OpenAIAdmissionDenied`) — hoje sempre, pois não há autoridade paga interativa —
 * usa o planejador local. Nunca é chamada paga silenciosa; se o local também não
 * puder operar, o erro observável do local sobe (bloqueio sem gasto). O `id` reflete
 * o planejador que REALMENTE produziu a proposta (proveniência honesta).
 */
export class AdmissionGatedOpenAIPlanner implements ProjectWorkPlanner {
  private lastId: string;
  constructor(
    private readonly openai: OpenAIProjectWorkPlanner,
    private readonly local: LocalOllamaProjectWorkPlanner,
  ) {
    this.lastId = openai.id;
  }
  get id(): string { return this.lastId; }
  async proposeArguments(message: string): Promise<PlannerProposalResult> {
    try {
      const result = await this.openai.proposeArguments(message);
      this.lastId = this.openai.id;
      return result;
    } catch (error) {
      if (error instanceof OpenAIAdmissionDenied) {
        console.info('[project-work-planner] OpenAI paga não admitida; usando planejador local', { reason: error.reason });
        this.lastId = this.local.id;
        return this.local.proposeArguments(message);
      }
      throw error;
    }
  }
}

/** Cria o planejador configurado. O provedor é config de deploy, nunca escolha
 * por-proposta do usuário. O caminho `openai` é sempre gated por admissão financeira
 * com fallback local. */
export function createConfiguredProjectPlanner(
  env: Record<string, string | undefined> = process.env,
): ProjectWorkPlanner {
  if (resolveConfiguredProjectPlannerProvider(env) === 'local') return new LocalOllamaProjectWorkPlanner();
  return new AdmissionGatedOpenAIPlanner(
    new OpenAIProjectWorkPlanner({ admission: createInteractiveOpenAIAdmission() }),
    new LocalOllamaProjectWorkPlanner(),
  );
}

/**
 * Planeja um trabalho executável a partir da mensagem do usuário. O `planner`
 * (injetável para teste) só produz os ARGUMENTOS BRUTOS; tudo abaixo é autoridade
 * do host e idêntico para qualquer provedor.
 */
export async function planExecutableProjectWork(
  message: string,
  base: CreateWorkProposalCommand,
  planner: ProjectWorkPlanner = createConfiguredProjectPlanner(),
): Promise<ProjectWorkPlanningResult> {
  const proposed = await planner.proposeArguments(message);
  if (!proposed.ok) return { ok: false, message: proposed.message };

  // VALIDAÇÃO HOST (fail-closed): escopo, paths e comando. O planejador não tem voz
  // aqui — argumentos fora dos limites são rejeitados, qualquer que seja o provedor.
  const proposal = parseProposal(proposed.rawArguments);
  if (!proposal) return { ok: false, message: 'O planejador produziu uma proposta fora dos limites locais permitidos.' };

  // Captura e persiste o SHA-base autorizado no momento da proposta. A execução
  // criará a worktree exatamente deste SHA, nunca do HEAD futuro. Autoridade do host.
  const baseSha = await readAuthorizedBaseSha();
  if (!baseSha) return { ok: false, message: 'Não foi possível capturar o SHA-base autorizado do repositório.' };

  return {
    ok: true,
    command: {
      ...base,
      capability: 'programming',
      intent: {
        ...base.intent,
        // Proveniência: qual planejador produziu a proposta (nunca concede autoridade).
        planner: planner.id,
        execution_spec: {
          schema_version: 1,
          target: { kind: 'project', reference: 'anima' },
          // Executor e backend persistidos pelo HOST (ADR-001): project:anima usa a
          // worktree isolada com o backend de código local selecionável por deploy.
          executor: 'worktree',
          coder_backend: resolveConfiguredCoderBackend(),
          model: process.env.ANIMA_WORKTREE_CODER_MODEL ?? 'qwen3-coder:latest',
          base_sha: baseSha,
          permissions: ['workspace_read', 'workspace_write_isolated'],
          // Autoridade do host: escopa um `npm test -- <arquivo>` ao workspace do
          // included_scope, senão o gate fana-out na raiz do monorepo e reprova por
          // "No tests found" em workspaces sem o arquivo (não afrouxa; só precisa).
          // O gate PRINCIPAL sempre existe; provas ADICIONAIS (quando o trabalho
          // exige múltiplas verificações independentes) viram critérios FORMAIS
          // separados — cada comando já foi validado na allowlist por parseProposal
          // e é escopado aqui igual ao principal. São N gates, nunca um `A && B`.
          // Sem additional_validations ⇒ exatamente um critério, como antes.
          validation_criteria: [
            {
              label: proposal.validation_label,
              command: scopeTestCommandToWorkspace(proposal.validation_command, proposal.included_scope),
              covers: proposal.validation_covers,
            },
            ...(proposal.additional_validations ?? []).map(validation => ({
              label: validation.label,
              command: scopeTestCommandToWorkspace(validation.command, proposal.included_scope),
              covers: validation.covers,
            })),
          ],
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
export type ProjectWorkRevisionPlanningResult =
  | {
      ok: true;
      revision: Pick<
        RequestProposalRevisionCommand,
        'requestedChanges' | 'intent' | 'proposal'
      >;
    }
  | { ok: false; message: string };

/**
 * Replaneja semanticamente uma proposta ainda não aprovada.
 *
 * O planner recebe o pedido original, a proposta vigente e o feedback humano,
 * mas continua sem autoridade sobre execução: planExecutableProjectWork reaplica
 * validação de paths/gates e reconstrói execution_spec/base_sha no host.
 */
export async function planExecutableProjectWorkRevision(
  item: WorkItem,
  requestedChanges: string,
  planner: ProjectWorkPlanner = createConfiguredProjectPlanner(),
): Promise<ProjectWorkRevisionPlanningResult> {
  const feedback = requestedChanges.trim();
  if (!feedback) {
    return { ok: false, message: 'A correção solicitada está vazia.' };
  }

  const planningMessage = [
    'Replaneje semanticamente o trabalho a partir das fontes autoritativas abaixo.',
    'Produza uma proposta COMPLETA substituta.',
    'Não reutilize fatos da proposta anterior: ela pode estar errada ou desatualizada.',
    'Investigue novamente o repositório real antes de afirmar paths, defaults ou comportamento existente.',
    '',
    'Pedido original:',
    item.originalRequest,
    '',
    'Correção mais recente solicitada pelo usuário:',
    feedback,
  ].join('\n');

  const planned = await planExecutableProjectWork(
    planningMessage,
    {
      sourceMessageId: item.sourceMessageId,
      impactLevel: item.impactLevel,
      capability: item.capability,
      intent: item.intent,
      proposal: item.proposal,
    },
    planner,
  );

  if (!planned.ok) return planned;

  return {
    ok: true,
    revision: {
      requestedChanges: feedback,
      intent: {
        ...planned.command.intent,
        revision_feedback: feedback,
      },
      proposal: planned.command.proposal,
    },
  };
}
