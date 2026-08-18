import {
  classifyHarnessTurnEnd,
  decideHarnessPreStep,
  resolveHarnessStepBudget,
  POC_HARNESS_STEP_BUDGET,
  type HarnessObservedTurnOutcome,
  type HarnessPreStepDecision,
  type HarnessTurnEnd,
} from '@anima/core';
import { coderBackendId, type CoderBackend, type CoderEditRequest, type CoderEditResult, type CoderWorkspace } from './coder-backend';

// ============================================================
// Backend de código candidato: DeepSeek Harness (@deepseek-ai/dsh) por trás da
// interface CoderBackend (ADR-001). O Harness é candidato a CODERBACKEND, NÃO a
// substituto do WorkExecutor: o host segue dono da worktree, do git observado,
// dos gates, do escopo, do cancelamento, do Resource Governor, do commit/handoff,
// do Verifier e da decisão de sucesso. Este adaptador só faz o Harness ESCREVER
// código dentro da worktree isolada; tudo o mais continua com o host.
//
// SEM importar o @deepseek-ai/dsh: o runtime real entra por INJEÇÃO (porta
// `HarnessRuntime`), exatamente como o Ollama/OpenAI injetam `fetchImpl`. Assim o
// adaptador é versionável, tipado e testável com um runtime falso — sem node_modules,
// sem rede, sem modelo — e a ligação real com o dsh fica isolada na borda de
// composição (uma fatia posterior, sujeita a revisão de segurança do `pwsh`).
//
// Diferença essencial dos backends que só PROPÕEM edições (Ollama/OpenAI): o
// Harness roda o próprio laço com as próprias ferramentas de arquivo, então
// precisa do cwd real (`workspace.rootPath`). O confinamento por-escrita
// (`safeJoin`) NÃO se aplica às ferramentas do Harness; o confinamento vem do
// host DEPOIS: worktree isolada e descartável, checagem de escopo pós-edição
// (fora do escopo ⇒ contract_violation), gates, restauração ao base e revisão
// humana — nada é aplicado, merjado ou pushado.
//
// Invariante (POC ponto 2): `turn/end kind=completed` e exit 0 NÃO são sucesso.
// O adaptador NUNCA decide sucesso — devolve o que observou e deixa o host rodar
// os gates. Houve turno `completed` sem alteração alguma, com o modelo afirmando
// que os testes passavam, enquanto o `npm test` do host encontrou FAIL.
// ============================================================

/**
 * Seleção de ferramentas do Harness. O POC venceu com edit/write/read/glob/grep/pwsh
 * habilitadas e `str_replace_editor` DESABILITADA (ergonomia ruim no ambiente
 * Windows/modelo: uso repetido de paths Unix como `/repo`, loops, aumento de duração).
 * Isso é evidência de COMPATIBILIDADE do provider Windows, NÃO regra universal — por
 * isso é configurável e a remoção universal de `str_replace_editor` NÃO está ratificada.
 */
export interface HarnessToolConfig {
  readonly enabled: readonly string[];
  readonly disabled: readonly string[];
}

/** Config de ferramentas com que o POC PROVOU a estabilidade — o DEFAULT, não um
 * veredito universal. */
export const DEFAULT_HARNESS_TOOLS: HarnessToolConfig = {
  enabled: ['edit', 'write', 'read', 'glob', 'grep', 'pwsh'],
  disabled: ['str_replace_editor'],
};

/** temperature do provider com que o POC estabilizou o protocolo de tool calls
 * (baseline sem temperature: 8/10 com 2 pseudo-tools; temperature=0: 10/10, 0
 * pseudo-tools). É o DEFAULT configurável, não um valor ratificado como final. */
export const DEFAULT_HARNESS_TEMPERATURE = 0;

/** Entrada de um turno do Harness, montada pelo adaptador a partir do contrato do
 * CoderBackend. O runtime real traduz isto para `ctx.agents.create`/`resume` +
 * as opções do provider (`temperature`, ferramentas) e instala o hook `agent/pre-step`. */
export interface HarnessRunTurnInput {
  /** Raiz absoluta da worktree isolada — o cwd das ferramentas do Harness. */
  readonly rootPath: string;
  readonly objective: string;
  readonly includedScope: readonly string[];
  readonly excludedScope: readonly string[];
  readonly carriedContext?: CoderEditRequest['carriedContext'];
  readonly temperature: number;
  readonly tools: HarnessToolConfig;
  /** Orçamento de passos já resolvido (inteiro positivo). */
  readonly stepBudget: number;
  /**
   * Hook `agent/pre-step`: o runtime DEVE chamar isto a cada passo com o número do
   * passo prestes a rodar; se a decisão for `cancel`, o runtime DEVE emitir
   * `agent.cancel({ kind: "hook", reason })` — o seam oficial de step budget. O
   * adaptador liga isto à política pura do core (`decideHarnessPreStep`).
   */
  readonly onPreStep: (step: number) => HarnessPreStepDecision;
  /**
   * Continuação na MESMA sessão (`ctx.agents.resume`), quando presente. Ausente ⇒
   * `create` de uma sessão nova. O retry na mesma sessão após falha de gate observada
   * pelo host é uma fatia POSTERIOR (orquestração do host); esta fatia é single-turn.
   */
  readonly resumeSessionId?: string;
  /** `AbortSignal` do host: o cancelamento da tentativa deve abortar o turno. */
  readonly signal: AbortSignal;
}

/** O que o runtime devolve de um turno: o `turn/end` durável (para classificação
 * host-side) e a sessão (para um resume posterior). `steps` é observável, para
 * evidência. NUNCA carrega veredito de sucesso. */
export interface HarnessRunTurnResult {
  readonly sessionId: string;
  readonly turnEnd: HarnessTurnEnd;
  readonly steps?: number;
}

/** Porta do runtime do Harness: a superfície pública mínima que o adaptador dirige.
 * O runtime real (que importa o @deepseek-ai/dsh) a implementa na borda; os testes
 * a implementam com um falso. */
export interface HarnessRuntime {
  runTurn(input: HarnessRunTurnInput): Promise<HarnessRunTurnResult>;
}

export interface DeepSeekHarnessCoderOptions {
  /** Runtime injetado (dsh real na borda; falso em teste). */
  readonly runtime: HarnessRuntime;
  /** Modelo — parte da identidade estável `deepseek-harness:<model>` (fonte única). */
  readonly model: string;
  /** temperature do provider; default `DEFAULT_HARNESS_TEMPERATURE` (0). */
  readonly temperature?: number;
  /** Orçamento de passos; default `POC_HARNESS_STEP_BUDGET` (12, valor do POC). */
  readonly stepBudget?: number;
  /** Seleção de ferramentas; default `DEFAULT_HARNESS_TOOLS`. */
  readonly tools?: HarnessToolConfig;
}

export class DeepSeekHarnessCoderBackend implements CoderBackend {
  readonly id: string;
  private readonly runtime: HarnessRuntime;
  private readonly temperature: number;
  private readonly stepBudget: number;
  private readonly tools: HarnessToolConfig;

  constructor(options: DeepSeekHarnessCoderOptions) {
    this.id = coderBackendId('deepseek-harness', options.model);
    this.runtime = options.runtime;
    this.temperature = options.temperature ?? DEFAULT_HARNESS_TEMPERATURE;
    this.stepBudget = resolveHarnessStepBudget(options.stepBudget ?? POC_HARNESS_STEP_BUDGET);
    this.tools = options.tools ?? DEFAULT_HARNESS_TOOLS;
  }

  async edit(request: CoderEditRequest, workspace: CoderWorkspace, signal: AbortSignal): Promise<CoderEditResult> {
    // Backend ENRAIZADO: exige o cwd real da worktree. Sem ele, falha fechado —
    // nunca tenta rodar o próprio laço agêntico sem um confinamento de host.
    const rootPath = workspace.rootPath;
    if (typeof rootPath !== 'string' || rootPath.length === 0) {
      throw new Error('O DeepSeek Harness exige uma worktree local enraizada (workspace.rootPath ausente).');
    }

    const stepBudget = this.stepBudget;
    const result = await this.runtime.runTurn({
      rootPath,
      objective: request.objective,
      includedScope: request.includedScope,
      excludedScope: request.excludedScope,
      ...(request.carriedContext ? { carriedContext: request.carriedContext } : {}),
      temperature: this.temperature,
      tools: this.tools,
      stepBudget,
      onPreStep: step => decideHarnessPreStep({ step, stepBudget }),
      signal,
    });

    const outcome = classifyHarnessTurnEnd(result.turnEnd);
    // `error` é falha do próprio turno/runtime (ex.: provider fora) — lança para o
    // host restaurar ao base e classificar execution_failed (retryable). Os demais
    // desfechos (completed-unverified, aborted-por-orçamento, aborted-outro)
    // significam "o turno terminou"; devolve normalmente e deixa o host observar o
    // git e rodar os gates. Sucesso é decisão do host, nunca deste adaptador.
    if (outcome === 'error') {
      throw new Error(`O turno do DeepSeek Harness terminou em erro (${describeTurnEnd(result.turnEnd)}).`);
    }

    return {
      // `summary` flui para o sinal `result` persistido: NUNCA inclui `rootPath` nem
      // segredo — só a identidade do backend, o desfecho observado e a contagem de passos.
      summary: `DeepSeek Harness (${this.id}) encerrou o turno como ${outcome}${typeof result.steps === 'number' ? ` em ${result.steps} passo(s)` : ''}; a validação é dos gates do host.`,
      // O adaptador NÃO atesta arquivos tocados: quem observa o escopo real é o host,
      // via git (changedFiles), autoridade única. Devolver vazio mantém a evidência
      // de escopo do lado do host, onde ela é honesta.
      touchedResources: [],
      notes: buildTurnNotes(outcome, result),
    };
  }
}

const describeTurnEnd = (turnEnd: HarnessTurnEnd): string => {
  const reason = turnEnd.reasonKind ? `${turnEnd.reasonKind}${turnEnd.reasonReason ? `:${turnEnd.reasonReason}` : ''}` : turnEnd.kind;
  return `kind=${turnEnd.kind}${turnEnd.kind === 'aborted' || turnEnd.kind === 'error' ? `, reason=${reason}` : ''}`;
};

/** Notas observáveis do turno (evidência): desfecho normalizado, sessão (para um
 * resume posterior) e a razão do abort quando houver. Sem caminhos absolutos. */
const buildTurnNotes = (outcome: HarnessObservedTurnOutcome, result: HarnessRunTurnResult): readonly string[] => {
  const notes: string[] = [`turn-outcome:${outcome}`, `session:${result.sessionId}`];
  if (typeof result.steps === 'number') notes.push(`steps:${result.steps}`);
  if (result.turnEnd.kind === 'aborted' && result.turnEnd.reasonReason) {
    notes.push(`abort-reason:${result.turnEnd.reasonReason}`);
  }
  return notes;
};
