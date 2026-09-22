import type { Database } from '@wap/db';
import type {
  BusinessReservationStore,
  ReservationRecord,
} from './dispatch.js';
import type { ReservationStatus } from './schemas.js';

export class PostgresReservationStore implements BusinessReservationStore {
  constructor(private readonly db: Database) {}

  async getReservation(intentKey: string): Promise<ReservationRecord | null> {
    const rows = await this.db.client<
      Array<{
        id: string;
        intent_key: string;
        source_key: string;
        board_id: string;
        run_id: string;
        status: ReservationStatus;
        remote_id: string | null;
        remote_url: string | null;
        operation_id: string | null;
        created_at: Date;
        updated_at: Date;
      }>
    >`
      SELECT id, intent_key, source_key, board_id, run_id, status, remote_id, remote_url, operation_id, created_at, updated_at
      FROM business_reservations
      WHERE intent_key = ${intentKey}
      LIMIT 1
    `;

    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: r.id,
      intentKey: r.intent_key,
      sourceKey: r.source_key,
      boardId: r.board_id,
      runId: r.run_id,
      status: r.status,
      remoteId: r.remote_id ?? undefined,
      remoteUrl: r.remote_url ?? undefined,
      operationId: r.operation_id ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async reserve(data: {
    intentKey: string;
    sourceKey: string;
    boardId: string;
    runId: string;
  }): Promise<ReservationRecord> {
    const existing = await this.getReservation(data.intentKey);
    if (existing) {
      if (existing.status === 'confirmed') {
        return existing;
      }
      if (existing.status === 'unknown') {
        throw new Error(
          `INTENT_IN_UNKNOWN_STATE: Intent ${data.intentKey} has unknown status and requires reconciliation`,
        );
      }
      if (existing.status === 'dispatched' || existing.status === 'reserved') {
        throw new Error(
          `INTENT_ALREADY_RESERVED: Intent ${data.intentKey} is already in state "${existing.status}"`,
        );
      }
    }

    const rows = await this.db.client<
      Array<{
        id: string;
        intent_key: string;
        source_key: string;
        board_id: string;
        run_id: string;
        status: ReservationStatus;
        remote_id: string | null;
        remote_url: string | null;
        operation_id: string | null;
        created_at: Date;
        updated_at: Date;
      }>
    >`
      INSERT INTO business_reservations (intent_key, source_key, board_id, run_id, status)
      VALUES (${data.intentKey}, ${data.sourceKey}, ${data.boardId}, ${data.runId}, 'reserved')
      RETURNING id, intent_key, source_key, board_id, run_id, status, remote_id, remote_url, operation_id, created_at, updated_at
    `;
    const r = rows[0];
    if (!r) {
      throw new Error('RESERVATION_INSERT_FAILED: Failed to insert business reservation');
    }
    return {
      id: r.id,
      intentKey: r.intent_key,
      sourceKey: r.source_key,
      boardId: r.board_id,
      runId: r.run_id,
      status: r.status,
      remoteId: r.remote_id ?? undefined,
      remoteUrl: r.remote_url ?? undefined,
      operationId: r.operation_id ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async claimDispatched(intentKey: string, operationId: string): Promise<void> {
    const result = await this.db.client`
      UPDATE business_reservations
      SET status = 'dispatched', operation_id = ${operationId}, updated_at = NOW()
      WHERE intent_key = ${intentKey}
    `;
    if (result.count === 0) {
      throw new Error(`RESERVATION_NOT_FOUND: Intent ${intentKey}`);
    }
  }

  async confirm(intentKey: string, remoteId: string, remoteUrl: string): Promise<void> {
    const result = await this.db.client`
      UPDATE business_reservations
      SET status = 'confirmed', remote_id = ${remoteId}, remote_url = ${remoteUrl}, updated_at = NOW()
      WHERE intent_key = ${intentKey}
    `;
    if (result.count === 0) {
      throw new Error(`RESERVATION_NOT_FOUND: Intent ${intentKey}`);
    }
  }

  async markUnknown(intentKey: string): Promise<void> {
    const result = await this.db.client`
      UPDATE business_reservations
      SET status = 'unknown', updated_at = NOW()
      WHERE intent_key = ${intentKey}
    `;
    if (result.count === 0) {
      throw new Error(`RESERVATION_NOT_FOUND: Intent ${intentKey}`);
    }
  }

  async cancel(intentKey: string): Promise<void> {
    await this.db.client`
      UPDATE business_reservations
      SET status = 'cancelled', updated_at = NOW()
      WHERE intent_key = ${intentKey}
    `;
  }
}
