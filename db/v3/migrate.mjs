import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const directory = dirname(fileURLToPath(import.meta.url));
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required for v3 migrations');

const pool = new pg.Pool({ connectionString });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock($1)', [20260929]);
  const files = (await readdir(directory)).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
  for (const file of files) {
    await client.query(await readFile(join(directory, file), 'utf8'));
  }
  await client.query('COMMIT');
  for (const file of files) process.stdout.write(`Applied ${file}\n`);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
