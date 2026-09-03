import type { CliPayload, VerifierSummaryPayload } from './app';

// Render HUMANO derivado do payload estável. Curto e legível; o `--json` é a
// interface de automação. Sem cores/ANSI (funciona em log e pipe). Uma única
// fonte de verdade: os mesmos dados do JSON, só formatados.

const YES = '✓'; // ✓
const NO = '✗';  // ✗
const DOT = '·'; // ·

const verdictLabel = (v: VerifierSummaryPayload | null): string =>
  v === null ? 'sem parecer (sem handoff durável)' : `${v.verdict} (violations ${v.violations} ${DOT} gaps ${v.gaps} ${DOT} checks ${v.checks})`;

const proofLabel = (proof: 'gate' | 'scope' | null): string =>
  proof === 'gate' ? 'gate' : proof === 'scope' ? 'escopo' : '—';

export function renderHuman(payload: CliPayload): string {
  switch (payload.kind) {
    case 'help':
      return payload.usage;

    case 'error':
      return `erro${payload.code ? ` [${payload.code}]` : ''}: ${payload.error}`;

    case 'status': {
      const states = Object.entries(payload.resumable.byState).map(([s, n]) => `${s}: ${n}`).join(`  ${DOT}  `);
      return [
        `anima ${DOT} conectado como ${payload.userId}`,
        `Supabase: ${payload.supabaseUrl}`,
        `Autonomia: ${payload.autonomyEnabled ? 'habilitada' : 'desabilitada'}`,
        `Trabalhos retomáveis: ${payload.resumable.total}${states ? `  (${states})` : ''}`,
      ].join('\n');
    }

    case 'work-list': {
      if (payload.items.length === 0) return 'Nenhum trabalho retomável.';
      return payload.items
        .map(item => `${item.id}  ${item.state.padEnd(18)}  ${item.summary}`)
        .join('\n');
    }

    case 'work-show': {
      const lines: string[] = [];
      lines.push(`${payload.id} ${DOT} ${payload.state}${payload.phase ? ` (${payload.phase})` : ''}`);
      lines.push(`Proposta v${payload.proposalVersion}${payload.attemptId ? ` ${DOT} tentativa ${payload.attemptId}` : ''}`);
      lines.push(`Resumo: ${payload.summary}`);
      lines.push(`Objetivo: ${payload.objective}`);
      if (payload.includedScope.length > 0) lines.push(`Escopo incluído: ${payload.includedScope.join(' | ')}`);
      if (payload.excludedScope.length > 0) lines.push(`Escopo excluído: ${payload.excludedScope.join(' | ')}`);
      if (payload.plannedGates.length > 0) {
        lines.push('');
        lines.push('Gates planejados (execution_spec · covers):');
        for (const g of payload.plannedGates) {
          const covers = g.covers.length > 0 ? `cobre: ${g.covers.join(' | ')}` : 'SEM covers';
          lines.push(`  ${DOT} ${g.label}${g.command ? ` [${g.command}]` : ''} → ${covers}`);
        }
      }
      lines.push('');
      lines.push(`Verifier (agora): ${verdictLabel(payload.verifierLive)}`);
      if (payload.verifierRecorded) {
        lines.push(`Verifier (registrado): ${payload.verifierRecorded.verdict} (${payload.verifierRecorded.opinions} parecer(es))`);
      }
      lines.push('');
      lines.push(`Cobertura de aceite: ${payload.acceptance.covered}/${payload.acceptance.total} com evidência`);
      for (const c of payload.acceptance.criteria) {
        lines.push(`  ${c.covered ? YES : NO} ${c.criterion}  [prova: ${proofLabel(c.proof)}]`);
      }
      if (payload.provenance.issues.length > 0) {
        lines.push('');
        lines.push(`Proveniência: ${payload.provenance.status} (${payload.provenance.issues.join(', ')})`);
      }
      lines.push('');
      lines.push(`Ações disponíveis: ${payload.availableActions.length ? payload.availableActions.join(', ') : '(nenhuma)'}`);
      if (payload.suggestedDecision) lines.push(`Decisão sugerida: ${payload.suggestedDecision}`);
      return lines.join('\n');
    }

    case 'work-evidence': {
      const lines: string[] = [];
      lines.push(`${payload.id} ${DOT} ${payload.state}${payload.attemptId ? ` ${DOT} tentativa ${payload.attemptId}` : ''}`);
      lines.push(`Verifier (agora): ${verdictLabel(payload.verifierLive)}`);
      if (payload.verifierRecorded) lines.push(`Verifier (registrado): ${payload.verifierRecorded.verdict}`);
      lines.push('');
      lines.push('Critérios de aceite (aprovados pelo humano):');
      for (const c of payload.acceptanceCriteria) lines.push(`  ${c.covered ? YES : NO} ${c.criterion}  [prova: ${proofLabel(c.proof)}]${c.covered ? '' : '   (sem evidência suficiente)'}`);
      if (payload.validationCriteria.length > 0) {
        lines.push('');
        lines.push('Critérios de validação (gates declarados):');
        for (const v of payload.validationCriteria) {
          const mark = v.status === 'covered' ? YES : v.status === 'gap' ? NO : DOT;
          lines.push(`  ${mark} ${v.label}${v.status === 'unverifiable' ? '   (só declarado, a cargo do humano)' : v.status === 'gap' ? '   (nenhum gate executado)' : ''}`);
        }
      }
      if (payload.declaredValidations && payload.declaredValidations.length > 0) {
        lines.push('');
        lines.push('Validações autodeclaradas no resultado:');
        for (const v of payload.declaredValidations) lines.push(`  ${DOT} ${v.label} — ${v.outcome}`);
      }
      if (payload.violations.length > 0) {
        lines.push('');
        lines.push('Violações:');
        for (const v of payload.violations) lines.push(`  ${NO} [${v.code}]${v.subject ? ` ${v.subject}:` : ''} ${v.detail}`);
      }
      if (payload.gaps.length > 0) {
        lines.push('');
        lines.push('Lacunas (impedem VERIFIED):');
        for (const g of payload.gaps) lines.push(`  ${NO} [${g.code}]${g.subject ? ` ${g.subject}:` : ''} ${g.detail}`);
      }
      return lines.join('\n');
    }

    case 'review':
      return `${payload.workItemId} ${DOT} ${payload.decision} ${DOT} ${payload.message}`;

    case 'approve':
      return `${payload.workItemId} ${DOT} ${payload.message}`;

    case 'withdraw':
      return `${payload.workItemId} ${DOT} ${payload.message}`;

    case 'retry':
      return [
        `${payload.workItemId} ${DOT} ${payload.message}`,
        `retryRequestId: ${payload.retryRequestId} ${DOT} failureEvent: ${payload.failureEventId} ${DOT} v${payload.expectedProposalVersion}${payload.replayed ? ' (replay)' : ''}`,
      ].join('\n');

    case 'work-correct':
      return [
        `${payload.message}`,
        `Sucessor: ${payload.successorWorkItemId}`,
        `Lineage: ${payload.lineageId} ${DOT} seq ${payload.recoverySequence}${payload.replayed ? ' (replay)' : ''}`,
        `Próximo passo: anima work show ${payload.successorWorkItemId} ${DOT} depois anima work approve ${payload.successorWorkItemId}`,
      ].join('\n');
    case 'work-replan':
      return `Sucessor: ${payload.successorWorkItemId}\nLineage: ${payload.lineageId}\nReplan: ${payload.replanId}${payload.replayed ? ' (replay)' : ''}\nBudget transferido: ${payload.allocatedAttempts}\nEstratégia: ${payload.strategy.map(s=>`${s.kind}: ${s.symbols.join(', ')}`).join(' | ')}\nAprovação humana permanece separada.`;

    case 'work-authorize-resume':
      return [
        `Autoridade humana de retomada registrada${payload.replayed ? ' (replay idempotente)' : ''}.`,
        `Concessão: ${payload.authorizationId}`,
        `Sucessor (proposed): ${payload.successorWorkItemId}`,
        `Lineage: ${payload.lineageId}`,
        `Orçamento: consumido ${payload.previousConsumed} ${DOT} +${payload.additionalAttempts} ${DOT} teto agregado ${payload.aggregateCeiling} (consumo anterior preservado)`,
        `Próximo passo: anima work show ${payload.successorWorkItemId} ${DOT} depois anima work approve ${payload.successorWorkItemId}. Nova falha volta ao humano.`,
      ].join('\n');
  }
}
