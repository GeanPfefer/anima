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

/**
 * Adapter do histórico real de self-development para a ontologia genérica
 * do Capability Proof Engine.
 *
 * Este V0 é DELIBERADAMENTE estreito:
 *
 * - só reconhece execução de código via worktree;
 * - exige resultado durável;
 * - exige Git observado pelo host;
 * - exige gates observados pelo host;
 * - exige todos os gates observados como `passed`;
 * - exige parecer persistido do Verifier com coverage git+gates;
 * - exige correlação exata por item + attempt + versão;
 * - não transforma `verified` puramente atestado em prova forte.
 *
 * Retorna UMA observação por attempt cujo parecer válido mais recente satisfaça
 * o contrato. Parecer posterior rejected/inconclusive invalida o antigo
 * `verified` daquela mesma attempt.
 */
export function deriveVerifiedWorktreeExecutionEvidenceFromEvents(
  capabilityId: string,
  events: readonly WorkEvent[],
): readonly CapabilityEvidenceObservation[] {
  if (capabilityId.trim().length === 0) return [];

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

  const observations: CapabilityEvidenceObservation[] = [];

  for (const candidate of latestByAttempt.values()) {
    const { event: verifierEvent, opinion } = candidate;

    if (opinion.verdict !== 'verified') continue;

    const basis = opinion.evidenceBasis;

    // Um `verified` atestado continua útil para review, mas NÃO constitui
    // `verified_execution` no Capability Proof Engine.
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

    // Resultado de worktree precisa de fato ter terminado com sucesso.
    if (handoff.status !== 'succeeded') continue;

    // Não basta o executor declarar um commit: o host precisa ter observado
    // exatamente esse commit.
    if (observedGit.observedCommitSha !== handoff.commitSha) continue;

    // Gate observado é autoridade sobre execução. Qualquer falha impede a
    // emissão de evidência positiva.
    if (observedGates.gates.some((gate) => gate.outcome !== 'passed')) {
      continue;
    }

    const observedAt = verifierEvent.occurredAt.toISOString();

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
      observedAt,
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

  return observations.sort((left, right) => {
    const time = Date.parse(left.observedAt) - Date.parse(right.observedAt);

    if (time !== 0) return time;

    return left.id.localeCompare(right.id);
  });
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

  return observations.sort((left, right) => {
    const time =
      Date.parse(left.observedAt) -
      Date.parse(right.observedAt);

    if (time !== 0) return time;

    return left.id.localeCompare(right.id);
  });
}