import pg from 'pg';
import {SlackMessageOriginBackfill} from '../services/slack/slack-message-origin-backfill.js';

// Explicit DATABASE_URL only; no dotenv/live provider configuration is loaded.
const args=process.argv.slice(2);
if(args.some(arg=>arg!=='--apply')||new Set(args).size!==args.length)throw Error('Usage: slack-message-origin-backfill.ts [--apply] (default: dry run)');
if(!process.env.DATABASE_URL)throw Error('DATABASE_URL is required');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL}),controller=new AbortController();
const stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
try{
  const backfill=new SlackMessageOriginBackfill(pool);
  for(const table of ['messages','conversations'] as const){
    let afterId:string|undefined;
    const totals={scanned:0,alreadyValid:0,eligible:0,quarantined:0,applied:0};
    do{
      const page=await backfill.page(table,{afterId,apply:args.includes('--apply'),signal:controller.signal});
      for(const key of Object.keys(totals) as Array<keyof typeof totals>)totals[key]+=page[key];
      afterId=page.nextCursor??undefined;
    }while(afterId);
    process.stdout.write(JSON.stringify({table,mode:args.includes('--apply')?'apply':'dry_run',...totals})+'\n');
  }
}finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);await pool.end();}
