#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- standalone CommonJS test runner */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

// Explicit disposable endpoints prevent an accidental run against the application's services.
for (const key of ['RESOURCE_TEST_DATABASE_URL', 'RESOURCE_TEST_REDIS_PORT']) {
  if (!process.env[key])
    throw new Error(`${key} must point to an explicitly provisioned disposable test service`);
}
const database = new URL(process.env.RESOURCE_TEST_DATABASE_URL);
if (!['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)) {
  throw new Error('Resource integration tests require a local disposable PostgreSQL service');
}
const result = spawnSync(
  process.execPath,
  [
    require.resolve('jest/bin/jest'),
    '--config',
    'test/jest-resource-integration.json',
    '--runInBand',
    ...process.argv.slice(2),
  ],
  {
    cwd: path.resolve(__dirname, '..'),
    env: process.env,
    stdio: 'inherit',
  },
);
process.exit(result.status ?? 1);
