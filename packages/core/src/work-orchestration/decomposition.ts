import type { Json } from '@anima/types';
import { readAutonomousExecutionSpec } from './eligibility';
import type { RecoverySuccessorCandidate } from './recovery-successor';
import type { WorkRecoveryAssessment } from './recovery-successor-types';
import type { WorkIntent, WorkItem, WorkProposal } from './types';
import { isAnimaWorktreeBranch } from './worktree-handoff';

// ============================================================
// Decomposição governada e DETERMINÍSTICA de um `no_progress` (ou limite de
// capacidade/contexto) repetido, quando a política de recuperação
// (`decideRecovery`) já decidiu `decompose`.
//
// Esta camada NÃO inventa subtarefas com um LLM. Ela usa apenas os FATOS já
// produzidos pela tentativa anterior — o handoff durável (`WorktreeHandoffV1`):
// o(s) gate(s) que falharam, os arquivos que o checkpoint tocou e a referência
// git durável (base + branch + commit do checkpoint). A partir disso deriva a
// MENOR unidade sucessora coerente: mesmo alvo, mesma capacidade, mesmo impacto,
// mesmas permissões, mesmos gates, MESMO budget — porém com escopo de arquivos
// ESTRITAMENTE MENOR (só os arquivos do diagnóstico) e um ponteiro de retomada
// para o checkpoint durável.
//
// Invariantes de governança (todos herdados/verificados por
// `validateRecoverySuccessor`, ao qual o candidato produzido é submetido):
//   * o original permanece `failed` (nada é reaberto/reescrito);
//   * capacidade, impacto, alvo, permissões e budget NUNCA aumentam;
//   * o escopo é um subconjunto ESTRITO do escopo original;
//   * nenhuma autoridade financeira/efeito externo é introduzido;
//   * a decomposição só ocorre quando a estratégia decidida é `decompose`.
//
// Anti-loop honesto: se o diagnóstico não permite reduzir o problema (nenhum
// arquivo do checkpoint dentro do escopo, ou escopo já mínimo), a derivação
// RECUSA (fail-closed) em vez de recriar o mesmo trabalho com outro ID. Uma
// decomposição que não reduz ambiguidade nem escopo não é autorizada.
//
// Puro: sem `fs`, sem `child_process`, sem rede, sem relógio, sem crypto. A
// chave de idempotência e a sequência de lineage são responsabilidade do
// chamador (que tem acesso ao banco); `decompositionIdempotencySeed` fornece a
// semente estável para que o MESMO checkpoint nunca gere dois sucessores.
// ============================================================

/** Referência git durável do checkpoint que a tentativa anterior preservou. */
export interface DecompositionCheckpoint {
  /** SHA-base autorizado (o diff continua sendo medido contra ele). */
  readonly baseSha: string;
  /** Branch preservada do Anima onde o checkpoint vive (`anima-work/...`). */
  readonly branch: string;
  /** Commit durável do edit inicial (o estado retomável). */
  readonly commitSha: string;
}

/** Gate que efetivamente reprovou na tentativa anterior. */
export interface DecompositionGate {
  readonly label: string;
  readonly command: string;
}

/**
 * Fatos DETERMINÍSTICOS extraídos do handoff durável da última tentativa falha.
 * Nenhum destes campos é prosa livre do modelo: gate reprovado, arquivos que o
 * checkpoint tocou e a referência git do checkpoint.
 */
export interface DecompositionDiagnostic {
  readonly failingGates: readonly DecompositionGate[];
  readonly changedFiles: readonly string[];
  readonly checkpoint: DecompositionCheckpoint;
}

export interface DecompositionInput {
  readonly original: WorkItem;
  readonly assessment: WorkRecoveryAssessment;
  readonly diagnostic: DecompositionDiagnostic;
  /** Sequência de lineage (1..N). O chamador a deriva do número de sucessores
   * já existentes do original; a RPC garante unicidade (original, sequência). */
  readonly recoverySequence: number;
  /** UUID de idempotência. O chamador o deriva de forma ESTÁVEL a partir de
   * `decompositionIdempotencySeed` para que o mesmo checkpoint não duplique. */
  readonly idempotencyKey: string;
}

export type DecompositionRefusal =
  | 'strategy_not_decompose'
  | 'original_not_failed'
  | 'assessment_mismatch'
  | 'spec_unreadable'
  | 'diagnostic_incomplete'
  | 'focus_empty'
  | 'scope_not_reducible'
  | 'lineage_input_invalid';

export type DecompositionResult =
  | { readonly ok: true; readonly candidate: RecoverySuccessorCandidate }
  | { readonly ok: false; readonly refusals: readonly DecompositionRefusal[] };

const SHA = /^[a-f0-9]{40}$/i;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Igualdade de caminho tolerante a barra e caixa — apenas para CASAR o
 * diagnóstico ao escopo. As entradas EMITIDAS preservam a string original do
 * escopo (byte-idêntica), garantindo o subconjunto estrito exigido a jusante. */
const pathKey = (value: string): string => value.trim().toLowerCase().replace(/\\/g, '/');
const clip = (value: string, max: number): string => (value.length <= max ? value : `${value.slice(0, max)}…`);

/**
 * Semente ESTÁVEL de idempotência da decomposição. O mesmo checkpoint durável
 * (mesmo original + mesmo commit) sempre produz a mesma semente, então o
 * chamador que a converte em UUID nunca cria dois sucessores para o mesmo
 * estado. Não é um UUID: o chamador (com crypto) o deriva; aqui fica puro.
 */
export const decompositionIdempotencySeed = (originalWorkItemId: string, checkpointCommitSha: string): string =>
  `decompose:${originalWorkItemId.trim().toLowerCase()}:${checkpointCommitSha.trim().toLowerCase()}`;

/** Referência git durável é retomável: base e commit são SHAs válidos e
 * distintos (houve edit efetivo) numa branch preservada do Anima. Compartilhada
 * pela decomposição (falha) e pela correção por retomada (revisão). */
const checkpointComplete = (checkpoint: DecompositionCheckpoint): boolean =>
  SHA.test(checkpoint.baseSha)
  && SHA.test(checkpoint.commitSha)
  && checkpoint.baseSha.toLowerCase() !== checkpoint.commitSha.toLowerCase()
  && isAnimaWorktreeBranch(checkpoint.branch);

const diagnosticComplete = (diagnostic: DecompositionDiagnostic): boolean =>
  diagnostic.failingGates.length > 0
  && diagnostic.failingGates.every(gate => gate.label.trim().length > 0 && gate.command.trim().length > 0)
  && diagnostic.changedFiles.length > 0
  && diagnostic.changedFiles.every(file => file.trim().length > 0)
  && checkpointComplete(diagnostic.checkpoint);

/**
 * Deriva a MENOR unidade sucessora governada a partir do diagnóstico durável.
 * Fail-closed: qualquer lacuna recusa a decomposição sem materializar nada. O
 * candidato retornado é construído para PASSAR em `validateRecoverySuccessor`;
 * o chamador ainda deve submetê-lo à validação antes de persistir (defesa em
 * profundidade — esta função não confia em si mesma como autoridade final).
 */
export function deriveDecompositionSuccessor(input: DecompositionInput): DecompositionResult {
  const { original, assessment, diagnostic } = input;
  const refusals: DecompositionRefusal[] = [];

  if (assessment.decision.action !== 'decompose') refusals.push('strategy_not_decompose');
  if (original.state !== 'failed') refusals.push('original_not_failed');
  if (assessment.workItemId !== original.id || assessment.proposalVersion !== original.proposalVersion) {
    refusals.push('assessment_mismatch');
  }
  if (!Number.isInteger(input.recoverySequence) || input.recoverySequence < 1 || !uuid.test(input.idempotencyKey)) {
    refusals.push('lineage_input_invalid');
  }
  if (!diagnosticComplete(diagnostic)) refusals.push('diagnostic_incomplete');

  const spec = readAutonomousExecutionSpec(original.intent);
  if (!spec) refusals.push('spec_unreadable');

  // Sem spec ou diagnóstico incompleto, não há como derivar a fatia com segurança.
  if (!spec || refusals.includes('diagnostic_incomplete')) {
    return { ok: false, refusals: dedupe(refusals) };
  }

  // Foco DETERMINÍSTICO: as entradas do escopo original cujos caminhos o
  // checkpoint efetivamente tocou. Preserva a string original (subconjunto
  // estrito byte-idêntico), casando por caminho tolerante a barra/caixa.
  const touched = new Set(diagnostic.changedFiles.map(pathKey));
  const originalScope = original.proposal.data.includedScope;
  const focusedScope = originalScope.filter(entry => touched.has(pathKey(entry)));

  if (focusedScope.length === 0) refusals.push('focus_empty');
  else if (focusedScope.length >= originalScope.length) refusals.push('scope_not_reducible');

  if (refusals.length > 0) return { ok: false, refusals: dedupe(refusals) };

  const removedFromScope = originalScope.filter(entry => !touched.has(pathKey(entry)));
  const gateLabels = diagnostic.failingGates.map(gate => gate.label);
  const shortCommit = diagnostic.checkpoint.commitSha.slice(0, 12);

  const proposal: WorkProposal = {
    schemaVersion: 1,
    data: {
      summary: clip(`Decomposição: corrigir ${gateLabels.join(', ')} a partir do checkpoint`, 200),
      objective: clip(
        `Corrigir especificamente o(s) gate(s) que falharam (${gateLabels.join(', ')}) `
        + `retomando do checkpoint durável ${shortCommit}, sem alterar arquivos fora do escopo reduzido `
        + `nem ampliar objetivo, capacidade, impacto, permissões ou budget da unidade original.`,
        1000,
      ),
      includedScope: [...focusedScope],
      // O que saiu do escopo passa a ser EXCLUÍDO de forma explícita e honesta.
      excludedScope: [...new Set([...original.proposal.data.excludedScope, ...removedFromScope])],
      expectedEffects: [
        `O(s) gate(s) ${gateLabels.join(', ')} passam a aprovar sobre o escopo reduzido.`,
        'Nenhum arquivo fora do escopo reduzido é alterado.',
      ],
      risks: [
        'A decomposição só reduz o problema se a causa estiver nos arquivos do checkpoint; '
        + 'se a repetição persistir, a recuperação deve parar (fail-closed), não gerar novos filhos.',
      ],
    },
  };

  const intent = buildSuccessorIntent(original.intent, diagnostic.checkpoint);
  if (!intent) {
    // Só ocorre se o spec original não puder ser reespelhado com fidelidade.
    return { ok: false, refusals: ['spec_unreadable'] };
  }

  const recoveryReason = clip(
    `${assessment.decision.reason}: decomposição governada de ${assessment.decision.failureKind} repetido, `
    + `retomando do checkpoint ${shortCommit} com escopo reduzido a ${focusedScope.length} arquivo(s).`,
    400,
  );

  const candidate: RecoverySuccessorCandidate = {
    impactLevel: original.impactLevel,
    capability: original.capability,
    intent,
    proposal,
    recoveryReason,
    recoverySequence: input.recoverySequence,
    idempotencyKey: input.idempotencyKey,
  };
  return { ok: true, candidate };
}

/**
 * Reespelha o `execution_spec` original VERBATIM e anexa o ponteiro de retomada.
 * Copiar o spec inteiro do original — por definição dentro da autoridade do
 * original — preserva IDÊNTICOS alvo, permissões, critérios, limites, dependências
 * E os campos de roteamento/execução (`executor`, `coder_backend`, `model`) que o
 * contrato de execução lê. Isso torna o sucessor efetivamente EXECUTÁVEL, não só
 * validável. Nunca amplia autoridade: é uma cópia fiel do envelope original; a
 * redução real (escopo de arquivos) vive na PROPOSTA, não no spec.
 *
 * Sobre-escreve apenas `base_sha` com a base do checkpoint (idêntica à base da
 * tentativa original) e ADICIONA `resume_from_checkpoint` — o parser de spec ignora
 * essa chave, então a retomada não afeta elegibilidade nem validação de envelope.
 * Nenhuma outra chave do intent original (fora `execution_spec`) é herdada, para
 * não carregar proveniência/autoridade acidental de outra camada.
 */
/**
 * Requisitos de PROVA a materializar no `execution_spec` do sucessor (opcional). Quando
 * presente (correção governada), enriquece os `validation_criteria` mirrorados:
 *  * cada gate por comando passa a COBRIR o critério funcional (`covers += functional`);
 *  * é ACRESCENTADO um critério `proof:'scope'` que cobre os critérios de escopo.
 * Ausente (decomposição por falha) ⇒ o spec é espelhado VERBATIM, sem enriquecer.
 */
interface SuccessorProofRequirements {
  readonly functional: string | null;
  readonly scopeCriteria: readonly string[];
}

function buildSuccessorIntent(
  originalIntent: WorkIntent,
  checkpoint: DecompositionCheckpoint,
  proof?: SuccessorProofRequirements,
): WorkIntent | null {
  if (!readAutonomousExecutionSpec(originalIntent)) return null;
  const rawSpec = originalIntent['execution_spec'];
  if (typeof rawSpec !== 'object' || rawSpec === null || Array.isArray(rawSpec)) return null;

  // Cópia profunda por serialização (o spec é Json), sem compartilhar referências.
  const executionSpec = JSON.parse(JSON.stringify(rawSpec)) as Record<string, Json>;
  // A base do sucessor é a base do checkpoint (o diff continua medido contra ela).
  executionSpec['base_sha'] = checkpoint.baseSha;
  // Proveniência/ponto de RETOMADA — auditável e ignorada pelos parsers de spec.
  executionSpec['resume_from_checkpoint'] = {
    base_sha: checkpoint.baseSha,
    branch: checkpoint.branch,
    commit_sha: checkpoint.commitSha,
  };

  // Enriquecimento de PROVA (só na correção governada). Amarra os critérios de aceite
  // às suas fontes de prova, para que o Verifier v2 possa classificar cada um pelo
  // requisito certo (gate para funcional, escopo para invariante) — sem afrouxar nada.
  if (proof) {
    const rawCriteria = executionSpec['validation_criteria'];
    if (Array.isArray(rawCriteria)) {
      const enriched: Json[] = rawCriteria.map(entry => {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return entry;
        const criterion = entry as Record<string, Json>;
        const command = criterion['command'];
        if (proof.functional !== null && typeof command === 'string' && command.trim().length > 0) {
          const existing = Array.isArray(criterion['covers'])
            ? (criterion['covers'] as Json[]).filter((value): value is string => typeof value === 'string')
            : [];
          return { ...criterion, covers: [...new Set([...existing, proof.functional])] };
        }
        return criterion;
      });
      if (proof.scopeCriteria.length > 0) {
        enriched.push({ label: 'Contenção de escopo da correção', proof: 'scope', covers: [...proof.scopeCriteria] });
      }
      executionSpec['validation_criteria'] = enriched;
    }
  }
  return { execution_spec: executionSpec };
}

const dedupe = <T>(values: readonly T[]): readonly T[] => [...new Set(values)];

// ============================================================
// Correção governada por RETOMADA de uma revisão (`changes_requested`).
//
// Quando a implementação já foi VERIFICADA e o humano pede só um complemento que
// cabe no escopo AINDA NÃO tocado (ex.: adicionar testes), refazer tudo desde a
// base reescreveria trabalho comprovadamente correto. Esta camada deriva — dos
// mesmos FATOS duráveis (checkpoint git observado da tentativa revisada) — a
// MENOR unidade sucessora que RETOMA do checkpoint e reduz o escopo aos arquivos
// que o checkpoint NÃO tocou (o "restante" da revisão), mantendo a implementação
// preservada FORA do escopo (o guard de edição impede reescrevê-la em silêncio).
//
// Invariantes (verificados a jusante por `validateCorrectionSuccessor`):
//   * o original permanece `changes_requested` (nada é reaberto/reescrito);
//   * capacidade, impacto, alvo, permissões e budget NUNCA aumentam;
//   * o escopo é um subconjunto ESTRITO do original (só o restante);
//   * a implementação preservada entra em EXCLUÍDO (não é tocada);
//   * o `execution_spec` é espelhado + `resume_from_checkpoint`/`base_sha` do checkpoint.
//
// Fail-closed: sem checkpoint retomável, sem escopo restante, ou pedido vazio,
// RECUSA — em vez de fabricar uma correção que amplia o envelope. Puro (sem I/O).
// ============================================================

/** Fatos DETERMINÍSTICOS da revisão: o pedido do humano + o checkpoint durável
 * observado da tentativa revisada + os arquivos que ele PRESERVOU (tocou). */
export interface ResumeCorrectionInput {
  readonly original: WorkItem;
  /** Texto da revisão solicitada (`request_changes`) — vira o objetivo. */
  readonly requestedChanges: string;
  /** Checkpoint git durável da tentativa revisada (base + branch + commit). */
  readonly checkpoint: DecompositionCheckpoint;
  /** Arquivos que o checkpoint tocou (a implementação preservada) — a excluir. */
  readonly preservedFiles: readonly string[];
  readonly recoverySequence: number;
  readonly idempotencyKey: string;
}

export type ResumeCorrectionRefusal =
  | 'original_not_changes_requested'
  | 'requested_changes_empty'
  | 'checkpoint_incomplete'
  | 'spec_unreadable'
  | 'preserved_files_out_of_scope'
  | 'remaining_scope_empty'
  | 'lineage_input_invalid';

export type ResumeCorrectionResult =
  | { readonly ok: true; readonly candidate: RecoverySuccessorCandidate }
  | { readonly ok: false; readonly refusals: readonly ResumeCorrectionRefusal[] };

/**
 * Deriva a MENOR unidade sucessora de correção que RETOMA do checkpoint e reduz o
 * escopo ao restante (arquivos não tocados). Construída para PASSAR em
 * `validateCorrectionSuccessor`; o chamador ainda a submete à validação antes de
 * persistir (defesa em profundidade). Fail-closed em toda lacuna.
 */
export function deriveResumeCorrectionSuccessor(input: ResumeCorrectionInput): ResumeCorrectionResult {
  const { original, requestedChanges, checkpoint, preservedFiles } = input;
  const refusals: ResumeCorrectionRefusal[] = [];

  if (original.state !== 'changes_requested') refusals.push('original_not_changes_requested');
  if (!requestedChanges.trim()) refusals.push('requested_changes_empty');
  if (!checkpointComplete(checkpoint)) refusals.push('checkpoint_incomplete');
  if (!Number.isInteger(input.recoverySequence) || input.recoverySequence < 1 || !uuid.test(input.idempotencyKey)) {
    refusals.push('lineage_input_invalid');
  }

  const spec = readAutonomousExecutionSpec(original.intent);
  if (!spec) refusals.push('spec_unreadable');

  if (!spec || refusals.length > 0) return { ok: false, refusals: dedupe(refusals) };

  // Escopo reduzido DETERMINÍSTICO: as entradas do escopo original que o
  // checkpoint NÃO tocou (o "restante" da revisão). A implementação preservada
  // (tocada) é casada por caminho tolerante e sai do escopo (byte-idêntico).
  const originalScope = original.proposal.data.includedScope;
  const preserved = new Set(preservedFiles.map(pathKey));
  const everyPreservedInScope = preservedFiles.length > 0
    && [...preserved].every(file => originalScope.some(entry => pathKey(entry) === file));
  if (!everyPreservedInScope) refusals.push('preserved_files_out_of_scope');

  const remainingScope = originalScope.filter(entry => !preserved.has(pathKey(entry)));
  if (remainingScope.length === 0) refusals.push('remaining_scope_empty');

  if (refusals.length > 0) return { ok: false, refusals: dedupe(refusals) };

  const preservedScope = originalScope.filter(entry => preserved.has(pathKey(entry)));
  const shortCommit = checkpoint.commitSha.slice(0, 12);
  const feedback = requestedChanges.trim();

  // Requisitos de PROVA dos critérios de aceite da correção — heterogêneos:
  //  * FUNCIONAL (provado por gate): as validações declaradas passam sobre a correção.
  //    Só é asserido quando há ao menos um gate por comando para prová-lo (senão
  //    ficaria descoberto). Os gates herdados passam a COBRIR este critério.
  //  * ESCOPO (provado por invariante observada): a correção altera apenas o restante,
  //    e a implementação preservada fica intacta. Um critério de validação `proof:'scope'`
  //    cobre ambos; a prova é a contenção de escopo observada pelo host, não um gate.
  // Textos EXATOS reusados nos `covers` (o Verifier casa por identidade).
  const functionalCriterion = 'As validações declaradas da unidade (gates) passam sobre a correção retomada.';
  const scopeRemainingCriterion = `A revisão é cumprida adicionando trabalho apenas a ${remainingScope.join(', ')}.`;
  const scopeIntactCriterion = `A implementação já verificada (${preservedScope.join(', ')}) permanece intacta, retomada do checkpoint ${shortCommit}.`;
  const hasGate = spec.validationCriteria.some(criterion => typeof criterion.command === 'string' && criterion.command.trim().length > 0);
  const scopeCriteria = [scopeRemainingCriterion, scopeIntactCriterion];

  const proposal: WorkProposal = {
    schemaVersion: 1,
    data: {
      summary: clip(
        `Correção por retomada: cumprir a revisão em ${remainingScope.join(', ')} sem tocar a implementação preservada`,
        200,
      ),
      objective: clip(
        `Retomando do checkpoint durável ${shortCommit} (implementação já verificada preservada em `
        + `${preservedScope.join(', ')}), cumprir a correção solicitada na revisão: ${feedback}. `
        + `Alterar SOMENTE ${remainingScope.join(', ')}; não modificar os arquivos preservados nem ampliar `
        + `objetivo, capacidade, impacto, permissões ou budget da unidade original.`,
        1000,
      ),
      includedScope: [...remainingScope],
      // A implementação preservada passa a ser EXCLUÍDA de forma explícita e honesta.
      excludedScope: [...new Set([...original.proposal.data.excludedScope, ...preservedScope])],
      // Aceite com PROVAS heterogêneas: funcional (gate, quando há) + escopo (invariante).
      expectedEffects: [...(hasGate ? [functionalCriterion] : []), ...scopeCriteria],
      risks: [
        'Se a correção exigisse alterar os arquivos preservados, esta retomada NÃO a satisfaz (fail-closed): '
        + 'o escopo reduzido é honesto e não deve ser ampliado silenciosamente.',
      ],
    },
  };

  const intent = buildSuccessorIntent(original.intent, checkpoint, {
    functional: hasGate ? functionalCriterion : null,
    scopeCriteria,
  });
  if (!intent) return { ok: false, refusals: ['spec_unreadable'] };

  const recoveryReason = clip(
    `Correção governada por retomada: cumprir a revisão no escopo restante (${remainingScope.length} arquivo(s)) `
    + `a partir do checkpoint ${shortCommit}, preservando a implementação já verificada.`,
    400,
  );

  const candidate: RecoverySuccessorCandidate = {
    impactLevel: original.impactLevel,
    capability: original.capability,
    intent,
    proposal,
    recoveryReason,
    recoverySequence: input.recoverySequence,
    idempotencyKey: input.idempotencyKey,
  };
  return { ok: true, candidate };
}
