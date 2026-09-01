import {
  isNodeAvailableForWork,
  isNodeLifecycleFailure,
  isNodeLive,
  transitionNodeLifecycle,
  type NodeLifecycleEvent,
  type NodeLifecycleState,
} from './node-lifecycle';

describe('transitionNodeLifecycle — caminho feliz', () => {
  test('ciclo completo offline → provisioning → ready → busy → idle → shutting_down → offline', () => {
    const steps: readonly [NodeLifecycleState, NodeLifecycleEvent, NodeLifecycleState][] = [
      ['offline', 'provision_requested', 'provisioning'],
      ['provisioning', 'health_confirmed', 'ready'],
      ['ready', 'reserved', 'busy'],
      ['busy', 'released', 'idle'],
      ['idle', 'shutdown_requested', 'shutting_down'],
      ['shutting_down', 'shutdown_confirmed', 'offline'],
    ];
    for (const [from, event, to] of steps) {
      const result = transitionNodeLifecycle(from, event);
      expect(result).toEqual({ ok: true, kind: 'transition', from, to, event });
    }
  });

  test('idle pode ser reservado de novo (reuso do node antes de desligar)', () => {
    expect(transitionNodeLifecycle('idle', 'reserved')).toMatchObject({ ok: true, kind: 'transition', to: 'busy' });
  });

  test('ready pode ser desligado sem nunca ter sido usado', () => {
    expect(transitionNodeLifecycle('ready', 'shutdown_requested')).toMatchObject({ ok: true, to: 'shutting_down' });
  });
});

describe('transitionNodeLifecycle — falhas distintas', () => {
  test('start que falha vira provision_failed (node nunca subiu)', () => {
    expect(transitionNodeLifecycle('provisioning', 'provision_failed')).toMatchObject({ ok: true, to: 'provision_failed' });
  });

  test('subiu mas health nunca passou vira health_failed', () => {
    expect(transitionNodeLifecycle('provisioning', 'health_lost')).toMatchObject({ ok: true, to: 'health_failed' });
  });

  test('saúde perdida em uso (busy) vira health_failed — não idle', () => {
    expect(transitionNodeLifecycle('busy', 'health_lost')).toMatchObject({ ok: true, to: 'health_failed' });
  });

  test('stop que falha vira shutdown_failed (node pode seguir custando)', () => {
    expect(transitionNodeLifecycle('shutting_down', 'shutdown_failed')).toMatchObject({ ok: true, to: 'shutdown_failed' });
  });

  test('de qualquer falha há sempre um caminho de teardown', () => {
    for (const failure of ['provision_failed', 'health_failed', 'shutdown_failed'] as const) {
      expect(transitionNodeLifecycle(failure, 'shutdown_requested')).toMatchObject({ ok: true, to: 'shutting_down' });
    }
  });

  test('shutdown_failed permite retry idempotente e confirmação de teardown', () => {
    expect(transitionNodeLifecycle('shutdown_failed', 'shutdown_requested')).toMatchObject({ ok: true, to: 'shutting_down' });
    expect(transitionNodeLifecycle('shutdown_failed', 'shutdown_confirmed')).toMatchObject({ ok: true, to: 'offline' });
  });
});

describe('transitionNodeLifecycle — idempotência (defesa contra dupla provisão)', () => {
  test('provision_requested observado enquanto já vivo é no-op, não nova provisão', () => {
    for (const alive of ['provisioning', 'ready', 'busy', 'idle'] as const) {
      const result = transitionNodeLifecycle(alive, 'provision_requested');
      expect(result).toEqual({ ok: true, kind: 'noop', from: alive, to: alive, event: 'provision_requested' });
    }
  });

  test('health_confirmed repetido em ready/idle/busy é no-op', () => {
    for (const s of ['ready', 'idle', 'busy'] as const) {
      expect(transitionNodeLifecycle(s, 'health_confirmed')).toMatchObject({ ok: true, kind: 'noop', to: s });
    }
  });

  test('reserved repetido em busy e released repetido em idle são no-ops', () => {
    expect(transitionNodeLifecycle('busy', 'reserved')).toMatchObject({ ok: true, kind: 'noop', to: 'busy' });
    expect(transitionNodeLifecycle('idle', 'released')).toMatchObject({ ok: true, kind: 'noop', to: 'idle' });
  });

  test('shutdown_requested repetido em shutting_down e shutdown_confirmed em offline são no-ops', () => {
    expect(transitionNodeLifecycle('shutting_down', 'shutdown_requested')).toMatchObject({ ok: true, kind: 'noop', to: 'shutting_down' });
    expect(transitionNodeLifecycle('offline', 'shutdown_confirmed')).toMatchObject({ ok: true, kind: 'noop', to: 'offline' });
  });
});

describe('transitionNodeLifecycle — fail-closed em transições ilegais', () => {
  test('não se pode provisionar durante o shutdown (corrida)', () => {
    expect(transitionNodeLifecycle('shutting_down', 'provision_requested')).toMatchObject({ ok: false, kind: 'illegal' });
  });

  test('não se pode reservar um node offline/desligando/doente', () => {
    for (const s of ['offline', 'shutting_down', 'health_failed', 'provision_failed'] as const) {
      expect(transitionNodeLifecycle(s, 'reserved')).toMatchObject({ ok: false, kind: 'illegal' });
    }
  });

  test('não se pode confirmar health de um node offline (não foi pedido subir)', () => {
    expect(transitionNodeLifecycle('offline', 'health_confirmed')).toMatchObject({ ok: false, kind: 'illegal' });
  });

  test('reviver uma falha in-place é ilegal — recuperar exige nova provisão', () => {
    expect(transitionNodeLifecycle('health_failed', 'health_confirmed')).toMatchObject({ ok: false, kind: 'illegal' });
    expect(transitionNodeLifecycle('provision_failed', 'provision_requested')).toMatchObject({ ok: false, kind: 'illegal' });
  });
});

describe('predicados de estado', () => {
  test('offline é o único estado sem custo/recurso ativo comprovado', () => {
    expect(isNodeLive('offline')).toBe(false);
    for (const s of ['provisioning', 'ready', 'busy', 'idle', 'shutting_down', 'provision_failed', 'health_failed', 'shutdown_failed'] as const) {
      expect(isNodeLive(s)).toBe(true);
    }
  });

  test('só ready e idle estão livres para executar já', () => {
    expect(isNodeAvailableForWork('ready')).toBe(true);
    expect(isNodeAvailableForWork('idle')).toBe(true);
    for (const s of ['offline', 'provisioning', 'busy', 'shutting_down', 'provision_failed', 'health_failed', 'shutdown_failed'] as const) {
      expect(isNodeAvailableForWork(s)).toBe(false);
    }
  });

  test('as três falhas são reconhecidas como falha', () => {
    for (const s of ['provision_failed', 'health_failed', 'shutdown_failed'] as const) {
      expect(isNodeLifecycleFailure(s)).toBe(true);
    }
    expect(isNodeLifecycleFailure('ready')).toBe(false);
  });
});


describe('provider identity lifecycle', () => {
  test('provider_identified preserva provisioning sem afirmar readiness', () => {
    expect(transitionNodeLifecycle('provisioning', 'provider_identified')).toEqual({
      ok: true,
      kind: 'transition',
      from: 'provisioning',
      to: 'provisioning',
      event: 'provider_identified',
    });
    expect(transitionNodeLifecycle('offline', 'provider_identified')).toMatchObject({
      ok: false,
      kind: 'illegal',
    });
  });
});
