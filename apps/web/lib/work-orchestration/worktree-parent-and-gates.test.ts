/** @jest-environment node */
import { join } from 'node:path';
import { worktreeParentDir } from './worktree';
import { requiredReviewGate } from './review-correction-orchestration';

describe('worktreeParentDir — worktrees no mesmo volume do repositório', () => {
  test('TEMP no mesmo volume ⇒ mantém o TEMP (comportamento anterior)', () => {
    const repo = process.platform === 'win32' ? 'C:/repo' : '/repo';
    const temp = process.platform === 'win32' ? 'C:/Users/x/AppData/Local/Temp' : '/tmp';
    expect(worktreeParentDir(repo, temp)).toBe(temp);
  });
  (process.platform === 'win32' ? test : test.skip)('TEMP em outro volume ⇒ <repo>/.worktrees (junction de node_modules não cruza volumes)', () => {
    expect(worktreeParentDir('G:/anima', 'C:/Users/x/AppData/Local/Temp')).toBe(join('G:/anima', '.worktrees'));
  });
});

describe('requiredReviewGate — gates exigidos na revisão só dentro da allowlist', () => {
  test('aceita build/test/typecheck npm, com rótulo explícito', () => {
    expect(requiredReviewGate(' npm run build --workspace=@anima/web ')).toEqual({
      label: 'Gate exigido pela revisão: npm run build --workspace=@anima/web', command: 'npm run build --workspace=@anima/web',
    });
    expect(requiredReviewGate('npm test --workspace=@anima/web -- app/api/x/route.test.ts')).not.toBeNull();
  });
  test.each(['npx next build', 'npm run build && rm -rf /', 'node build.js', 'npm run lint', ''])('recusa %p', command => {
    expect(requiredReviewGate(command)).toBeNull();
  });
});
