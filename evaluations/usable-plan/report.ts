/**
 * W4-03 report: reads the facilitator sheet and the session's PostgreSQL (read-only),
 * writes turns.csv and summary.md, and prints the summary.
 *
 *   node --env-file=.env --import tsx evaluations/usable-plan/report.ts --sheet <sheet.csv> --out <dir>
 *
 * Keep the sheet and the output in docs/ai-evidence/USABLE-PLAN/ (git-ignored).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { buildReport, classifyTurn, parseSheet, readTurnFacts, withReadOnly } from './report-lib.js';

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Usage: report.ts --sheet <sheet.csv> --out <dir> (missing ${name})`);
  return value;
}

async function main() {
  const sheetPath = argument('--sheet'), out = argument('--out');
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL must point at the database used in the session');
  const rows = parseSheet(readFileSync(sheetPath, 'utf8'));
  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    const facts = await withReadOnly(pool, (client) => readTurnFacts(client, rows.map((row) => row.conversationId)));
    const report = buildReport(rows.map((row) => classifyTurn(row, facts.get(row.conversationId) ?? null)));
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'turns.csv'), report.csv);
    writeFileSync(join(out, 'summary.md'), report.summary);
    console.log(report.summary);
    if (!report.meetsMinimum) process.exitCode = 2;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Report failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
});
