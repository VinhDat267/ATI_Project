import { defineConfig } from '@playwright/test';
import { assertBrowserV3Environment } from '../../scripts/v3-local-env.mjs';

assertBrowserV3Environment(process.env);

export default defineConfig({
  testDir: './tests/browser',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: 'line',
  outputDir: '../../node_modules/.cache/v3-browser-results',
  use: {
    baseURL: 'http://127.0.0.1:5174',
    browserName: 'chromium',
    headless: true,
    trace: 'off',
  },
  webServer: {
    command: process.env.GITHUB_ACTIONS === 'true' ? 'npm run up' : 'npm run up:local:v3',
    url: 'http://127.0.0.1:3000/api/health',
    cwd: '../..',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
