import { defineConfig } from '@playwright/test';
import { E2E_BASE_URL, E2E_DATA_DIR } from './e2e/constants.mjs';

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.spec.js',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
  globalSetup: './e2e/global-setup.mjs',
  use: {
    baseURL: E2E_BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node server/index.js',
    url: E2E_BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      DATA_DIR: E2E_DATA_DIR,
      NODE_ENV: 'test',
      TELEGRAM_ENABLED: 'false',
      DISABLE_DEMO_SEED: 'true',
      PORT: '3001',
    },
  },
});
