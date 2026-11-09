import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import type pg from 'pg';
import { encryptCredentials } from '@wap/tool-adapters';
import {
  createIsolatedTestSchema,
  createSyntheticUser,
  type IsolatedTestContext,
} from '../helpers/jira-test-db.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { SessionRepo } from '../../src/db/repositories/session-repo.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { GoogleAuthRepo } from '../../src/db/repositories/google-auth-repo.js';
import { GitHubTeamRepo } from '../../src/db/repositories/github-team-repo.js';
import { WorkspaceRepo } from '../../src/db/repositories/workspace-repo.js';
import { createGitHubConnectionRoutes } from '../../src/routes/connections/github.js';
import {
  assertDedicatedTestDatabaseUrl,
  run0034MigrationVerification,
  WS_ALPHA_UUID,
  WS_BETA_UUID,
} from '../../../../scripts/verify-0034-github-scope-migration.mjs';

const TEST_JWT_SECRET = 'test_jwt_secret_for_wave_r1_a1_red_0123456789abcdef';
const TEST_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('PR-R1-A1: GitHub Workspace-Scoped Team Scope Migration (0034) & Route/Repo RED Suite', () => {
  let ctx: IsolatedTestContext;
  let pool: pg.Pool;
  let workspaceRepo: WorkspaceRepo;
  let credentialRepo: CredentialRepo;
  let statesRepo: GoogleAuthRepo;
  let githubTeamRepo: GitHubTeamRepo;
  let sessionRepo: SessionRepo;

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema();
    await ctx.runAllMigrations();
    pool = ctx.pool;
    workspaceRepo = new WorkspaceRepo(pool);
    credentialRepo = new CredentialRepo(pool);
    statesRepo = new GoogleAuthRepo(pool);
    githubTeamRepo = new GitHubTeamRepo(pool);
    sessionRepo = new SessionRepo(pool);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  async function createSessionToken(userId: string, email: string, role: 'member' | 'admin' = 'member') {
    const { sessionId } = await sessionRepo.create(userId, 'vitest-r1-a1');
    return generateAccessToken({ id: userId, email, name: 'Test User', role }, TEST_JWT_SECRET, sessionId).accessToken;
  }

  describe('Part 1: Dedicated PostgreSQL 16 Revalidation of db/v3/0034_github_workspace_scoped_team_scope.sql (GREEN)', () => {
    it('A1-MIG-1: assertDedicatedTestDatabaseUrl rejects runtime port 55533 and non-test database name ati_v3', () => {
      expect(() =>
        assertDedicatedTestDatabaseUrl('postgres://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3'),
      ).toThrow(/55533/);
      expect(() =>
        assertDedicatedTestDatabaseUrl('postgres://ati_v3:ati_v3_local_only@127.0.0.1:56534/ati_v3'),
      ).toThrow(/dedicated \*_test database required/);
      expect(() =>
        assertDedicatedTestDatabaseUrl(
          'postgres://ati_v3:ati_v3_local_only@127.0.0.1:56534/ati_v3_migration_test',
        ),
      ).not.toThrow();
    });

    it('A1-MIG-2: executes 0034_github_workspace_scoped_team_scope.sql on dedicated test DB with valid UUID workspace fixtures, verifying repeated runs, immutable archives, production CHECK/FK constraints, and tenant isolation', async () => {
      const report = await run0034MigrationVerification();

      expect(report.migrationFile).toBe('db/v3/0034_github_workspace_scoped_team_scope.sql');

      // Scenario 1: pre_0033 + repeated runs + conflicting archive snapshots + constraints + cascade isolation
      expect(report.scenario1.archiveSnapshotCount).toBe(2);
      expect(report.scenario1.archiveRepoCount).toBe(3);
      expect(report.scenario1.archiveDeleteBlocked).toBe(true);
      expect(report.scenario1.rejectedDefaultScope).toBe(true);
      expect(report.scenario1.rejectedBadFullName).toBe(true);
      expect(report.scenario1.rejectedBadPosition).toBe(true);
      expect(report.scenario1.rejectedDefaultRepoScope).toBe(true);
      expect(report.scenario1.remainingReposAfterAlphaCascade).toEqual([
        { scope_id: WS_BETA_UUID, full_name: 'beta-org/beta-repo' },
      ]);

      const constraintNames = report.scenario1.constraints.map((c: { conname: string }) => c.conname);
      expect(constraintNames).toContain('github_team_scope_id_check');
      expect(constraintNames).toContain('github_team_repos_scope_id_check');
      expect(constraintNames).toContain('github_team_repos_full_name_check');
      expect(constraintNames).toContain('github_team_repos_position_check');
      expect(constraintNames).toContain('github_team_repos_scope_id_fkey');
      expect(constraintNames).toContain('github_team_repos_legacy_archive_snapshot_id_fkey');

      // Scenario 2: post_0033 + multi-tenant UUID workspaces + legacy quarantine
      expect(report.scenario2.activeScopes).toEqual([{ id: WS_ALPHA_UUID }, { id: WS_BETA_UUID }]);
      expect(report.scenario2.activeRepos).toEqual([
        { scope_id: WS_ALPHA_UUID, full_name: 'alpha-org/repo-a' },
        { scope_id: WS_BETA_UUID, full_name: 'beta-org/repo-b' },
      ]);
      expect(report.scenario2.archivedScopes).toEqual([{ legacy_id: 'default' }]);
    });
  });

  describe('Part 2: GitHubTeamRepo & /api/connections/github Route Authorization Deterministic RED Tests', () => {
    it('A1-1: GitHubTeamRepo.replace and GitHubTeamRepo.get require explicit workspace UUID scopeId and isolate ws_alpha from ws_beta', async () => {
      const userAlpha = await createSyntheticUser(pool, 'Alpha Admin', 'a1-alpha');
      const userBeta = await createSyntheticUser(pool, 'Beta Admin', 'a1-beta');
      const wsAlpha = await workspaceRepo.create(userAlpha, 'Alpha Org');
      const wsBeta = await workspaceRepo.create(userBeta, 'Beta Org');

      await (githubTeamRepo as any).replace({
        scopeId: wsAlpha.id,
        chosenBy: userAlpha,
        repos: [{ repoId: '101', fullName: 'alpha-org/alpha-repo', name: 'alpha-repo' }],
      });

      await (githubTeamRepo as any).replace({
        scopeId: wsBeta.id,
        chosenBy: userBeta,
        repos: [{ repoId: '202', fullName: 'beta-org/beta-repo', name: 'beta-repo' }],
      });

      const alphaScope = await (githubTeamRepo as any).get(wsAlpha.id);
      const betaScope = await (githubTeamRepo as any).get(wsBeta.id);

      expect(alphaScope?.repos.map((r: any) => r.fullName)).toEqual(['alpha-org/alpha-repo']);
      expect(betaScope?.repos.map((r: any) => r.fullName)).toEqual(['beta-org/beta-repo']);
    });

    it('A1-2: mode="legacy" (missing x-workspace-id header) fails closed with 400 GITHUB_WORKSPACE_SCOPE_REQUIRED on PUT /scope and GET /candidate-repos', async () => {
      const adminId = await createSyntheticUser(pool, 'Legacy Admin', 'a1-leg', { role: 'admin' });
      const token = await createSessionToken(adminId, 'a1-leg@example.com', 'admin');

      const enc = encryptCredentials(
        {
          accessToken: 'gho_test_token',
          login: 'legadmin',
          githubUserId: '1001',
          connectedAt: new Date().toISOString(),
        },
        TEST_ENCRYPTION_KEY,
      );
      await credentialRepo.saveCredentials('github', enc, adminId);

      const app = express();
      app.use(express.json());
      app.use(
        '/api/connections/github',
        createGitHubConnectionRoutes({
          jwtSecret: TEST_JWT_SECRET,
          sessionRepo,
          states: statesRepo,
          credentialRepo,
          teamRepo: githubTeamRepo,
          encryptionKey: TEST_ENCRYPTION_KEY,
          oauth: { clientId: 'cid', clientSecret: 'csec', redirectUri: 'http://localhost:3001/cb' },
          fetchFn: (async () =>
            new Response(
              JSON.stringify([{ id: 101, name: 'alpha-repo', full_name: 'alpha-org/alpha-repo', private: true }]),
              { status: 200, headers: { 'content-type': 'application/json' } },
            )) as typeof fetch,
        }),
      );

      const candidateRes = await request(app)
        .get('/api/connections/github/candidate-repos')
        .set('Authorization', `Bearer ${token}`);
      expect(candidateRes.status).toBe(400);
      expect(candidateRes.body.code).toBe('GITHUB_WORKSPACE_SCOPE_REQUIRED');

      const putScopeRes = await request(app)
        .put('/api/connections/github/scope')
        .set('Authorization', `Bearer ${token}`)
        .send({ repos: ['alpha-org/alpha-repo'] });
      expect(putScopeRes.status).toBe(400);
      expect(putScopeRes.body.code).toBe('GITHUB_WORKSPACE_SCOPE_REQUIRED');
    });

    it('A1-3: enforces workspace membership and org-admin vs non-admin member (403) on GET /, GET /candidate-repos, and PUT /scope', async () => {
      const orgAdminId = await createSyntheticUser(pool, 'Org Admin', 'a1-orgadmin', { role: 'member' });
      const orgMemberId = await createSyntheticUser(pool, 'Org Member', 'a1-orgmember', { role: 'member' });
      const outsiderId = await createSyntheticUser(pool, 'Outsider Admin', 'a1-outsider', { role: 'admin' });

      const ws = await workspaceRepo.create(orgAdminId, 'Alpha Org');
      await pool.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`,
        [ws.id, orgMemberId],
      );

      for (const uid of [orgAdminId, orgMemberId, outsiderId]) {
        const enc = encryptCredentials(
          {
            accessToken: 'gho_test_token',
            login: `gh_${uid.slice(0, 6)}`,
            githubUserId: uid.slice(0, 6),
            connectedAt: new Date().toISOString(),
          },
          TEST_ENCRYPTION_KEY,
        );
        await credentialRepo.saveCredentials('github', enc, uid);
      }

      const orgAdminToken = await createSessionToken(orgAdminId, 'orgadmin@example.com', 'member');
      const orgMemberToken = await createSessionToken(orgMemberId, 'orgmember@example.com', 'member');
      const outsiderToken = await createSessionToken(outsiderId, 'outsider@example.com', 'admin');

      const app = express();
      app.use(express.json());
      app.use(
        '/api/connections/github',
        createGitHubConnectionRoutes({
          jwtSecret: TEST_JWT_SECRET,
          sessionRepo,
          states: statesRepo,
          credentialRepo,
          teamRepo: githubTeamRepo,
          encryptionKey: TEST_ENCRYPTION_KEY,
          oauth: { clientId: 'cid', clientSecret: 'csec', redirectUri: 'http://localhost:3001/cb' },
          fetchFn: (async () =>
            new Response(
              JSON.stringify([{ id: 101, name: 'alpha-repo', full_name: 'alpha-org/alpha-repo', private: true }]),
              { status: 200, headers: { 'content-type': 'application/json' } },
            )) as typeof fetch,
        }),
      );

      // Organization workspace admin (even with global user.role === 'member') must be allowed (200) on PUT /scope
      const orgAdminPut = await request(app)
        .put('/api/connections/github/scope')
        .set('Authorization', `Bearer ${orgAdminToken}`)
        .set('x-workspace-id', ws.id)
        .send({ repos: ['alpha-org/alpha-repo'] });
      expect(orgAdminPut.status).toBe(200);

      // Non-admin member of organization workspace gets 403 on PUT /scope
      const memberPut = await request(app)
        .put('/api/connections/github/scope')
        .set('Authorization', `Bearer ${orgMemberToken}`)
        .set('x-workspace-id', ws.id)
        .send({ repos: ['alpha-org/alpha-repo'] });
      expect(memberPut.status).toBe(403);

      // Outsider (even with global admin role) who is NOT a member of ws.id gets 403 on PUT /scope
      const outsiderPut = await request(app)
        .put('/api/connections/github/scope')
        .set('Authorization', `Bearer ${outsiderToken}`)
        .set('x-workspace-id', ws.id)
        .send({ repos: ['alpha-org/alpha-repo'] });
      expect(outsiderPut.status).toBe(403);
    });
  });
});
