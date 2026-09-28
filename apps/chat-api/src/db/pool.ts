import pg from 'pg';

const { Pool } = pg;
export type { Pool, PoolConfig } from 'pg';

let globalPool: pg.Pool | null = null;

export function getPool(config?: pg.PoolConfig): pg.Pool {
  if (!globalPool) {
    const connectionString =
      config?.connectionString ||
      process.env.DATABASE_URL ||
      'postgresql://wap:wap@localhost:5432/wap';

    globalPool = new Pool({
      connectionString,
      max: config?.max ?? 20,
      idleTimeoutMillis: config?.idleTimeoutMillis ?? 30000,
      connectionTimeoutMillis: config?.connectionTimeoutMillis ?? 5000,
      ...config,
    });
  }
  return globalPool;
}

export async function closePool(): Promise<void> {
  if (globalPool) {
    const poolToClose = globalPool;
    globalPool = null;
    await poolToClose.end();
  }
}

export async function checkDatabaseHealth(pool?: pg.Pool): Promise<boolean> {
  const activePool = pool || getPool();
  try {
    const res = await activePool.query('SELECT 1');
    return Array.isArray(res?.rows) && res.rows.length > 0;
  } catch {
    return false;
  }
}
