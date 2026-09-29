import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { assertBrowserV3Environment, assertLocalV3Environment } from './v3-local-env.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const local = 'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3';

test('accepts only the dedicated local v3 database', () => {
  assert.doesNotThrow(() => assertLocalV3Environment({ RUNTIME_MODE: 'sandbox', DATABASE_URL: local }));
  for (const databaseUrl of [
    'postgresql://wap:wap@127.0.0.1:55532/wap_g1',
    'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/other',
    'postgresql://ati_v3:ati_v3_local_only@localhost:55533/ati_v3',
  ]) {
    assert.throws(() => assertLocalV3Environment({ RUNTIME_MODE: 'sandbox', DATABASE_URL: databaseUrl }), /dedicated local v3 database/);
  }
  assert.throws(() => assertLocalV3Environment({ RUNTIME_MODE: 'live', DATABASE_URL: local }), /sandbox/);
});

test('the local migration command rejects a shell override before touching a database', () => {
  const result = spawnSync(process.execPath, ['--env-file-if-exists=.env', 'scripts/run-v3-local.mjs', 'migrate'], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: 'postgresql://127.0.0.1:1/wrong_database', RUNTIME_MODE: 'sandbox' },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /dedicated local v3 database/);
});

test('browser E2E rejects live mode and unexpected CI or local database targets', () => {
  const ciUrl = 'postgresql://ati_v3:ati_v3_ci_only@127.0.0.1:5432/ati_v3';
  assert.doesNotThrow(() => assertBrowserV3Environment({ RUNTIME_MODE: 'sandbox', DATABASE_URL: local }));
  assert.doesNotThrow(() => assertBrowserV3Environment({ GITHUB_ACTIONS: 'true', RUNTIME_MODE: 'sandbox', DATABASE_URL: ciUrl }));
  assert.throws(() => assertBrowserV3Environment({ RUNTIME_MODE: 'live', DATABASE_URL: local }), /sandbox/);
  assert.throws(() => assertBrowserV3Environment({ CI: 'true', RUNTIME_MODE: 'sandbox', DATABASE_URL: ciUrl }), /dedicated local v3 database/);
  assert.throws(() => assertBrowserV3Environment({ GITHUB_ACTIONS: 'true', RUNTIME_MODE: 'sandbox', DATABASE_URL: local }), /dedicated GitHub CI v3 database/);
  assert.throws(() => assertBrowserV3Environment({ GITHUB_ACTIONS: 'true', RUNTIME_MODE: 'sandbox', DATABASE_URL: 'postgresql://prod@host/ati_v3' }), /dedicated GitHub CI v3 database/);
});
