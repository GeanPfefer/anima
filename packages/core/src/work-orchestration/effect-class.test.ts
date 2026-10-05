import { readEffectClass, validateEffectClassCoherence } from './effect-class';

describe('SDC-10 effect class fail-closed', () => {
  test('absence preserves mutating behavior', () => {
    expect(readEffectClass({})).toEqual({ ok: true, value: 'mutating' });
    expect(readEffectClass({ execution_spec: {} })).toEqual({ ok: true, value: 'mutating' });
    expect(validateEffectClassCoherence(undefined, ['workspace_read', 'workspace_write_isolated'], 'worktree')).toBeNull();
    expect(validateEffectClassCoherence('mutating', ['workspace_read', 'workspace_write_isolated'], 'worktree')).toBeNull();
  });
  test.each([null, 'unknown', 'mutating', '', 1, false])('unknown persisted value %p never defaults to mutation', value => {
    expect(readEffectClass({ execution_spec: { effect_class: value } }).ok).toBe(false);
    expect(validateEffectClassCoherence(value, ['workspace_read'], 'investigation-v1')).not.toBeNull();
  });
  test('read_only requires investigation adapter and exactly supported read authority', () => {
    expect(readEffectClass({ execution_spec: { effect_class: 'read_only' } })).toEqual({ ok: true, value: 'read_only' });
    expect(validateEffectClassCoherence('read_only', ['workspace_read'], 'investigation-v1')).toBeNull();
    for (const permissions of [[], ['workspace_read', 'workspace_write_isolated'], ['workspace_read', 'write'], ['workspace_read', 'unknown']]) {
      expect(validateEffectClassCoherence('read_only', permissions, 'investigation-v1')).not.toBeNull();
    }
    expect(validateEffectClassCoherence('read_only', ['workspace_read'], 'worktree')).not.toBeNull();
    expect(validateEffectClassCoherence(undefined, ['workspace_read'], 'investigation-v1')).not.toBeNull();
  });
  test('malformed intent/spec fails closed', () => {
    for (const intent of [null, [], { execution_spec: null }, { execution_spec: 'bad' }]) expect(readEffectClass(intent).ok).toBe(false);
  });
});
