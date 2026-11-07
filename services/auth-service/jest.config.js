/**
 * Jest configuration for auth-service.
 *
 * Design goals:
 *   - Mirror tsconfig.json paths so `@/foo` resolves in tests
 *   - Fail CI on coverage regressions (thresholds enforced)
 *   - Isolate tests from the network (no accidental external calls)
 *   - Fast: parallel workers, but serial DB access per test file
 *   - Clear failure output
 */

/** @type {import('jest').Config} */
module.exports = {
  // ------------------------------------------------------------
  // PRESET & ENVIRONMENT
  // ------------------------------------------------------------
  preset: 'ts-jest',
  testEnvironment: 'node',

  // ------------------------------------------------------------
  // PATHS
  // ------------------------------------------------------------
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },

  // ------------------------------------------------------------
  // TRANSFORMS
  // ------------------------------------------------------------
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
        isolatedModules: true, // speeds up tests; per-file type check is enough
      },
    ],
  },

  // ------------------------------------------------------------
  // SETUP FILES
  // ------------------------------------------------------------
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],

  // ------------------------------------------------------------
  // COVERAGE
  // ------------------------------------------------------------
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/types/**',
    '!src/index.ts', // bootstrap — covered by integration smoke test
    '!src/db/**',    // DB wrappers covered indirectly via models
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'text-summary', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 75,
      statements: 75,
    },
    // Critical files get a stricter bar
    './src/services/auth.service.ts': {
      branches: 75,
      functions: 80,
      lines: 80,
      statements: 80,
    },
    './src/utils/password.util.ts': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
    './src/utils/jwt.util.ts': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },

  // ------------------------------------------------------------
  // EXECUTION
  // ------------------------------------------------------------
  testTimeout: 15000,      // 15s per test (DB calls can be slow on cold CI)
  maxWorkers: '50%',       // parallel where safe
  bail: process.env.CI ? 1 : 0, // fail-fast on CI
  verbose: true,
  clearMocks: true,
  resetMocks: false,       // explicit reset in setup.ts
  restoreMocks: true,

  // ------------------------------------------------------------
  // REPORTING
  // ------------------------------------------------------------
  reporters: [
    'default',
    ...(process.env.CI
      ? [['jest-junit', { outputDirectory: 'coverage', outputName: 'junit.xml' }]]
      : []),
  ],

  // ------------------------------------------------------------
  // MISC
  // ------------------------------------------------------------
  errorOnDeprecated: true,
  detectOpenHandles: true,
  forceExit: false,
};