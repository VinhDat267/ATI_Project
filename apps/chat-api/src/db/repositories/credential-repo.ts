import type pg from 'pg';

export interface ServiceCredentialRow {
  id: string;
  service: string;
  user_id: string | null;
  config: string;
  created_at: Date;
}

export class CredentialRepo {
  constructor(private pool: pg.Pool) {}

  async saveCredentials(
    service: string,
    config: string,
    userId?: string | null
  ): Promise<ServiceCredentialRow> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [service, userId || 'team-shared']);
      if (userId) {
        await client.query('DELETE FROM service_credentials WHERE service = $1 AND user_id = $2', [service, userId]);
      } else {
        await client.query('DELETE FROM service_credentials WHERE service = $1 AND user_id IS NULL', [service]);
      }
      const res = await client.query(
        `INSERT INTO service_credentials (service, user_id, config)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [service, userId || null, config]
      );
      await client.query('COMMIT');
      return res.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getCredentials(
    service: string,
    userId?: string | null
  ): Promise<ServiceCredentialRow | null> {
    if (userId) {
      const userRes = await this.pool.query(
        'SELECT * FROM service_credentials WHERE service = $1 AND user_id = $2',
        [service, userId]
      );
      if (userRes.rows[0]) return userRes.rows[0];
    }

    // Fallback to team-shared credentials (user_id IS NULL)
    const sharedRes = await this.pool.query(
      'SELECT * FROM service_credentials WHERE service = $1 AND user_id IS NULL',
      [service]
    );
    return sharedRes.rows[0] || null;
  }

  async deleteCredentials(service: string, userId?: string | null): Promise<void> {
    if (userId) {
      await this.pool.query(
        'DELETE FROM service_credentials WHERE service = $1 AND user_id = $2',
        [service, userId]
      );
    } else {
      await this.pool.query(
        'DELETE FROM service_credentials WHERE service = $1 AND user_id IS NULL',
        [service]
      );
    }
  }
}
