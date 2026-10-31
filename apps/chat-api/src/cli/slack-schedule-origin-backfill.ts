import {SlackScheduleOriginBackfill} from '../services/slack/slack-schedule-origin-backfill.js';
import pg from 'pg';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--apply') || new Set(args).size !== args.length) {
  throw new Error('Usage: slack-schedule-origin-backfill.ts [--apply] (default: dry run)');
}
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL});
const backfill = new SlackScheduleOriginBackfill(pool);
const apply = args.includes('--apply');
const schedules = await backfill.page({apply, limit: 200});
console.log(JSON.stringify({apply, schedules}));
await pool.end();
