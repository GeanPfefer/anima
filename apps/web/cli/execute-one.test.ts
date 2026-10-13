/** @jest-environment node */
import { runWorkExecuteOne } from './app';
import { renderHuman } from './render';
import type { BacklogHostTurnResult } from '@/lib/work-orchestration/autonomous-backlog-host-turn';
const id = 'aa6b3d64-1e0b-414d-984d-5264b9c89968';
const result: BacklogHostTurnResult = { cyclesExecuted: 1, turnsExecuted: 1, itemsTouched: 1, stopReason: 'max_cycles_reached', continuation: 'stop', moreWorkAvailable: false, lastOutcome: 'execution_completed', cycles: [] };
test('uma invocação e resultado recuperável, sem aprovação implícita', async () => {
  const execute = jest.fn(async () => result);
  const r = await runWorkExecuteOne(id, 1, execute);
  expect(execute).toHaveBeenCalledTimes(1); expect(r.exitCode).toBe(0);
  expect(r.payload).toMatchObject({ kind: 'work-execute-one', workItemId: id, proposalVersion: 1 });
  expect(renderHuman(r.payload)).toContain('não aceita ou integra');
});
test('recusa/erro nunca repete a operação', async () => {
  for (const execute of [jest.fn(async () => { throw new Error('version changed'); }), jest.fn(async () => ({ ...result, turnsExecuted: 0 })), jest.fn(async () => ({ ...result, notExecutableReason: { code: 'not_eligible', message: 'blocked' } }))]) {
    const r = await runWorkExecuteOne(id, 1, execute);
    expect(r.exitCode).not.toBe(0); expect(r.payload.ok).toBe(false); expect(execute).toHaveBeenCalledTimes(1);
  }
});


test('recusa SQL conserva código e nunca inicia segunda invocação', async () => {
  const execute = jest.fn(async () => ({ ...result, turnsExecuted: 0, notExecutableReason: { code: 'single_item_atomic_claim_unavailable', message: 'SQL proof pending' } }));
  const response = await runWorkExecuteOne(id, 1, execute);
  expect(response.exitCode).not.toBe(0);
  expect(response.payload).toMatchObject({ ok: false, code: 'single_item_atomic_claim_unavailable' });
  expect(execute).toHaveBeenCalledTimes(1);
});
