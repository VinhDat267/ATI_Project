import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

describe('Slack Consent Operator CLI', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  const cliPath = fileURLToPath(new URL('../../src/cli/slack-consent.ts', import.meta.url));

  beforeAll(async () => {
    db = await createMigratedSchema('slack_cli');
  });

  afterAll(async () => {
    await db?.close();
  });

  function runCli(args: string[], extraEnv: Record<string, string> = {}) {
    const dbUrl = (db.pool as any).options?.connectionString || process.env.DATABASE_URL;
    return spawnSync(
      process.execPath,
      ['--import', 'tsx', cliPath, ...args],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          DATABASE_URL: dbUrl,
          ...extraEnv,
        },
      }
    );
  }

  it('prints usage with --help and exits with 0', () => {
    const res = runCli(['--help']);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('Usage: slack-consent');
  });

  it('attests a provider via CLI successfully', () => {
    const res = runCli([
      'attest-provider',
      '--id', 'cli-gemini',
      '--name', 'Google Gemini Test',
      '--verified',
      '--no-training',
      '--max-retention', '14',
      '--fingerprint', 'cli-fingerprint-12345',
      '--evidence-ref', 'CLI-AUDIT-2026',
      '--by', 'operator@example.test',
    ]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('cli-gemini');

    // Verify row in database
    const query = db.pool.query('SELECT * FROM slack_trusted_providers WHERE id = $1', ['cli-gemini']);
    return query.then(r => {
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0].verified).toBe(true);
      expect(r.rows[0].no_training).toBe(true);
    });
  });

  it('fails attest-provider if verified without evidence-ref', () => {
    const res = runCli([
      'attest-provider',
      '--id', 'cli-fail',
      '--name', 'Fail Test',
      '--verified',
      '--no-training',
      '--max-retention', '0',
      '--fingerprint', 'fp',
      // missing --evidence-ref and --by
    ]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('evidence-ref');
  });

  it('grants organization consent with retention 0 via CLI', async () => {
    const res = runCli([
      'grant',
      '--workspace', 'T_CLI_01',
      '--provider', 'cli-gemini',
      '--policy-version', 'v1.0.0',
      '--purposes', 'manual_lookup,triage',
      '--retention', '0',
      '--representative', 'Alice Smith, Legal Counsel',
      '--evidence-ref', 'CLI-DPA-001',
      '--by', 'operator@example.test',
    ]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('T_CLI_01');

    const check = await db.pool.query('SELECT * FROM slack_processing_consents WHERE workspace_id = $1', ['T_CLI_01']);
    expect(check.rows).toHaveLength(1);
    expect(check.rows[0].status).toBe('granted');
    expect(check.rows[0].retention_days).toBe(0);
  });

  it('fails grant if negative retention or invalid purpose is provided', () => {
    const resNegative = runCli([
      'grant',
      '--workspace', 'T_CLI_02',
      '--provider', 'cli-gemini',
      '--policy-version', 'v1.0.0',
      '--purposes', 'manual_lookup',
      '--retention', '-5',
      '--representative', 'Rep',
      '--evidence-ref', 'Ref',
      '--by', 'operator@example.test',
    ]);
    expect(resNegative.status).toBe(1);

    const resPurpose = runCli([
      'grant',
      '--workspace', 'T_CLI_02',
      '--provider', 'cli-gemini',
      '--policy-version', 'v1.0.0',
      '--purposes', 'illegal_stealth_training',
      '--retention', '0',
      '--representative', 'Rep',
      '--evidence-ref', 'Ref',
      '--by', 'operator@example.test',
    ]);
    expect(resPurpose.status).toBe(1);
  });

  it('revokes consent with reason and CAS via CLI', async () => {
    const res = runCli([
      'revoke',
      '--workspace', 'T_CLI_01',
      '--provider', 'cli-gemini',
      '--reason', 'Annual review revocation',
      '--by', 'operator@example.test',
      '--expected-revision', '1',
    ]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('revoked');

    const check = await db.pool.query('SELECT * FROM slack_processing_consents WHERE workspace_id = $1', ['T_CLI_01']);
    expect(check.rows[0].status).toBe('revoked');
    expect(check.rows[0].revision).toBe('2');

    // Attempting revoke again with stale revision 1 must fail
    const resStale = runCli([
      'revoke',
      '--workspace', 'T_CLI_01',
      '--provider', 'cli-gemini',
      '--reason', 'Duplicate revoke',
      '--by', 'operator@example.test',
      '--expected-revision', '1',
    ]);
    expect(resStale.status).toBe(1);
    expect(resStale.stderr).toContain('SLACK_CAS_CONFLICT');
  });
});
