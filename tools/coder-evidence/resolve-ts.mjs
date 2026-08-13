// Resolve-hook mínimo: permite importar os módulos de PRODUÇÃO (que usam imports
// relativos sem extensão, escritos para o bundler/Jest) sob o loader nativo do
// Node, SEM copiar nem alterar o código. Só afeta a resolução deste harness
// standalone; produção (Next.js/Jest) continua com o próprio resolvedor.
const EXTS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'];

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (!specifier.startsWith('.')) throw err;
    for (const ext of EXTS) {
      try { return await nextResolve(specifier + ext, context); } catch {}
    }
    for (const ext of EXTS) {
      try { return await nextResolve(specifier + '/index' + ext, context); } catch {}
    }
    throw err;
  }
}
