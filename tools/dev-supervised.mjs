import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Comando Dev composto (`npm run dev:supervised`): sobe a ANIMA Web e o Resident Host
// JUNTOS, reusando os scripts canônicos (`dev:web` + `local-host`). Não implementa um
// segundo host nem um segundo Supervisor — o consumidor canônico continua sendo o
// processo `local-host` (ADR-003). Não inicia compute pago por conta própria.
//
// Contrato (Parte 2): herda stdio (saída útil dos dois), encerra os dois em conjunto
// (SIGINT/SIGTERM), NUNCA esconde o crash de um deles (exit≠0 vira exitCode do
// supervisor e derruba o par) e o stop é idempotente. As costuras (`spawnFn`,
// `onSignal`, `setExitCode`) são injetáveis só para teste; o default é o caminho real.

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/** Os dois processos do dev local supervisionado, na ordem de subida. */
export const SUPERVISED_DEV_COMMANDS = [
  ['run', 'dev:web'],
  ['run', 'local-host'],
];

export function startSupervisedDev({
  spawnFn = spawn,
  onSignal = (signal, handler) => process.on(signal, handler),
  setExitCode = (code) => { process.exitCode = code; },
  commands = SUPERVISED_DEV_COMMANDS,
} = {}) {
  const children = commands.map((args) => spawnFn(npm, args, { stdio: 'inherit' }));
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    for (const child of children) child.kill('SIGTERM');
  };
  for (const signal of ['SIGINT', 'SIGTERM']) onSignal(signal, stop);
  for (const child of children) child.on('exit', (code) => {
    // Crash de um filho não pode passar silencioso: propaga o código e derruba o par.
    if (!stopping && code !== 0) setExitCode(code ?? 1);
    stop();
  });
  return { children, stop };
}

// Auto-inicia só quando executado diretamente (`node tools/dev-supervised.mjs`), nunca
// quando importado por um teste/harness.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startSupervisedDev();
}
