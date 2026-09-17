import {
  DEFAULT_MAX_PROVISION_ATTEMPTS,
  classifyCloudProvisionFailure,
  deriveCloudSessionEnvelope,
  planNextCloudSessionAction,
  type CloudSessionEnvelopeV1,
  type CloudSessionProgressV1,
} from './cloud-session';

const envelope = (over: Partial<CloudSessionEnvelopeV1> = {}): CloudSessionEnvelopeV1 => ({
  schemaVersion: 1,
  cloudSessionId: 'sess-1',
  maxTotalCost: { currency: 'USD', amount: 1.5 },
  maxSessionDurationMs: 60 * 60_000,
  maxConcurrentNodes: 1,
  maxProvisionAttempts: DEFAULT_MAX_PROVISION_ATTEMPTS,
  maxAttemptsPerPlacement: 1,
  ...over,
});

const progress = (over: Partial<CloudSessionProgressV1> = {}): CloudSessionProgressV1 => ({
  elapsedMs: 0,
  committedCost: { currency: 'USD', amount: 0 },
  attemptsMade: 0,
  halt: 'none',
  terminalReason: null,
  ...over,
});

describe('classifyCloudProvisionFailure', () => {
  test('endpoint_unpublished → recuperável por troca de placement (barreira 2026-09-10)', () => {
    expect(classifyCloudProvisionFailure('endpoint_unpublished')).toEqual({
      reason: 'endpoint_unpublished', failureClass: 'endpoint_publication_timeout',
      disposition: 'reprovision', excludePlacement: true,
    });
  });

  test('capacity_unavailable → candidato sem capacidade, reprovision', () => {
    expect(classifyCloudProvisionFailure('capacity_unavailable')).toMatchObject({
      failureClass: 'candidate_capacity_absent', disposition: 'reprovision', excludePlacement: true,
    });
  });

  test('health_failed e provision_failed → placement insalubre, reprovision', () => {
    expect(classifyCloudProvisionFailure('health_failed')).toMatchObject({ failureClass: 'placement_unhealthy', disposition: 'reprovision', excludePlacement: true });
    expect(classifyCloudProvisionFailure('provision_failed')).toMatchObject({ failureClass: 'placement_unhealthy', disposition: 'reprovision', excludePlacement: true });
  });

  test('tunnel_unavailable → falha DE PLACEMENT (túnel da máquina não subiu), reprovision — NÃO halt global (barreira 2026-09-10, 2º A40 mapping oscilou)', () => {
    expect(classifyCloudProvisionFailure('tunnel_unavailable')).toEqual({
      reason: 'tunnel_unavailable', failureClass: 'placement_unhealthy',
      disposition: 'reprovision', excludePlacement: true,
    });
  });

  test('provider_unreachable e rate_limited → provider fora, halt sem martelar (não exclui placement)', () => {
    expect(classifyCloudProvisionFailure('provider_unreachable')).toMatchObject({ failureClass: 'provider_unavailable', disposition: 'halt_provider_unavailable', excludePlacement: false });
    expect(classifyCloudProvisionFailure('rate_limited')).toMatchObject({ failureClass: 'provider_unavailable', disposition: 'halt_provider_unavailable', excludePlacement: false });
  });

  test('auth/quota/identidade/desconhecido → terminal fail-closed', () => {
    for (const reason of ['auth_invalid', 'quota_exceeded', 'provider_identity_unpersisted', 'aborted', 'algo_novo_desconhecido']) {
      expect(classifyCloudProvisionFailure(reason)).toMatchObject({ failureClass: 'non_recoverable', disposition: 'halt_terminal', excludePlacement: false });
    }
  });
});

describe('deriveCloudSessionEnvelope', () => {
  test('constrói envelope válido com maxConcurrentNodes fixo em 1', () => {
    const env = deriveCloudSessionEnvelope({ cloudSessionId: 's', maxTotalCost: { currency: 'USD', amount: 1.5 }, maxSessionDurationMs: 1000 });
    expect(env).not.toBeNull();
    expect(env!.maxConcurrentNodes).toBe(1);
    expect(env!.maxProvisionAttempts).toBe(DEFAULT_MAX_PROVISION_ATTEMPTS);
  });

  test('fail-closed: id em branco, duração não-positiva, ou custo malformado → null', () => {
    expect(deriveCloudSessionEnvelope({ cloudSessionId: '  ', maxSessionDurationMs: 1000 })).toBeNull();
    expect(deriveCloudSessionEnvelope({ cloudSessionId: 's', maxSessionDurationMs: 0 })).toBeNull();
    expect(deriveCloudSessionEnvelope({ cloudSessionId: 's', maxSessionDurationMs: 1000, maxTotalCost: { currency: 'USD', amount: -1 } })).toBeNull();
  });

  test('maxTotalCost ausente = sessão sem teto agregado (autoridade paga continua o teto duro)', () => {
    const env = deriveCloudSessionEnvelope({ cloudSessionId: 's', maxSessionDurationMs: 1000 });
    expect(env!.maxTotalCost).toBeNull();
  });

  test('maxAttemptsPerPlacement default 1; override positivo respeitado; inválido cai no default', () => {
    expect(deriveCloudSessionEnvelope({ cloudSessionId: 's', maxSessionDurationMs: 1000 })!.maxAttemptsPerPlacement).toBe(1);
    expect(deriveCloudSessionEnvelope({ cloudSessionId: 's', maxSessionDurationMs: 1000, maxAttemptsPerPlacement: 2 })!.maxAttemptsPerPlacement).toBe(2);
    expect(deriveCloudSessionEnvelope({ cloudSessionId: 's', maxSessionDurationMs: 1000, maxAttemptsPerPlacement: 0 })!.maxAttemptsPerPlacement).toBe(1);
  });
});

describe('planNextCloudSessionAction', () => {
  const next = { placementId: 'runpod:NVIDIA A40', estimatedCost: { currency: 'USD', amount: 0.245 } };

  test('primeira volta com budget/tempo/candidato → provision', () => {
    expect(planNextCloudSessionAction({ envelope: envelope(), progress: progress(), nextCandidate: next })).toEqual({
      action: 'provision', placementId: 'runpod:NVIDIA A40', estimatedCost: { currency: 'USD', amount: 0.245 },
    });
  });

  test('última falha terminal → stop terminal_failure com razão preservada', () => {
    expect(planNextCloudSessionAction({ envelope: envelope(), progress: progress({ halt: 'terminal', terminalReason: 'auth_invalid' }), nextCandidate: next }))
      .toEqual({ action: 'stop', reason: 'terminal_failure', detail: 'auth_invalid' });
  });

  test('provider fora → stop provider_unavailable (precede budget/candidato)', () => {
    expect(planNextCloudSessionAction({ envelope: envelope(), progress: progress({ halt: 'provider_unavailable', terminalReason: 'provider_unreachable' }), nextCandidate: next }))
      .toMatchObject({ action: 'stop', reason: 'provider_unavailable' });
  });

  test('deadline da sessão vencido → stop session_deadline_reached', () => {
    expect(planNextCloudSessionAction({ envelope: envelope({ maxSessionDurationMs: 1000 }), progress: progress({ elapsedMs: 1000 }), nextCandidate: next }))
      .toMatchObject({ action: 'stop', reason: 'session_deadline_reached' });
  });

  test('sem candidato elegível → stop no_more_candidates', () => {
    expect(planNextCloudSessionAction({ envelope: envelope(), progress: progress(), nextCandidate: null }))
      .toMatchObject({ action: 'stop', reason: 'no_more_candidates' });
  });

  test('committed + estimativa excede teto → stop session_budget_exhausted (fail-closed)', () => {
    expect(planNextCloudSessionAction({
      envelope: envelope({ maxTotalCost: { currency: 'USD', amount: 0.3 } }),
      progress: progress({ committedCost: { currency: 'USD', amount: 0.082 } }),
      nextCandidate: { placementId: 'p', estimatedCost: { currency: 'USD', amount: 0.245 } },
    })).toMatchObject({ action: 'stop', reason: 'session_budget_exhausted' });
  });

  test('excesso liberado por settlement reabre budget para o próximo candidato', () => {
    // committed caiu de 0.245 para 0.082 (settlement do 1º Pod) → 0.082 + 0.245 = 0.327 ≤ 1.5.
    expect(planNextCloudSessionAction({
      envelope: envelope({ maxTotalCost: { currency: 'USD', amount: 1.5 } }),
      progress: progress({ committedCost: { currency: 'USD', amount: 0.082 }, attemptsMade: 1 }),
      nextCandidate: { placementId: 'p2', estimatedCost: { currency: 'USD', amount: 0.245 } },
    })).toMatchObject({ action: 'provision', placementId: 'p2' });
  });

  test('committed 0.49 + nova reserva 0.245 cabe no teto agregado 1.50', () => {
    expect(planNextCloudSessionAction({
      envelope: envelope({ maxTotalCost: { currency: 'USD', amount: 1.5 } }),
      progress: progress({ committedCost: { currency: 'USD', amount: 0.49 } }),
      nextCandidate: { placementId: 'runpod:NVIDIA A40', estimatedCost: { currency: 'USD', amount: 0.245 } },
    })).toMatchObject({ action: 'provision', placementId: 'runpod:NVIDIA A40' });
  });

  test('committed realmente excedido continua fail-closed', () => {
    expect(planNextCloudSessionAction({
      envelope: envelope({ maxTotalCost: { currency: 'USD', amount: 1.5 } }),
      progress: progress({ committedCost: { currency: 'USD', amount: 1.3 } }),
      nextCandidate: { placementId: 'runpod:NVIDIA A40', estimatedCost: { currency: 'USD', amount: 0.245 } },
    })).toMatchObject({ action: 'stop', reason: 'session_budget_exhausted' });
  });

  test('teto agregado sem estimativa de custo → stop cost_estimate_unavailable (fail-closed)', () => {
    expect(planNextCloudSessionAction({ envelope: envelope(), progress: progress(), nextCandidate: { placementId: 'p', estimatedCost: null } }))
      .toMatchObject({ action: 'stop', reason: 'cost_estimate_unavailable' });
  });

  test('sem teto agregado: estimativa nula NÃO barra (autoridade paga é o teto duro)', () => {
    expect(planNextCloudSessionAction({ envelope: envelope({ maxTotalCost: null }), progress: progress({ committedCost: null }), nextCandidate: { placementId: 'p', estimatedCost: null } }))
      .toMatchObject({ action: 'provision', placementId: 'p' });
  });

  test('moeda divergente entre estimativa e teto → stop currency_mismatch', () => {
    expect(planNextCloudSessionAction({ envelope: envelope(), progress: progress(), nextCandidate: { placementId: 'p', estimatedCost: { currency: 'EUR', amount: 0.1 } } }))
      .toMatchObject({ action: 'stop', reason: 'currency_mismatch' });
  });

  test('rede defensiva de tentativas só barra depois de budget/tempo/candidato', () => {
    expect(planNextCloudSessionAction({ envelope: envelope({ maxProvisionAttempts: 2 }), progress: progress({ attemptsMade: 2 }), nextCandidate: next }))
      .toMatchObject({ action: 'stop', reason: 'attempt_limit_reached' });
    // com budget esgotado E tentativas no teto, budget vence (governança real precede rede defensiva)
    expect(planNextCloudSessionAction({
      envelope: envelope({ maxProvisionAttempts: 2, maxTotalCost: { currency: 'USD', amount: 0.1 } }),
      progress: progress({ attemptsMade: 2, committedCost: { currency: 'USD', amount: 0.1 } }),
      nextCandidate: next,
    })).toMatchObject({ action: 'stop', reason: 'session_budget_exhausted' });
  });
});
