import type pg from 'pg';

export interface TrelloTeamScope {
  workspaceId: string;
  workspaceName: string;
  boards: { boardId: string; boardName: string }[];
}

export interface ReplaceTrelloTeamScopeInput {
  chosenBy: string;
  workspaceId: string;
  workspaceName: string;
  boards: { boardId: string; boardName: string }[];
}

export class TrelloTeamRepo {
  constructor(private pool: pg.Pool) {}

  async get(): Promise<TrelloTeamScope | null> {
    const scopeRes = await this.pool.query<{ workspace_id: string; workspace_name: string }>(
      "SELECT workspace_id, workspace_name FROM trello_team_scope WHERE id = 'default'"
    );
    const scope = scopeRes.rows[0];
    if (!scope) return null;

    const boardsRes = await this.pool.query<{ board_id: string; board_name: string }>(
      "SELECT board_id, board_name FROM trello_team_boards WHERE scope_id = 'default' ORDER BY position ASC, created_at ASC"
    );

    return {
      workspaceId: scope.workspace_id,
      workspaceName: scope.workspace_name,
      boards: boardsRes.rows.map((r) => ({ boardId: r.board_id, boardName: r.board_name })),
    };
  }

  async replace(input: ReplaceTrelloTeamScopeInput): Promise<TrelloTeamScope> {
    if (!input.boards || input.boards.length > 10) {
      throw new Error('Cannot select more than 10 boards');
    }
    if (!input.workspaceId?.trim()) {
      throw new Error('workspaceId is required');
    }
    if (!input.workspaceName?.trim()) {
      throw new Error('workspaceName is required');
    }
    if (!input.chosenBy?.trim()) {
      throw new Error('chosenBy is required');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("DELETE FROM trello_team_boards WHERE scope_id = 'default'");

      await client.query(
        `INSERT INTO trello_team_scope (id, workspace_id, workspace_name, chosen_by, updated_at)
         VALUES ('default', $1, $2, $3, now())
         ON CONFLICT (id) DO UPDATE SET
           workspace_id = EXCLUDED.workspace_id,
           workspace_name = EXCLUDED.workspace_name,
           chosen_by = EXCLUDED.chosen_by,
           updated_at = now()`,
        [input.workspaceId, input.workspaceName, input.chosenBy]
      );

      for (let i = 0; i < input.boards.length; i++) {
        const b = input.boards[i]!;
        await client.query(
          `INSERT INTO trello_team_boards (scope_id, workspace_id, board_id, board_name, position)
           VALUES ('default', $1, $2, $3, $4)`,
          [input.workspaceId, b.boardId, b.boardName, i + 1]
        );
      }

      await client.query('COMMIT');
      return {
        workspaceId: input.workspaceId,
        workspaceName: input.workspaceName,
        boards: input.boards.map((b) => ({ boardId: b.boardId, boardName: b.boardName })),
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
