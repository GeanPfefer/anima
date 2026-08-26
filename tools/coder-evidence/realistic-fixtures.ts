import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { Fixture } from './fixtures.ts';

const SUCCESSOR_A_BASELINE_COMMIT = '4857530';

const WORK_ROUTING_PATH =
  'packages/core/src/work-orchestration/work-routing.ts';
const WORK_ROUTING_TEST_PATH =
  'packages/core/src/work-orchestration/work-routing.test.ts';

const readBaselineFile = (path: string): string =>
  execFileSync(
    'git',
    ['show', `${SUCCESSOR_A_BASELINE_COMMIT}:${path}`],
    { encoding: 'utf8' },
  );

const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const baselineWorkRouting = readBaselineFile(WORK_ROUTING_PATH);
const baselineWorkRoutingTest = readBaselineFile(WORK_ROUTING_TEST_PATH);

const exportedHelpers = (source: string): Set<string> =>
  new Set(
    [...source.matchAll(
      /\bexport\s+(?:function|const)\s+([A-Za-z_$][\w$]*)/g,
    )]
      .map(match => match[1]!)
      .filter(name => name !== 'selectWorkRoute'),
  );

const extractExportedFunction = (
  source: string,
  functionName: string,
): string | null => {
  const marker = `export function ${functionName}`;
  const start = source.indexOf(marker);
  if (start < 0) return null;

  const open = source.indexOf('{', start);
  if (open < 0) return null;

  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;

    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }

  return null;
};

const countMatches = (
  source: string,
  pattern: RegExp,
): number => [...source.matchAll(pattern)].length;

const baselineHelpers = exportedHelpers(baselineWorkRouting);

const baselineSelectWorkRoute =
  extractExportedFunction(
    baselineWorkRouting,
    'selectWorkRoute',
  );

const successorARealistic: Fixture = {
  id: 'successor_a_realistic',

  description:
    'alvo realista do Successor A: helper puro local-first em work-routing, sem wiring',

  files: {
    [WORK_ROUTING_PATH]: baselineWorkRouting,
    [WORK_ROUTING_TEST_PATH]: baselineWorkRoutingTest,
  },

  objective: [
    'Adicione em packages/core/src/work-orchestration/work-routing.ts',
    'um helper PURO e isolado que expresse a preferência local-first:',
    'dado um conjunto de rotas equivalentes rotuladas por localidade,',
    'prefira deterministicamente a rota LOCAL quando suficiente.',
    'Ausência ou localidade desconhecida deve falhar fechado,',
    'sem crash e sem preferência inventada.',
    'Adicione testes focados em',
    'packages/core/src/work-orchestration/work-routing.test.ts.',
    'Não altere o comportamento de selectWorkRoute',
    'e não faça wiring do helper nela.',
  ].join(' '),

  includedScope: [
    WORK_ROUTING_PATH,
    WORK_ROUTING_TEST_PATH,
  ],

  excludedScope: [
    'apps/web/',
    'supabase/',
    'Resident Host',
    'wiring em selectWorkRoute',
    'execução remota',
    'autorização financeira',
  ],

  achieved: final => {
    const production =
      final.get(WORK_ROUTING_PATH) ?? '';

    const test =
      final.get(WORK_ROUTING_TEST_PATH) ?? '';

    const finalHelpers =
      exportedHelpers(production);

    const newHelpers =
      [...finalHelpers]
        .filter(name => !baselineHelpers.has(name));

    const selectedRouteFunction =
      extractExportedFunction(
        production,
        'selectWorkRoute',
      );

    const helperIsExercised =
      newHelpers.some(name =>
        new RegExp(`\\b${name}\\b`).test(test),
      );

    const localityVocabularyAdded =
      /\blocal\b/i.test(production) &&
      /\bremote\b/i.test(production);

    const localCasesAdded =
      countMatches(test, /\blocal\b/gi) >
      countMatches(
        baselineWorkRoutingTest,
        /\blocal\b/gi,
      );

    const remoteCasesAdded =
      countMatches(test, /\bremote\b/gi) >
      countMatches(
        baselineWorkRoutingTest,
        /\bremote\b/gi,
      );

    const failClosedCaseAdded =
      countMatches(
        test,
        /\b(?:unknown|undefined|null)\b/gi,
      ) >
      countMatches(
        baselineWorkRoutingTest,
        /\b(?:unknown|undefined|null)\b/gi,
      );

    return newHelpers.length > 0
      && helperIsExercised
      && localityVocabularyAdded
      && localCasesAdded
      && remoteCasesAdded
      && failClosedCaseAdded
      && baselineSelectWorkRoute !== null
      && selectedRouteFunction === baselineSelectWorkRoute;
  },
};

export const REALISTIC_FIXTURES:
  readonly Fixture[] = [
    successorARealistic,
  ];

export const REALISTIC_FIXTURE_IDS =
  REALISTIC_FIXTURES.map(
    fixture => fixture.id,
  );

export const REALISTIC_FIXTURE_PROVENANCE = {
  successor_a_realistic: {
    baselineCommit:
      SUCCESSOR_A_BASELINE_COMMIT,

    files: {
      [WORK_ROUTING_PATH]:
        sha256(baselineWorkRouting),

      [WORK_ROUTING_TEST_PATH]:
        sha256(baselineWorkRoutingTest),
    },
  },
} as const;
