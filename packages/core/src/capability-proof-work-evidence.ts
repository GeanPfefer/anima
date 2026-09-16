import type { CapabilityEvidenceObservation } from './capability-proof-engine';
import { projectHostObservedEvidence } from './work-orchestration/host-observed-evidence';
import { projectHostObservedGateEvidence } from './work-orchestration/host-observed-gate-evidence';
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