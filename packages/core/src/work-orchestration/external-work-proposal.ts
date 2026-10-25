import { lintAcceptanceContract } from './acceptance-contract-lint';
import type { CreateWorkProposalCommand } from './commands';
import { evaluateAutonomousEligibility, readAutonomousExecutionSpec } from './eligibility';
import { isAllowedGateCommand } from './gate-command-policy';
import { isExternalTargetReference, isFullCommitSha, readExternalTarget } from './external-target';
import type { WorkItem } from './types';
import { isValidWorkIntent, isValidWorkProposal } from './validation';

// ============================================================
// Proposta de trabalho em TARGET EXTERNO (Project Builder V0 — T2/T3). Construtor PURO.
//
// O operador fornece o objetivo, o escopo, os critérios de aceite COM IDENTIDADE ESTÁVEL (A1, A2…), o backend e as PROVAS de cada
// critério. Nada aqui usa LLM, toca disco/Git, aprova, classifica ou executa: o resultado é um `CreateWorkProposalCommand`
// (estado `proposed`) no formato `acceptance_contract: 2` já existente (mesmo do planner), que segue o fluxo humano
// (aprovação → classificação humana → Single-Item). A identidade do repositório (T1) chega pronta em `specTarget`.
//
// Contrato de provas (reutiliza `covers`, `claim_kind` e `lintAcceptanceContract`; o Verifier NÃO é flexibilizado):
//   - gate_assertion : o resultado do comando É a afirmação (ex.: "npm test passa"). Não prova comportamento.
//   - test_binding   : testes nomeados (Jest) que devem existir e passar, medidos pelo relatório do host.
//   - human_review   : o critério aguarda revisão humana (pendência registrada, nunca prova automática).
// Cada critério é coberto EXATAMENTE uma vez e ao menos um é provado de forma automática; senão a proposta é recusada, porque
// terminaria estruturalmente `inconclusive`.
// ============================================================

export const EXTERNAL_WORK_ORIGIN = 'cli_propose_external_v1' as const;
export const EXTERNAL_WORK_BACKENDS = ['ollama', 'codex-cli'] as const;
export type ExternalWorkBackend = typeof EXTERNAL_WORK_BACKENDS[number];

export const EXTERNAL_WORK_OBJECTIVE_MAX = 4000;
export const EXTERNAL_WORK_ITEM_MAX = 400;
export const EXTERNAL_WORK_LIST_MAX = 20;
export const EXTERNAL_WORK_MAX_ATTEMPTS = 3;
export const EXTERNAL_WORK_MAX_MINUTES = 60;
export const EXTERNAL_WORK_MAX_BINDINGS = 3;
export const EXTERNAL_WORK_MAX_BOUND_TESTS = 50;
export const EXTERNAL_ACCEPTANCE_ID_PATTERN = /^A[1-9]\d?$/;

export interface ExternalAcceptanceCriterion {
  /** Identificação estável (`A1`…`A99`) usada nas declarações de prova. */
  readonly id: string;
  readonly text: string;
}
/** Gate por comando. Com `covers`, é prova `gate_assertion` desses critérios; sem `covers`, é só um gate exigido. */
export interface ExternalGateProof { readonly command: string; readonly covers?: readonly string[] }
/** Teste(s) nomeado(s) de UM arquivo de teste Jest, que devem existir e passar. `boundTests` são nomes completos (describe + título). */
export interface ExternalTestBindingProof {
  readonly covers: readonly string[];
  readonly file: string;
  readonly minNewTests: number;
  readonly boundTests: readonly string[];
}

export interface ExternalWorkInput {
  readonly reference: string;
  readonly objective: string;
  /** Caminhos relativos (arquivos ou diretórios) que a execução pode alterar. */
  readonly scope: readonly string[];
  readonly excluded?: readonly string[];
  readonly acceptance: readonly ExternalAcceptanceCriterion[];
  readonly gates: readonly ExternalGateProof[];
  readonly bindings?: readonly ExternalTestBindingProof[];
  /** Ids dos critérios que dependem de revisão humana. */
  readonly reviews?: readonly string[];
  readonly backend: string;
  /** Obrigatório para `ollama`; `codex-cli` usa sempre `default`. */
  readonly model?: string;
  readonly maxAttempts?: number;
  readonly maxMinutes?: number;
}

export interface ExternalWorkProvenance {
  readonly kind: 'external_work_proposal';
  readonly origin: typeof EXTERNAL_WORK_ORIGIN;
  readonly reference: string;
  readonly preparedAt: string;
}

const object = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !v.includes('\0');

/** Caminho relativo seguro: sem absoluto, `..`, glob, backslash, `.git`/`node_modules`. */
export function isSafeExternalScopePath(value: unknown): value is string {
  if (!text(value, 300) || value !== value.trim()) return false;
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.includes('\\') || /[*?[\]{}]/.test(value)) return false;
  const segments = value.replace(/\/+$/, '').split('/');
  return segments.every(s => s !== '' && s !== '.' && s !== '..' && s.toLowerCase() !== '.git' && s !== 'node_modules');
}

/** Arquivo de teste Jest exato (sem diretório, glob ou espaço) com sufixo suportado. */
export const isExactTestFile = (value: unknown): value is string =>
  isSafeExternalScopePath(value) && /^[A-Za-z0-9_./-]+$/.test(value) && !value.endsWith('/') && /\.(?:test|spec)\.(?:tsx?|jsx?)$/.test(value);

const isList = (v: unknown, min: number, check: (x: unknown) => boolean): v is readonly string[] =>
  Array.isArray(v) && v.length >= min && v.length <= EXTERNAL_WORK_LIST_MAX && v.every(check) && new Set(v).size === v.length;

/**
 * Nomes completos ESTÁTICOS dos testes Jest de um arquivo (`describe… + título`, aninhamento por blocos), sem executar nada do alvo.
 * Títulos dinâmicos (template com interpolação, `each`, variáveis) não entram: fail-closed, porque um nome inexistente tornaria o
 * vínculo estruturalmente insatisfazível.
 */
export function listStaticJestTestNames(fileText: string): ReadonlySet<string> {
  type Node = { kind: 'describe' | 'test'; title: string; at: number; open: number; close: number };
  const nodes: Node[] = [];
  const closeOf = new Map<number, number>();
  const stack: number[] = [];
  const callHead = /\b(describe|test|it)(?:\.(?:only|skip|concurrent|todo))?\s*\(\s*$/;
  let i = 0;
  while (i < fileText.length) {
    const c = fileText[i]!;
    const n = fileText[i + 1];
    if (c === '/' && n === '/') { while (i < fileText.length && fileText[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { const end = fileText.indexOf('*/', i + 2); i = end < 0 ? fileText.length : end + 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      const head = callHead.exec(fileText.slice(Math.max(0, i - 24), i));
      let j = i + 1;
      while (j < fileText.length && fileText[j] !== c) {
        if (fileText[j] === '\\') j++;
        else if (fileText[j] === '\n' && c !== '`') break;
        j++;
      }
      if (head && fileText[j] === c) {
        const title = fileText.slice(i + 1, j).replace(/\\(.)/gu, '$1');
        const dynamic = c === '`' && title.includes('${');
        if (!dynamic && title) nodes.push({ kind: head[1] === 'describe' ? 'describe' : 'test', title, at: i, open: -1, close: -1 });
      }
      i = j + 1;
      continue;
    }
    if (c === '{') stack.push(i);
    else if (c === '}') { const open = stack.pop(); if (open !== undefined) closeOf.set(open, i); }
    i++;
  }
  // O bloco de cada chamada começa na primeira '{' depois do título.
  for (const node of nodes) {
    const open = fileText.indexOf('{', node.at);
    node.open = open;
    node.close = open >= 0 ? (closeOf.get(open) ?? -1) : -1;
  }
  const names = new Set<string>();
  for (const node of nodes) {
    if (node.kind !== 'test') continue;
    const chain = nodes
      .filter(d => d.kind === 'describe' && d.open >= 0 && d.close > d.open && d.open < node.at && node.at < d.close)
      .sort((a, b) => a.open - b.open);
    names.add([...chain.map(d => d.title), node.title].join(' '));
  }
  return names;
}

export const boundTestNameResolvable = (fileText: string, fullName: string): boolean =>
  fullName.trim().length > 0 && listStaticJestTestNames(fileText).has(fullName);

/** Valida o contrato de provas. Devolve código estável (`codigo` ou `codigo:detalhe`) ou null. */
export function validateExternalProofs(input: ExternalWorkInput): string | null {
  const ids = input.acceptance.map(a => a.id);
  const known = new Set(ids);
  const covered = new Map<string, number>();
  const cover = (list: readonly string[] | undefined, kind: string): string | null => {
    for (const id of list ?? []) {
      if (!known.has(id)) return `cover_unknown:${id}`;
      covered.set(id, (covered.get(id) ?? 0) + 1);
    }
    return list !== undefined && new Set(list).size !== list.length ? `cover_duplicate_in_${kind}` : null;
  };
  const commands = new Set<string>();
  for (const gate of input.gates) {
    if (commands.has(gate.command)) return `gate_duplicate:${gate.command}`;
    commands.add(gate.command);
    if (gate.covers !== undefined && gate.covers.length === 0) return 'gate_covers_empty';
    const bad = cover(gate.covers, 'gate'); if (bad) return bad;
  }
  const files = new Set<string>();
  for (const binding of input.bindings ?? []) {
    if (binding.covers.length === 0) return 'binding_covers_empty';
    const bad = cover(binding.covers, 'binding'); if (bad) return bad;
    if (!isExactTestFile(binding.file)) return `binding_file_invalid:${String(binding.file)}`;
    if (files.has(binding.file)) return `binding_file_duplicate:${binding.file}`;
    files.add(binding.file);
    if (!input.scope.includes(binding.file)) return `binding_file_outside_scope:${binding.file}`;
    if (!Number.isInteger(binding.minNewTests) || binding.minNewTests < 0 || binding.minNewTests > 100) return 'binding_min_new_tests_invalid';
    if (binding.boundTests.length > EXTERNAL_WORK_MAX_BOUND_TESTS || !binding.boundTests.every(n => text(n, 400)) || new Set(binding.boundTests).size !== binding.boundTests.length) return 'binding_bound_tests_invalid';
    if (binding.boundTests.length === 0 && binding.minNewTests < 1) return 'binding_vacuous';
  }
  const reviews = input.reviews ?? [];
  const reviewBad = cover(reviews, 'review'); if (reviewBad) return reviewBad;
  for (const id of ids) {
    const n = covered.get(id) ?? 0;
    if (n === 0) return `acceptance_uncovered:${id}`;
    if (n > 1) return `acceptance_covered_twice:${id}`;
  }
  const automated = new Set([...input.gates.flatMap(g => g.covers ?? []), ...(input.bindings ?? []).flatMap(b => b.covers)]);
  if (automated.size === 0) return 'no_automated_proof';
  return null;
}

export function validateExternalWorkInput(input: ExternalWorkInput): string | null {
  if (!isExternalTargetReference(input.reference)) return 'target_reference_invalid';
  if (!text(input.objective, EXTERNAL_WORK_OBJECTIVE_MAX)) return 'objective_invalid';
  if (!isList(input.scope, 1, isSafeExternalScopePath)) return 'scope_invalid';
  // Escopo concreto exige também o que NÃO entra (regra da elegibilidade): exclusões explícitas e obrigatórias.
  if (!isList(input.excluded, 1, isSafeExternalScopePath)) return 'excluded_invalid';
  const acceptance = input.acceptance;
  if (!Array.isArray(acceptance) || acceptance.length < 1 || acceptance.length > EXTERNAL_WORK_LIST_MAX
    || !acceptance.every(a => a && EXTERNAL_ACCEPTANCE_ID_PATTERN.test(a.id) && text(a.text, EXTERNAL_WORK_ITEM_MAX))
    || new Set(acceptance.map(a => a.id)).size !== acceptance.length
    || new Set(acceptance.map(a => a.text.normalize('NFKC').replace(/\s+/gu, ' ').trim())).size !== acceptance.length) return 'acceptance_invalid';
  if (!Array.isArray(input.gates) || input.gates.length < 1 || input.gates.length > EXTERNAL_WORK_LIST_MAX
    || !input.gates.every(g => g && isAllowedGateCommand(g.command) && (g.covers === undefined || Array.isArray(g.covers)))) return 'gates_invalid';
  if (input.bindings !== undefined && (!Array.isArray(input.bindings) || input.bindings.length > EXTERNAL_WORK_MAX_BINDINGS
    || !input.bindings.every(b => b && Array.isArray(b.covers) && Array.isArray(b.boundTests) && typeof b.file === 'string'))) return 'bindings_invalid';
  if (input.reviews !== undefined && !Array.isArray(input.reviews)) return 'reviews_invalid';
  if (!(EXTERNAL_WORK_BACKENDS as readonly string[]).includes(input.backend)) return 'backend_invalid';
  if (input.backend === 'ollama' && !text(input.model, 120)) return 'model_required_for_ollama';
  if (input.backend === 'codex-cli' && input.model !== undefined && input.model !== 'default') return 'model_invalid_for_codex';
  const attempts = input.maxAttempts ?? 1, minutes = input.maxMinutes ?? 30;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > EXTERNAL_WORK_MAX_ATTEMPTS) return 'max_attempts_invalid';
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > EXTERNAL_WORK_MAX_MINUTES) return 'max_minutes_invalid';
  return validateExternalProofs(input);
}

export type ExternalWorkBuild =
  | { readonly ok: true; readonly command: Omit<CreateWorkProposalCommand, 'sourceMessageId'> }
  | { readonly ok: false; readonly code: string };

/**
 * Monta a proposta. `specTarget` é a saída de `captureExternalTargetSpec` (T1): precisa ser um target externo válido da MESMA
 * referência informada e seu `base_sha` é o único base_sha do contrato. Nunca aprova, classifica, reserva compute ou executa.
 */
export function buildExternalWorkProposal(input: ExternalWorkInput, specTarget: unknown, preparedAt: string): ExternalWorkBuild {
  const invalid = validateExternalWorkInput(input);
  if (invalid) return { ok: false, code: invalid };
  const target = readExternalTarget(specTarget);
  if (!target.ok) return { ok: false, code: target.reason };
  if (target.target.reference !== input.reference) return { ok: false, code: 'target_reference_mismatch' };
  const baseSha = target.target.identity.baseSha;
  if (!isFullCommitSha(baseSha)) return { ok: false, code: 'base_sha_invalid' };

  const textOf = new Map(input.acceptance.map(a => [a.id, a.text.trim()] as const));
  const texts = (ids: readonly string[]): string[] => ids.map(id => textOf.get(id)!);
  const criteria: Record<string, unknown>[] = [
    ...input.gates.map(gate => ({
      label: gate.command, command: gate.command, proof: 'gate', claim_kind: 'gate_assertion',
      ...(gate.covers ? { covers: texts(gate.covers) } : {}),
    })),
    ...(input.bindings ?? []).map(binding => ({
      label: `Teste vinculado: ${binding.file}`, proof: 'gate', claim_kind: 'test_binding', covers: texts(binding.covers),
      target_paths: [binding.file], command: `npm test -- ${binding.file}`,
      binding: { test_files: [binding.file], min_new_tests: binding.minNewTests,
        ...(binding.boundTests.length ? { bound_tests: binding.boundTests.map(full_name => ({ file: binding.file, full_name })) } : {}) },
    })),
    ...(input.reviews ?? []).map(id => ({ label: `Revisão humana: ${textOf.get(id)!}`, proof: 'human_review', covers: [textOf.get(id)!] })),
  ];
  if (new Set(criteria.map(c => c['label'])).size !== criteria.length) return { ok: false, code: 'criterion_label_duplicate' };
  if (criteria.some(c => c['command'] !== undefined && !isAllowedGateCommand(c['command']))) return { ok: false, code: 'gates_invalid' };

  const objective = input.objective.trim();
  const command: Omit<CreateWorkProposalCommand, 'sourceMessageId'> = {
    impactLevel: 'low',
    capability: 'programming',
    intent: {
      external_work_provenance: { kind: 'external_work_proposal', origin: EXTERNAL_WORK_ORIGIN, reference: input.reference, preparedAt } satisfies ExternalWorkProvenance,
      execution_spec: {
        schema_version: 1,
        acceptance_contract: 2,
        target: specTarget as Record<string, unknown>,
        executor: 'worktree',
        coder_backend: input.backend,
        coder_backend_source: 'operator_explicit',
        model: input.backend === 'codex-cli' ? 'default' : input.model!.trim(),
        base_sha: baseSha,
        permissions: ['workspace_read', 'workspace_write_isolated'],
        validation_criteria: criteria,
        verifier_requirement: 'required_fail_closed',
        limits: { max_attempts: input.maxAttempts ?? 1, max_duration_minutes: input.maxMinutes ?? 30 },
      },
    } as unknown as CreateWorkProposalCommand['intent'],
    proposal: {
      schemaVersion: 1,
      data: {
        summary: objective.slice(0, 160),
        objective,
        includedScope: [...input.scope],
        excludedScope: [...(input.excluded ?? [])],
        expectedEffects: input.acceptance.map(a => a.text.trim()),
        risks: ['Repositório externo: o código e os gates são do projeto alvo; a execução ocorre em worktree isolada e o resultado exige revisão humana.'],
      },
    } as unknown as CreateWorkProposalCommand['proposal'],
  };
  if (!isValidWorkIntent(command.intent) || !isValidWorkProposal(command.proposal)) return { ok: false, code: 'external_envelope_invalid' };

  // Elegibilidade e lint do contrato v2 avaliados como se aprovada (não aprova nem persiste nada), igual ao planner.
  const preview = { ...command, id: 'external-preview', userId: 'external-preview', sourceMessageId: 'external-preview', state: 'approved',
    originalRequest: objective, proposalVersion: 1, createdAt: new Date(0), updatedAt: new Date(0) } as unknown as WorkItem;
  const eligibility = evaluateAutonomousEligibility(preview);
  if (!eligibility.eligible) return { ok: false, code: `not_eligible:${eligibility.gaps.map(g => `${g.code}`).join(',')}` };
  const spec = readAutonomousExecutionSpec(preview.intent);
  if (!spec) return { ok: false, code: 'execution_spec_unreadable' };
  const findings = lintAcceptanceContract(command.proposal.data.expectedEffects, spec.validationCriteria);
  if (findings.length) return { ok: false, code: `acceptance_contract_invalid:${findings.map(f => f.detail).join(',')}` };
  return { ok: true, command };
}

/** O intent foi produzido por este materializador (origem declarada + target externo válido da mesma referência)? */
export function isExternalWorkEnvelope(intent: unknown): boolean {
  const root = object(intent), p = object(root?.['external_work_provenance']), spec = object(root?.['execution_spec']);
  if (!root || !p || !spec) return false;
  if (Object.keys(p).sort().join(',') !== 'kind,origin,preparedAt,reference') return false;
  if (p['kind'] !== 'external_work_proposal' || p['origin'] !== EXTERNAL_WORK_ORIGIN || !isExternalTargetReference(p['reference'])) return false;
  const target = readExternalTarget(spec['target']);
  return target.ok && target.target.reference === p['reference'] && spec['executor'] === 'worktree' && spec['base_sha'] === target.target.identity.baseSha;
}
