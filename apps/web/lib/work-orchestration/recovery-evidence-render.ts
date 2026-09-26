import type { RecoveryEvidenceContextV1 } from '@anima/core';

/** Texto determinístico, compacto e rastreável. Só recebe fatos já sanitizados. */
export function renderRecoveryEvidence(context: RecoveryEvidenceContextV1): string {
  const lines = ['Evidence inherited from recovery ancestors (host-observed; do not repeat solved investigation):'];
  for (const item of context.items) {
    lines.push(
      `- source attempt ${item.sourceAttemptId}; event ${item.sourceEventId}`,
      `  failed gate: ${item.failedCommand}`,
      `  observed failure: ${item.observedFailure}`,
    );
    if (item.provenCorrection) {
      lines.push(
        `  later proven passed: ${item.provenCorrection.passedCommand}`,
        `  changed files: ${item.provenCorrection.changedFiles.join(', ') || '(not observed)'}`,
      );
      if (item.provenCorrection.patchExcerpt) lines.push(`  bounded observed patch:\n${item.provenCorrection.patchExcerpt}`);
    }
    lines.push(`  references: ${item.references.map(ref => `${ref.kind}:${ref.id}`).join(', ')}`);
  }
  if (context.truncated) lines.push('- Additional ancestor evidence was omitted by the bounded selector.');
  return lines.join('\n');
}
