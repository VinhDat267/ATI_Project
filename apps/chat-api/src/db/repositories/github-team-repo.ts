import type pg from 'pg';

export interface GitHubTeamRepoItem {
  repoId: string;
  fullName: string;
  name: string;
}

export interface GitHubTeamScope {
  chosenBy: string;
  updatedAt: string;
  repos: GitHubTeamRepoItem[];
}

export interface ReplaceGitHubTeamScopeInput {
  chosenBy: string;
  repos: GitHubTeamRepoItem[];
}

const REPO_FULL_NAME_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function isValidGitHubRepoFullName(value: string): boolean {
  if (!REPO_FULL_NAME_RE.test(value)) return false;
  const [owner, name] = value.split('/');
  if (!owner || !name) return false;
  if (owner === '.' || owner === '..' || name === '.' || name === '..') return false;
  return true;
}

export class GitHubTeamRepo {
  constructor(private pool: pg.Pool) {}

  async get(): Promise<GitHubTeamScope | null> {
    const scopeRes = await this.pool.query<{ chosen_by: string; updated_at: Date | string }>(
      "SELECT chosen_by, updated_at FROM github_team_scope WHERE id = 'default'"
    );
    const scope = scopeRes.rows[0];
    if (!scope) return null;

    const reposRes = await this.pool.query<{ repo_id: string; full_name: string; name: string }>(
      "SELECT repo_id, full_name, name FROM github_team_repos WHERE scope_id = 'default' ORDER BY position ASC, created_at ASC"
    );

    const updatedAt = scope.updated_at instanceof Date ? scope.updated_at.toISOString() : new Date(scope.updated_at).toISOString();
    return {
      chosenBy: scope.chosen_by,
      updatedAt,
      repos: reposRes.rows.map((r) => ({
        repoId: r.repo_id,
        fullName: r.full_name,
        name: r.name,
      })),
    };
  }

  async replace(input: ReplaceGitHubTeamScopeInput): Promise<GitHubTeamScope> {
    if (!input.chosenBy?.trim()) {
      throw new Error('chosenBy is required');
    }
    if (!Array.isArray(input.repos)) {
      throw new Error('repos must be an array');
    }

    const deduped: GitHubTeamRepoItem[] = [];
    const seen = new Set<string>();
    for (const item of input.repos) {
      const fullName = item?.fullName?.trim();
      const repoId = item?.repoId?.trim();
      const name = item?.name?.trim() || (fullName ? fullName.split('/')[1] ?? '' : '');
      if (!fullName || !repoId || !name || !isValidGitHubRepoFullName(fullName)) {
        throw new Error(`Invalid GitHub repository fullName: ${fullName || '(empty)'}`);
      }
      if (seen.has(fullName)) continue;
      seen.add(fullName);
      deduped.push({ repoId, fullName, name });
    }

    if (deduped.length < 1 || deduped.length > 10) {
      throw new Error('Must select between 1 and 10 repositories');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("DELETE FROM github_team_repos WHERE scope_id = 'default'");

      const scopeRes = await client.query<{ chosen_by: string; updated_at: Date | string }>(
        `INSERT INTO github_team_scope (id, chosen_by, updated_at)
         VALUES ('default', $1, now())
         ON CONFLICT (id) DO UPDATE SET
           chosen_by = EXCLUDED.chosen_by,
           updated_at = now()
         RETURNING chosen_by, updated_at`,
        [input.chosenBy.trim()]
      );

      for (let i = 0; i < deduped.length; i++) {
        const repo = deduped[i]!;
        await client.query(
          `INSERT INTO github_team_repos (scope_id, repo_id, full_name, name, position)
           VALUES ('default', $1, $2, $3, $4)`,
          [repo.repoId, repo.fullName, repo.name, i + 1]
        );
      }

      await client.query('COMMIT');
      const row = scopeRes.rows[0]!;
      const updatedAt = row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString();
      return {
        chosenBy: row.chosen_by,
        updatedAt,
        repos: deduped,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
