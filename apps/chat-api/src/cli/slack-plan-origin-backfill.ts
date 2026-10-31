import {SlackPlanOriginBackfill} from '../services/slack/slack-plan-origin-backfill.js';
import pg from 'pg';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--apply') || new Set(args).size !== args.length) {
  throw new Error('Usage: slack-plan-origin-backfill.ts [--apply] (default: dry run)');
}
const pool = new pg.Pool({connectionString: process.env.DATABASE_URL});
const backfill = new SlackPlanOriginBackfill(pool);
const apply = args.includes('--apply');
const plans = await backfill.page('plans', {apply, limit: 200});
const steps = await backfill.page('execution_steps', {apply, limit: 200});
console.log(JSON.stringify({apply, plans, steps}));
await pool.end();
