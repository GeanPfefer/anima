import {
  runResidentHost,
  classifyResidentNext,
  errorBackoffMs,
  DEFAULT_BACKOFF,
  type ResidentHostDependencies,
  type ResidentIdentity,
  type HostTurnOutcome,
  type AdmissionVerdict,
  type WakeReason,
  type BackoffPolicy,
} from './resident-host';

// ============================================================
// A engine do resident host é o LAÇO GOVERNADO por cima do host-turn bounded já
// provado. Aqui provamos SÓ o que é exclusivo do laço — reconcilia, kill-switch,
// identidade fail-closed, pré-gate do Governor, quiescência/backoff, wake e
// cancelamento determinístico — tudo por doubles, sem rede, sem banco, sem execução
// real. As 15 regressões exigidas pelo handoff estão numeradas abaixo.
// ============================================================

const IDENTITY: ResidentIdentity = { userId: 'user-1', accessToken: 'opaque-token' };

const OUT = {
  drained: { ok: true, continuation: 'stop', stopReason: 'no_eligible_work', moreWorkAvailable: false, cyclesExecuted: 1, itemsTouched: 1, workItemIds: ['item-a'] } as const,
  moreWork: { ok: true, continuation: 'continue', stopReason: 'max_cycles_reached', moreWorkAvailable: true, cyclesExecuted: 2, itemsTouched: 2, workItemIds: ['item-a', 'item-b'] } as const,
  humanWait: { ok: true, continuation: 'wait', stopReason: 'awaiting_human_or_recovery', moreWorkAvailable: false, cyclesExecuted: 1, itemsTouched: 0, workItemIds: [] } as const,
  resource: { ok: true, continuation: 'wait', stopReason: 'resource_pressure', moreWorkAvailable: false, cyclesExecuted: 0, itemsTouched: 0, workItemIds: [] } as const,
  error: { ok: false, error: 'boom' } as const,
} satisfies Record<string, HostTurnOutcome>;

/** Sequência de desfechos do host-turn; o último repete. Conta chamadas, captura
 * identidades e mede concorrência (nunca deve exceder 1). */
const hostTurnScript = (outcomes: readonly HostTurnOutcome[]) => {
  const calls = { count: 0, live: 0, maxLive: 0, identities: [] as ResidentIdentity[] };
  const run = async (identity: ResidentIdentity): Promise<HostTurnOutcome> => {
    calls.live++; calls.maxLive = Math.max(calls.maxLive, calls.live);
    calls.identities.push(identity);
    const out = outcomes[Math.min(calls.count, outcomes.length - 1)] ?? OUT.drained;
    calls.count++;
    await Promise.resolve();
    calls.live--;
    return out;
  };
  return { run, calls };
};

/** Wake scriptado: devolve as razões em ordem (última repete); captura os backoffMs.
 * Uma razão `cancelled` também aborta o controller (shutdown determinístico). */
const wakeScript = (reasons: readonly WakeReason[], controller: AbortController) => {
  const calls = { count: 0, backoffs: [] as number[] };
  const wait = async ({ backoffMs }: { backoffMs: number; signal: AbortSignal }): Promise<WakeReason> => {
    calls.backoffs.push(backoffMs);
    const reason = reasons[Math.min(calls.count, reasons.length - 1)] ?? 'cancelled';
    calls.count++;
    if (reason === 'cancelled') controller.abort();
    return reason;
  };
  return { wait, calls };
};

const deps = (over: Partial<ResidentHostDependencies> & { signal: AbortSignal }): ResidentHostDependencies => ({
  reconcile: async () => {},
  checkAutonomyEnabled: () => true,
  acquireIdentity: async () => IDENTITY,
  admitNewWork: () => 'permit',
  runHostTurn: async () => OUT.drained,
  waitForWake: async () => 'cancelled',
  maxIterations: 100,
  ...over,
});

describe('classifyResidentNext (puro)', () => {
  test('continue + moreWorkAvailable → run_again', () => {
    expect(classifyResidentNext(OUT.moreWork)).toBe('run_again');
  });
  test('resource_pressure → wait_resource (antes de wait genérico)', () => {
    expect(classifyResidentNext(OUT.resource)).toBe('wait_resource');
  });
  test('wait de fronteira humana → wait_human', () => {
    expect(classifyResidentNext(OUT.humanWait)).toBe('wait_human');
  });
  test('stop definitivo → idle', () => {
    expect(classifyResidentNext(OUT.drained)).toBe('idle');
  });
  test('continue sem moreWork (defensivo) → idle', () => {
    expect(classifyResidentNext({ ...OUT.moreWork, moreWorkAvailable: false })).toBe('idle');
  });
});

describe('errorBackoffMs (puro)', () => {
  test('exponencial no número de erros consecutivos', () => {
    expect(errorBackoffMs(1, DEFAULT_BACKOFF)).toBe(2_000);
    expect(errorBackoffMs(2, DEFAULT_BACKOFF)).toBe(4_000);
    expect(errorBackoffMs(3, DEFAULT_BACKOFF)).toBe(8_000);
  });
  test('capado em maxMs', () => {
    expect(errorBackoffMs(100, DEFAULT_BACKOFF)).toBe(DEFAULT_BACKOFF.maxMs);
  });
});

describe('runResidentHost — laço governado', () => {
  // (1) startup + backlog ready + governor permit → host-turn chamado.
  test('(1) arranque com trabalho pronto e Governor permit → invoca host-turn como o usuário', async () => {
    const c = new AbortController();
    const ht = hostTurnScript([OUT.drained]);
    const admit = { count: 0 };
    const summary = await runResidentHost(deps({
      signal: c.signal, runHostTurn: ht.run,
      admitNewWork: () => { admit.count++; return 'permit'; },
      waitForWake: wakeScript(['cancelled'], c).wait,
    }));
    expect(ht.calls.count).toBe(1);
    expect(ht.calls.identities[0]).toEqual(IDENTITY);
    expect(admit.count).toBe(1); // Governor consultado ANTES do host-turn.
    expect(summary.states).toContain('running');
    expect(summary.finalState).toBe('stopped');
  });

  // (2) startup sem trabalho → idle/quiesce.
  test('(2) arranque sem trabalho → idle e quiesce (sem spin)', async () => {
    const c = new AbortController();
    const ht = hostTurnScript([OUT.drained]);
    const w = wakeScript(['cancelled'], c);
    const summary = await runResidentHost(deps({ signal: c.signal, runHostTurn: ht.run, waitForWake: w.wait }));
    expect(ht.calls.count).toBe(1);
    expect(summary.states).toContain('idle');
    expect(w.calls.count).toBe(1); // cedeu o controle ao wake — não girou.
    expect(w.calls.backoffs[0]).toBe(DEFAULT_BACKOFF.idleMs);
  });

  // (3) autonomy disabled → zero nova execução.
  test('(3) kill-switch desligado → zero host-turn, estado disabled', async () => {
    const c = new AbortController();
    const ht = hostTurnScript([OUT.drained]);
    const rec = { count: 0 };
    const summary = await runResidentHost(deps({
      signal: c.signal, runHostTurn: ht.run,
      checkAutonomyEnabled: () => false,
      reconcile: async () => { rec.count++; },
      waitForWake: wakeScript(['cancelled'], c).wait,
    }));
    expect(ht.calls.count).toBe(0);
    expect(rec.count).toBe(0); // desligado congela até reconciliação (frozen).
    expect(summary.states).toContain('disabled');
    expect(summary.states).not.toContain('running');
  });

  // (4) auth unavailable → fail-closed.
  test('(4) identidade indisponível → fail-closed, nunca invoca host-turn', async () => {
    const c = new AbortController();
    const ht = hostTurnScript([OUT.drained]);
    const rec = { count: 0 };
    const summary = await runResidentHost(deps({
      signal: c.signal, runHostTurn: ht.run,
      acquireIdentity: async () => null,
      reconcile: async () => { rec.count++; },
      waitForWake: wakeScript(['cancelled'], c).wait,
    }));
    expect(ht.calls.count).toBe(0);
    expect(rec.count).toBe(0); // reconciliação também exige identidade.
    expect(summary.states).toContain('waiting_human_or_recovery');
  });

  // (5) resource pressure (pré-gate) → waiting/backoff, sem host-turn.
  test('(5) Governor adia no pré-gate → waiting_resource, sem host-turn', async () => {
    const c = new AbortController();
    const ht = hostTurnScript([OUT.drained]);
    const w = wakeScript(['cancelled'], c);
    const admit = { count: 0 };
    const summary = await runResidentHost(deps({
      signal: c.signal, runHostTurn: ht.run,
      admitNewWork: () => { admit.count++; return 'defer'; },
      waitForWake: w.wait,
    }));
    expect(ht.calls.count).toBe(0);
    expect(admit.count).toBe(1);
    expect(summary.states).toContain('waiting_resource');
    expect(w.calls.backoffs[0]).toBe(DEFAULT_BACKOFF.resourceMs);
  });

  // (5b) telemetria indisponível (fail_closed) também adia.
  test('(5b) admissão fail_closed → waiting_resource, sem host-turn', async () => {
    const c = new AbortController();
    const ht = hostTurnScript([OUT.drained]);
    await runResidentHost(deps({
      signal: c.signal, runHostTurn: ht.run,
      admitNewWork: () => 'fail_closed',
      waitForWake: wakeScript(['cancelled'], c).wait,
    }));
    expect(ht.calls.count).toBe(0);
  });

  // (6) host-turn conclui e backlog esgota → idle.
  test('(6) host-turn drena a fila → idle', async () => {
    const c = new AbortController();
    const ht = hostTurnScript([OUT.drained]);
    const summary = await runResidentHost(deps({
      signal: c.signal, runHostTurn: ht.run,
      waitForWake: wakeScript(['cancelled'], c).wait,
    }));
    expect(ht.calls.count).toBe(1);
    expect(summary.states.filter(s => s === 'idle').length).toBe(1);
  });

  // (7) host-turn conclui e ainda há trabalho → continua dentro da política/bounds.
  test('(7) continue + moreWork → roda de novo IMEDIATAMENTE (sem wait), reconcilia só uma vez', async () => {
    const c = new AbortController();
    const ht = hostTurnScript([OUT.moreWork, OUT.drained]);
    const w = wakeScript(['cancelled'], c);
    const rec = { count: 0 };
    const admit = { count: 0 };
    const summary = await runResidentHost(deps({
      signal: c.signal, runHostTurn: ht.run,
      reconcile: async () => { rec.count++; },
      admitNewWork: () => { admit.count++; return 'permit'; },
      waitForWake: w.wait,
    }));
    expect(ht.calls.count).toBe(2);
    expect(admit.count).toBe(2); // Governor reconsultado antes do 2º host-turn.
    expect(rec.count).toBe(1); // reconciliação é de wake, NÃO entre run_again.
    expect(w.calls.count).toBe(1); // só esperou depois de drenar, não entre os dois.
    // Dois `running` seguidos, sem estado de espera entre eles.
    const firstIdle = summary.states.indexOf('idle');
    expect(summary.states.slice(0, firstIdle).filter(s => s === 'running').length).toBe(2);
  });

  // (8) só human frontier → idle/wait, sem spin.
  test('(8) só fronteira humana → waiting_human_or_recovery sem spin', async () => {
    const c = new AbortController();
    const ht = hostTurnScript([OUT.humanWait]);
    const w = wakeScript(['cancelled'], c);
    const summary = await runResidentHost(deps({ signal: c.signal, runHostTurn: ht.run, waitForWake: w.wait }));
    expect(ht.calls.count).toBe(1); // não re-executou em falso.
    expect(summary.states).toContain('waiting_human_or_recovery');
    expect(w.calls.count).toBe(1);
  });

  // (9) host-turn error → backoff, não tight retry.
  test('(9) erro do host-turn → backoff crescente, nunca tight retry', async () => {
    const c = new AbortController();
    const ht = hostTurnScript([OUT.error, OUT.error, OUT.drained]);
    const w = wakeScript(['explicit', 'explicit', 'cancelled'], c);
    const summary = await runResidentHost(deps({ signal: c.signal, runHostTurn: ht.run, waitForWake: w.wait }));
    expect(summary.states).toContain('backoff');
    // Backoff dobrou entre o 1º e o 2º erro — cresce, não é intervalo fixo apertado.
    expect(w.calls.backoffs[0]).toBe(errorBackoffMs(1, DEFAULT_BACKOFF));
    expect(w.calls.backoffs[1]).toBe(errorBackoffMs(2, DEFAULT_BACKOFF));
    expect(w.calls.backoffs[1]!).toBeGreaterThan(w.calls.backoffs[0]!);
  });

  // (10) cancel/shutdown → termina deterministicamente.
  test('(10) cancelamento no meio → parada determinística (stopping→stopped)', async () => {
    const c = new AbortController();
    const ht = hostTurnScript([OUT.drained]);
    // waitForWake aborta e devolve cancelled já na primeira espera.
    const summary = await runResidentHost(deps({
      signal: c.signal, runHostTurn: ht.run,
      waitForWake: async ({ signal }) => { void signal; c.abort(); return 'cancelled'; },
    }));
    expect(summary.stopReason).toBe('cancelled');
    expect(summary.finalState).toBe('stopped');
    expect(summary.states.slice(-2)).toEqual(['stopping', 'stopped']);
  });

  // (10b) cancelamento ANTES da primeira volta → nenhuma execução.
  test('(10b) já cancelado no arranque → 0 host-turn, para determinístico', async () => {
    const c = new AbortController();
    c.abort();
    const ht = hostTurnScript([OUT.drained]);
    const summary = await runResidentHost(deps({ signal: c.signal, runHostTurn: ht.run }));
    expect(ht.calls.count).toBe(0);
    expect(summary.stopReason).toBe('cancelled');
  });

  // (11) wake em idle → reconcilia novamente.
  test('(11) wake após idle → reconcilia de novo antes de reavaliar', async () => {
    const c = new AbortController();
    const ht = hostTurnScript([OUT.drained]);
    const w = wakeScript(['explicit', 'cancelled'], c);
    const rec = { count: 0 };
    await runResidentHost(deps({
      signal: c.signal, runHostTurn: ht.run,
      reconcile: async () => { rec.count++; },
      waitForWake: w.wait,
    }));
    // Reconciliou no arranque E de novo após o wake do idle.
    expect(rec.count).toBe(2);
    expect(ht.calls.count).toBe(2);
  });

  // (12) duas wake signals → sem execução duplicada.
  test('(12) múltiplos wakes → host-turns sequenciais, nunca concorrentes', async () => {
    const c = new AbortController();
    const ht = hostTurnScript([OUT.drained, OUT.drained, OUT.drained]);
    const w = wakeScript(['explicit', 'explicit', 'cancelled'], c);
    await runResidentHost(deps({ signal: c.signal, runHostTurn: ht.run, waitForWake: w.wait }));
    expect(ht.calls.count).toBe(3);
    expect(ht.calls.maxLive).toBe(1); // concorrência nunca excede 1 — sem duplicação.
  });

  // (13) restart → reconcile antes de executar.
  test('(13) arranque reconcilia ANTES do primeiro host-turn', async () => {
    const c = new AbortController();
    const order: string[] = [];
    const ht = hostTurnScript([OUT.drained]);
    await runResidentHost(deps({
      signal: c.signal,
      reconcile: async () => { order.push('reconcile'); },
      runHostTurn: async (id) => { order.push('host-turn'); return ht.run(id); },
      waitForWake: wakeScript(['cancelled'], c).wait,
    }));
    expect(order).toEqual(['reconcile', 'host-turn']);
  });

  // (14) nenhum service_role fallback: sem identidade, NUNCA há caminho privilegiado.
  test('(14) identidade sempre indisponível → host-turn jamais chamado, mesmo com vários wakes', async () => {
    const c = new AbortController();
    const ht = hostTurnScript([OUT.drained]);
    const rec = { count: 0 };
    const summary = await runResidentHost(deps({
      signal: c.signal, runHostTurn: ht.run,
      acquireIdentity: async () => null,
      reconcile: async () => { rec.count++; },
      waitForWake: wakeScript(['explicit', 'explicit', 'explicit', 'cancelled'], c).wait,
    }));
    expect(ht.calls.count).toBe(0);
    expect(rec.count).toBe(0);
    expect(summary.states.every(s => s !== 'running')).toBe(true);
  });

  // (15) Resource Governor é consultado antes de novo trabalho — todas as vezes.
  test('(15) admitNewWork é consultado antes de CADA host-turn', async () => {
    const c = new AbortController();
    const ht = hostTurnScript([OUT.moreWork, OUT.moreWork, OUT.drained]);
    const order: string[] = [];
    const w = wakeScript(['cancelled'], c);
    await runResidentHost(deps({
      signal: c.signal,
      admitNewWork: () => { order.push('admit'); return 'permit'; },
      runHostTurn: async (id) => { order.push('run'); return ht.run(id); },
      waitForWake: w.wait,
    }));
    // Três host-turns (2× run_again + drain), cada um precedido de uma admissão.
    expect(order).toEqual(['admit', 'run', 'admit', 'run', 'admit', 'run']);
  });

  // Segurança estrutural: maxIterations teta mesmo um wake que nunca cancela.
  test('maxIterations é o teto estrutural (defesa em profundidade)', async () => {
    const c = new AbortController();
    const ht = hostTurnScript([OUT.moreWork]); // sempre há mais → run_again eterno
    const summary = await runResidentHost(deps({
      signal: c.signal, runHostTurn: ht.run, maxIterations: 5,
      waitForWake: async () => 'explicit',
    }));
    expect(summary.stopReason).toBe('max_iterations');
    expect(ht.calls.count).toBe(5);
  });

  // A engine nunca loga/expõe o accessToken: só o repassa opaco ao runHostTurn.
  test('o accessToken flui opaco para o host-turn e não aparece na telemetria', async () => {
    const c = new AbortController();
    const seen: unknown[] = [];
    const ht = hostTurnScript([OUT.drained]);
    await runResidentHost(deps({
      signal: c.signal, runHostTurn: ht.run,
      onState: (_s, detail) => { if (detail) seen.push(JSON.stringify(detail)); },
      waitForWake: wakeScript(['cancelled'], c).wait,
    }));
    expect(ht.calls.identities[0]!.accessToken).toBe('opaque-token');
    expect(seen.some(s => typeof s === 'string' && s.includes('opaque-token'))).toBe(false);
  });
});

// Tipo-guarda: BackoffPolicy e AdmissionVerdict continuam exportados e estáveis.
const _policy: BackoffPolicy = DEFAULT_BACKOFF;
const _verdict: AdmissionVerdict = 'permit';
void _policy; void _verdict;

describe('materializeWhenIdle — materializar quando a fila operacional esvazia', () => {
  const controlStop = { ok: true, continuation: 'stop', stopReason: 'control_applied', moreWorkAvailable: false, cyclesExecuted: 0, itemsTouched: 0, workItemIds: [] } as const;

  test('idle por no_eligible_work + porto presente → materializer chamado; resultado na telemetria', async () => {
    const c = new AbortController();
    const ht = hostTurnScript([OUT.drained]); // stopReason = no_eligible_work
    let matCalls = 0;
    const seen: { state: string; mat?: unknown }[] = [];
    await runResidentHost(deps({
      signal: c.signal, runHostTurn: ht.run,
      materializeWhenIdle: async () => { matCalls++; return { materialized: true, detail: 'FIX-01', workItemId: 'wi-1' }; },
      onState: (state, detail) => seen.push({ state, mat: detail?.materialization }),
      waitForWake: wakeScript(['cancelled'], c).wait,
    }));
    expect(matCalls).toBe(1);
    const idle = seen.find(s => s.state === 'idle');
    expect(idle?.mat).toEqual({ materialized: true, detail: 'FIX-01', workItemId: 'wi-1' });
  });

  test('sem o porto → comportamento inalterado (não materializa)', async () => {
    const c = new AbortController();
    const ht = hostTurnScript([OUT.drained]);
    const summary = await runResidentHost(deps({ signal: c.signal, runHostTurn: ht.run, waitForWake: wakeScript(['cancelled'], c).wait }));
    expect(summary.states).toContain('idle'); // idle normal, sem materialização.
  });

  test('idle por OUTRA razão (control_applied) → materializer NÃO chamado', async () => {
    const c = new AbortController();
    const ht = hostTurnScript([controlStop]);
    let matCalls = 0;
    await runResidentHost(deps({
      signal: c.signal, runHostTurn: ht.run,
      materializeWhenIdle: async () => { matCalls++; return { materialized: false, detail: 'x' }; },
      waitForWake: wakeScript(['cancelled'], c).wait,
    }));
    expect(matCalls).toBe(0); // só na fila VAZIA (no_eligible_work).
  });

  test('ação wait_human/resource/run_again → materializer NÃO chamado', async () => {
    const c = new AbortController();
    const ht = hostTurnScript([OUT.humanWait]);
    let matCalls = 0;
    await runResidentHost(deps({
      signal: c.signal, runHostTurn: ht.run,
      materializeWhenIdle: async () => { matCalls++; return { materialized: false, detail: 'x' }; },
      waitForWake: wakeScript(['cancelled'], c).wait,
    }));
    expect(matCalls).toBe(0);
  });

  test('materializeWhenIdle lança → capturado, {materialized:false} na telemetria', async () => {
    const c = new AbortController();
    const ht = hostTurnScript([OUT.drained]);
    const seen: unknown[] = [];
    await runResidentHost(deps({
      signal: c.signal, runHostTurn: ht.run,
      materializeWhenIdle: async () => { throw new Error('boom'); },
      onState: (state, detail) => { if (state === 'idle') seen.push(detail?.materialization); },
      waitForWake: wakeScript(['cancelled'], c).wait,
    }));
    expect(seen[0]).toEqual({ materialized: false, detail: 'boom' });
  });
});
