// Registra o resolve-hook e deixa o type-stripping nativo do Node cuidar do
// carregamento dos .ts. Uso: node --experimental-transform-types --import
// ./tools/coder-evidence/register.mjs <arquivo.ts>
import { register } from 'node:module';
register('./resolve-ts.mjs', import.meta.url);
