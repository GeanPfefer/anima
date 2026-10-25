/** @jest-environment node */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildExternalWorkProposal, buildWorktreeHandoff, computeVerifierOpinion, type ExternalItemSnapshot, type ExternalOpenClaim, type ExternalWorkInput, type WorkEvent, type WorkItem,
} from '@anima/core';
import {
  externalAcceptanceRefusal, inspectExternalCandidate, recordExternalCriterionReview, type ExternalReviewDeps,
} from './external-candidate-review';
import { captureExternalTargetSpec, defaultExternalTargetDeps, EXTERNAL_TARGET_ENV, verifyExternalTargetForContract, type ExternalTargetDeps } from './external-target-resolver';
import { createTrustedGitRunner } from './trusted-git';
import { runWorkReview } from '../../cli/app';

// Repositórios 100% descartáveis em tmpdir; persistência e Verifier por doubles (nada toca o banco residente).
jest.setTimeout(90_000);
const sandboxes: string[] = [];
afterAll(() => { for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true }); });
const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', windowsHide: true }).trim();
const sandbox = (): string => { const d = mkdtempSync(join(tmpdir(), 't4-')); sandboxes.push(d); return d; };

const CLAMP = "'use strict';\nfunction clamp(value, min, max) {\n  if (value < min) return min;\n  return value;\n}\nmodule.exports = { clamp };\n";
const CLAMP_FIXED = CLAMP.replace('  return value;', '  if (value > max) return max;\n  return value;');
const CLAMP_TEST = "describe('clamp', () => {\n  test('retorna max quando o valor excede o máximo', () => {});\n  test('mantém o valor dentro do intervalo', () => {});\n});\n";
const TEST_NAME = 'clamp retorna max quando o valor excede o máximo';
const A3 = 'Os testes existentes não foram enfraquecidos';

interface Lab { root: string; rootSha: string; baseSha: string }
function makeLab(name: string, extra: Record<string, string> = {}): Lab {
  const base = sandbox(); mkdirSync(join(base, name));
  const root = realpathSync.native(join(base, name));
  git(root, 'init', '-q', '-b', 'main');
  for (const [p, c] of Object.entries({ 'src/clamp.js': CLAMP, 'src/clamp.test.js': CLAMP_TEST, 'package.json': '{}', ...extra })) { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), c); }
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'base');
  return { root, rootSha: git(root, 'rev-list', '--max-parents=0', 'HEAD'), baseSha: git(root, 'rev-parse', 'HEAD') };
}
const fakeAnima = (): string => { const l = makeLab('fake-anima', { 'apps/web/package.json': '{}' }); return l.root; };
/** Branch da attempt com UM commit candidato sobre a base. */
function candidate(lab: Lab, attemptId: string, files: Record<string, string> = { 'src/clamp.js': CLAMP_FIXED }): string {
  git(lab.root, 'checkout', '-q', '-b', `anima-work/${attemptId}`, lab.baseSha);
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(lab.root, p, '..'), { recursive: true }); writeFileSync(join(lab.root, p), c); }
  git(lab.root, 'add', '-A'); git(lab.root, 'commit', '-q', '-m', 'candidato');
  const sha = git(lab.root, 'rev-parse', 'HEAD'); git(lab.root, 'checkout', '-q', 'main'); return sha;
}

const targetEnv = (reference: string, lab: Lab): Record<string, string> => ({ [EXTERNAL_TARGET_ENV]: JSON.stringify({ reference, repoRoot: lab.root, rootCommitSha: lab.rootSha }) });
const input = (): ExternalWorkInput => ({
  reference: 'ext:shop', objective: 'Corrigir clamp quando excede max', scope: ['src/clamp.js', 'src/clamp.test.js'], excluded: ['package.json'],
  acceptance: [{ id: 'A1', text: 'clamp(15, 0, 10) retorna 10' }, { id: 'A2', text: 'npm test passa' }, { id: 'A3', text: A3 }],
  gates: [{ command: 'npm test', covers: ['A2'] }], bindings: [{ covers: ['A1'], file: 'src/clamp.test.js', minNewTests: 0, boundTests: [TEST_NAME] }], reviews: ['A3'], backend: 'codex-cli',
});

interface World {
  lab: Lab; anima: string; item: WorkItem; events: WorkEvent[]; env: Record<string, string>; targetDeps: ExternalTargetDeps;
  deps: ExternalReviewDeps; messages: Map<string, { userId: string; content: string }>; attach: jest.Mock; items: ExternalItemSnapshot[]; claims: ExternalOpenClaim[]; attemptId: string; commit: string;
}
const NOW = new Date('2026-10-25T12:00:00.000Z');
const ev = (id: string, type: WorkEvent['type'], data: Record<string, unknown>, v = 1): WorkEvent => ({ id, workItemId: 'w1', type, author: 'system', proposalVersion: v, payload: { schema_version: 1, data } as never, occurredAt: NOW });

async function world(over: { files?: Record<string, string>; lab?: Lab; reference?: string; handoffBase?: string; handoffFiles?: string[]; userId?: string } = {}): Promise<World> {
  const lab = over.lab ?? makeLab('shop'); const anima = fakeAnima();
  const reference = over.reference ?? 'ext:shop';
  const env = targetEnv(reference, lab);
  const targetDeps: ExternalTargetDeps = { ...defaultExternalTargetDeps, animaRoot: () => anima };
  const captured = await captureExternalTargetSpec(env, { deps: targetDeps });
  if (!captured.ok) throw new Error(captured.code);
  const built = buildExternalWorkProposal({ ...input(), reference }, captured.specTarget, NOW.toISOString());
  if (!built.ok) throw new Error(built.code);
  const item = { ...built.command, id: 'w1', userId: 'u', sourceMessageId: 's', state: 'review', originalRequest: 'x', proposalVersion: 1, createdAt: NOW, updatedAt: NOW } as unknown as WorkItem;
  const attemptId = `att-${Math.random().toString(16).slice(2, 8)}`;
  const commit = candidate(lab, attemptId, over.files);
  const handoff = buildWorktreeHandoff({ workItemId: 'w1', attemptId, approvedProposalVersion: 1, executorId: 'worktree-v1', backendId: 'codex-cli:default', model: null,
    baseSha: over.handoffBase ?? lab.baseSha, branch: `anima-work/${attemptId}`, commitSha: commit, status: 'succeeded', changedFiles: over.handoffFiles ?? ['src/clamp.js'],
    diffFiles: (over.handoffFiles ?? ['src/clamp.js']).map(path => ({ path, insertions: 1, deletions: 0 })), gates: [{ label: 'npm test', command: 'npm test', exitCode: 0, outcome: 'passed' }] });
  if (!handoff.ok) throw new Error(handoff.explanation);
  const result = ev('res-1', 'result_submitted', { work_item_id: 'w1', attempt_id: attemptId, approved_proposal_version: 1, summary: 'feito', result_references: [], executor_signal: { worktreeHandoff: handoff.value } });
  const opinion = computeVerifierOpinion(item, [result]);
  if (!opinion) throw new Error('sem parecer');
  // O Verifier real é coberto nos testes do core; aqui o parecer é FORÇADO a `verified` com base de evidência completa.
  const verified = { ...opinion, verdict: 'verified' as const, evidenceBasis: { ...opinion.evidenceBasis, observedEventId: 'ev-git', observedGateEventId: 'ev-gate', coverage: { git: true, gates: true } } };
  const events: WorkEvent[] = [result,
    ev('git-1', 'host_observed_evidence_recorded', { attempt_id: attemptId, evidence: { observedCommitSha: commit, baseSha: lab.baseSha } }),
    ev('op-1', 'verifier_opinion_recorded', { work_item_id: 'w1', attempt_id: attemptId, approved_proposal_version: 1, opinion: verified })];
  const messages = new Map<string, { userId: string; content: string }>();
  const items: ExternalItemSnapshot[] = []; const claims: ExternalOpenClaim[] = [];
  const attach = jest.fn(async (cmd: { references: Array<{ kind: string; id: string }> }) => {
    events.push(ev(`ctx-${events.length}`, 'context_attached', { context_references: cmd.references }));
    return { ok: true as const, value: { id: 'c', workItemId: 'w1', version: 2, references: cmd.references, createdAt: NOW } };
  });
  const userId = over.userId ?? 'u';
  const deps: ExternalReviewDeps = {
    service: { getItem: async () => ({ ok: true as const, value: item }), listEvents: async () => ({ ok: true as const, value: [...events] }), attachContext: attach as never },
    userId, now: () => NOW,
    verifyTarget: contract => verifyExternalTargetForContract(contract, env, targetDeps),
    gitFor: gitDir => createTrustedGitRunner({ gitDir }),
    physical: { listItems: async () => items, listOpenClaims: async () => claims },
    messages: {
      insert: async content => { const id = `msg-${messages.size + 1}`; messages.set(id, { userId, content }); return id; },
      load: async ids => ids.flatMap(id => messages.has(id) ? [{ id, userId: messages.get(id)!.userId, content: messages.get(id)!.content }] : []),
    },
  };
  return { lab, anima, item, events, env, targetDeps, deps, messages, attach, items, claims, attemptId, commit };
}
const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
const ok = async (w: World) => { const r = await inspectExternalCandidate('w1', w.deps); if (!r.ok) throw new Error(`${r.code}: ${r.message}`); return r; };

describe('inspectExternalCandidate (somente leitura)', () => {
  test('candidato verified: identidade, Git real e diff; nada é gravado', async () => {
    const w = await world();
    const r = await ok(w);
    expect(r.facts).toMatchObject({ candidateCommitSha: w.commit, baseSha: w.lab.baseSha, attemptId: w.attemptId, branch: `anima-work/${w.attemptId}`, reference: 'ext:shop' });
    expect(r.repoRoot).toBe(w.lab.root);
    expect(r.diff.files).toEqual(['src/clamp.js']);
    expect(r.diff.text).toContain('+  if (value > max) return max;');
    expect(r.diff.sha256).toBe(sha256(git(w.lab.root, 'diff', '--no-ext-diff', '--no-textconv', '--no-color', w.lab.baseSha, w.commit) + '\n'));
    expect(r.criteria).toEqual([{ position: 3, text: A3, status: 'pending' }]);
    expect(w.messages.size).toBe(0); expect(w.attach).not.toHaveBeenCalled();
  });

  test('recusas: não é trabalho externo, fora de review, Verifier não verified, versão', async () => {
    const w = await world();
    w.deps.service.getItem = async () => ({ ok: true as const, value: { ...w.item, intent: { execution_spec: { target: { kind: 'project', reference: 'anima' } } } } as unknown as WorkItem });
    expect(await inspectExternalCandidate('w1', w.deps)).toMatchObject({ ok: false, code: 'not_external_work' });
    const w2 = await world(); w2.deps.service.getItem = async () => ({ ok: true as const, value: { ...w2.item, state: 'completed' } as WorkItem });
    expect(await inspectExternalCandidate('w1', w2.deps)).toMatchObject({ ok: false, code: 'not_in_review' });
    const w3 = await world(); w3.events.splice(w3.events.findIndex(e => e.type === 'verifier_opinion_recorded'), 1);
    expect(await inspectExternalCandidate('w1', w3.deps)).toMatchObject({ ok: false, code: 'verifier_not_verified' });
  });

  test('identidade alterada após a autorização (outro repositório / caminho): recusa antes de qualquer Git', async () => {
    const w = await world();
    const stranger = makeLab('stranger');
    const deps = { ...w.deps, verifyTarget: ((c: Parameters<typeof verifyExternalTargetForContract>[0]) => verifyExternalTargetForContract(c, targetEnv('ext:shop', stranger), w.targetDeps)) as typeof verifyExternalTargetForContract };
    const r = await inspectExternalCandidate('w1', deps);
    expect(r).toMatchObject({ ok: false });
    expect(['external_target_base_sha_invalid', 'external_target_root_commit_mismatch']).toContain((r as { code: string }).code);
    const clone = join(sandbox(), 'clone'); execFileSync('git', ['clone', '-q', w.lab.root, clone], { windowsHide: true });
    const cloneLab: Lab = { ...w.lab, root: realpathSync.native(clone) };
    const viaClone = { ...w.deps, verifyTarget: ((c: Parameters<typeof verifyExternalTargetForContract>[0]) => verifyExternalTargetForContract(c, targetEnv('ext:shop', cloneLab), w.targetDeps)) as typeof verifyExternalTargetForContract };
    expect(await inspectExternalCandidate('w1', viaClone)).toMatchObject({ ok: false, code: 'external_target_identity_changed' });
    expect(await inspectExternalCandidate('w1', { ...w.deps, verifyTarget: (c => verifyExternalTargetForContract(c, {}, w.targetDeps)) as typeof verifyExternalTargetForContract })).toMatchObject({ ok: false, code: 'external_target_not_configured' });
  });

  test('SHA-base divergente da identidade autorizada: recusa', async () => {
    const w = await world({ handoffBase: 'f'.repeat(40) });
    w.events[w.events.findIndex(e => e.id === 'git-1')] = ev('git-1', 'host_observed_evidence_recorded', { attempt_id: w.attemptId, evidence: { observedCommitSha: w.commit, baseSha: 'f'.repeat(40) } });
    expect(await inspectExternalCandidate('w1', w.deps)).toMatchObject({ ok: false });
  });

  test('candidato de outro work item: handoff com outro item não é reconhecido', async () => {
    const w = await world();
    const result = w.events[0]!;
    (result.payload as { data: Record<string, unknown> }).data['work_item_id'] = 'w9';
    expect(await inspectExternalCandidate('w1', w.deps)).toMatchObject({ ok: false });
  });

  test('branch movida / commit do host divergente / diff fora do escopo / arquivos divergentes do handoff', async () => {
    const moved = await world();
    git(moved.lab.root, 'branch', '-f', `anima-work/${moved.attemptId}`, moved.lab.baseSha);
    expect(await inspectExternalCandidate('w1', moved.deps)).toMatchObject({ ok: false, code: 'candidate_branch_mismatch' });
    const hostDiverges = await world();
    hostDiverges.events[hostDiverges.events.findIndex(e => e.id === 'git-1')] = ev('git-1', 'host_observed_evidence_recorded', { attempt_id: hostDiverges.attemptId, evidence: { observedCommitSha: 'e'.repeat(40), baseSha: hostDiverges.lab.baseSha } });
    expect(await inspectExternalCandidate('w1', hostDiverges.deps)).toMatchObject({ ok: false, code: 'host_observed_commit_mismatch' });
    const outside = await world({ files: { 'src/clamp.js': CLAMP_FIXED, 'package.json': '{"x":1}' }, handoffFiles: ['package.json', 'src/clamp.js'] });
    expect(await inspectExternalCandidate('w1', outside.deps)).toMatchObject({ ok: false, code: 'candidate_outside_authorized_scope' });
    const hidden = await world({ files: { 'src/clamp.js': CLAMP_FIXED, 'src/clamp.test.js': CLAMP_TEST + '// x\n' } });
    expect(await inspectExternalCandidate('w1', hidden.deps)).toMatchObject({ ok: false, code: 'candidate_diff_mismatch' });
  });

  test('mesmo repositório físico sob OUTRA referência: execução em curso recusa; item retido só avisa', async () => {
    const w = await world();
    const other = await captureExternalTargetSpec(targetEnv('ext:other', w.lab), { deps: w.targetDeps });
    if (!other.ok) throw new Error(other.code);
    const otherIntent = { execution_spec: { target: other.specTarget } };
    w.items.push({ id: 'w-retained', state: 'in_progress', intent: otherIntent });
    const r = await ok(w);
    expect(r.retainedConflicts).toEqual([{ workItemId: 'w-retained', reference: 'ext:other', kind: 'retained' }]);
    w.claims.push({ workItemId: 'w-retained', expiresAt: '2026-10-25T13:00:00.000Z' });
    expect(await inspectExternalCandidate('w1', w.deps)).toMatchObject({ ok: false, code: 'external_physical_conflict_running' });
    w.claims.length = 0; w.items.length = 0;
    w.items.push({ id: 'w-far', state: 'in_progress', intent: { execution_spec: { target: (await captureExternalTargetSpec(targetEnv('ext:far', makeLab('far')), { deps: w.targetDeps }) as { specTarget: unknown }).specTarget } } });
    expect((await ok(w)).retainedConflicts).toEqual([]);
  });

  test('hooks e configuração hostis do repositório externo não executam (Git confiável)', async () => {
    const lab = makeLab('hostile');
    const marks = { hook: join(sandbox(), 'hook'), ext: join(sandbox(), 'ext'), fsm: join(sandbox(), 'fsm'), conv: join(sandbox(), 'conv') };
    const sh = (p: string) => p.replace(/\\/g, '/');
    const script = (name: string, mark: string) => { const f = join(lab.root, '.git', name); writeFileSync(f, `#!/bin/sh\necho executed > "${sh(mark)}"\nexit 0\n`, { mode: 0o755 }); return sh(f); };
    for (const hook of ['post-checkout', 'pre-commit', 'post-commit', 'reference-transaction']) writeFileSync(join(lab.root, '.git', 'hooks', hook), `#!/bin/sh\necho executed > "${sh(marks.hook)}"\nexit 0\n`, { mode: 0o755 });
    git(lab.root, 'config', 'diff.external', script('ext.sh', marks.ext));
    git(lab.root, 'config', 'core.fsmonitor', script('fsm.sh', marks.fsm));
    git(lab.root, 'config', 'diff.hostile.textconv', script('conv.sh', marks.conv));
    writeFileSync(join(lab.root, '.gitattributes'), '*.js diff=hostile\n'); git(lab.root, 'add', '-A'); git(lab.root, 'commit', '-q', '-m', 'attrs');
    const hostile: Lab = { ...lab, baseSha: git(lab.root, 'rev-parse', 'HEAD') };
    // CONTROLE: o Git comum, com a configuração do alvo, executaria o diff externo (o teste não é vácuo).
    const control = await world({ lab: hostile }).catch(() => null);
    if (!control) throw new Error('setup');
    git(hostile.root, 'diff', control.lab.baseSha, control.commit);
    expect(existsSync(marks.ext) || existsSync(marks.conv)).toBe(true);
    for (const m of Object.values(marks)) rmSync(m, { force: true });
    const r = await ok(control);
    expect(r.diff.text).toContain('+  if (value > max) return max;');
    for (const m of Object.values(marks)) expect(existsSync(m)).toBe(false);
  });
});

describe('revisão humana e gate do aceite', () => {
  const decide = (w: World, over: Partial<{ position: number; decision: 'accept' | 'reject'; diffDigest: string; reason: string }> = {}) =>
    ok(w).then(r => recordExternalCriterionReview('w1', { position: 3, decision: 'accept', diffDigest: r.diff.sha256, ...over }, w.deps));

  test('aceitar o resultado sem revisão humana é recusado (pendente ≠ concluída)', async () => {
    const w = await world();
    expect(await externalAcceptanceRefusal('w1', w.deps)).toMatchObject({ code: 'external_human_review_missing', message: expect.stringContaining(A3) });
  });

  test('revisão accept do candidato libera o aceite; a decisão persiste mensagem do operador + contexto e não aceita nada', async () => {
    const w = await world();
    const r = await decide(w);
    expect(r).toMatchObject({ ok: true, decision: 'accept', criterion: A3, remaining: [] });
    expect(w.messages.size).toBe(1);
    const record = JSON.parse([...w.messages.values()][0]!.content);
    expect(record).toMatchObject({ kind: 'external_criterion_review_v1', workItemId: 'w1', candidateCommitSha: w.commit, attemptId: w.attemptId, baseSha: w.lab.baseSha, reviewerUserId: 'u', criterion: A3, decision: 'accept' });
    expect(w.attach).toHaveBeenCalledTimes(1);
    expect((w.attach.mock.calls[0] as unknown[])[0]).toMatchObject({ workItemId: 'w1', expectedProposalVersion: 1, references: [{ kind: 'message', id: 'msg-1' }] });
    expect(await externalAcceptanceRefusal('w1', w.deps)).toBeNull();
    expect(w.item.state).toBe('review');
  });

  test('rejeição bloqueia o aceite; nova decisão accept do mesmo candidato supera', async () => {
    const w = await world();
    await decide(w, { decision: 'reject', reason: 'enfraqueceu' });
    expect(await externalAcceptanceRefusal('w1', w.deps)).toMatchObject({ code: 'external_human_review_rejected' });
    await decide(w);
    expect(await externalAcceptanceRefusal('w1', w.deps)).toBeNull();
  });

  test('digest errado, critério que não é human_review e decisão inválida são recusados sem gravar', async () => {
    const w = await world();
    expect(await recordExternalCriterionReview('w1', { position: 3, decision: 'accept', diffDigest: '0'.repeat(64) }, w.deps)).toMatchObject({ ok: false, code: 'diff_digest_mismatch' });
    expect(await decide(w, { position: 1 })).toMatchObject({ ok: false, code: 'criterion_not_human_review' });
    expect(await decide(w, { decision: 'maybe' as never })).toMatchObject({ ok: false, code: 'decision_invalid' });
    expect(await recordExternalCriterionReview('w1', { position: 3, decision: 'accept', diffDigest: 'curto' }, w.deps)).toMatchObject({ ok: false, code: 'diff_digest_invalid' });
    expect(w.messages.size).toBe(0); expect(w.attach).not.toHaveBeenCalled();
  });

  test('revisão de OUTRO candidato não é reutilizada (nova attempt, mesmo item)', async () => {
    const w = await world();
    await decide(w);
    expect(await externalAcceptanceRefusal('w1', w.deps)).toBeNull();
    // segunda attempt: novo commit, novo resultado, novo parecer
    const attemptId = 'att-second';
    const commit = candidate(w.lab, attemptId, { 'src/clamp.js': CLAMP_FIXED + '// v2\n' });
    const handoff = buildWorktreeHandoff({ workItemId: 'w1', attemptId, approvedProposalVersion: 1, executorId: 'worktree-v1', backendId: 'codex-cli:default', model: null, baseSha: w.lab.baseSha,
      branch: `anima-work/${attemptId}`, commitSha: commit, status: 'succeeded', changedFiles: ['src/clamp.js'], diffFiles: [{ path: 'src/clamp.js', insertions: 2, deletions: 0 }],
      gates: [{ label: 'npm test', command: 'npm test', exitCode: 0, outcome: 'passed' }] });
    if (!handoff.ok) throw new Error(handoff.explanation);
    w.events.push(ev('res-2', 'result_submitted', { work_item_id: 'w1', attempt_id: attemptId, approved_proposal_version: 1, summary: 'v2', result_references: [], executor_signal: { worktreeHandoff: handoff.value } }),
      ev('git-2', 'host_observed_evidence_recorded', { attempt_id: attemptId, evidence: { observedCommitSha: commit, baseSha: w.lab.baseSha } }));
    expect(await externalAcceptanceRefusal('w1', w.deps)).toMatchObject({ code: 'external_human_review_missing' });
  });

  test('mensagem forjada por outro usuário ou com registro de outro item é ignorada', async () => {
    const w = await world();
    const r = await ok(w);
    const record = { schemaVersion: 1, kind: 'external_criterion_review_v1', workItemId: 'w1', approvedProposalVersion: 1, attemptId: w.attemptId, resultEventId: 'res-1', candidateCommitSha: w.commit,
      baseSha: w.lab.baseSha, reference: 'ext:shop', criterion: A3, decision: 'accept', diffSha256: r.diff.sha256, reviewerUserId: 'u', reviewedAt: NOW.toISOString() };
    w.messages.set('msg-x', { userId: 'intruso', content: JSON.stringify(record) });
    w.messages.set('msg-y', { userId: 'u', content: JSON.stringify({ ...record, reviewerUserId: 'intruso' }) });
    w.messages.set('msg-z', { userId: 'u', content: JSON.stringify({ ...record, workItemId: 'w2' }) });
    w.events.push(ev('ctx-forged', 'context_attached', { context_references: ['msg-x', 'msg-y', 'msg-z'].map(id => ({ kind: 'message', id })) }));
    expect(await externalAcceptanceRefusal('w1', w.deps)).toMatchObject({ code: 'external_human_review_missing' });
  });

  test('regressão: item interno do Anima e externo sem human_review passam intactos pelo gate', async () => {
    const w = await world();
    w.deps.service.getItem = async () => ({ ok: true as const, value: { ...w.item, intent: { execution_spec: { target: { kind: 'project', reference: 'anima' }, validation_criteria: [{ label: 'x', proof: 'human_review', covers: ['y'] }] } } } as unknown as WorkItem });
    expect(await externalAcceptanceRefusal('w1', w.deps)).toBeNull();
  });
});

describe('integração com work accept (CLI)', () => {
  test('runWorkReview recusa o aceite pelo gate (exit 3) e não chama reviewResult; sem gate o fluxo antigo é idêntico', async () => {
    const reviewResult = jest.fn();
    const item = { id: 'w1', state: 'review', proposalVersion: 1 };
    const service = { getItem: async () => ({ ok: true, value: item }), listEvents: async () => ({ ok: true, value: [] }), listContexts: async () => ({ ok: true, value: [] }), reviewResult } as never;
    const gated = await runWorkReview(service, 'w1', { type: 'accept' }, async () => ({ code: 'external_human_review_missing', message: 'falta revisão' }));
    expect(gated.exitCode).toBe(3);
    expect(gated.payload).toMatchObject({ ok: false, code: 'external_human_review_missing' });
    expect(reviewResult).not.toHaveBeenCalled();
    // request_changes nunca passa pelo gate
    const gate = jest.fn(async () => ({ code: 'x', message: 'y' }));
    await runWorkReview(service, 'w1', { type: 'request_changes', requestedChanges: 'ajustar' }, gate);
    expect(gate).not.toHaveBeenCalled();
  });
});
