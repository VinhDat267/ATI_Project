import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { decryptCredentials, encryptCredentials } from '@wap/tool-adapters';
import { TrelloTeamRepo } from '../../src/db/repositories/trello-team-repo.js';
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

describe('TrelloTeamRepo and CredentialRepo.rotatePersonalSecret', () => {
  const schema = `trello_team_repo_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool, pool: pg.Pool;
  let userId: string;
  let teamRepo: TrelloTeamRepo;
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
    teamRepo = new TrelloTeamRepo(pool);
    credentials = new CredentialRepo(pool, testEncryptionKey);
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.end();
  });

  describe('TrelloTeamRepo', () => {
    it('returns null when no team scope is configured', async () => {
      const scope = await teamRepo.get();
      expect(scope).toBeNull();
    });

    it('rejects replace with 11 boards and does not write', async () => {
      const elevenBoards = Array.from({ length: 11 }, (_, i) => ({
        boardId: `board_${i + 1}`,
        boardName: `Board ${i + 1}`,
      }));

      await expect(
        teamRepo.replace({
          chosenBy: userId,
          workspaceId: 'ws_alpha',
          workspaceName: 'Workspace Alpha',
          boards: elevenBoards,
        })
      ).rejects.toThrow();

      // Verify nothing was written
      expect(await teamRepo.get()).toBeNull();
    });

    it('replaces team scope with valid boards and reads them back', async () => {
      const initialBoards = [
        { boardId: 'b_1', boardName: 'Board 1' },
        { boardId: 'b_2', boardName: 'Board 2' },
      ];

      const saved = await teamRepo.replace({
        chosenBy: userId,
        workspaceId: 'ws_alpha',
        workspaceName: 'Workspace Alpha',
        boards: initialBoards,
      });

      expect(saved).toEqual({
        workspaceId: 'ws_alpha',
        workspaceName: 'Workspace Alpha',
        boards: initialBoards,
      });

      const fetched = await teamRepo.get();
      expect(fetched).toEqual({
        workspaceId: 'ws_alpha',
        workspaceName: 'Workspace Alpha',
        boards: initialBoards,
      });
    });

    it('replaces with a new workspace and drops all old boards', async () => {
      const newBoards = [
        { boardId: 'b_new_1', boardName: 'New Board 1' },
      ];

      const saved = await teamRepo.replace({
        chosenBy: userId,
        workspaceId: 'ws_beta',
        workspaceName: 'Workspace Beta',
        boards: newBoards,
      });

      expect(saved.workspaceId).toBe('ws_beta');
      expect(saved.boards).toEqual(newBoards);

      const fetched = await teamRepo.get();
      expect(fetched).toEqual({
        workspaceId: 'ws_beta',
        workspaceName: 'Workspace Beta',
        boards: newBoards,
      });
    });
  });

  describe('CredentialRepo.rotatePersonalSecret', () => {
    it('handles two parallel rotatePersonalSecret calls: one rotated, one mismatch, and keeps only the new token', async () => {
      const initialRefreshToken = 'initial_refresh_token_12345';
      const initialConfig = encryptCredentials(
        {
          refreshToken: initialRefreshToken,
          username: 'trello_user',
          idMember: 'mem_123',
        },
        testEncryptionKey
      );

      const savedCred = await credentials.saveCredentials('trello', initialConfig, userId);

      const [resA, resB] = await Promise.all([
        credentials.rotatePersonalSecret({
          service: 'trello',
          userId,
          credentialId: savedCred.id,
          previousRefreshToken: initialRefreshToken,
          nextRefreshToken: 'rotated_refresh_token_A',
        }),
        credentials.rotatePersonalSecret({
          service: 'trello',
          userId,
          credentialId: savedCred.id,
          previousRefreshToken: initialRefreshToken,
          nextRefreshToken: 'rotated_refresh_token_B',
        }),
      ]);

      const outcomes = [resA, resB].sort();
      expect(outcomes).toEqual(['mismatch', 'rotated']);

      // Check database row: only the new token from the winner exists
      const row = await credentials.getPersonalCredentials('trello', userId);
      expect(row).not.toBeNull();
      const decrypted = decryptCredentials<any>(row!.config, testEncryptionKey);
      expect(['rotated_refresh_token_A', 'rotated_refresh_token_B']).toContain(decrypted.refreshToken);
      expect(decrypted.refreshToken).not.toBe(initialRefreshToken);
      expect(decrypted.username).toBe('trello_user');
      expect(decrypted.idMember).toBe('mem_123');

      // Subsequent rotation using the old initial token must return mismatch
      const replay = await credentials.rotatePersonalSecret({
        service: 'trello',
        userId,
        credentialId: savedCred.id,
        previousRefreshToken: initialRefreshToken,
        nextRefreshToken: 'replay_token',
      });
      expect(replay).toBe('mismatch');
    });

    it('returns missing when credential does not exist', async () => {
      const res = await credentials.rotatePersonalSecret({
        service: 'trello',
        userId,
        credentialId: randomUUID(),
        previousRefreshToken: 'some_token',
        nextRefreshToken: 'new_token',
      });
      expect(res).toBe('missing');
    });
  });
});
