import type pg from 'pg';
import {
  createLostAppendLeaseError,
  createUnreconciledAppendLeaseError,
} from '@wap/tool-adapters';
import type {
  SheetsAppendDispatchMetadata,
  SheetsAppendLeaseAcquireInput,
  SheetsAppendLeaseHandle,
  SheetsAppendLeaseReconcileInput,
  SheetsAppendLeaseState,
  SheetsAppendLeaseStatus,
  SheetsAppendLeaseStore,
} from '@wap/tool-schemas';

export interface QueryablePool {
  query: (text: string, values?: unknown[]) => Promise<pg.QueryResult<any>>;
}

export interface PostgresSheetsAppendLeaseStoreOptions {
  pollIntervalMs?: number;
  defaultTtlMs?: number;
  heartbeatIntervalMs?: number;
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

function toIsoOrUndefined(val: unknown): string | undefined {
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string' && val.length > 0) return val;
  return undefined;
}

function toIsoOrNull(val: unknown): string | null {
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string' && val.length > 0) return val;
  return null;
}

/**
 * Multi-worker PostgreSQL-backed lease store for serializing deduplicated
 * Google Sheets appends (`mysheets.append_rows` / `sheets.append_rows`) across
 * adapter instances and worker processes without holding DB transactions or row
 * locks across provider HTTP calls.
 *
 * Protocol guarantees (GAS-10):
 * 1. Monotonic fencing tokens + unique lease_id: `release()` transitions the row
 *    to `status = 'released'` rather than deleting it, so `fencing_token` never
 *    resets to 1 and a stale owner's `release()` cannot erase a newer owner's row.
 * 2. Pre-dispatch (`status = 'active'`) vs write-in-flight (`status = 'dispatched'`)
 *    vs uncertain outcome (`status = 'unknown_outcome'`):
 *    - Only `'released'` rows or expired pre-dispatch (`'active'`) rows can be
 *      taken over automatically.
 *    - Immediately before sending a Google Sheets write HTTP request, the adapter
 *      calls `beginWriteDispatch()`, which atomically verifies ownership & non-expiry
 *      in PostgreSQL and transitions the row to `status = 'dispatched'`. If a stale
 *      pre-dispatch lease expired and was taken over, `beginWriteDispatch()` rejects
 *      with `SHEETS_APPEND_LEASE_LOST` before any HTTP POST is sent.
 *    - While a lease holder is alive, a background heartbeat extends `expires_at`
 *      for active/dispatched leases so slow requests do not lose ownership.
 *    - Once a lease enters `'dispatched'` or `'unknown_outcome'`, automatic expiry
 *      takeover is forbidden. An expired `'dispatched'` lease (e.g. worker crash
 *      mid-HTTP POST) is promoted to `'unknown_outcome'`, and `acquireLease()` fails
 *      closed with `SHEETS_APPEND_UNKNOWN_OUTCOME_UNRECONCILED` until explicitly
 *      reconciled via `reconcileUnknownLease()`.
 *    - `release()` never erases `'unknown_outcome'`, and releasing an unconfirmed
 *      `'dispatched'` lease transitions it to `'unknown_outcome'`.
 */
export class PostgresSheetsAppendLeaseStore implements SheetsAppendLeaseStore {
  private readonly pollIntervalMs: number;
  private readonly defaultTtlMs: number;
  private readonly heartbeatIntervalMs?: number;

  constructor(
    private readonly pool: QueryablePool,
    options?: PostgresSheetsAppendLeaseStoreOptions
  ) {
    this.pollIntervalMs = Math.max(5, options?.pollIntervalMs ?? 25);
    this.defaultTtlMs = Math.max(100, options?.defaultTtlMs ?? 30_000);
    this.heartbeatIntervalMs = options?.heartbeatIntervalMs;
  }

  private mapRowToState(row: Record<string, any>): SheetsAppendLeaseState {
    return {
      scopeKey: String(row.scope_key),
      spreadsheetId: String(row.spreadsheet_id),
      sheetTitle: String(row.sheet_title),
      leaseId: String(row.lease_id),
      ownerId: String(row.owner_id),
      fencingToken: Number(row.fencing_token),
      status: row.status as SheetsAppendLeaseStatus,
      acquiredAt: toIsoOrUndefined(row.acquired_at),
      expiresAt: toIsoOrUndefined(row.expires_at),
      dispatchedAt: toIsoOrNull(row.dispatched_at),
      unknownReason: typeof row.unknown_reason === 'string' ? row.unknown_reason : null,
      dispatchedMeta:
        row.dispatched_meta && typeof row.dispatched_meta === 'object'
          ? (row.dispatched_meta as SheetsAppendDispatchMetadata)
          : null,
    };
  }

  private async promoteExpiredDispatchedLease(scopeKey: string): Promise<void> {
    await this.pool.query(
      `UPDATE sheets_append_leases
          SET status = 'unknown_outcome',
              unknown_reason = COALESCE(
                unknown_reason,
                'Dispatched Sheets append lease expired before write outcome was confirmed'
              )
        WHERE scope_key = $1
          AND status = 'dispatched'
          AND expires_at <= clock_timestamp()`,
      [scopeKey]
    );
  }

  async getLeaseState(scopeKey: string): Promise<SheetsAppendLeaseState | null> {
    await this.promoteExpiredDispatchedLease(scopeKey);
    const res = await this.pool.query(
      `SELECT scope_key, spreadsheet_id, sheet_title, lease_id, owner_id, fencing_token,
              status, acquired_at, heartbeat_at, expires_at, dispatched_at, released_at,
              reconciled_at, unknown_reason, dispatched_meta
         FROM sheets_append_leases
        WHERE scope_key = $1`,
      [scopeKey]
    );
    if (!res.rowCount || res.rowCount === 0) {
      return null;
    }
    return this.mapRowToState(res.rows[0]);
  }

  async reconcileUnknownLease(input: SheetsAppendLeaseReconcileInput): Promise<boolean> {
    const current = await this.getLeaseState(input.scopeKey);
    if (!current) {
      return false;
    }
    // Never reconcile a live 'dispatched', 'active', or 'released' lease.
    // Expired 'dispatched' rows are promoted to 'unknown_outcome' by getLeaseState().
    if (current.status !== 'unknown_outcome') {
      return false;
    }
    if (input.leaseId !== undefined && current.leaseId !== input.leaseId) {
      return false;
    }
    if (input.fencingToken !== undefined && current.fencingToken !== input.fencingToken) {
      return false;
    }
    const targetLeaseId = input.leaseId ?? current.leaseId;
    const targetFencingToken = input.fencingToken ?? current.fencingToken;

    // Manual operator override and unverified abort claims are unsupported in production
    // primitives pending an authenticated, authorized, and durably audited operator service.
    if (
      input.manualOperatorDecision !== undefined ||
      input.acknowledgeDuplicateRisk !== undefined ||
      input.confirmDuplicateRisk !== undefined ||
      input.reason === 'manual_operator_override' ||
      input.reason === 'aborted'
    ) {
      return false;
    }
    if (typeof input.verify !== 'function') {
      return false;
    }
    const meta = current.dispatchedMeta;
    if (
      !meta ||
      !Array.isArray(meta.candidateKeys) ||
      meta.candidateKeys.length === 0 ||
      !Number.isInteger(meta.rowCount) ||
      meta.rowCount < 1 ||
      meta.candidateKeys.length !== meta.rowCount ||
      meta.candidateKeys.some((sig) => typeof sig !== 'string' || sig.trim().length === 0)
    ) {
      return false;
    }
    const verified = await input.verify(current);
    if (!verified) {
      return false;
    }

    const res = await this.pool.query(
      `UPDATE sheets_append_leases
          SET status = 'released',
              reconciled_at = clock_timestamp(),
              released_at = clock_timestamp(),
              heartbeat_at = clock_timestamp(),
              unknown_reason = NULL
        WHERE scope_key = $1
          AND lease_id = $2
          AND fencing_token = $3
          AND status = 'unknown_outcome'`,
      [input.scopeKey, targetLeaseId, targetFencingToken]
    );
    return Boolean(res.rowCount && res.rowCount > 0);
  }

  async acquireLease(input: SheetsAppendLeaseAcquireInput): Promise<SheetsAppendLeaseHandle> {
    if (input.signal?.aborted) {
      throw abortError();
    }

    const ttlMs = Math.max(100, input.ttlMs ?? this.defaultTtlMs);
    const heartbeatMs = Math.max(
      20,
      this.heartbeatIntervalMs ?? Math.min(5_000, Math.floor(ttlMs / 3))
    );
    const waitBudgetMs = Math.max(2_000, ttlMs * 4);
    const deadline = Date.now() + waitBudgetMs;
    let notifiedContention = false;

    while (true) {
      if (input.signal?.aborted) {
        throw abortError();
      }

      await this.promoteExpiredDispatchedLease(input.scopeKey);

      const candidateLeaseId = `${input.scopeKey}#${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const res = await this.pool.query(
        `INSERT INTO sheets_append_leases (
           scope_key, spreadsheet_id, sheet_title, lease_id, owner_id,
           fencing_token, status, acquired_at, heartbeat_at, expires_at,
           dispatched_at, released_at, reconciled_at, unknown_reason, dispatched_meta
         )
         VALUES (
           $1, $2, $3, $4, $5,
           1, 'active', clock_timestamp(), clock_timestamp(),
           clock_timestamp() + ($6 * interval '1 millisecond'),
           NULL, NULL, NULL, NULL, NULL
         )
         ON CONFLICT (scope_key) DO UPDATE
         SET spreadsheet_id = EXCLUDED.spreadsheet_id,
             sheet_title = EXCLUDED.sheet_title,
             lease_id = EXCLUDED.lease_id,
             owner_id = EXCLUDED.owner_id,
             fencing_token = sheets_append_leases.fencing_token + 1,
             status = 'active',
             acquired_at = clock_timestamp(),
             heartbeat_at = clock_timestamp(),
             expires_at = EXCLUDED.expires_at,
             dispatched_at = NULL,
             released_at = NULL,
             reconciled_at = NULL,
             unknown_reason = NULL,
             dispatched_meta = NULL
         WHERE sheets_append_leases.status = 'released'
            OR (
              sheets_append_leases.status = 'active'
              AND sheets_append_leases.expires_at <= clock_timestamp()
            )
         RETURNING fencing_token, lease_id`,
        [
          input.scopeKey,
          input.spreadsheetId,
          input.sheetTitle,
          candidateLeaseId,
          input.ownerId ?? 'worker',
          ttlMs,
        ]
      );

      if (res.rowCount && res.rowCount > 0) {
        const fencingToken = Number(res.rows[0]?.fencing_token ?? 1);
        const committedLeaseId = String(res.rows[0]?.lease_id ?? candidateLeaseId);
        let released = false;
        let leaseLost = false;

        let heartbeatTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
          if (released || leaseLost) {
            if (heartbeatTimer) {
              clearInterval(heartbeatTimer);
              heartbeatTimer = null;
            }
            return;
          }
          void this.pool
            .query(
              `UPDATE sheets_append_leases
                  SET heartbeat_at = clock_timestamp(),
                      expires_at = clock_timestamp() + ($4 * interval '1 millisecond')
                WHERE scope_key = $1
                  AND lease_id = $2
                  AND fencing_token = $3
                  AND status IN ('active', 'dispatched')
                  AND expires_at > clock_timestamp()`,
              [input.scopeKey, committedLeaseId, fencingToken, ttlMs]
            )
            .then((hbRes) => {
              if (!hbRes.rowCount || hbRes.rowCount === 0) {
                leaseLost = true;
                if (heartbeatTimer) {
                  clearInterval(heartbeatTimer);
                  heartbeatTimer = null;
                }
              }
            })
            .catch(() => undefined);
        }, heartbeatMs);
        heartbeatTimer.unref?.();

        const stopHeartbeat = () => {
          if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
          }
        };

        return {
          leaseId: committedLeaseId,
          fencingToken,
          waitedForContention: notifiedContention,
          beginWriteDispatch: async (meta?: SheetsAppendDispatchMetadata) => {
            if (released || leaseLost) {
              stopHeartbeat();
              throw createLostAppendLeaseError(
                input.scopeKey,
                committedLeaseId,
                fencingToken,
                'lease already released or lost before write dispatch'
              );
            }
            const dispatchRes = await this.pool.query(
              `UPDATE sheets_append_leases
                  SET status = 'dispatched',
                      dispatched_at = COALESCE(dispatched_at, clock_timestamp()),
                      heartbeat_at = clock_timestamp(),
                      expires_at = clock_timestamp() + ($4 * interval '1 millisecond'),
                      dispatched_meta = COALESCE($5::jsonb, dispatched_meta)
                WHERE scope_key = $1
                  AND lease_id = $2
                  AND fencing_token = $3
                  AND status IN ('active', 'dispatched')
                  AND expires_at > clock_timestamp()
                RETURNING fencing_token`,
              [
                input.scopeKey,
                committedLeaseId,
                fencingToken,
                ttlMs,
                meta ? JSON.stringify(meta) : null,
              ]
            );
            if (!dispatchRes.rowCount || dispatchRes.rowCount === 0) {
              leaseLost = true;
              stopHeartbeat();
              throw createLostAppendLeaseError(
                input.scopeKey,
                committedLeaseId,
                fencingToken,
                'lease expired or superseded before provider write dispatch'
              );
            }
          },
          completeWrite: async () => {
            if (released || leaseLost) return;
            await this.pool.query(
              `UPDATE sheets_append_leases
                  SET status = 'active',
                      heartbeat_at = clock_timestamp(),
                      expires_at = clock_timestamp() + ($4 * interval '1 millisecond')
                WHERE scope_key = $1
                  AND lease_id = $2
                  AND fencing_token = $3
                  AND status = 'dispatched'`,
              [input.scopeKey, committedLeaseId, fencingToken, ttlMs]
            );
          },
          abortUncommittedWrite: async () => {
            if (released || leaseLost) return;
            await this.pool.query(
              `UPDATE sheets_append_leases
                  SET status = 'active',
                      dispatched_at = NULL,
                      dispatched_meta = NULL,
                      heartbeat_at = clock_timestamp(),
                      expires_at = clock_timestamp() + ($4 * interval '1 millisecond')
                WHERE scope_key = $1
                  AND lease_id = $2
                  AND fencing_token = $3
                  AND status = 'dispatched'`,
              [input.scopeKey, committedLeaseId, fencingToken, ttlMs]
            );
          },
          markUnknownOutcome: async (reason: string, meta?: SheetsAppendDispatchMetadata) => {
            stopHeartbeat();
            await this.pool
              .query(
                `UPDATE sheets_append_leases
                    SET status = 'unknown_outcome',
                        unknown_reason = $4,
                        dispatched_meta = COALESCE($5::jsonb, dispatched_meta),
                        heartbeat_at = clock_timestamp()
                  WHERE scope_key = $1
                    AND lease_id = $2
                    AND fencing_token = $3
                    AND status IN ('active', 'dispatched', 'unknown_outcome')`,
                [
                  input.scopeKey,
                  committedLeaseId,
                  fencingToken,
                  reason,
                  meta ? JSON.stringify(meta) : null,
                ]
              )
              .catch(() => undefined);
          },
          release: async () => {
            if (released) return;
            released = true;
            stopHeartbeat();
            // Fail closed if release() is invoked while a write dispatch is still in flight
            await this.pool
              .query(
                `UPDATE sheets_append_leases
                    SET status = 'unknown_outcome',
                        unknown_reason = COALESCE(
                          unknown_reason,
                          'Lease released while write dispatch was in flight without outcome confirmation'
                        ),
                        heartbeat_at = clock_timestamp()
                  WHERE scope_key = $1
                    AND lease_id = $2
                    AND fencing_token = $3
                    AND status = 'dispatched'`,
                [input.scopeKey, committedLeaseId, fencingToken]
              )
              .catch(() => undefined);
            // Transition only 'active' leases owned by (lease_id, fencing_token) to 'released'.
            // Never DELETE the row and never erase 'unknown_outcome'.
            await this.pool
              .query(
                `UPDATE sheets_append_leases
                    SET status = 'released',
                        released_at = clock_timestamp(),
                        heartbeat_at = clock_timestamp()
                  WHERE scope_key = $1
                    AND lease_id = $2
                    AND fencing_token = $3
                    AND status = 'active'`,
                [input.scopeKey, committedLeaseId, fencingToken]
              )
              .catch(() => undefined);
          },
        };
      }

      const current = await this.getLeaseState(input.scopeKey);
      if (current && current.status === 'unknown_outcome') {
        throw createUnreconciledAppendLeaseError(current);
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
