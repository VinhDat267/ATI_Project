import { defineConfig } from '@playwright/test';

if (process.env.LIVE_APP_LATENCY !== '1') {
  throw new Error('This run sends every prompt to the real model through the app; set LIVE_APP_LATENCY=1 to confirm');
}

/**
 * W4-04 batch latency against an already running server (RUNTIME_MODE=live
 * npm run up). Every plan is cancelled and the approve button is never
 * pressed, so no service is written to.
 */
export default defineConfig({
  testDir: '.',
  testMatch: 'latency.e2e.ts',
  timeout: 120 * 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: 'line',
  outputDir: '../../node_modules/.cache/v3-live-latency-results',
  use: {
    baseURL: process.env.LIVE_APP_WEB_URL || 'http://127.0.0.1:5174',
    browserName: 'chromium',
    headless: true,
    trace: 'off',
  },
});
