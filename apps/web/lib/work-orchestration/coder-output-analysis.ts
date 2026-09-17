import ts from 'typescript';
import {
  combineCoderHarnessViolations,
  matchIncompatibleRunner,
  parseForbiddenBackendSource,
  type CoderHarnessPolicyV1,
  type CoderHarnessValidationV1,
  type CoderHarnessViolationV1,
  type ForbiddenBackendSourceRefV1,
} from '@anima/core';

// ============================================================
// Análise ESTRUTURAL (AST via `typescript`, já presente no workspace) da saída do
// coder, contra o contrato do harness (política canônica em @anima/core). Substitui
// o matching por regex/linha: comentários, strings e templates NÃO são nós de
// import/acesso, então não geram falso positivo por construção.
//
// FRONTEIRA CONSERVADORA (deliberada, documentada — não é prova geral):
//  • Runner incompatível: detectado em import estático, re-export, import dinâmico,
//    require e `import x = require(...)`, incluindo subpaths e formas multilinha, em
//    QUALQUER arquivo de script produzido (não só `*.test.*`: setup/helpers também
//    poderiam introduzir runner incompatível).
//  • Fonte não autoritativa do backend (`entry.coderBackend` e equivalentes): a
//    detecção é KEYED no nome do identificador `entry` (conforme a política), com
//    resolução de ALIAS LOCAL SIMPLES (`const x = entry;` no arquivo). NÃO fazemos
//    resolução de tipos/símbolos: não confirmamos que `entry` é a fila, e não
//    seguimos reatribuições, parâmetros, cadeias profundas (`a.entry.coderBackend`)
//    nem aliases via função. É conservador na direção de NÃO sinalizar o incerto —
//    a prevenção pré-coder e o gate de escopo são as outras camadas.
// ============================================================

export interface CoderOutputFile {
  readonly path: string;
  readonly content: string;
}

/** Superfície mínima da worktree para coletar a saída do coder (subset de GitWorktree). */
export interface CoderOutputSource {
  changedEntriesSinceStart(signal?: AbortSignal): Promise<readonly { readonly status: string; readonly path: string; readonly oldPath?: string }[]>;
  readWorkspaceFile(relPath: string): Promise<string | null>;
}

export type CoderOutputCollection =
  | { readonly ok: true; readonly files: readonly CoderOutputFile[] }
  | { readonly ok: false; readonly unreadable: { readonly status: string; readonly path: string } };

/**
 * Coleta FAIL-CLOSED os arquivos alterados desta tentativa para inspeção do harness.
 * Diferencia status Git: uma deleção (D) legitimamente não tem conteúdo (é pulada);
 * A/M/R/C/T DEVEM ser legíveis — se `readWorkspaceFile` devolver null, retorna
 * `ok:false` (o executor encerra fail-closed ANTES de checkpoint/gates/result). Um
 * rename (R) inspeciona o DESTINO (`entry.path`). Nunca há passagem silenciosa de um
 * arquivo alterado não inspecionado.
 */
export async function collectCoderOutputForHarness(
  source: CoderOutputSource,
  signal?: AbortSignal,
): Promise<CoderOutputCollection> {
  const entries = await source.changedEntriesSinceStart(signal);
  const files: CoderOutputFile[] = [];
  for (const entry of entries) {
    if (entry.status === 'D') continue;
    const content = await source.readWorkspaceFile(entry.path);
    if (content === null) return { ok: false, unreadable: { status: entry.status, path: entry.path } };
    files.push({ path: entry.path.replace(/\\/g, '/'), content });
  }
  return { ok: true, files };
}

const SCRIPT_EXT = /\.[cm]?[jt]sx?$/i;

/** Arquivos que passam pela análise estrutural: qualquer script TS/JS produzido. */
export function isAnalyzableSourcePath(path: string): boolean {
  return SCRIPT_EXT.test(path.replace(/\\/g, '/'));
}

function scriptKindFor(path: string): ts.ScriptKind {
  const p = path.toLowerCase();
  if (p.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (p.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (p.endsWith('.js') || p.endsWith('.cjs') || p.endsWith('.mjs')) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

const lineOf = (sf: ts.SourceFile, node: ts.Node): number =>
  sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

/** Desembrulha `!`, `( )` para chegar ao identificador base de um acesso. */
function baseIdentifierName(expr: ts.Expression): string | null {
  let current: ts.Expression = expr;
  while (ts.isNonNullExpression(current) || ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return ts.isIdentifier(current) ? current.text : null;
}

function moduleSpecifierText(node: ts.Expression | undefined): string | null {
  return node !== undefined && ts.isStringLiteralLike(node) ? node.text : null;
}

/** Coleta aliases locais simples do objeto proibido: `const x = entry;`. */
function collectAliases(sf: ts.SourceFile, objectNames: ReadonlySet<string>): Map<string, string> {
  const aliasToObject = new Map<string, string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isIdentifier(node.initializer)) {
      const source = node.initializer.text;
      if (objectNames.has(source) || aliasToObject.has(source)) {
        aliasToObject.set(node.name.text, aliasToObject.get(source) ?? source);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return aliasToObject;
}

/**
 * Analisa os arquivos produzidos contra a política EFETIVA (já resolvida como
 * superset canônico pelo caller). Retorna todas as violações; determinístico.
 */
export function analyzeCoderOutputFiles(
  files: readonly CoderOutputFile[],
  policy: CoderHarnessPolicyV1,
): CoderHarnessValidationV1 {
  const forbiddenRefs = policy.forbiddenBackendSources
    .map(parseForbiddenBackendSource)
    .filter((ref): ref is ForbiddenBackendSourceRefV1 => ref !== null);
  const violations: CoderHarnessViolationV1[] = [];

  for (const file of files) {
    const path = file.path.replace(/\\/g, '/');
    if (!isAnalyzableSourcePath(path)) continue;
    const sf = ts.createSourceFile(path, file.content, ts.ScriptTarget.Latest, true, scriptKindFor(path));

    // Objetos proibidos (nomes) + seus aliases locais simples deste arquivo.
    const objectNames = new Set(forbiddenRefs.map(ref => ref.object));
    const aliasToObject = collectAliases(sf, objectNames);
    const resolveObject = (name: string): string | null =>
      objectNames.has(name) ? name : (aliasToObject.get(name) ?? null);
    const propertyFor = (objectName: string): ReadonlySet<string> =>
      new Set(forbiddenRefs.filter(ref => ref.object === objectName).map(ref => ref.property));
    const rawFor = (objectName: string, property: string): string =>
      forbiddenRefs.find(ref => ref.object === objectName && ref.property === property)?.raw ?? `${objectName}.${property}`;

    const flagBackend = (node: ts.Node, objectName: string, property: string): void => {
      violations.push({ kind: 'non_authoritative_backend_source', path, expression: rawFor(objectName, property), line: lineOf(sf, node) });
    };

    const visit = (node: ts.Node): void => {
      // ── Runner incompatível ────────────────────────────────────────────────
      let specifier: string | null = null;
      let specifierNode: ts.Node = node;
      if (ts.isImportDeclaration(node)) {
        specifier = moduleSpecifierText(node.moduleSpecifier);
        specifierNode = node.moduleSpecifier;
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
        specifier = moduleSpecifierText(node.moduleSpecifier);
        specifierNode = node.moduleSpecifier;
      } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
        specifier = moduleSpecifierText(node.moduleReference.expression);
        specifierNode = node.moduleReference.expression;
      } else if (ts.isCallExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length > 0) {
          specifier = moduleSpecifierText(node.arguments[0]);
          specifierNode = node.arguments[0]!;
        } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require' && node.arguments.length > 0) {
          specifier = moduleSpecifierText(node.arguments[0]);
          specifierNode = node.arguments[0]!;
        }
      }
      if (specifier !== null) {
        const runner = matchIncompatibleRunner(specifier, policy.incompatibleTestRunners);
        if (runner !== null) {
          violations.push({ kind: 'incompatible_test_runner', path, importedRunner: runner, requiredRunner: policy.canonicalTestRunner, line: lineOf(sf, specifierNode) });
        }
      }

      // ── Fonte não autoritativa do backend ──────────────────────────────────
      // `entry.coderBackend` / `entry?.coderBackend` / `entry!.coderBackend`
      if (ts.isPropertyAccessExpression(node)) {
        const base = baseIdentifierName(node.expression);
        const object = base !== null ? resolveObject(base) : null;
        if (object !== null && propertyFor(object).has(node.name.text)) flagBackend(node, object, node.name.text);
      }
      // `entry["coderBackend"]` / `entry['coderBackend']`
      if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
        const base = baseIdentifierName(node.expression);
        const object = base !== null ? resolveObject(base) : null;
        if (object !== null && propertyFor(object).has(node.argumentExpression.text)) flagBackend(node, object, node.argumentExpression.text);
      }
      // `const { coderBackend } = entry` (destructuring cuja origem é entry/alias)
      if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.initializer) && ts.isObjectBindingPattern(node.name)) {
        const object = resolveObject(node.initializer.text);
        if (object !== null) {
          const props = propertyFor(object);
          for (const element of node.name.elements) {
            const sourceProp = element.propertyName && ts.isIdentifier(element.propertyName)
              ? element.propertyName.text
              : (ts.isIdentifier(element.name) ? element.name.text : null);
            if (sourceProp !== null && props.has(sourceProp)) flagBackend(element, object, sourceProp);
          }
        }
      }

      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sf, visit);
  }

  return combineCoderHarnessViolations(violations);
}
