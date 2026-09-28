import { GATE_COMMAND_POLICY_VERSION, isAllowedGateCommand } from './gate-command-policy';

describe('gate-command-allowlist-v1', () => {
  test.each([
    'npm test',
    'npm.cmd test',
    'npm run typecheck',
    'npm run build --workspace=@anima/web',
    'npm test --workspace=@anima/core -- src/x.test.ts',
  ])('permite %s', (command) => expect(isAllowedGateCommand(command)).toBe(true));

  test.each([
    '',
    'npm install',
    'npm run deploy',
    'npm test && rm -rf .',
    'npm test -- $(whoami)',
    'npm test -- a;b',
    'node x.js',
    'bash -c "npm test"',
    'npx jest',
  ])('recusa %s', (command) => expect(isAllowedGateCommand(command)).toBe(false));

  test('não-string é recusado e a versão é estável', () => {
    expect(isAllowedGateCommand(undefined)).toBe(false);
    expect(isAllowedGateCommand(42)).toBe(false);
    expect(GATE_COMMAND_POLICY_VERSION).toBe('gate-command-allowlist-v1');
  });
});
