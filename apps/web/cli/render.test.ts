import { renderHuman } from './render';
import type { CliPayload } from './app';

describe('render humano da CLI', () => {
  test('status lista estado e conexão', () => {
    const payload: CliPayload = { ok: true, kind: 'status', userId: 'u1', supabaseUrl: 'http://x', autonomyEnabled: true, resumable: { total: 2, byState: { review: 1, proposed: 1 } } };
    const out = renderHuman(payload);
    expect(out).toContain('conectado como u1');
    expect(out).toContain('Autonomia: habilitada');
    expect(out).toContain('review: 1');
  });

  test('budget status mostra decisão, saldos e próxima liberação', () => {
    const payload: CliPayload = { ok: true, kind: 'budget-status', workItemId: 'i', observedAt: '2026-09-05T12:00:00Z', policyVersion: 'p', costClass: 'external', admitted: false, reason: 'user_attempt_budget_exhausted', supervised:false,supervisionExpiresAt:null,unattendedAdmitted:false,unattendedReason:'user_attempt_budget_exhausted', userAttempts24h: 6, userAttemptsRemaining: 0, externalAttempts24h: 4, externalAttemptsRemaining: 2, windows: { attemptsHours: 24, userRuntimeHours: 24, autonomousRuntimeMinutes: 60 }, attempts: { item: { used: 2, limit: 3, remaining: 1, nextReleaseAt: null }, user: { used: 6, remaining: 0, nextReleaseAt: '2026-09-05T13:00:00Z' }, external: { used: 4, remaining: 2, nextReleaseAt: null } }, runtime: { user24h: { usedSeconds: 60, remainingSeconds: 7140 }, external24h: { usedSeconds: 30, remainingSeconds: 7170 }, autonomous60m: { usedSeconds: 10, remainingSeconds: 2690 } }, nextBudgetReleaseAt: '2026-09-05T13:00:00Z' };
    const out = renderHuman(payload);
    expect(out).toContain('reason=user_attempt_budget_exhausted');
    expect(out).toContain('Tentativas do usuário: 6 · restantes 0');
    expect(out).toContain('Próxima liberação estimável: 2026-09-05T13:00:00Z');
  });

  test('work-show contrasta Verifier ao vivo × registrado e marca cobertura de aceite', () => {
    const payload: CliPayload = {
      ok: true, kind: 'work-show', id: 'i', state: 'review', proposalVersion: 2, phase: 'Revisando', attemptId: 'a1',
      summary: 's', objective: 'o', includedScope: ['pkg/x.ts'], excludedScope: [], risks: [],
      plannedGates: [{ label: 'G', command: 'npm test', covers: ['A'] }],
      latestResult: { eventId: 'r', proposalVersion: 2, summary: 'feito' },
      verifierLive: { verdict: 'inconclusive', violations: 0, gaps: 3, checks: 11, restsOnAttestedEvidence: false },
      verifierRecorded: { verdict: 'verified', opinions: 1 },
      acceptance: { total: 2, covered: 1, missing: 1, criteria: [{ criterion: 'A', covered: true, proof: 'gate' }, { criterion: 'B', covered: false, proof: 'scope' }] },
      availableActions: ['accept_result', 'request_result_changes'], suggestedDecision: 'request_changes',
      provenance: { status: 'complete', issues: [] },
    };
    const out = renderHuman(payload);
    expect(out).toContain('Verifier (agora): inconclusive');
    expect(out).toContain('Verifier (registrado): verified');
    expect(out).toContain('✓ A');
    expect(out).toContain('✗ B');
    expect(out).toContain('Decisão sugerida: request_changes');
  });

  test('review resume o novo estado', () => {
    const payload: CliPayload = { ok: true, kind: 'review', workItemId: 'i', decision: 'request_changes', state: 'changes_requested', reviewedResultEventId: 'r', message: 'Correções solicitadas. Novo estado: changes_requested.' };
    expect(renderHuman(payload)).toContain('changes_requested');
  });

  test('erro é prefixado com o código', () => {
    const payload: CliPayload = { ok: false, kind: 'error', error: 'ausente', code: 'work_item_not_found' };
    expect(renderHuman(payload)).toBe('erro [work_item_not_found]: ausente');
  });
});
