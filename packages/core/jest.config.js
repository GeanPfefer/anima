/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@anima/types$': '<rootDir>/../types/src/index.ts',
  },
};
