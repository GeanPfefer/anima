// READINESS CALIBRATION — DRY-RUN READ-ONLY. US$0.
//
// Projeta, sob a identidade residente (GoTrue Bearer + RLS; NUNCA service_role), a
// COMPARAÇÃO POSTERIOR que a cadeia shadow foi construída para permitir: para cada
// tentativa revisada no histórico REAL, o que a Enforcement Readiness (shadow) DIRIA
// versus o que o HUMANO decidiu na revisão. Não aprova, não autoriza, não reserva, não
// executa, não promove, não usa provider pago. Apenas LÊ e imprime.
//
// A precisão de `eligible` (confirmados / (confirmados + otimistas)) é EVIDÊNCIA
// HISTÓRICA para uma futura decisão HUMANA de maturidade — nunca uma promoção
// automática (a política automática permanece explicitamente bloqueada, Marco 005).
//
//   node --experimental-transform-types --import ./scripts/ts-resolve.mjs \
//        --env-file-if-exists=.env.local scripts/readiness-calibration-readonly.ts

import { resolveCliIdentity } from '@/cli/identity';
import { correlateReadinessCalibration, summarizeReadinessCalibration } from '@anima/core';
import { readCanonicalWorkHistory } from '@/lib/evolution/capability-assessment-read';

async function main(): Promise<void> {
  const identity = await resolveCliIdentity();
  if (!identity.ok) throw new Error(identity.error);
  const { client, userId } = identity.identity;

  const history = await readCanonicalWorkHistory(client);
  if (!history.ok) {
    console.log(JSON.stringify({ ok: false, reason: history.reason }, null, 2));
    return;
  }

  const records = correlateReadinessCalibration(history.events);
  const summary = summarizeReadinessCalibration(records);

  console.log('=== READINESS CALIBRATION (READ-ONLY, US$0) ===');
  console.log(JSON.stringify({
    userId,
    eventCount: history.events.length,
    version: summary.version,
    total: summary.total,
    byOutcome: summary.byOutcome,
    eligibleAttempts: summary.eligibleAttempts,
    eligiblePrecision: summary.eligiblePrecision,
  }, null, 2));

  for (const record of records) {
    console.log(`\n--- ${record.workItemId} · attempt ${record.attemptId} · v${record.approvedProposalVersion} ---`);
    console.log(JSON.stringify({
      readinessRollup: record.rollup,
      humanReview: record.review,
      calibration: record.outcome,
    }, null, 2));
  }

  console.log('\n=== FIM (nada foi alterado: calibração é advisory; enforcement automático permanece bloqueado) ===');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
