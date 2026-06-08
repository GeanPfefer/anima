// Adaptador Health — Camada 0 passiva (PRD §13b).
// Importa dados do Apple HealthKit (iOS) como entradas no pilar Saúde.
//
// ⚠️  REQUER DEV BUILD — não funciona no Expo Go padrão.
//
// Para ativar:
//   1. npm install @kingstinct/react-native-healthkit --workspace=@anima/mobile
//   2. Adicionar ao app.json > plugins: ["@kingstinct/react-native-healthkit"]
//   3. npx expo prebuild --platform ios
//   4. Abrir ios/ no Xcode e buildar no dispositivo
//
// Dados importados: sono (HKCategoryTypeIdentifierSleepAnalysis),
//   exercício (HKQuantityTypeIdentifierActiveEnergyBurned),
//   passos (HKQuantityTypeIdentifierStepCount).

import { Platform } from 'react-native';

// ── Tipos ────────────────────────────────────────────────────────────────────

export type HealthSample = {
  startDate: Date;
  endDate: Date;
  value: number;
  unit: string;
  sourceRevision?: string;
};

export type HealthImportResult = {
  sleep:    HealthSample[];
  exercise: HealthSample[];
  steps:    HealthSample[];
};

export type HealthImportEntry = {
  /** ID externo — evita duplicatas na reimportação */
  externalId: string;
  pillarName: string;
  durationMinutes: number;
  note: string;
  activityDate: string; // 'YYYY-MM-DD'
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function diffMinutes(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 60_000);
}

function toDateStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// ── Conversão de amostras em entradas Anima ───────────────────────────────────

export function sleepSamplesToEntries(samples: HealthSample[]): HealthImportEntry[] {
  // Agrupa sessões de sono por noite (data da manhã = data do fim)
  const byNight = new Map<string, number>();
  for (const s of samples) {
    const nightKey = toDateStr(s.endDate);
    const mins = diffMinutes(s.startDate, s.endDate);
    if (mins > 0) {
      byNight.set(nightKey, (byNight.get(nightKey) ?? 0) + mins);
    }
  }
  return Array.from(byNight.entries()).map(([date, mins]) => ({
    externalId: `health_sleep_${date}`,
    pillarName: 'Saúde',
    durationMinutes: mins,
    note: `Sono — ${Math.floor(mins / 60)}h${mins % 60 > 0 ? `${mins % 60}min` : ''} (Apple Health)`,
    activityDate: date,
  }));
}

export function exerciseSamplesToEntries(samples: HealthSample[]): HealthImportEntry[] {
  // Uma entrada por sessão de exercício detectada
  return samples
    .filter(s => diffMinutes(s.startDate, s.endDate) >= 5) // ignora < 5min
    .map(s => {
      const mins = diffMinutes(s.startDate, s.endDate);
      const kcal = Math.round(s.value);
      return {
        externalId: `health_exercise_${s.startDate.toISOString()}`,
        pillarName: 'Saúde',
        durationMinutes: mins,
        note: `Exercício — ${mins}min · ${kcal} kcal (Apple Health)`,
        activityDate: toDateStr(s.startDate),
      };
    });
}

export function stepSamplesToEntries(samples: HealthSample[]): HealthImportEntry[] {
  // Agrupa passos por dia — não gera XP por tempo (duration=0), só presença
  const byDay = new Map<string, number>();
  for (const s of samples) {
    const day = toDateStr(s.startDate);
    byDay.set(day, (byDay.get(day) ?? 0) + s.value);
  }
  return Array.from(byDay.entries())
    .filter(([, steps]) => steps >= 1000) // ignora dias sem movimento real
    .map(([date, steps]) => ({
      externalId: `health_steps_${date}`,
      pillarName: 'Saúde',
      durationMinutes: 0, // presença — sem XP de tempo
      note: `${steps.toLocaleString('pt-BR')} passos (Apple Health)`,
      activityDate: date,
    }));
}

// ── Leitor do HealthKit ───────────────────────────────────────────────────────
// O corpo das funções usa require dinâmico para não crashar quando o módulo
// nativo não está disponível (Expo Go sem dev build).

export type HealthPermissionStatus = 'authorized' | 'denied' | 'unavailable';

export async function requestHealthPermissions(): Promise<HealthPermissionStatus> {
  if (Platform.OS !== 'ios') return 'unavailable';
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const HK = require('@kingstinct/react-native-healthkit');
    await HK.requestAuthorization(
      [], // sem permissões de escrita
      [
        HK.HKCategoryTypeIdentifierSleepAnalysis,
        HK.HKQuantityTypeIdentifierActiveEnergyBurned,
        HK.HKQuantityTypeIdentifierStepCount,
      ],
    );
    return 'authorized';
  } catch {
    return 'unavailable';
  }
}

export async function readHealthData(daysBack = 30): Promise<HealthImportResult> {
  const empty: HealthImportResult = { sleep: [], exercise: [], steps: [] };
  if (Platform.OS !== 'ios') return empty;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const HK = require('@kingstinct/react-native-healthkit');
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    const [sleep, exercise, steps] = await Promise.all([
      HK.queryHealthkitSamples(HK.HKCategoryTypeIdentifierSleepAnalysis, { startDate }),
      HK.queryHealthkitSamples(HK.HKQuantityTypeIdentifierActiveEnergyBurned, { startDate }),
      HK.queryHealthkitSamples(HK.HKQuantityTypeIdentifierStepCount, { startDate }),
    ]);

    return {
      sleep:    sleep    as HealthSample[],
      exercise: exercise as HealthSample[],
      steps:    steps    as HealthSample[],
    };
  } catch {
    return empty;
  }
}

/** Converte todos os dados de saúde em entradas prontas para importar no Anima */
export async function buildHealthEntries(daysBack = 30): Promise<HealthImportEntry[]> {
  const data = await readHealthData(daysBack);
  return [
    ...sleepSamplesToEntries(data.sleep),
    ...exerciseSamplesToEntries(data.exercise),
    ...stepSamplesToEntries(data.steps),
  ];
}
