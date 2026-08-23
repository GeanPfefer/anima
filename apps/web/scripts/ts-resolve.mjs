// Resolução para rodar o resident host IN-PROCESS por `node` puro (Node 24, TS nativo)
// sem bundler. O monorepo usa `moduleResolution: bundler`, então os imports relativos
// são SEM extensão (`./xp`), o que a resolução nativa do Node não aceita. Este hook
// `resolve` (síncrono, mesmo thread, via `module.registerHooks`) tenta a resolução nativa
// primeiro (node_modules, `@anima/*` via exports, builtins, `.json`) e, só quando ela
// falha para um especificador RELATIVO, tenta os candidatos `.ts`/`.tsx`/`/index.ts` —
// exatamente o que o resolvedor de bundler faria.
//
// ZERO-dependência, escopo estreito: não reescreve `@/`, não toca node_modules, não muda
// a semântica do que já resolve. Só preenche a extensão dos imports TS relativos. Habilitado
// SOB DEMANDA (só no transporte in-process) por `enableTsResolution()`.
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';

const CANDIDATE_SUFFIXES = ['.ts', '.tsx', '.mts', '/index.ts', '/index.tsx'];
const JS_TO_TS = [['.js', '.ts'], ['.jsx', '.tsx'], ['.mjs', '.mts']];

export function resolve(specifier, context, nextResolve) {
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
  if (!isRelative) return nextResolve(specifier, context);

  // 1) Resolução nativa primeiro (arquivos com extensão real, `.json`, etc.).
  try {
    return nextResolve(specifier, context);
  } catch (error) {
    // 2) Extensionless → candidatos TS.
    const basePath = fileURLToPath(new URL(specifier, context.parentURL));
    for (const suffix of CANDIDATE_SUFFIXES) {
      const candidate = basePath + suffix;
      if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
    // 3) `./x.js` que é na verdade `./x.ts` (TS-ESM; defensivo).
    for (const [from, to] of JS_TO_TS) {
      if (basePath.endsWith(from)) {
        const swapped = basePath.slice(0, -from.length) + to;
        if (existsSync(swapped)) return { url: pathToFileURL(swapped).href, shortCircuit: true };
      }
    }
    throw error;
  }
}

let enabled = false;
/** Registra o hook (idempotente). Chamado só quando o transporte in-process é escolhido. */
export function enableTsResolution() {
  if (enabled) return;
  registerHooks({ resolve });
  enabled = true;
}

// Se carregado por `--import`, auto-registra (conveniência para provas/testes).
enableTsResolution();
