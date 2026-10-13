import { renderHuman } from './render';
import type { CliPayload, WorkEvidencePayload } from './app';
import { projectExecutorCandidates, recommendExecutor } from '@/lib/work-orchestration/executor-discovery';

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
      ok: true, kind: 'work-show', reference: null, title: null, id: 'i', state: 'review', proposalVersion: 2, phase: 'Revisando', attemptId: 'a1',
      summary: 's', objective: 'o', includedScope: ['pkg/x.ts'], excludedScope: [], risks: [],
      plannedGates: [{ label: 'G', command: 'npm test', covers: ['A'] }],
      latestResult: { eventId: 'r', proposalVersion: 2, summary: 'feito' },
      verifierLive: { verdict: 'inconclusive', violations: 0, gaps: 3, checks: 11, restsOnAttestedEvidence: false },
      verifierRecorded: { verdict: 'verified', opinions: 1 },
      acceptance: { total: 2, covered: 1, missing: 1, criteria: [{ criterion: 'A', covered: true, proof: 'gate' }, { criterion: 'B', covered: false, proof: 'scope' }] },
      availableActions: ['accept_result', 'request_result_changes'], suggestedDecision: 'request_changes',
      provenance: { status: 'complete', issues: [] }, computeRouting: null, computePreference: { status: 'router_default', cleared: false },
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

  test('work-executors mostra candidatos, recomendação, honestidade e somente leitura', () => {
    const candidates = projectExecutorCandidates({
      contract: { coderBackend: 'claude-code', model: null },
      observations: [{ provider: 'claude-code', availability: 'ready', reasonUnavailable: null }, { provider: 'codex-cli', availability: 'unavailable', reasonUnavailable: 'codex_not_logged_in' }],
    });
    const outcome = recommendExecutor(candidates, { coderBackend: 'claude-code', model: null });
    const payload: CliPayload = { ok: true, kind: 'work-executors', reference: null, title: null, workItemId: 'i', state: 'approved', proposalVersion: 1, contractBackend: 'claude-code', observedAt: '2026-10-03T00:00:00.000Z', candidates, ...outcome };
    const out = renderHuman(payload);
    expect(out).toContain('Backend do contrato: claude-code');
    expect(out).toContain('Recomendado: claude-code:default (regra contract_declared)');
    expect(out).toContain('codex_not_logged_in');
    expect(out).toContain('parked_not_operational');
    expect(out).toContain('não afirma adequação do modelo');
    expect(out).toContain('Somente leitura');
  });

  test('work-executors sem recomendação lista os motivos', () => {
    const contract = { coderBackend: null, model: null };
    const candidates = projectExecutorCandidates({ contract, observations: [] });
    const out = renderHuman({ ok: true, kind: 'work-executors', reference: null, title: null, workItemId: 'i', state: 'approved', proposalVersion: 1, contractBackend: null, observedAt: 't', candidates, ...recommendExecutor(candidates, contract) });
    expect(out).toContain('Sem recomendação: no_ready_candidate');
    expect(out).toContain('ollama: readiness_not_probed');
    expect(out).toContain('(não declarado)');
  });

  test('erro é prefixado com o código', () => {
    const payload: CliPayload = { ok: false, kind: 'error', error: 'ausente', code: 'work_item_not_found' };
    expect(renderHuman(payload)).toBe('erro [work_item_not_found]: ausente');
  });
});

test('list prioriza referência e título e mantém diagnóstico do UUID', () => {
  const out = renderHuman({ ok: true, kind: 'work-list', items: [
    { id: 'uuid', reference: 'SDC-01', title: 'Título canônico', state: 'approved', proposalVersion: 1, phase: null, summary: 'Resumo' },
    { id: 'histórico', reference: null, title: null, state: 'review', proposalVersion: 1, phase: null, summary: 'Antigo' },
  ] });
  expect(out.split('\n').slice(0, 3)).toEqual(['SDC-01 — Título canônico', 'Estado: approved', 'id interno: uuid']);
  expect(out).toContain('histórico — sem referência humana canônica\nEstado: review\nid interno: histórico');
});


describe('work evidence — apresentação aditiva v4', () => {
  const payload: WorkEvidencePayload = {
    ok: true, kind: 'work-evidence', reference: null, title: null, id: 'i', state: 'review', proposalVersion: 2,
    attemptId: null, verifierLive: null, verifierRecorded: null,
    acceptanceCriteria: [{ criterion: 'A', covered: true, proof: 'gate' }, { criterion: 'B', covered: false, proof: 'scope' }],
    validationCriteria: [], declaredValidations: null, gaps: [], violations: [], findings: [],
    humanReviewPending: [], contractLint: { mode: 'legacy', findings: [] },
  };
  const previousOutput = [
    'i — sem referência humana canônica', 'Estado: review', 'id interno: i',
    'Verifier (agora): sem parecer (sem handoff durável)', '',
    'Critérios de aceite (aprovados pelo humano):',
    '  ✓ A  [prova: gate]', '  ✗ B  [prova: escopo]   (sem evidência suficiente)',
  ].join('\n');

  test.each(['legacy', 'v2'] as const)('sem pendências nem achados mantém saída byte a byte (%s)', mode => {
    expect(renderHuman({ ...payload, contractLint: { mode, findings: [] } })).toBe(previousOutput);
  });

  test('pendências mostram um item por aceite e rótulo human_review sem seção de lint vazia', () => {
    const out = renderHuman({ ...payload, humanReviewPending: ['C', 'D'],
      acceptanceCriteria: [{ criterion: 'C', covered: false, proof: 'human_review' }],
    });
    expect(out).toContain('Revisão humana pendente:\n  · C\n  · D');
    expect(out).toContain('[prova: human_review]');
    expect(out).not.toContain('Contrato de aceite');
  });

  test.each(['legacy', 'v2'] as const)('lint mostra mode, code e detail sem seção humana vazia (%s)', mode => {
    const out = renderHuman({ ...payload, contractLint: { mode, findings: [
      { code: 'duplicate_cover', subject: 'A', detail: 'Aceite duplicado' },
      { code: 'no_automated_proof', subject: null, detail: 'Sem prova automática' },
    ] } });
    expect(out).toContain(`Contrato de aceite (${mode}):\n  [duplicate_cover] Aceite duplicado\n  [no_automated_proof] Sem prova automática`);
    expect(out).not.toContain('Revisão humana pendente');
  });

  test('ambas as seções aparecem quando preenchidas', () => {
    const out = renderHuman({ ...payload, humanReviewPending: ['C'], contractLint: { mode: 'v2', findings: [
      { code: 'no_automated_proof', subject: null, detail: 'Sem prova automática' },
    ] } });
    expect(out).toContain('Revisão humana pendente:');
    expect(out).toContain('Contrato de aceite (v2):');
  });
});
