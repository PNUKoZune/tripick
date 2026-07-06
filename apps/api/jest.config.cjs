module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  moduleNameMapper: {
    '^@tripick/types$': '<rootDir>/../../packages/types/src/index.ts',
    '^@tripick/utils$': '<rootDir>/../../packages/utils/src/index.ts',
  },
  testEnvironment: 'node',
};
