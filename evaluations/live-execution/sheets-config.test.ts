import { expect, it } from 'vitest';
import { readLiveConfig } from './harness.js';

it('requires Sheets credentials and a valid spreadsheet allowlist without performing network calls', () => {
  const env = { GOOGLE_CLIENT_EMAIL: 'fixture@unit.iam.gserviceaccount.com', GOOGLE_PRIVATE_KEY: 'synthetic-key', LIVE_SHEETS_SPREADSHEET_IDS: 'spreadsheet_fixture_123456' };
  expect(readLiveConfig(env).services.sheets).toEqual({ credentials: { clientEmail: env.GOOGLE_CLIENT_EMAIL, privateKey: env.GOOGLE_PRIVATE_KEY }, allowedScope: { spreadsheets: [env.LIVE_SHEETS_SPREADSHEET_IDS] } });
  expect(readLiveConfig({ ...env, LIVE_SHEETS_SPREADSHEET_IDS: 'wrong/id' }).services.sheets).toBeUndefined();
  expect(readLiveConfig({ ...env, GOOGLE_PRIVATE_KEY: '' }).services.sheets).toBeUndefined();
});
