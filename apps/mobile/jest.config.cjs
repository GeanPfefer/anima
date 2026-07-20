module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@anima/core$': '<rootDir>/../../packages/core/src/index.ts',
    '^@anima/types$': '<rootDir>/../../packages/types/src/index.ts',
  },
};
