import type { CapabilityEvidenceObservation } from './capability-proof-engine';
import { projectHostObservedEvidence } from './work-orchestration/host-observed-evidence';
import { projectHostObservedCoderEvidence } from './work-orchestration/host-observed-coder-evidence';
import {
  projectHostObservedGateEvidence,
  terminalObservedGates,
} from './work-orchestration/host-observed-gate-evidence';
import { projectVerifierOpinionHistory } from './work-orchestration/verifier-opinion';
import { projectWorktreeHandoff } from './work-orchestration/worktree-handoff';
import type { WorkEvent } from './work-orchestration/types';

interface ValidVerifierEvent {
  readonly event: WorkEvent;
  readonly opinion: ReturnType<typeof projectVerifierOpinionHistory>[number];
}

function sameCorrelation(
  value: {
    readonly workItemId: string;
    readonly attemptId: string;
    readonly approvedProposalVersion: number;
  },
  expected: {
    readonly workItemId: string;
    readonly attemptId: string;
    readonly approvedProposalVersion: number;
  },
): boolean {
  return (
    value.workItemId === expected.workItemId &&
    value.attemptId === expected.attemptId &&
    value.approvedProposalVersion === expected.approvedProposalVersion
  );
}

function eventTimestamp(event: WorkEvent): number {
  const value = event.occurredAt.getTime();
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

function compareVerifierEvents(
  left: ValidVerifierEvent,
  right: ValidVerifierEvent,
): number {
  const time = eventTimestamp(left.event) - eventTimestamp(right.event);

  if (time !== 0) return time;

  return left.event.id.localeCompare(right.event.id);
}

function verifierAttemptKey(value: ValidVerifierEvent): string {
  const { opinion } = value;

  return [
    opinion.workItemId,
    opinion.attemptId,
    opinion.approvedProposalVersion,
  ].join(':');
}

function compareEvents(left: WorkEvent, right: WorkEvent): number {
  const time = eventTimestamp(left) - eventTimestamp(right);

  if (time !== 0) return time;

  return left.id.localeCompare(right.id);
}

function byObservedAtThenId(
  left: CapabilityEvidenceObservation,
  right: CapabilityEvidenceObservation,
): number {
  const time = Date.parse(left.observedAt) - Date.parse(right.observedAt);

  if (time !== 0) return time;

  return left.id.localeCompare(right.id);
}

function eventData(event: WorkEvent): Record<string, unknown> | null {
  const payload = event.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const data = (payload as Record<string, unknown>).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

  return data as Record<string, unknown>;
}

function readString(
  data: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = data?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Um parecer do Verifier que a linha atual sabe reprojetar E que repousa sobre
 * OBSERVAÇÃO INDEPENDENTE (git + gates observados pelo host), correlacionado à
 * mesma attempt/versão. É o único ponto onde o parecer, o resultado e os fatos
 * observados são resolvidos e cruzados — um READER, reutilizado por todas as
 * derivações que dependem do Verifier.
 *
 * DELIBERADAMENTE NÃO filtra por veredito nem por sucesso do resultado: isso é
 * responsabilidade de cada caller.
 *
 * - `agency.produce-change`/`verify-change` exigem a cadeia FORTE
 *   (`isStrongVerifiedExecution`): verdict verified + handoff succeeded + commit
 *   observado == commit produzido + todos os gates passed;
 * - `governance.verifier` aceita veredito conclusivo (verified OU rejected),
 *   porque uma rejeição bem-fundada PROVA que o verifier operou;
 * - `agency.supervised-self-development` parte da cadeia FORTE e soma a decisão
 *   humana de revisão.
 *
 * Retorna UMA entrada por attempt: o parecer válido mais recente. Um parecer
 * posterior inválido/incoerente da mesma attempt substitui o anterior.
 */
interface ResolvedIndependentOpinion {
  readonly opinion: ValidVerifierEvent['opinion'];
  readonly verifierEvent: WorkEvent;
  readonly resultEvent: WorkEvent;
  readonly handoff: NonNullable<ReturnType<typeof projectWorktreeHandoff>>;
  readonly observedGitEvent: WorkEvent;
  readonly observedGit: NonNullable<
    ReturnType<typeof projectHostObservedEvidence>
  >;
  readonly observedGateEvent: WorkEvent;
  readonly observedGates: NonNullable<
    ReturnType<typeof projectHostObservedGateEvidence>
  >;
}

function resolveIndependentVerifierOpinions(
  events: readonly WorkEvent[],
): readonly ResolvedIndependentOpinion[] {
  const validVerifierEvents: ValidVerifierEvent[] = [];

  for (const event of events) {
    if (event.type !== 'verifier_opinion_recorded') continue;

    // Reutiliza o parser/projetor canônico. Um evento cujo envelope discorda
    // do parecer simplesmente não entra como fato confiável.
    const projected = projectVerifierOpinionHistory([event]);

    if (projected.length !== 1) continue;

    validVerifierEvents.push({
      event,
      opinion: projected[0]!,
    });
  }

  validVerifierEvents.sort(compareVerifierEvents);

  // Append-only pode conter mais de um parecer da mesma attempt.
  // Só o parecer válido mais recente daquela attempt representa o estado
  // epistemológico atual dela.
  const latestByAttempt = new Map<string, ValidVerifierEvent>();

  for (const candidate of validVerifierEvents) {
    latestByAttempt.set(verifierAttemptKey(candidate), candidate);
  }

  const byEventId = new Map(events.map((event) => [event.id, event] as const));

  const resolved: ResolvedIndependentOpinion[] = [];

  for (const candidate of latestByAttempt.values()) {
    const { event: verifierEvent, opinion } = candidate;

    const basis = opinion.evidenceBasis;

    // Um parecer puramente atestado (sem observação independente) NÃO prova que
    // o Verifier realmente conferiu fatos — falha fechado.
    if (
      basis.coverage.git !== true ||
      basis.coverage.gates !== true ||
      basis.observedEventId === null ||
      basis.observedGateEventId === null
    ) {
      continue;
    }

    const resultEvent = byEventId.get(basis.resultEventId);
    const observedGitEvent = byEventId.get(basis.observedEventId);
    const observedGateEvent = byEventId.get(basis.observedGateEventId);

    if (!resultEvent || !observedGitEvent || !observedGateEvent) continue;

    // Cada projetor abaixo revalida o payload persistido e seu próprio
    // envelope. Não duplicamos os parsers da orquestração aqui.
    const handoff = projectWorktreeHandoff([resultEvent]);
    const observedGit = projectHostObservedEvidence([observedGitEvent]);
    const observedGates = projectHostObservedGateEvidence([observedGateEvent]);

    if (!handoff || !observedGit || !observedGates) continue;

    const expectedCorrelation = {
      workItemId: opinion.workItemId,
      attemptId: opinion.attemptId,
      approvedProposalVersion: opinion.approvedProposalVersion,
    };

    if (
      !sameCorrelation(handoff, expectedCorrelation) ||
      !sameCorrelation(observedGit, expectedCorrelation) ||
      !sameCorrelation(observedGates, expectedCorrelation)
    ) {
      continue;
    }

    resolved.push({
      opinion,
      verifierEvent,
      resultEvent,
      handoff,
      observedGitEvent,
      observedGit,
      observedGateEvent,
      observedGates,
    });
  }

  return resolved;
}

/**
 * Cadeia FORTE: o resultado de worktree terminou com sucesso, o host observou
 * exatamente o commit produzido, todos os gates observados passaram e o Verifier
 * concluiu `verified` sobre observação independente.
 */
function isStrongVerifiedExecution(
  resolved: ResolvedIndependentOpinion,
): boolean {
  return (
    resolved.opinion.verdict === 'verified' &&
    resolved.handoff.status === 'succeeded' &&
    resolved.observedGit.observedCommitSha === resolved.handoff.commitSha &&
    resolved.observedGates.gates.every((gate) => gate.outcome === 'passed')
  );
}

/**
 * Cadeia forte: resultado + Git + gates + Verifier `verified` correlacionados na
 * mesma attempt. Uma observação por attempt cujo parecer válido mais recente
 * satisfaça o contrato forte. Usada por `agency.produce-change`/`verify-change`.
 */
export function deriveVerifiedWorktreeExecutionEvidenceFromEvents(
  capabilityId: string,
  events: readonly WorkEvent[],
): readonly CapabilityEvidenceObservation[] {
  if (capabilityId.trim().length === 0) return [];

  const observations: CapabilityEvidenceObservation[] = [];

  for (const resolved of resolveIndependentVerifierOpinions(events)) {
    if (!isStrongVerifiedExecution(resolved)) continue;

    const {
      opinion,
      verifierEvent,
      resultEvent,
      observedGitEvent,
      observedGateEvent,
    } = resolved;

    observations.push({
      id: [
        'verified-worktree-execution',
        capabilityId,
        opinion.attemptId,
        verifierEvent.id,
      ].join(':'),
      capabilityId,
      evidenceClass: 'verified_execution',
      outcome: 'positive',
      observedAt: verifierEvent.occurredAt.toISOString(),
      // Ocasião = attempt: reprodução exige execuções verificadas de attempts
      // distintos, não múltiplas provas do mesmo attempt.
      occasionId: opinion.attemptId,
      proofRefs: [
        {
          kind: 'attempt',
          ref: opinion.attemptId,
          note: 'attempt correlacionada à execução',
        },
        {
          kind: 'event',
          ref: resultEvent.id,
          note: 'resultado persistido da worktree',
        },
        {
          kind: 'event',
          ref: observedGitEvent.id,
          note: 'Git observado independentemente pelo host',
        },
        {
          kind: 'event',
          ref: observedGateEvent.id,
          note: 'gates observados independentemente pelo host',
        },
        {
          kind: 'verifier',
          ref: verifierEvent.id,
          note: `${opinion.verifierVersion}: ${opinion.verdict}`,
        },
      ],
      note: 'Resultado + Git + gates + Verifier correlacionados na mesma attempt.',
    });
  }

  return observations.sort(byObservedAtThenId);
}

/**
 * GOVERNANCE.VERIFIER — prova de que o VERIFIER operou.
 *
 * Um parecer conclusivo (`verified` OU `rejected`) que repousa sobre observação
 * INDEPENDENTE (git + gates) demonstra que o verifier analisou fatos reais e
 * emitiu juízo — inclusive uma REJEIÇÃO bem-fundada prova que ele funcionou.
 *
 * NÃO exige que a mudança tenha sido aprovada nem que os gates passem: "verifier
 * funcionou" é separado de "mudança correta". `inconclusive` é abstenção e não
 * conta; parecer atestado/sem cobertura independente falha fechado no resolver.
 * Uma ocasião por attempt (occasionId = attempt), então múltiplos pareceres da
 * mesma attempt nunca viram reprodução.
 */
export function deriveVerifierOperationEvidenceFromEvents(
  events: readonly WorkEvent[],
): readonly CapabilityEvidenceObservation[] {
  const observations: CapabilityEvidenceObservation[] = [];

  for (const resolved of resolveIndependentVerifierOpinions(events)) {
    const { opinion, verifierEvent, resultEvent, observedGitEvent, observedGateEvent } =
      resolved;

    if (opinion.verdict !== 'verified' && opinion.verdict !== 'rejected') {
      continue;
    }

    observations.push({
      id: [
        'verifier-operation',
        'governance.verifier',
        opinion.attemptId,
        verifierEvent.id,
      ].join(':'),
      capabilityId: 'governance.verifier',
      evidenceClass: 'verified_execution',
      outcome: 'positive',
      observedAt: verifierEvent.occurredAt.toISOString(),
      occasionId: opinion.attemptId,
      proofRefs: [
        {
          kind: 'attempt',
          ref: opinion.attemptId,
          note: 'attempt sobre a qual o verifier operou',
        },
        {
          kind: 'verifier',
          ref: verifierEvent.id,
          note: `${opinion.verifierVersion}: ${opinion.verdict}`,
        },
        {
          kind: 'event',
          ref: resultEvent.id,
          note: 'resultado que o verifier analisou',
        },
        {
          kind: 'event',
          ref: observedGitEvent.id,
          note: 'Git observado que embasou o parecer',
        },
        {
          kind: 'event',
          ref: observedGateEvent.id,
          note: 'gates observados que embasaram o parecer',
        },
      ],
      note: 'Verifier operou sobre observação independente (git+gates) com veredito conclusivo.',
    });
  }

  return observations.sort(byObservedAtThenId);
}

/**
 * AGENCY.SUPERVISED-SELF-DEVELOPMENT — o ANIMA modificou o próprio código sob
 * supervisão humana válida.
 *
 * Parte da cadeia FORTE (mudança produzida e verificada de forma independente) e
 * soma a DECISÃO HUMANA de revisão sobre aquele resultado:
 *
 * - `result_accepted` (accepted_result_event_id) → ocasião POSITIVA (o supervisor
 *   aceitou a auto-modificação verificada);
 * - `changes_requested` (reviewed_result_event_id) → ocasião NEGATIVA (o
 *   supervisor pediu mudanças; o self-development não se sustentou — captura o
 *   padrão do falso-positivo seq4→seq5);
 * - sem decisão terminal ainda → NENHUMA observação (aguardando supervisão).
 *
 * Distingue-se de `produce-change` justamente pela SUPERVISÃO: a proposta foi
 * aprovada (correlação por versão) e a revisão humana atuou sobre o resultado.
 * `supervised` != `autonomous`: a intervenção humana NÃO invalida — ela é a prova.
 */
export function deriveSupervisedSelfDevelopmentEvidenceFromEvents(
  events: readonly WorkEvent[],
): readonly CapabilityEvidenceObservation[] {
  const observations: CapabilityEvidenceObservation[] = [];

  for (const resolved of resolveIndependentVerifierOpinions(events)) {
    if (!isStrongVerifiedExecution(resolved)) continue;

    const { opinion, verifierEvent, resultEvent } = resolved;

    // Decisão humana terminal de revisão sobre ESTE resultado. Append-only pode
    // conter mais de uma; a mais recente representa a supervisão vigente.
    let decision: { readonly event: WorkEvent; readonly accepted: boolean } | null =
      null;

    for (const event of events) {
      let accepted: boolean | null = null;

      if (
        event.type === 'result_accepted' &&
        readString(eventData(event), 'accepted_result_event_id') === resultEvent.id
      ) {
        accepted = true;
      } else if (
        event.type === 'changes_requested' &&
        readString(eventData(event), 'reviewed_result_event_id') === resultEvent.id
      ) {
        accepted = false;
      }

      if (accepted === null) continue;

      if (decision === null || compareEvents(event, decision.event) > 0) {
        decision = { event, accepted };
      }
    }

    if (decision === null) continue;

    const accepted = decision.accepted;

    observations.push({
      id: [
        'supervised-self-development',
        opinion.attemptId,
        resultEvent.id,
        decision.event.id,
      ].join(':'),
      capabilityId: 'agency.supervised-self-development',
      evidenceClass: 'verified_execution',
      outcome: accepted ? 'positive' : 'negative',
      observedAt: decision.event.occurredAt.toISOString(),
      occasionId: opinion.attemptId,
      proofRefs: [
        {
          kind: 'attempt',
          ref: opinion.attemptId,
          note: 'attempt do self-development',
        },
        {
          kind: 'event',
          ref: resultEvent.id,
          note: 'mudança produzida e verificada no próprio código',
        },
        {
          kind: 'verifier',
          ref: verifierEvent.id,
          note: `${opinion.verifierVersion}: ${opinion.verdict}`,
        },
        {
          kind: 'event',
          ref: decision.event.id,
          note: accepted
            ? 'revisão humana aceitou o resultado'
            : 'revisão humana pediu mudanças',
        },
      ],
      note: accepted
        ? 'Mudança no próprio código verificada e ACEITA sob supervisão humana.'
        : 'Mudança verificada, mas a revisão humana pediu mudanças (self-development não sustentado).',
    });
  }

  return observations.sort(byObservedAtThenId);
}
/**
 * Atribui fatos do worktree às capabilities canônicas mais estreitas que eles
 * realmente exercitaram.
 *
 * Importante:
 *
 * - NÃO usa `WorkCapability` (`programming`, `research`, ...);
 * - NÃO interpreta objective/expectedEffects por texto livre;
 * - NÃO conta proofRefs;
 * - cada capability tem sua própria régua factual;
 * - uma mesma attempt pode provar mais de uma capability quando realmente
 *   exercitou mais de um comportamento.
 *
 * V0:
 *
 * host-observed Git change
 *   -> agency.edit-file
 *
 * host-observed terminal gates all passed
 *   -> agency.run-tests
 *
 * strong verified worktree execution
 *   -> agency.produce-change
 *   -> agency.verify-change
 */
export function deriveCanonicalWorkCapabilityEvidenceFromEvents(
  events: readonly WorkEvent[],
): readonly CapabilityEvidenceObservation[] {
  const observations: CapabilityEvidenceObservation[] = [];

  /**
   * A ordem recebida não é autoridade.
   *
   * O event log é append-only, mas callers/testes podem fornecer o conjunto
   * fora de ordem. Canonicalizamos por occurredAt + id antes de escolher
   * o fato mais recente de cada attempt.
   */
  const canonicalEvents = [...events].sort((left, right) => {
    const leftTime = left.occurredAt.getTime();
    const rightTime = right.occurredAt.getTime();

    if (
      Number.isFinite(leftTime) &&
      Number.isFinite(rightTime) &&
      leftTime !== rightTime
    ) {
      return leftTime - rightTime;
    }

    return left.id.localeCompare(right.id);
  });

  const correlationKey = (
    value: {
      readonly workItemId: string;
      readonly attemptId: string;
      readonly approvedProposalVersion: number;
    },
  ): string =>
    [
      value.workItemId,
      value.attemptId,
      value.approvedProposalVersion,
    ].join(':');

  const results = new Map<
    string,
    {
      readonly event: WorkEvent;
      readonly handoff: NonNullable<
        ReturnType<typeof projectWorktreeHandoff>
      >;
    }
  >();

  const gitObservations = new Map<
    string,
    {
      readonly event: WorkEvent;
      readonly evidence: NonNullable<
        ReturnType<typeof projectHostObservedEvidence>
      >;
    }
  >();

  const coderObservations = new Map<
    string,
    {
      readonly event: WorkEvent;
      readonly evidence: NonNullable<
        ReturnType<typeof projectHostObservedCoderEvidence>
      >;
    }
  >();

  for (const event of canonicalEvents) {
    if (event.type === 'result_submitted') {
      const handoff = projectWorktreeHandoff([event]);

      if (handoff !== null) {
        results.set(
          correlationKey(handoff),
          {
            event,
            handoff,
          },
        );
      }

      continue;
    }

    if (event.type === 'host_observed_evidence_recorded') {
      const evidence = projectHostObservedEvidence([event]);

      if (evidence !== null) {
        gitObservations.set(
          correlationKey(evidence),
          {
            event,
            evidence,
          },
        );
      }

      continue;
    }

    if (event.type === 'host_observed_coder_evidence_recorded') {
      const evidence = projectHostObservedCoderEvidence([event]);

      if (evidence !== null) {
        coderObservations.set(
          correlationKey(evidence),
          {
            event,
            evidence,
          },
        );
      }

      continue;
    }

    if (event.type === 'host_observed_gate_evidence_recorded') {
      const observedGates =
        projectHostObservedGateEvidence([event]);

      if (observedGates === null) continue;

      const terminal =
        terminalObservedGates(observedGates.gates);

      if (
        terminal.length === 0 ||
        terminal.some(
          (gate) => gate.outcome !== 'passed',
        )
      ) {
        continue;
      }

      observations.push({
        id: [
          'host-observed-gates',
          'agency.run-tests',
          observedGates.attemptId,
          event.id,
        ].join(':'),
        capabilityId: 'agency.run-tests',
        evidenceClass: 'verified_execution',
        outcome: 'positive',
        observedAt: observedGates.observedAt,
        occasionId: observedGates.attemptId,
        proofRefs: [
          {
            kind: 'attempt',
            ref: observedGates.attemptId,
            note: 'attempt em que os gates foram executados',
          },
          {
            kind: 'event',
            ref: event.id,
            note: 'gates observados independentemente pelo host',
          },
        ],
        note:
          'Todos os gates terminais observados pelo host passaram.',
      });
    }
  }

  /**
   * EDIT-FILE
   *
   * Um diff sozinho NÃO prova que foi o coder que editou.
   *
   * Exigimos simultaneamente:
   *
   * 1. backend.edit() observado pelo host como succeeded;
   * 2. handoff durável da mesma attempt/backend;
   * 3. commit do handoff observado pelo host;
   * 4. conjunto de arquivos declarado == conjunto observado.
   */
  for (const [key, result] of results) {
    const git = gitObservations.get(key);
    const coder = coderObservations.get(key);

    if (!git || !coder) continue;

    if (result.handoff.status !== 'succeeded') continue;

    if (coder.evidence.outcome !== 'succeeded') continue;

    if (
      result.handoff.backendId !==
      coder.evidence.backendId
    ) {
      continue;
    }

    if (
      git.evidence.observedCommitSha !==
      result.handoff.commitSha
    ) {
      continue;
    }

    const declaredFiles = [
      ...result.handoff.changedFiles,
    ].sort();

    const observedFiles = [
      ...git.evidence.observedChangedFiles,
    ].sort();

    if (
      declaredFiles.length !== observedFiles.length ||
      declaredFiles.some(
        (path, index) =>
          path !== observedFiles[index],
      )
    ) {
      continue;
    }

    const timestamps = [
      result.event.occurredAt.getTime(),
      Date.parse(git.evidence.observedAt),
      Date.parse(coder.evidence.observedAt),
    ];

    if (
      timestamps.some(
        (timestamp) => !Number.isFinite(timestamp),
      )
    ) {
      continue;
    }

    observations.push({
      id: [
        'host-observed-coder-edit',
        'agency.edit-file',
        result.handoff.attemptId,
        result.event.id,
        git.event.id,
        coder.event.id,
      ].join(':'),
      capabilityId: 'agency.edit-file',
      evidenceClass: 'verified_execution',
      outcome: 'positive',
      observedAt: new Date(
        Math.max(...timestamps),
      ).toISOString(),
      occasionId: result.handoff.attemptId,
      proofRefs: [
        {
          kind: 'attempt',
          ref: result.handoff.attemptId,
          note: 'attempt em que o coder editou',
        },
        {
          kind: 'event',
          ref: result.event.id,
          note: 'handoff durável do coder',
        },
        {
          kind: 'event',
          ref: coder.event.id,
          note: `backend.edit() observado pelo host (${coder.evidence.backendId})`,
        },
        {
          kind: 'event',
          ref: git.event.id,
          note: 'alteração Git observada independentemente pelo host',
        },
      ],
      note:
        'Coder observado + handoff + Git convergem sobre a mesma alteração.',
    });
  }

  /**
   * PRODUCE-CHANGE
   *
   * Continua usando a cadeia forte:
   *
   * result + Git + gates + Verifier independente.
   */
  observations.push(
    ...deriveVerifiedWorktreeExecutionEvidenceFromEvents(
      'agency.produce-change',
      canonicalEvents,
    ),
  );

  /**
   * VERIFY-CHANGE
   *
   * A mesma cadeia forte demonstra que a alteração foi conferida
   * contra gates e Verifier, não apenas produzida.
   */
  observations.push(
    ...deriveVerifiedWorktreeExecutionEvidenceFromEvents(
      'agency.verify-change',
      canonicalEvents,
    ),
  );

  /**
   * GOVERNANCE.VERIFIER
   *
   * O verifier operou sobre observação independente com veredito conclusivo
   * (verified OU rejected) — "verifier funcionou", separado de "mudança correta".
   */
  observations.push(
    ...deriveVerifierOperationEvidenceFromEvents(canonicalEvents),
  );

  /**
   * SUPERVISED-SELF-DEVELOPMENT
   *
   * Cadeia forte verificada + decisão humana de revisão: aceite = ocasião
   * positiva; changes_requested = ocasião negativa (regressão real).
   */
  observations.push(
    ...deriveSupervisedSelfDevelopmentEvidenceFromEvents(canonicalEvents),
  );

  return observations.sort((left, right) => {
    const time =
      Date.parse(left.observedAt) -
      Date.parse(right.observedAt);

    if (time !== 0) return time;

    return left.id.localeCompare(right.id);
  });
}