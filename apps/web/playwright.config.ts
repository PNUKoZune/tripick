import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4300',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit-mobile', use: { ...devices['iPhone 13'] } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @tripick/api exec ts-node test/e2e/web-test-server.ts',
      cwd: '../..',
      url: 'http://127.0.0.1:4310/api/v1/health',
      timeout: 120_000,
      env: {
        TEST_DATABASE_URL:
          process.env.TEST_DATABASE_URL ??
          'postgresql://tripick:tripick@localhost:5432/tripick_browser_test',
        TEST_REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6388',
      },
    },
    {
      command: 'pnpm exec next start -p 4300 -H 127.0.0.1',
      url: 'http://127.0.0.1:4300',
      timeout: 60_000,
      env: { TRIPICK_API_ORIGIN: 'http://127.0.0.1:4310' },
    },
  ],
});
