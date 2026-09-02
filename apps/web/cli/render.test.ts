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

  test('work-show contrasta Verifier ao vivo × registrado e marca cobertura de aceite', () => {
    const payload: CliPayload = {
      ok: true, kind: 'work-show', id: 'i', state: 'review', proposalVersion: 2, phase: 'Revisando', attemptId: 'a1',
      summary: 's', objective: 'o', includedScope: ['pkg/x.ts'], excludedScope: [], risks: [],
      plannedGates: [{ label: 'G', command: 'npm test', covers: ['A'] }],
      latestResult: { eventId: 'r', proposalVersion: 2, summary: 'feito' },
      verifierLive: { verdict: 'inconclusive', violations: 0, gaps: 3, checks: 11, restsOnAttestedEvidence: false },
      verifierRecorded: { verdict: 'verified', opinions: 1 },
      acceptance: { total: 2, covered: 1, missing: 1, criteria: [{ criterion: 'A', covered: true }, { criterion: 'B', covered: false }] },
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
