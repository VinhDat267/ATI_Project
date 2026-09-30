import { defineConfig } from '@playwright/test';

if (process.env.LIVE_APP !== '1') {
  throw new Error('This run writes to real Trello, Slack and GitHub through the app; set LIVE_APP=1 to confirm');
}

/**
 * Drives the real web UI against an already running live server
 * (RUNTIME_MODE=live npm run up). It starts no server itself, so a sandbox
 * server is never mistaken for a live one.
 */
export default defineConfig({
  testDir: '.',
  testMatch: 'live-app.e2e.ts',
  timeout: 35 * 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: 'line',
  outputDir: '../../node_modules/.cache/v3-live-app-results',
  use: {
    baseURL: process.env.LIVE_APP_WEB_URL || 'http://127.0.0.1:5174',
    browserName: 'chromium',
    headless: true,
    trace: 'off',
  },
});
