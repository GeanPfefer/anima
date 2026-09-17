// ============================================================
// Política PURA do Coding Harness V3 (Agentic Workspace Runtime).
//
// O runtime/agente PERTENCE ao ANIMA; o model backend é intercambiável. Este
// módulo detém as FRONTEIRAS operacionais do laço iterativo do coder — expressas
// como ORÇAMENTOS (rodadas, leituras servidas por rodada, teto de sessão), NÃO
// como um limite de schema arbitrário por rodada. A distinção é a correção
// arquitetural central do V3:
//
//   • ANTES (V2): um pedido de `read` com mais de 8 itens numa rodada era um ERRO
//     DE SCHEMA TERMINAL (`ollama_invalid_response_schema`) — o protocolo recusava
//     a resposta ANTES de qualquer edit. Um modelo forte que investiga amplamente
//     (o comportamento agêntico desejado) falhava a tentativa inteira. Isso tornou
//     o próprio harness o gargalo do self-development.
//   • AGORA (V3): quantas leituras o host SERVE por rodada é um ORÇAMENTO. O
//     excedente é DEFERIDO (re-solicitável na rodada seguinte), não recusado; o
//     laço continua. A segurança vem das fronteiras (rodadas, teto de sessão,
//     tempo/custo/escopo/rede na camada do Governor), não de um número mágico.
//
// Este módulo é PURO (sem I/O, sem rede, sem custo) e não conhece Ollama, OpenAI,
// worktree nem banco — como `harness-turn-lifecycle`. O protocolo compartilhado
// (que hoje serve Ollama e OpenAI, pois o GptCoder delega ao Ollama) consome esta
// política; trocar/adicionar backend não reconstrói o laço.
//
// Modo SUPERVISIONADO vs AUTÔNOMO: em modo supervisionado pelo usuário evita-se
// anti-loop artificial que impeça o trabalho (rodadas/leituras mais generosas);
// em modo autônomo/desacompanhado os loop guards continuam necessários (perfis
// mais contidos). A segurança ESTRUTURAL e FINANCEIRA (escopo de escrita, gates,
// autoridade paga, tempo) é idêntica nos dois — ela vive nas fronteiras do agente.
// ============================================================

export type AgenticRuntimeMode = 'supervised' | 'autonomous';

export interface AgenticRuntimePolicyV1 {
  readonly schemaVersion: 1;
  readonly mode: AgenticRuntimeMode;
  /**
   * Quantas leituras VÁLIDAS o host serve por rodada. As excedentes NÃO são
   * recusadas: viram `deferred` e podem ser re-solicitadas na próxima rodada. É um
   * orçamento de prompt/latência (uma janela pequena não comporta muitos trechos
   * grandes de uma vez), não um teto de exploração.
   */
  readonly readServingBudgetPerRound: number;
  /** Rodadas de leitura antes de o protocolo exigir edição. Fronteira do laço. */
  readonly maxReadRounds: number;
  /**
   * Teto de leituras SERVIDAS na sessão inteira (soma entre rodadas). Fronteira de
   * sessão que substitui o anti-loop por-rodada: um agente pode ler muito ao longo
   * de várias rodadas, mas não indefinidamente sem editar.
   */
  readonly maxTotalServedReads: number;
}

/**
 * Teto ABSOLUTO de itens de `read` aceitos numa única rodada — guarda de ABUSO,
 * não orçamento. Uma lista acima disto é payload patológico (não exploração
 * legítima) e continua sendo `ollama_invalid_response_schema`. Deliberadamente
 * MUITO acima de qualquer orçamento operacional para nunca barrar investigação real.
 */
export const MAX_READS_REQUESTED_PER_ROUND = 64;

/** Limites sãos de cada grandeza da política (fail-closed por clamp). */
export const AGENTIC_RUNTIME_POLICY_BOUNDS = {
  readServingBudgetPerRound: { min: 1, max: MAX_READS_REQUESTED_PER_ROUND },
  maxReadRounds: { min: 1, max: 40 },
  maxTotalServedReads: { min: 1, max: 1000 },
} as const;

/**
 * Perfil LOCAL conservador (Ollama / janela pequena, ex.: num_ctx 8192): poucos
 * trechos por rodada para não estourar a janela, poucas rodadas. Serve de default
 * seguro e preserva EXATAMENTE o comportamento numérico do backend local histórico
 * (8 leituras/rodada, 3 rodadas) — a mudança do V3 é a DEFERÊNCIA graciosa do
 * excedente, não o afrouxamento do orçamento local.
 */
export const LOCAL_AGENTIC_RUNTIME_PROFILE_V1 = {
  readServingBudgetPerRound: 8,
  maxReadRounds: 3,
  maxTotalServedReads: 40,
} as const;

/**
 * Perfil de backend REMOTO FORTE (OpenAI e afins / janela grande, ex.: 64k+): a
 * exploração ampla que o modelo forte QUER fazer cabe na janela, então o orçamento
 * por rodada e o número de rodadas são maiores. É a correção direta do gargalo que
 * reprovou a correction paga (`gpt-5.6-terra` pediu > 8 leituras e a tentativa
 * falhou antes de qualquer edit). Continua bounded — nunca ilimitado.
 */
export const STRONG_REMOTE_AGENTIC_RUNTIME_PROFILE_V1 = {
  readServingBudgetPerRound: 24,
  maxReadRounds: 10,
  maxTotalServedReads: 200,
} as const;

type AgenticRuntimeProfile = Pick<
  AgenticRuntimePolicyV1,
  'readServingBudgetPerRound' | 'maxReadRounds' | 'maxTotalServedReads'
>;

const clampInt = (raw: unknown, bounds: { readonly min: number; readonly max: number }, fallback: number): number => {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return fallback;
  return Math.max(bounds.min, Math.min(raw, bounds.max));
};

/**
 * Resolve uma política EFETIVA e SÃ a partir de um perfil base e de overrides
 * opcionais. FAIL-CLOSED por clamp: cada grandeza é forçada aos limites; entrada
 * malformada cai no valor do perfil. Garante ainda a invariante estrutural
 * `maxTotalServedReads >= readServingBudgetPerRound` (um teto de sessão menor que
 * uma rodada tornaria a 1ª rodada impossível). Determinística e sem efeitos.
 */
export function resolveAgenticRuntimePolicy(input: {
  readonly mode: AgenticRuntimeMode;
  readonly profile?: AgenticRuntimeProfile;
  readonly overrides?: Partial<AgenticRuntimeProfile> | null;
}): AgenticRuntimePolicyV1 {
  const base = input.profile ?? LOCAL_AGENTIC_RUNTIME_PROFILE_V1;
  const overrides = input.overrides ?? {};
  const readServingBudgetPerRound = clampInt(
    overrides.readServingBudgetPerRound ?? base.readServingBudgetPerRound,
    AGENTIC_RUNTIME_POLICY_BOUNDS.readServingBudgetPerRound,
    LOCAL_AGENTIC_RUNTIME_PROFILE_V1.readServingBudgetPerRound,
  );
  const maxReadRounds = clampInt(
    overrides.maxReadRounds ?? base.maxReadRounds,
    AGENTIC_RUNTIME_POLICY_BOUNDS.maxReadRounds,
    LOCAL_AGENTIC_RUNTIME_PROFILE_V1.maxReadRounds,
  );
  const maxTotalServedReadsRaw = clampInt(
    overrides.maxTotalServedReads ?? base.maxTotalServedReads,
    AGENTIC_RUNTIME_POLICY_BOUNDS.maxTotalServedReads,
    LOCAL_AGENTIC_RUNTIME_PROFILE_V1.maxTotalServedReads,
  );
  return {
    schemaVersion: 1,
    mode: input.mode,
    readServingBudgetPerRound,
    maxReadRounds,
    // Um teto de sessão nunca pode ser menor que o servido numa rodada.
    maxTotalServedReads: Math.max(maxTotalServedReadsRaw, readServingBudgetPerRound),
  };
}

/** Default seguro: perfil LOCAL conservador em modo supervisionado. É o que um
 * caller que não conhece a política recebe — comportamento numérico idêntico ao
 * backend local histórico, com a deferência graciosa do V3. */
export const DEFAULT_AGENTIC_RUNTIME_POLICY_V1: AgenticRuntimePolicyV1 = resolveAgenticRuntimePolicy({
  mode: 'supervised',
  profile: LOCAL_AGENTIC_RUNTIME_PROFILE_V1,
});

// ============================================================
// SUBMIT GATE STATE MACHINE (Coding Harness V3).
//
// Correção estrutural: NÃO basta RECUSAR um submit sem provas — o runtime precisa
// CONDUZIR o espaço de ações de modo que a ação SUBMIT só EXISTA quando a revisão
// atual estiver realmente validada. Esta é a fonte de verdade PURA (sem I/O) que o
// laço compartilhado consome para (a) anunciar por rodada apenas as ações permitidas
// e (b) aceitar/recusar um submit de forma determinística.
//
// Estados (para tarefas COM validação executável do Work Item):
//   EXPLORING          — nenhuma edição material ainda. SUBMIT indisponível.
//   DIRTY_UNVALIDATED  — editou a revisão atual; falta validação focal verde. SUBMIT indisponível.
//   DIRTY_VALIDATED    — validação focal verde na revisão atual; falta git diff. SUBMIT indisponível.
//   READY_TO_SUBMIT    — validação verde E git diff da revisão atual. SUBMIT disponível.
//
// Invariante central: as PROVAS são amarradas à `editRevision`. QUALQUER edição
// material nova incrementa `editRevision`, o que invalida automaticamente provas
// antigas (elas deixam de casar `=== editRevision`) e devolve ao DIRTY_UNVALIDATED.
// TEST vermelho não cria prova; um git diff anterior à edição não vale.
//
// Compatibilidade: quando a tarefa NÃO tem validação executável (`requiresValidation`
// false), o gate é retrocompatível — após a primeira edição o estado é READY_TO_SUBMIT
// (sem exigir prova). Assim tarefas sem gate executável NUNCA entram em deadlock.
// ============================================================

export type SubmitGateStateV1 = 'exploring' | 'dirty_unvalidated' | 'dirty_validated' | 'ready_to_submit';

export interface SubmitGateSnapshotV1 {
  /** Nº de edições materiais aplicadas (0 = nada editado ainda). */
  readonly editRevision: number;
  /** editRevision cuja validação focal passou (exitCode 0); -1 = nenhuma. */
  readonly passedValidationRevision: number;
  /** editRevision cuja validação focal falhou (exitCode≠0/timeout); -1 = nenhuma. */
  readonly failedValidationRevision: number;
  /** editRevision cujo git diff (não vazio) foi revisado; -1 = nenhum. */
  readonly diffReviewedRevision: number;
  /** A tarefa tem comando(s) de validação executável(is)? Sem eles o gate é retrocompatível. */
  readonly requiresValidation: boolean;
}

/**
 * Deriva o estado do gate de submit a partir do snapshot de revisões. PURA e
 * determinística. As provas só contam quando amarradas à `editRevision` atual.
 */
export function deriveSubmitGateState(snapshot: SubmitGateSnapshotV1): SubmitGateStateV1 {
  if (snapshot.editRevision <= 0) return 'exploring';
  // Sem gate executável: retrocompatível — editar já habilita submit.
  if (!snapshot.requiresValidation) return 'ready_to_submit';
  const validated =
    snapshot.passedValidationRevision === snapshot.editRevision
    && snapshot.failedValidationRevision !== snapshot.editRevision;
  const diffReviewed = snapshot.diffReviewedRevision === snapshot.editRevision;
  if (validated && diffReviewed) return 'ready_to_submit';
  if (validated) return 'dirty_validated';
  return 'dirty_unvalidated';
}

/** SUBMIT só existe no estado READY_TO_SUBMIT. */
export function isSubmitAvailable(state: SubmitGateStateV1): boolean {
  return state === 'ready_to_submit';
}

export type RuntimeAction = 'read' | 'search' | 'glob' | 'exec' | 'edit' | 'submit';

/**
 * Conjunto de ações que o protocolo pode ANUNCIAR na rodada atual — a lista
 * apresentada ao modelo deve conter SOMENTE ações permitidas no estado atual.
 * `submit` NUNCA aparece antes de READY_TO_SUBMIT. read/search/glob dependem de
 * ainda haver orçamento de investigação; exec/edit existem enquanto o modo permite.
 * Ordem estável para prompt determinístico.
 */
export function availableRuntimeActions(input: {
  readonly state: SubmitGateStateV1;
  readonly searchEnabled: boolean;
  readonly execEnabled: boolean;
  readonly readRoundsLeft: number;
}): readonly RuntimeAction[] {
  const actions: RuntimeAction[] = [];
  if (input.readRoundsLeft > 0) {
    actions.push('read');
    if (input.searchEnabled) actions.push('search', 'glob');
  }
  if (input.execEnabled) actions.push('exec');
  actions.push('edit');
  if (isSubmitAvailable(input.state)) actions.push('submit');
  return actions;
}
