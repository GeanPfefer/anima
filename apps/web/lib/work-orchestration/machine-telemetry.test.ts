import { parseMachineSnapshot } from '@anima/core';
import type { Json } from '@anima/types';
import { readMachineSnapshot, type OsTelemetrySource } from './machine-telemetry';

const at = () => new Date('2026-08-17T12:00:00.000Z');

const source = (over: Partial<OsTelemetrySource> = {}): OsTelemetrySource => ({
  totalmem: () => 16_000_000_000,
  freemem: () => 4_000_000_000,
  cpus: () => new Array(8).fill({}),
  loadavg: () => [1.5, 1.2, 0.9],
  platform: () => 'linux',
  ...over,
});

describe('readMachineSnapshot (host-side, node:os, honesto por plataforma)', () => {
  test('Unix: inclui loadAvg1 e todos os campos de memória/cpu', () => {
    const snapshot = readMachineSnapshot(at, source());
    expect(snapshot).toEqual({
      schemaVersion: 1, capturedAt: '2026-08-17T12:00:00.000Z', observer: 'host',
      totalMemBytes: 16_000_000_000, freeMemBytes: 4_000_000_000, cpuCount: 8, loadAvg1: 1.5,
    });
  });

  test('Windows: OMITE loadAvg1 (os.loadavg() é sempre 0 e não significa nada)', () => {
    const snapshot = readMachineSnapshot(at, source({ platform: () => 'win32', loadavg: () => [0, 0, 0] }));
    expect(snapshot.loadAvg1).toBeUndefined();
    expect(snapshot.freeMemBytes).toBe(4_000_000_000);
  });

  test('memória indisponível (0/NaN) → campo ausente, não zero falso', () => {
    const snapshot = readMachineSnapshot(at, source({ totalmem: () => 0, cpus: () => [] }));
    expect(snapshot.totalMemBytes).toBeUndefined();
    expect(snapshot.cpuCount).toBeUndefined();
    expect(snapshot.freeMemBytes).toBe(4_000_000_000);
  });

  test('leitura que lança vira campo ausente (nunca propaga erro)', () => {
    const snapshot = readMachineSnapshot(at, source({ freemem: () => { throw new Error('sem acesso'); } }));
    expect(snapshot.freeMemBytes).toBeUndefined();
    expect(snapshot.totalMemBytes).toBe(16_000_000_000);
  });

  test('o snapshot produzido é aceito pelo parser do core (contrato coerente)', () => {
    const snapshot = readMachineSnapshot(at, source());
    expect(parseMachineSnapshot(snapshot as unknown as Json)).toEqual(snapshot);
  });

  test('usa o now injetado (determinístico)', () => {
    expect(readMachineSnapshot(at, source()).capturedAt).toBe('2026-08-17T12:00:00.000Z');
  });
});
