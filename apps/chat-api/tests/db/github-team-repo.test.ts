import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { decryptCredentials, encryptCredentials } from '@wap/tool-adapters';
import { GitHubTeamRepo } from '../../src/db/repositories/github-team-repo.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';

const directory = fileURLToPath(new URL('../../../../db/v3/', import.meta.url));
const testEncryptionKey = '01234567890123456789012345678901';

async function connectAdmin(): Promise<{ admin: pg.Pool; databaseUrl: string }> {
  const candidates = [
    process.env.DATABASE_URL,
    'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3',
    'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:56533/ati_v3',
  ].filter(Boolean) as string[];

  for (const url of candidates) {
    try {
      const p = new pg.Pool({ connectionString: url });
      await p.query('SELECT 1');
      return { admin: p, databaseUrl: url };
    } catch {
      // try next candidate
    }
  }
  throw new Error('Cannot connect to PostgreSQL on any candidate port (55533, 56533)');
}

describe('GitHubTeamRepo and CredentialRepo.rotatePersonalSecret for github', () => {
  const schema = `github_team_repo_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool, pool: pg.Pool;
  let userId: string;
  let teamRepo: GitHubTeamRepo;
  let credentials: CredentialRepo;

  beforeAll(async () => {
    const conn = await connectAdmin();
    admin = conn.admin;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(conn.databaseUrl);
    url.searchParams.set('options', `-c search_path=${schema}`);
    pool = new pg.Pool({ connectionString: url.href });

    const files = (await readdir(directory)).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    for (const f of files) {
      await pool.query(await readFile(`${directory}/${f}`, 'utf8'));
    }

    userId = (await pool.query("INSERT INTO users(email,password,name) VALUES('admin@example.test','hash','Admin') RETURNING id")).rows[0].id;
    teamRepo = new GitHubTeamRepo(pool);
    credentials = new CredentialRepo(pool, testEncryptionKey);
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  describe('GitHubTeamRepo', () => {
    it('returns null when no team scope is configured', async () => {
      const scope = await teamRepo.get();
      expect(scope).toBeNull();
    });

    it('rejects replace with 0 repos, 11 repos, or invalid fullName and does not write', async () => {
      await expect(teamRepo.replace({ chosenBy: userId, repos: [] })).rejects.toThrow();

      const elevenRepos = Array.from({ length: 11 }, (_, i) => ({
        repoId: `r_${i + 1}`,
        fullName: `octo/repo_${i + 1}`,
        name: `repo_${i + 1}`,
      }));
      await expect(teamRepo.replace({ chosenBy: userId, repos: elevenRepos })).rejects.toThrow();

      await expect(
        teamRepo.replace({
          chosenBy: userId,
          repos: [{ repoId: 'r_bad', fullName: 'invalid-repo-name', name: 'invalid' }],
        })
      ).rejects.toThrow();

      expect(await teamRepo.get()).toBeNull();
    });

    it('replaces team scope with valid repos in order, deduplicates fullName, and preserves old data on failure', async () => {
      const saved = await teamRepo.replace({
        chosenBy: userId,
        repos: [
          { repoId: '101', fullName: 'nhom/ati', name: 'ati' },
          { repoId: '102', fullName: 'nhom/web', name: 'web' },
          { repoId: '101', fullName: 'nhom/ati', name: 'ati' },
        ],
      });

      expect(saved.chosenBy).toBe(userId);
      expect(typeof saved.updatedAt).toBe('string');
      expect(saved.repos).toEqual([
        { repoId: '101', fullName: 'nhom/ati', name: 'ati' },
        { repoId: '102', fullName: 'nhom/web', name: 'web' },
      ]);

      const fetched = await teamRepo.get();
      expect(fetched).toEqual(saved);

      // Invalid update keeps previous scope intact
      await expect(teamRepo.replace({ chosenBy: userId, repos: [] })).rejects.toThrow();
      expect(await teamRepo.get()).toEqual(saved);
    });
  });

  describe('CredentialRepo.rotatePersonalSecret (github)', () => {
    it('rotates a personal github refresh token atomically under concurrent calls', async () => {
      const initialRefreshToken = 'ghr_initial_12345';
      const initialConfig = encryptCredentials(
        {
          accessToken: 'ghu_initial_access',
          refreshToken: initialRefreshToken,
          login: 'octocat',
          githubUserId: '999',
        },
        testEncryptionKey
      );

      const savedCred = await credentials.saveCredentials('github', initialConfig, userId);

      const [resA, resB] = await Promise.all([
        credentials.rotatePersonalSecret({
          service: 'github',
          userId,
          credentialId: savedCred.id,
          previousRefreshToken: initialRefreshToken,
          nextRefreshToken: 'ghr_rotated_A',
          nextAccessToken: 'ghu_rotated_A',
        }),
        credentials.rotatePersonalSecret({
          service: 'github',
          userId,
          credentialId: savedCred.id,
          previousRefreshToken: initialRefreshToken,
          nextRefreshToken: 'ghr_rotated_B',
          nextAccessToken: 'ghu_rotated_B',
        }),
      ]);

      expect([resA, resB].sort()).toEqual(['mismatch', 'rotated']);
      const row = await credentials.getPersonalCredentials('github', userId);
      const decrypted = decryptCredentials<any>(row!.config, testEncryptionKey);
      expect(['ghr_rotated_A', 'ghr_rotated_B']).toContain(decrypted.refreshToken);
      expect(['ghu_rotated_A', 'ghu_rotated_B']).toContain(decrypted.accessToken);
      expect(decrypted.login).toBe('octocat');
    });
  });
});
