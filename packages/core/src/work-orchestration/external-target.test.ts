import {
  canonicalPathContains,
  compareExternalTargetIdentity,
  externalTargetToSpecTarget,
  isExternalTargetReference,
  readExternalTarget,
  sameCanonicalPath,
  type ExternalTargetIdentityV1,
} from './external-target';
import { evaluateAutonomousApprovalEnvelope } from './autonomous-authorization';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const identity: ExternalTargetIdentityV1 = {
  repoRootCanonical: 'C:\\work\\shop', gitCommonDirCanonical: 'C:\\work\\shop\\.git', rootCommitSha: A, baseSha: B,
};
const target = { reference: 'ext:shop', identity };

describe('referência externa', () => {
  test.each(['ext:shop', 'ext:a', 'ext:my-app-2'])('%s é válida', ref => expect(isExternalTargetReference(ref)).toBe(true));
  test.each(['anima', 'project:anima', 'ext:', 'ext:-x', 'ext:x-', 'ext:Shop', 'ext:a b', 'ext:../x', 'EXT:shop', `ext:${'a'.repeat(40)}`, null, undefined, 7])(
    '%j é recusada', ref => expect(isExternalTargetReference(ref)).toBe(false));
});

describe('readExternalTarget', () => {
  test('round-trip pelo formato persistido', () => {
    expect(readExternalTarget(externalTargetToSpecTarget(target))).toEqual({ ok: true, target });
  });
  test('anima não representa externo, nem com identidade', () => {
    const spec = { ...externalTargetToSpecTarget(target), reference: 'anima' };
    expect(readExternalTarget(spec)).toEqual({ ok: false, reason: 'external_target_reference_invalid' });
    expect(readExternalTarget({ ...spec, reference: 'project:anima' })).toMatchObject({ ok: false });
  });
  test.each([
    ['sem identidade', { kind: 'project', reference: 'ext:shop' }, 'external_target_identity_missing'],
    ['kind errado', { ...externalTargetToSpecTarget(target), kind: 'deploy' }, 'external_target_kind_invalid'],
    ['campo extra', { ...externalTargetToSpecTarget(target), identity: { ...(externalTargetToSpecTarget(target).identity as object), extra: 1 } }, 'external_target_identity_malformed'],
    ['SHA curto', { ...externalTargetToSpecTarget(target), identity: { ...(externalTargetToSpecTarget(target).identity as object), base_sha: 'abc123' } }, 'external_target_identity_sha_invalid'],
    ['caminho relativo', { ...externalTargetToSpecTarget(target), identity: { ...(externalTargetToSpecTarget(target).identity as object), repo_root_canonical: 'shop' } }, 'external_target_identity_path_invalid'],
    ['caminho com ..', { ...externalTargetToSpecTarget(target), identity: { ...(externalTargetToSpecTarget(target).identity as object), repo_root_canonical: 'C:\\work\\..\\x' } }, 'external_target_identity_path_invalid'],
  ])('%s é recusado', (_name, raw, reason) => expect(readExternalTarget(raw)).toEqual({ ok: false, reason }));
  test.each([null, [], 'x', 3])('não-objeto %j é recusado', raw => expect(readExternalTarget(raw)).toMatchObject({ ok: false }));
});

describe('comparação de identidade', () => {
  test('alias textual (barras, caixa, barra final) é a mesma identidade', () => {
    expect(compareExternalTargetIdentity(identity, { ...identity, repoRootCanonical: 'c:/WORK/shop/', gitCommonDirCanonical: 'c:/work/shop/.GIT' })).toBeNull();
    expect(sameCanonicalPath('/srv/a', '/srv/a/')).toBe(true);
  });
  test('caminhos POSIX diferem por caixa', () => expect(sameCanonicalPath('/srv/A', '/srv/a')).toBe(false));
  test.each([
    ['repo_root_changed', { repoRootCanonical: 'C:\\work\\other' }],
    ['git_common_dir_changed', { gitCommonDirCanonical: 'C:\\work\\shop\\.git2' }],
    ['root_commit_changed', { rootCommitSha: 'c'.repeat(40) }],
    ['base_sha_changed', { baseSha: 'c'.repeat(40) }],
  ])('%s', (expected, patch) => expect(compareExternalTargetIdentity(identity, { ...identity, ...patch })).toBe(expected));
  test('contenção não confunde prefixo textual', () => {
    expect(canonicalPathContains('C:\\a\\anima', 'C:\\a\\anima\\x')).toBe(true);
    expect(canonicalPathContains('C:\\a\\anima', 'C:\\a\\anima-other')).toBe(false);
  });
});

test('o envelope de auto-aprovação continua recusando target externo (sem autoaprovação)', () => {
  const decision = evaluateAutonomousApprovalEnvelope({
    state: 'proposed', impactLevel: 'low', capability: 'programming', governorVerdict: 'permit',
    intent: { execution_spec: { schema_version: 1, target: externalTargetToSpecTarget(target) } }, proposal: {},
  });
  expect(decision.authorized).toBe(false);
});
