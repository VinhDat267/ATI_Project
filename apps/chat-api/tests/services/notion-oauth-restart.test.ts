import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { NotionOAuthClient, NotionOAuthError } from '../../src/services/notion/oauth-client.js';
import { NotionTokenManager } from '../../src/services/notion/token-manager.js';
import {
  buildIsolatedChildEnv,
  createDeferred,
  createNotionDurabilitySchema,
  inspectOwnerAdvisoryLocks,
  startNotionLoopbackServer,
} from '../helpers/notion-oauth-test-env.js';

const CHILD_SCRIPT = fileURLToPath(new URL('../helpers/notion-refresh-crash-child.ts', import.meta.url));
const TSX_CLI = fileURLToPath(new URL('../../../../node_modules/tsx/dist/loader.mjs', import.meta.url));
const ENC_KEY = '0123456789abcdef0123456789abcdef';
const JWT_SECRET = 'notion_n2b_restart_test_jwt_secret_32chars!';

describe('Notion OAuth dedicated child-process crash & restart checkpoint quarantine', () => {
  let db: Awaited<ReturnType<typeof createNotionDurabilitySchema>>;
  let loopback: Awaited<ReturnType<typeof startNotionLoopbackServer>>;

  beforeAll(async () => {
    db = await createNotionDurabilitySchema('notion_restart');
    loopback = await startNotionLoopbackServer();
  });

  afterAll(async () => {
    await loopback?.close();
    await db?.close();
  });

  it('commits durable refresh_in_flight checkpoint before /oauth/token leaves child process, and on restart quarantines to reconnect_required + rotation_unknown while preserving ciphertext with zero replay', async () => {
    const alice = await db.person('alice-restart');
    const seeded = await db.seedConnection({
      userId: alice.id,
      sessionId: alice.sid,
      encryptionKey: ENC_KEY,
      appId: 'notion-app-restart',
      accessToken: 'syn_access_before_crash',
      refreshToken: 'syn_refresh_before_crash',
      databases: [{ id: '44444444-5555-6666-7777-888888888888', title: 'Ops DB' }],
    });

    const beforeCrash = (await db.inspectRow(seeded.id))!;
    expect(beforeCrash.status).toBe('active');
    expect(beforeCrash.configPresent).toBe(true);
    expect(beforeCrash.refreshInFlight).toBe(false);

    const tokenRequestArrived = createDeferred<void>();
    let midFlightSnapshot: Awaited<ReturnType<typeof db.inspectRow>> = null;
    let midFlightLocks = { grantedCount: 0, waitingCount: 0 };

    loopback.clearRoutes();
    loopback.enqueue('POST', '/oauth/token', {
      kind: 'hang',
      holdMs: 8000,
      onRequest: async () => {
        // Observed from parent's separate PG pool while child holds advisory lock and awaits HTTP response
        midFlightSnapshot = await db.inspectRow(seeded.id);
        midFlightLocks = await inspectOwnerAdvisoryLocks(db.pool, alice.id);
        tokenRequestArrived.resolve();
      },
    });

    let child: ChildProcess | undefined;
    try {
      child = spawn(
        process.execPath,
        [
          '--import',
          `file:///${TSX_CLI.replaceAll('\\', '/')}`,
          CHILD_SCRIPT,
          db.schemaDatabaseUrl,
          alice.id,
          seeded.id,
          String(seeded.identity_version),
          'notion-app-restart',
          loopback.baseUrl,
          ENC_KEY,
        ],
        {
          env: buildIsolatedChildEnv({
            N2B_ALLOWED_LOOPBACK_PORT: String(loopback.port),
          }),
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        },
      );

      await Promise.race([
        tokenRequestArrived.promise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Timed out waiting for child /oauth/token dispatch')), 7000),
        ),
      ]);

      // Kill the child process abruptly before /oauth/token response is ever returned
      const exitPromise = new Promise<void>((resolve) => {
        if (child!.exitCode !== null || child!.signalCode !== null) {
          resolve();
          return;
        }
        child!.once('close', () => resolve());
      });
      child.kill('SIGKILL');
      await exitPromise;
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }

    // Wait for PostgreSQL backend to observe socket close and release the dead child's session advisory lock
    const lockReleaseDeadline = Date.now() + 4000;
    while (Date.now() < lockReleaseDeadline) {
      const locks = await inspectOwnerAdvisoryLocks(db.pool, alice.id);
      if (locks.grantedCount === 0) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    // 1. Verify durable checkpoint was committed in PG while /oauth/token was in flight
    expect(midFlightSnapshot).not.toBeNull();
    expect(midFlightSnapshot!.refreshInFlight).toBe(true);
    expect(midFlightSnapshot!.configPresent).toBe(true);
    expect(midFlightSnapshot!.configFingerprint).toBe(beforeCrash.configFingerprint);
    expect(midFlightLocks.grantedCount).toBe(1);
    expect(loopback.countPath('/oauth/token')).toBe(1);

    // 2. Simulate restarted server process creating a fresh NotionTokenManager
    let reconnectNotifications = 0;
    const restartedOAuth = new NotionOAuthClient(loopback.oauthConfig('notion-app-restart'));
    const restartedManager = new NotionTokenManager(db.repo, restartedOAuth, ENC_KEY, () => {
      reconnectNotifications++;
    });

    await expect(
      restartedManager.execute(alice.id, seeded.id, seeded.identity_version, async () => 'must-not-run'),
    ).rejects.toBeInstanceOf(NotionOAuthError);

    // 3. Zero automatic replay on restart; row quarantined with rotation_unknown and preserved ciphertext
    expect(loopback.countPath('/oauth/token')).toBe(1);
    expect(reconnectNotifications).toBe(1);

    const afterRestart = (await db.inspectRow(seeded.id))!;
    expect(afterRestart.status).toBe('reconnect_required');
    expect(afterRestart.refreshInFlight).toBe(false);
    expect(afterRestart.configPresent).toBe(true);
    expect(afterRestart.configFingerprint).toBe(beforeCrash.configFingerprint);
    expect(midFlightSnapshot!.authFailureCode).toBe('access_rejected');
    expect(afterRestart.authFailureCode).toBe('rotation_unknown');
    expect(afterRestart.identityVersion).toBe(beforeCrash.identityVersion);

    // 4. Explicit POST /:id/check MUST also refuse to replay rotation_unknown
    const aliceToken = generateAccessToken(alice, JWT_SECRET, alice.sid).accessToken;
    const app = createApp({
      jwtSecret: JWT_SECRET,
      encryptionKey: ENC_KEY,
      userRepo: db.users,
      notion: {
        oauth: loopback.oauthConfig('notion-app-restart'),
        repo: db.repo,
      },
    });
    const checkRes = await request(app)
      .post(`/api/connections/notion/${seeded.id}/check`)
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(checkRes.status).toBe(409);
    expect(loopback.countPath('/oauth/token')).toBe(1);
    expect((await db.inspectRow(seeded.id))!.authFailureCode).toBe('rotation_unknown');
  });

  it('transitions interrupted explicit check recovery (reconnect_required + refresh_retryable + refresh_in_flight=true after SIGKILL) durably to rotation_unknown with preserved ciphertext, UI/check denial, and zero replay', async () => {
    const bob = await db.person('bob-restart-explicit-check');
    const seeded = await db.seedConnection({
      userId: bob.id,
      sessionId: bob.sid,
      encryptionKey: ENC_KEY,
      appId: 'notion-app-restart',
      accessToken: 'syn_access_predispatch_check',
      refreshToken: 'syn_refresh_predispatch_check',
      databases: [{ id: '44444444-5555-6666-7777-888888888888', title: 'Ops DB' }],
    });

    // Place connection in reconnect_required + refresh_retryable (prior pre-dispatch failure eligible for explicit check)
    await db.pool.query(
      `UPDATE notion_connections
          SET status = 'reconnect_required',
              auth_failure_code = 'refresh_retryable',
              refresh_in_flight = false
        WHERE id = $1`,
      [seeded.id],
    );
    const beforeCrash = (await db.inspectRow(seeded.id))!;
    expect(beforeCrash.status).toBe('reconnect_required');
    expect(beforeCrash.authFailureCode).toBe('refresh_retryable');
    expect(beforeCrash.refreshInFlight).toBe(false);
    expect(beforeCrash.configPresent).toBe(true);

    const tokenRequestArrived = createDeferred<void>();
    let midFlightSnapshot: Awaited<ReturnType<typeof db.inspectRow>> = null;
    let midFlightLocks = { grantedCount: 0, waitingCount: 0 };

    loopback.clearRoutes();
    loopback.resetLedger();
    loopback.enqueue('POST', '/oauth/token', {
      kind: 'hang',
      holdMs: 8000,
      onRequest: async () => {
        midFlightSnapshot = await db.inspectRow(seeded.id);
        midFlightLocks = await inspectOwnerAdvisoryLocks(db.pool, bob.id);
        tokenRequestArrived.resolve();
      },
    });

    let child: ChildProcess | undefined;
    try {
      child = spawn(
        process.execPath,
        [
          '--import',
          `file:///${TSX_CLI.replaceAll('\\', '/')}`,
          CHILD_SCRIPT,
          db.schemaDatabaseUrl,
          bob.id,
          seeded.id,
          String(seeded.identity_version),
          'notion-app-restart',
          loopback.baseUrl,
          ENC_KEY,
          'check',
        ],
        {
          env: buildIsolatedChildEnv({
            N2B_ALLOWED_LOOPBACK_PORT: String(loopback.port),
          }),
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        },
      );

      await Promise.race([
        tokenRequestArrived.promise,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Timed out waiting for child explicit check /oauth/token dispatch')),
            7000,
          ),
        ),
      ]);

      const exitPromise = new Promise<void>((resolve) => {
        if (child!.exitCode !== null || child!.signalCode !== null) {
          resolve();
          return;
        }
        child!.once('close', () => resolve());
      });
      child.kill('SIGKILL');
      await exitPromise;
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }

    const lockReleaseDeadline = Date.now() + 4000;
    while (Date.now() < lockReleaseDeadline) {
      const locks = await inspectOwnerAdvisoryLocks(db.pool, bob.id);
      if (locks.grantedCount === 0) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    // 1. Mid-flight checkpoint persisted reconnect_required + refresh_retryable + refresh_in_flight=true
    expect(midFlightSnapshot).not.toBeNull();
    expect(midFlightSnapshot!.status).toBe('reconnect_required');
    expect(midFlightSnapshot!.authFailureCode).toBe('refresh_retryable');
    expect(midFlightSnapshot!.refreshInFlight).toBe(true);
    expect(midFlightSnapshot!.configFingerprint).toBe(beforeCrash.configFingerprint);
    expect(midFlightLocks.grantedCount).toBe(1);
    expect(loopback.countPath('/oauth/token')).toBe(1);

    // 2. Immediately on restart, GET /api/connections/notion must NOT advertise refresh_retryable while checkpoint is dangling
    let connectionChangedCount = 0;
    const bobToken = generateAccessToken(bob, JWT_SECRET, bob.sid).accessToken;
    const app = createApp({
      jwtSecret: JWT_SECRET,
      encryptionKey: ENC_KEY,
      userRepo: db.users,
      notion: {
        oauth: loopback.oauthConfig('notion-app-restart'),
        repo: db.repo,
        onConnectionChanged: () => {
          connectionChangedCount++;
        },
      },
    });

    const statusBeforeCheck = await request(app)
      .get('/api/connections/notion')
      .set('Authorization', `Bearer ${bobToken}`);

    // 3. Subsequent explicit POST /:id/check transitions row durably under owner lock to rotation_unknown with 0 replay
    const checkRes = await request(app)
      .post(`/api/connections/notion/${seeded.id}/check`)
      .set('Authorization', `Bearer ${bobToken}`);
    const afterCheck = (await db.inspectRow(seeded.id))!;

    expect({
      getBeforeCheckStatus: statusBeforeCheck.status,
      getBeforeCheckConnStatus: statusBeforeCheck.body.status,
      getBeforeCheckAuthFailureCode: statusBeforeCheck.body.authFailureCode,
      checkHttpStatus: checkRes.status,
      checkBodyStatus: checkRes.body.status,
      checkBodyAuthFailureCode: checkRes.body.authFailureCode,
      tokenHttpCalls: loopback.countPath('/oauth/token'),
      notifiedOnQuarantine: connectionChangedCount >= 1,
      afterCheckStatus: afterCheck.status,
      afterCheckRefreshInFlight: afterCheck.refreshInFlight,
      afterCheckAuthFailureCode: afterCheck.authFailureCode,
      afterCheckConfigPresent: afterCheck.configPresent,
      afterCheckFingerprintUnchanged: afterCheck.configFingerprint === beforeCrash.configFingerprint,
      afterCheckVersionUnchanged: afterCheck.identityVersion === beforeCrash.identityVersion,
    }).toEqual({
      getBeforeCheckStatus: 200,
      getBeforeCheckConnStatus: 'reconnect_required',
      getBeforeCheckAuthFailureCode: 'rotation_unknown',
      checkHttpStatus: 409,
      checkBodyStatus: 'reconnect_required',
      checkBodyAuthFailureCode: 'rotation_unknown',
      tokenHttpCalls: 1,
      notifiedOnQuarantine: true,
      afterCheckStatus: 'reconnect_required',
      afterCheckRefreshInFlight: false,
      afterCheckAuthFailureCode: 'rotation_unknown',
      afterCheckConfigPresent: true,
      afterCheckFingerprintUnchanged: true,
      afterCheckVersionUnchanged: true,
    });
  });
});
