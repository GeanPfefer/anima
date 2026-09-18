// SELF-DEVELOPMENT CONTINUOUS LOOP V0 — DRY-RUN READ-ONLY. US$0.
//
// Projeta, sob a identidade residente (GoTrue Bearer + RLS; NUNCA service_role),
// quais deficiências próprias o detector determinístico encontra no histórico
// REAL, com o ciclo de vida resolvido, e QUAL proposta de melhoria cada uma
// geraria — SEM criar nada. Não aprova, não autoriza, não reserva, não executa,
// não usa provider pago. Apenas LÊ e imprime.
//
//   npm run anima  → usa cli/anima.ts; este script roda com o MESMO runner:
//   node --experimental-transform-types --import ./scripts/ts-resolve.mjs \
//        --env-file-if-exists=.env.local scripts/self-deficiency-dry-run-readonly.ts

import { resolveCliIdentity } from '@/cli/identity';
import { formulateImprovementProposal, selfDeficienciesAwaitingProposal } from '@anima/core';
import { readSelfDeficiencies } from '@/lib/evolution/self-deficiency-read';

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client, userId } = identity.identity;

  const result = await readSelfDeficiencies(client);
  if (!result.ok) {
    console.log(JSON.stringify({ ok: false, reason: result.reason }, null, 2));
    return;
  }

  const awaiting = selfDeficienciesAwaitingProposal(result.deficiencies);
  console.log('=== SELF-DEFICIENCY DRY-RUN (READ-ONLY, US$0) ===');
  console.log(JSON.stringify({
    userId,
    eventCount: result.eventCount,
    totalDeficiencies: result.deficiencies.length,
    awaitingProposal: awaiting.length,
    byStatus: countBy(result.deficiencies.map(d => d.status)),
    byKind: countBy(result.deficiencies.map(d => d.kind)),
  }, null, 2));

  for (const deficiency of result.deficiencies) {
    console.log(`\n--- ${deficiency.id} [${deficiency.status}] ---`);
    console.log(JSON.stringify({
      kind: deficiency.kind,
      subject: deficiency.subject,
      summary: deficiency.summary,
      occurrences: deficiency.occurrences,
      occasions: deficiency.occasions,
      firstObservedAt: deficiency.firstObservedAt,
      lastObservedAt: deficiency.lastObservedAt,
      evidenceRefs: deficiency.evidenceRefs.length,
    }, null, 2));
    if (deficiency.status === 'open' || deficiency.status === 'reopened') {
      const proposal = formulateImprovementProposal(deficiency);
      console.log('  → PROPOSTA DE MELHORIA QUE SERIA FORMULADA (não criada):');
      console.log(JSON.stringify({
        objective: proposal.objective,
        expectedOutcome: proposal.expectedOutcome,
        acceptanceCriteria: proposal.acceptanceCriteria,
        impactLevel: proposal.impactLevel,
      }, null, 2));
    }
  }

  console.log('\n=== FIM (nada foi criado: sem approval/authority/reservation/attempt) ===');
}

function countBy(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return out;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
