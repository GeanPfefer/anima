import { readVerifierRequirement, VERIFIER_REQUIREMENT_KEY, type CreateWorkProposalCommand, type RequestProposalRevisionCommand, type WorkItem } from '@anima/core';
import { readAuthorizedBaseSha } from '@/lib/work-orchestration/executor-selection';
import { resolveConfiguredCoderBackend } from '@/lib/work-orchestration/coder-backend';
import { resolveOpenAICoderModel } from '@/lib/work-orchestration/gpt-coder';
import { parseProposal, scopeTestCommandToWorkspace, targetPathsAreExactFilesOrAbsent, type PlannerProposalResult, type ProjectWorkPlanner } from './project-work-planner-shared';
import { OpenAIProjectWorkPlanner } from './project-work-planner-openai';
import { LocalOllamaProjectWorkPlanner } from './project-work-planner-local';
import { OpenAIAdmissionDenied } from './openai-paid-transport';
import { createInteractiveOpenAIAdmission } from './openai-interactive-admission';
import type { ChatProviderId } from './chat-provider';

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
  _chatProvider: string,
  _plannerProvider: ProjectWorkPlannerProvider = resolveConfiguredProjectPlannerProvider(),
): boolean {
  return developmentMode;
}

/**
 * Compatibilidade para callers não conversacionais: mantém a escolha configurada,
 * mas nunca troca de provider durante uma chamada.
 */
export class AdmissionGatedOpenAIPlanner implements ProjectWorkPlanner {
  constructor(
    private readonly openai: OpenAIProjectWorkPlanner,
    _local?: LocalOllamaProjectWorkPlanner,
  ) {}
  get id(): string { return this.openai.id; }
  async proposeArguments(message: string): Promise<PlannerProposalResult> {
    try {
      return await this.openai.proposeArguments(message);
    } catch (error) {
      if (error instanceof OpenAIAdmissionDenied) {
        console.warn('[project-work-planner] provider selecionado não admitido', {
          requestedProvider: 'openai', effectiveProvider: 'openai',
          reason: error.reason, fallbackAttempted: false,
        });
        return { ok: false, message: `Não foi possível planejar com a OpenAI: ${error.reason}.` };
      }
      throw error;
    }
  }
}

/** Provider do request é a autoridade do turno Dev. Nenhuma configuração de deploy
 * ou recusa de admissão pode trocar GPT por Local (ou o inverso) numa subetapa. */
export function createChatProjectPlanner(provider: ChatProviderId, userId: string): ProjectWorkPlanner {
  return provider === 'ollama'
    ? new LocalOllamaProjectWorkPlanner()
    : new AdmissionGatedOpenAIPlanner(new OpenAIProjectWorkPlanner({ admission: createInteractiveOpenAIAdmission(), userId }));
}

/** Cria o planejador configurado. O provedor é config de deploy, nunca escolha
 * por-proposta do usuário. O caminho `openai` é sempre gated por admissão financeira
 * e falha no próprio provider quando não admitido. */
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
  if (!targetPathsAreExactFilesOrAbsent(proposal)) {
    return { ok: false, message: 'Os target_paths precisam apontar para arquivos exatos; diretórios e globs não são suportados.' };
  }

  // Captura e persiste o SHA-base autorizado no momento da proposta. A execução
  // criará a worktree exatamente deste SHA, nunca do HEAD futuro. Autoridade do host.
  const baseSha = await readAuthorizedBaseSha();
  if (!baseSha) return { ok: false, message: 'Não foi possível capturar o SHA-base autorizado do repositório.' };
  const coderBackend = resolveConfiguredCoderBackend();

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
          coder_backend: coderBackend,
          // Proveniência: o backend acima é a CAPACIDADE configurada no deploy (env), não uma
          // decisão sobre esta unidade. A escolha de compute da unidade é um ato humano
          // separado (`anima work set-compute` → `compute_preference_recorded`).
          coder_backend_source: 'runtime_default',
          // O modelo acompanha o backend: um contrato `openai` com modelo Ollama era
          // incoerente (e, com o Router desligado, chamaria a OpenAI com `qwen…`).
          model: coderBackend === 'openai'
            ? resolveOpenAICoderModel()
            : process.env.ANIMA_WORKTREE_CODER_MODEL ?? 'qwen3-coder:latest',
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
          // Cada gate do planner é sempre prova por COMANDO (`proof:'gate'`,
          // explícito) e carrega seu `claim_kind` estrutural (gate_assertion ×
          // substantive), declarado pelo planner e normalizado fail-closed pelo
          // host. O campo é propagado SEM perda até aqui, para o Verifier lê-lo
          // como dado — sem heurística de texto. Critérios `proof:'scope'` não são
          // produzidos pelo planner e seguem inalterados em outros produtores.
          validation_criteria: [
            {
              label: proposal.validation_label,
              command: scopeTestCommandToWorkspace(proposal.validation_command, proposal.included_scope),
              covers: proposal.validation_covers,
              proof: 'gate',
              claim_kind: proposal.validation_claim_kind,
              ...(proposal.validation_target_paths ? { target_paths: proposal.validation_target_paths } : {}),
            },
            ...(proposal.additional_validations ?? []).map(validation => ({
              label: validation.label,
              command: scopeTestCommandToWorkspace(validation.command, proposal.included_scope),
              covers: validation.covers,
              proof: 'gate',
              claim_kind: validation.claim_kind,
              ...(validation.target_paths ? { target_paths: validation.target_paths } : {}),
            })),
          ],
          limits: { max_attempts: proposal.max_attempts ?? 3, max_duration_minutes: 30 },
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
const revisionSpec = (intent: unknown) => {
  const spec = (intent as { execution_spec?: { validation_criteria?: unknown; limits?: unknown } } | null)?.execution_spec;
  return { validation_criteria: spec?.validation_criteria ?? null, limits: spec?.limits ?? null };
};

/** Resumo estrutural da versão vigente para o planner saber o que corrigir. */
function describeProposalForRevision(item: WorkItem): string {
  const spec = revisionSpec(item.intent);
  return JSON.stringify({
    summary: item.proposal.data.summary,
    included_scope: item.proposal.data.includedScope,
    excluded_scope: item.proposal.data.excludedScope,
    expected_effects: item.proposal.data.expectedEffects,
    validation_criteria: spec.validation_criteria,
    limits: spec.limits,
    impact_level: item.impactLevel,
  });
}

function sameRevisableContent(item: WorkItem, command: CreateWorkProposalCommand): boolean {
  return JSON.stringify(item.proposal.data) === JSON.stringify(command.proposal.data)
    && JSON.stringify(revisionSpec(item.intent)) === JSON.stringify(revisionSpec(command.intent));
}

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
    'Produza uma proposta COMPLETA substituta que ATENDA a correção pedida.',
    'Não reutilize fatos da proposta anterior: ela pode estar errada ou desatualizada.',
    'Investigue novamente o repositório real antes de afirmar paths, defaults ou comportamento existente.',
    'Tudo o que a correção pedir e o contrato permitir (included_scope, gates, max_attempts) deve estar nos CAMPOS estruturados; nunca só no texto.',
    '',
    'Pedido original:',
    item.originalRequest,
    '',
    `Proposta anterior (v${item.proposalVersion}) — apenas para saber o que corrigir:`,
    describeProposalForRevision(item),
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
  // Uma revisão precisa REVISAR: reenviar a mesma proposta não gera versão nova.
  if (sameRevisableContent(item, planned.command)) {
    return { ok: false, message: 'O planejador devolveu a mesma proposta; nenhuma nova versão foi criada. A versão atual e o pedido continuam intactos.' };
  }

  // Mandated Verifier é MONOTÔNICO entre revisões: o host reconstrói o execution_spec e
  // só o materializer canônico grava o marcador; sem isto, revisar um lane mandatado o
  // rebaixaria em silêncio para advisory. A revisão pode mudar escopo/gates/limites,
  // nunca remover o mandato. Sem execution_spec para carregá-lo ⇒ falha fechada.
  let intent: Record<string, unknown> = { ...planned.command.intent, revision_feedback: feedback };
  if (readVerifierRequirement(item.intent) === 'required_fail_closed') {
    const spec = intent.execution_spec;
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      return { ok: false, message: 'A revisão não pôde preservar o Verifier obrigatório do item (execution_spec ausente); nenhuma nova versão foi criada.' };
    }
    intent = { ...intent, execution_spec: { ...(spec as Record<string, unknown>), [VERIFIER_REQUIREMENT_KEY]: 'required_fail_closed' } };
  }

  return {
    ok: true,
    revision: {
      requestedChanges: feedback,
      intent: intent as RequestProposalRevisionCommand['intent'],
      proposal: planned.command.proposal,
    },
  };
}
