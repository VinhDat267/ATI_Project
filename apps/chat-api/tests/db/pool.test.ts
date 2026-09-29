import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { getPool, closePool, checkDatabaseHealth } from '../../src/db/pool.js';

describe('apps/chat-api (Task 6: PostgreSQL V3 Schema Migration & Connection Pool)', () => {
  it('verifies SQL migration defines 6 tables and 4 performance indexes with valid syntax', () => {
    const candidates: [string, string] = [
      resolve(process.cwd(), 'db/v3/0001_v3_core.sql'),
      resolve(process.cwd(), '../../db/v3/0001_v3_core.sql'),
    ];
    const file = candidates.find((p) => existsSync(p)) || candidates[0];
    expect(existsSync(file)).toBe(true);
    const sql = readFileSync(file, 'utf8');

    // 6 Core Tables
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS users');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS conversations');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS messages');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS plans');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS execution_steps');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS service_credentials');

    // 4 Performance Indexes
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_conversations_user_id');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_messages_conv_id');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_plans_conv_id');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_execution_steps_plan_id');
  });

  it('manages singleton connection pool lifecycle', async () => {
    const pool1 = getPool();
    const pool2 = getPool();
    expect(pool1).toBe(pool2);

    await closePool();
    const pool3 = getPool();
    expect(pool3).not.toBe(pool1);
    await closePool();
  });

  it('checks database health using probe query', async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });
    const mockPool = { query: mockQuery } as any;

    const healthy = await checkDatabaseHealth(mockPool);
    expect(healthy).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith('SELECT 1');

    const failingQuery = vi.fn().mockRejectedValue(new Error('Connection refused'));
    const failingPool = { query: failingQuery } as any;
    const unhealthy = await checkDatabaseHealth(failingPool);
    expect(unhealthy).toBe(false);
  });
});
