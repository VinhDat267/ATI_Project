import type pg from 'pg';
import type {
  SheetsAppendLeaseAcquireInput,
  SheetsAppendLeaseHandle,
  SheetsAppendLeaseStore,
} from '@wap/tool-schemas';

export interface QueryablePool {
  query: (text: string, values?: unknown[]) => Promise<pg.QueryResult<any>>;
}

function abortError(): Error {
  const err = new Error('The operation was aborted while waiting for a Sheets append lease.');
  err.name = 'AbortError';
  return err;
}

function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(abortError());
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * Multi-worker PostgreSQL-backed lease store for serializing deduplicated
 * Google Sheets appends (`mysheets.append_rows` / `sheets.append_rows`) across
 * adapter instances and worker processes without holding DB transactions or row
 * locks across provider HTTP calls.
 */
export class PostgresSheetsAppendLeaseStore implements SheetsAppendLeaseStore {
  private readonly pollIntervalMs: number;
  private readonly defaultTtlMs: number;

  constructor(
    private readonly pool: QueryablePool,
    options?: { pollIntervalMs?: number; defaultTtlMs?: number }
  ) {
    this.pollIntervalMs = Math.max(5, options?.pollIntervalMs ?? 25);
    this.defaultTtlMs = Math.max(1_000, options?.defaultTtlMs ?? 30_000);
  }

  async acquireLease(input: SheetsAppendLeaseAcquireInput): Promise<SheetsAppendLeaseHandle> {
    if (input.signal?.aborted) {
      throw abortError();
    }

    const ttlMs = Math.max(1_000, input.ttlMs ?? this.defaultTtlMs);
    const deadline = Date.now() + ttlMs;
    let notifiedContention = false;

    while (true) {
      if (input.signal?.aborted) {
        throw abortError();
      }

      const leaseId = `${input.scopeKey}#${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const res = await this.pool.query(
        `INSERT INTO sheets_append_leases (
           scope_key, spreadsheet_id, sheet_title, lease_id, owner_id, fencing_token, status, acquired_at, expires_at
         )
         VALUES ($1, $2, $3, $4, $5, 1, 'active', now(), now() + ($6 * interval '1 millisecond'))
         ON CONFLICT (scope_key) DO UPDATE
         SET spreadsheet_id = EXCLUDED.spreadsheet_id,
             sheet_title = EXCLUDED.sheet_title,
             lease_id = EXCLUDED.lease_id,
             owner_id = EXCLUDED.owner_id,
             fencing_token = sheets_append_leases.fencing_token + 1,
             status = 'active',
             acquired_at = now(),
             expires_at = EXCLUDED.expires_at
         WHERE sheets_append_leases.expires_at <= now()
         RETURNING fencing_token, lease_id`,
        [
          input.scopeKey,
          input.spreadsheetId,
          input.sheetTitle,
          leaseId,
          input.ownerId ?? 'worker',
          ttlMs,
        ]
      );

      if (res.rowCount && res.rowCount > 0) {
        const fencingToken = Number(res.rows[0]?.fencing_token ?? 1);
        const committedLeaseId = String(res.rows[0]?.lease_id ?? leaseId);
        let released = false;
        return {
          leaseId: committedLeaseId,
          fencingToken,
          waitedForContention: notifiedContention,
          markUnknownOutcome: async (reason: string) => {
            await this.pool
              .query(
                `UPDATE sheets_append_leases
                 SET status = 'unknown_outcome',
                     unknown_reason = $3
                 WHERE scope_key = $1 AND fencing_token = $2`,
                [input.scopeKey, fencingToken, reason]
              )
              .catch(() => undefined);
          },
          release: async () => {
            if (released) return;
            released = true;
            await this.pool
              .query(
                `DELETE FROM sheets_append_leases
                 WHERE scope_key = $1 AND fencing_token = $2`,
                [input.scopeKey, fencingToken]
              )
              .catch(() => undefined);
          },
        };
      }

      if (!notifiedContention) {
        notifiedContention = true;
        if (input.onContention) {
          await input.onContention();
        }
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new Error(
          `Quá thời gian chờ khóa ghi tuần tự bảng tính Google Sheets (${input.scopeKey}).`
        );
      }

      await sleepWithSignal(Math.min(this.pollIntervalMs, Math.max(5, remainingMs)), input.signal);
    }
  }
}
