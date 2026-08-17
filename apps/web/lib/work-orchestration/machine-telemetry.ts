import os from 'node:os';
import type { MachineSnapshotV1 } from '@anima/core';

// Leitor host-side de telemetria da máquina para o Resource Governor V0. Usa SÓ as
// APIs do próprio Node/OS (`node:os`) — nenhuma dependência nova, captura barata de
// uma amostra pontual (sem polling agressivo). Produz o `MachineSnapshotV1` puro que o
// core classifica. É host, não CoderBackend: mede o estado real da máquina no momento.
//
// HONESTIDADE POR PLATAFORMA: cada campo só aparece quando a fonte é confiável naquela
// plataforma. `os.loadavg()` retorna `[0,0,0]` no Windows (sem significado), então
// `loadAvg1` é OMITIDO no Windows em vez de reportar um zero falso. Campos ausentes são
// preferíveis a números falsamente precisos — a mesma régua da camada de evidência.

/** Fonte injetável das leituras de OS (para testar sem depender do host real). */
export interface OsTelemetrySource {
  totalmem(): number;
  freemem(): number;
  cpus(): readonly unknown[];
  loadavg(): readonly number[];
  platform(): string;
}

const defaultSource: OsTelemetrySource = {
  totalmem: () => os.totalmem(),
  freemem: () => os.freemem(),
  cpus: () => os.cpus(),
  loadavg: () => os.loadavg(),
  platform: () => os.platform(),
};

const finiteNonNeg = (value: number | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/**
 * Lê uma amostra barata e pontual do estado da máquina. Determinística dado o `now` e a
 * `source` injetados. Nunca lança: uma leitura que falhe vira campo ausente, não erro.
 */
export function readMachineSnapshot(
  now: () => Date = () => new Date(),
  source: OsTelemetrySource = defaultSource,
): MachineSnapshotV1 {
  const read = <T>(fn: () => T, fallback: T): T => {
    try { return fn(); } catch { return fallback; }
  };
  const total = read(() => source.totalmem(), Number.NaN);
  const free = read(() => source.freemem(), Number.NaN);
  const cpuCount = read(() => source.cpus().length, Number.NaN);
  const isWindows = read(() => source.platform(), '') === 'win32';
  // loadavg só é significativo em Unix; no Windows é sempre 0 → omitido (não é fato).
  const load = isWindows ? undefined : read(() => source.loadavg()[0], undefined);

  return {
    schemaVersion: 1,
    capturedAt: now().toISOString(),
    observer: 'host',
    ...(finiteNonNeg(total) && total > 0 ? { totalMemBytes: total } : {}),
    ...(finiteNonNeg(free) ? { freeMemBytes: free } : {}),
    ...(finiteNonNeg(cpuCount) && cpuCount > 0 ? { cpuCount } : {}),
    ...(finiteNonNeg(load) ? { loadAvg1: load } : {}),
  };
}
