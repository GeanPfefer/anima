import { createHash } from 'node:crypto';

import { normalizeRelPath, resolveScopedPath, sha256 } from './ollama-protocol';

export type ExperimentalAnchorErrorCode =
  | 'anchor_invalid_input'
  | 'anchor_outside_scope'
  | 'anchor_missing'
  | 'anchor_cycle_mismatch'
  | 'anchor_stale_file'
  | 'anchor_invalid_range'
  | 'anchor_content_mismatch'
  | 'anchor_overlap'
  | 'anchor_no_effective_edits';

export class ExperimentalAnchorError extends Error {
  readonly code: ExperimentalAnchorErrorCode;

  constructor(code: ExperimentalAnchorErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'ExperimentalAnchorError';
    this.code = code;
  }
}

export interface ServedAnchor {
  readonly schemaVersion: 1;
  readonly anchorId: string;
  readonly cycleId: string;
  readonly path: string;
  readonly fileSha256: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly rawSliceSha256: string;
  /**
   * Estado efêmero AUTORITATIVO do host.
   * Não é campo fornecido pelo modelo e não é persistido pelo experimento.
   */
  readonly rawSlice: string;
}

export interface CreateServedAnchorInput {
  readonly cycleId: string;
  readonly ordinal: number;
  readonly path: string;
  readonly fileContent: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly allowedPaths: ReadonlySet<string>;
}

export interface ExperimentalReplaceAnchorOperation {
  readonly kind: 'replace_anchor';
  readonly anchorId: string;
  readonly after: string;
}

export interface ExperimentalAppliedChange {
  readonly path: string;
  readonly newContent: string;
  readonly kind: 'replace';
}

const MAX_EXPERIMENTAL_OPERATIONS = 20;
const MAX_EXPERIMENTAL_AFTER_CHARS = 40_000;
const MAX_ANCHOR_ID_CHARS = 128;
const MAX_CYCLE_ID_CHARS = 200;

const nonBlank = (value: string): boolean => value.trim().length > 0;

interface LineSpan {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly raw: string;
}

const resolveLineSpan = (
  content: string,
  startLine: number,
  endLine: number,
): LineSpan | null => {
  if (
    !Number.isInteger(startLine)
    || !Number.isInteger(endLine)
    || startLine < 1
    || endLine < startLine
  ) {
    return null;
  }

  const lines = content.split('\n');
  if (startLine > lines.length || endLine > lines.length) return null;

  let startOffset = 0;
  for (let line = 1; line < startLine; line++) {
    startOffset += lines[line - 1]!.length + 1;
  }

  let endOffset = startOffset;
  for (let line = startLine; line <= endLine; line++) {
    endOffset += lines[line - 1]!.length;
    if (line < endLine) endOffset += 1;
  }

  return {
    startOffset,
    endOffset,
    raw: content.slice(startOffset, endOffset),
  };
};

const deterministicAnchorId = (input: {
  readonly cycleId: string;
  readonly ordinal: number;
  readonly path: string;
  readonly fileSha256: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly rawSliceSha256: string;
}): string => {
  const canonical = [
    'anima-r2-anchor-v1',
    input.cycleId,
    String(input.ordinal),
    input.path,
    input.fileSha256,
    String(input.startLine),
    String(input.endLine),
    input.rawSliceSha256,
  ].join('\0');

  return `r2a_${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
};

/**
 * Cria uma capability efêmera somente para um trecho que o HOST realmente resolveu.
 * O modelo nunca fornece path, SHA, range ou conteúdo original desta estrutura.
 */
export function createServedAnchor(input: CreateServedAnchorInput): ServedAnchor {
  if (
    !nonBlank(input.cycleId)
    || input.cycleId.length > MAX_CYCLE_ID_CHARS
    || !Number.isInteger(input.ordinal)
    || input.ordinal < 0
  ) {
    throw new ExperimentalAnchorError(
      'anchor_invalid_input',
      'cycleId não vazio e ordinal inteiro não negativo são obrigatórios.',
    );
  }

  const path = resolveScopedPath(input.path, input.allowedPaths);
  if (!path) {
    throw new ExperimentalAnchorError(
      'anchor_outside_scope',
      `o host recusou criar âncora fora do escopo: ${String(input.path)}`,
    );
  }

  const span = resolveLineSpan(input.fileContent, input.startLine, input.endLine);
  if (!span || span.raw.length === 0) {
    throw new ExperimentalAnchorError(
      'anchor_invalid_range',
      `intervalo ${input.startLine}-${input.endLine} não identifica conteúdo não vazio válido.`,
    );
  }

  const fileSha256 = sha256(input.fileContent);
  const rawSliceSha256 = sha256(span.raw);
  const normalizedPath = normalizeRelPath(path);

  return {
    schemaVersion: 1,
    anchorId: deterministicAnchorId({
      cycleId: input.cycleId,
      ordinal: input.ordinal,
      path: normalizedPath,
      fileSha256,
      startLine: input.startLine,
      endLine: input.endLine,
      rawSliceSha256,
    }),
    cycleId: input.cycleId,
    path: normalizedPath,
    fileSha256,
    startLine: input.startLine,
    endLine: input.endLine,
    rawSliceSha256,
    rawSlice: span.raw,
  };
}

/**
 * Parser do envelope experimental. O modelo só controla:
 * - qual anchorId previamente emitido deseja usar;
 * - qual conteúdo "after" propõe.
 */
export function parseExperimentalAnchorOperations(
  rawOperations: readonly unknown[],
): ExperimentalReplaceAnchorOperation[] {
  if (!Array.isArray(rawOperations)) {
    throw new ExperimentalAnchorError(
      'anchor_invalid_input',
      '"operations" precisa ser uma lista.',
    );
  }

  if (
    rawOperations.length === 0
    || rawOperations.length > MAX_EXPERIMENTAL_OPERATIONS
  ) {
    throw new ExperimentalAnchorError(
      'anchor_invalid_input',
      `o lote exige entre 1 e ${MAX_EXPERIMENTAL_OPERATIONS} operações.`,
    );
  }

  return rawOperations.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new ExperimentalAnchorError(
        'anchor_invalid_input',
        'operação replace_anchor malformada.',
      );
    }

    const op = raw as Record<string, unknown>;
    if (op.kind !== 'replace_anchor') {
      throw new ExperimentalAnchorError(
        'anchor_invalid_input',
        `operação experimental não suportada: ${String(op.kind)}`,
      );
    }

    if (
      typeof op.anchor_id !== 'string'
      || !nonBlank(op.anchor_id)
      || op.anchor_id.length > MAX_ANCHOR_ID_CHARS
    ) {
      throw new ExperimentalAnchorError(
        'anchor_invalid_input',
        'replace_anchor exige anchor_id não vazio dentro do limite.',
      );
    }

    if (
      typeof op.after !== 'string'
      || op.after.length > MAX_EXPERIMENTAL_AFTER_CHARS
    ) {
      throw new ExperimentalAnchorError(
        'anchor_invalid_input',
        'replace_anchor exige after string dentro do limite.',
      );
    }

    return {
      kind: 'replace_anchor',
      anchorId: op.anchor_id,
      after: op.after,
    };
  });
}

export function applyExperimentalAnchorOperations(input: {
  readonly operations: readonly ExperimentalReplaceAnchorOperation[];
  readonly anchors: ReadonlyMap<string, ServedAnchor>;
  readonly cycleId: string;
  readonly allowedPaths: ReadonlySet<string>;
  readonly contentOf: (path: string) => string | null;
}): ExperimentalAppliedChange[] {
  if (input.operations.length === 0) {
    throw new ExperimentalAnchorError(
      'anchor_no_effective_edits',
      'nenhuma operação experimental foi fornecida.',
    );
  }

  type ResolvedRange = {
    readonly start: number;
    readonly end: number;
    readonly after: string;
    readonly anchorId: string;
  };

  const rangesByPath = new Map<string, ResolvedRange[]>();

  for (const operation of input.operations) {
    const anchor = input.anchors.get(operation.anchorId);
    if (!anchor) {
      throw new ExperimentalAnchorError(
        'anchor_missing',
        `anchorId inexistente: ${operation.anchorId}`,
      );
    }

    if (anchor.cycleId !== input.cycleId) {
      throw new ExperimentalAnchorError(
        'anchor_cycle_mismatch',
        'a âncora pertence a outro ciclo/execução.',
      );
    }

    const scopedPath = resolveScopedPath(anchor.path, input.allowedPaths);
    if (!scopedPath || normalizeRelPath(scopedPath) !== anchor.path) {
      throw new ExperimentalAnchorError(
        'anchor_outside_scope',
        'a âncora não pertence ao escopo autorizado desta execução.',
      );
    }

    const current = input.contentOf(anchor.path);
    if (current === null || sha256(current) !== anchor.fileSha256) {
      throw new ExperimentalAnchorError(
        'anchor_stale_file',
        `arquivo mudou ou desapareceu desde a leitura: ${anchor.path}`,
      );
    }

    const span = resolveLineSpan(current, anchor.startLine, anchor.endLine);
    if (!span || span.raw.length === 0) {
      throw new ExperimentalAnchorError(
        'anchor_invalid_range',
        `intervalo da âncora não é mais válido: ${anchor.anchorId}`,
      );
    }

    if (
      span.raw !== anchor.rawSlice
      || sha256(span.raw) !== anchor.rawSliceSha256
    ) {
      throw new ExperimentalAnchorError(
        'anchor_content_mismatch',
        `conteúdo original da âncora divergiu: ${anchor.anchorId}`,
      );
    }

    if (operation.after === span.raw) {
      throw new ExperimentalAnchorError(
        'anchor_no_effective_edits',
        `replace_anchor não produz mudança real: ${anchor.anchorId}`,
      );
    }

    const ranges = rangesByPath.get(anchor.path) ?? [];
    ranges.push({
      start: span.startOffset,
      end: span.endOffset,
      after: operation.after,
      anchorId: anchor.anchorId,
    });
    rangesByPath.set(anchor.path, ranges);
  }

  const changes: ExperimentalAppliedChange[] = [];

  for (const [path, ranges] of rangesByPath) {
    const original = input.contentOf(path);
    if (original === null) {
      throw new ExperimentalAnchorError(
        'anchor_stale_file',
        `arquivo desapareceu antes da aplicação: ${path}`,
      );
    }

    const ordered = [...ranges].sort((left, right) => left.start - right.start);

    for (let index = 1; index < ordered.length; index++) {
      if (ordered[index]!.start < ordered[index - 1]!.end) {
        throw new ExperimentalAnchorError(
          'anchor_overlap',
          `âncoras sobrepostas no mesmo arquivo: ${ordered[index - 1]!.anchorId} / ${ordered[index]!.anchorId}`,
        );
      }
    }

    let next = original;
    for (const range of [...ordered].sort((left, right) => right.start - left.start)) {
      next = next.slice(0, range.start) + range.after + next.slice(range.end);
    }

    if (next !== original) {
      changes.push({ path, newContent: next, kind: 'replace' });
    }
  }

  if (changes.length === 0) {
    throw new ExperimentalAnchorError(
      'anchor_no_effective_edits',
      'as operações experimentais não produziram mudança real.',
    );
  }

  return changes;
}
