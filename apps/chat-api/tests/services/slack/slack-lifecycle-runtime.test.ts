import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { inspect } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSlackReadEnvironment, TEST_KEY, waitFor, type SlackReadEnvironment, type SeededUser } from '../../helpers/slack-private-read-fixture.js';
import { SlackEventReceiptRepo } from '../../../src/db/repositories/slack-event-receipt-repo.js';
import { createSlackLifecycleRuntime } from '../../../src/services/slack/slack-lifecycle-runtime.js';
import { SlackIdentityClient } from '../../../src/services/slack/oauth-client.js';
import { slackLifecycleApiBaseUrl, slackOAuthEnv } from '../../../src/config/slack-env.js';

describe('04B2 native lifecycle runtime with real PostgreSQL/HTTP',()=>{
  let env:SlackReadEnvironment,seed:SeededUser;
  const flags={MYSLACK_ENABLED:'off',MYSLACK_AUTOMATION_ENABLED:'off',MYSLACK_APP_ID:'A_RUNTIME',SLACK_SIGNING_SECRET:'FIXTURE_SIGNING'};
  beforeAll(async()=>{env=await createSlackReadEnvironment('slack_lifecycle_runtime');});
  beforeEach(async()=>{
    await env.db.pool.query('DELETE FROM slack_event_receipts');env.fixture.clearHandlers();env.fixture.reset();
    seed=await env.addUser({name:'runtime',workspaceId:`T${randomUUID()}`,actorId:`U${randomUUID()}`,accessToken:'RUNTIME_FIXTURE'});
    env.fixture.setHandler('/auth.test',()=>({body:{ok:true,team_id:seed.binding.workspaceId,user_id:seed.binding.slackUserId}}));
  });
  afterAll(async()=>{await env?.close();});
  async function event() {
    return new SlackEventReceiptRepo(env.db.pool,env.invalidationService).recordLifecycle({appId:seed.row.app_id,eventId:`Ev${randomUUID()}`,teamId:seed.binding.workspaceId,eventType:'tokens_revoked',
      eventSubtype:null,eventContext:null,sourceEventTs:'1730000000.000001',sourceEventTimeIso:'2024-10-27T03:33:20.000001Z',channelId:null,messageTs:null,payloadHash:'a'.repeat(64),
      lifecycle:{intentType:'token_revocation_validation',slackUserIds:[seed.binding.slackUserId]}});
  }
  function runtime(extra:Record<string,unknown>={}) {
    return createSlackLifecycleRuntime({pool:env.db.pool,encryptionKey:TEST_KEY,env:{...flags,MYSLACK_API_BASE_URL:env.fixture.url},live:false,intervalMs:15,stopGraceMs:100,...extra})!;
  }
  async function state() {return (await env.db.pool.query('SELECT status,validation_outcome FROM slack_lifecycle_intents ORDER BY created_at')).rows;}
  it('drains a real durable job by timer with both flags off and no OAuth client secrets',async()=>{
    await event();expect(slackOAuthEnv(flags,false)).toBeUndefined();
    const service=runtime();expect(service.isRunning()).toBe(false);service.start();service.start();
    try {
      await waitFor(()=>env.fixture.requests.some(r=>r.path==='/auth.test'));
      const end=Date.now()+2000;while((await state())[0]?.status!=='applied' && Date.now()<end) await new Promise(r=>setTimeout(r,10));
      expect(await state()).toEqual([{status:'applied',validation_outcome:'valid'}]);
      expect(env.fixture.requests.map(r=>r.path)).toEqual(['/auth.test']);
    } finally {await service.stop();}
    expect(service.isRunning()).toBe(false);
  });
  it('metadata-only client needs only endpoint and has no OAuth/write methods',async()=>{
    const client=new SlackIdentityClient(env.fixture.url);await client.verify('RUNTIME_FIXTURE',seed.binding.workspaceId,seed.binding.slackUserId,AbortSignal.timeout(1000));
    expect('exchange' in client).toBe(false);expect('refresh' in client).toBe(false);expect('revoke' in client).toBe(false);
    expect(env.fixture.requests.map(r=>r.path)).toEqual(['/auth.test']);
  });
  it('never follows a metadata redirect carrying the access credential',async()=>{
    env.fixture.setHandler('/auth.test',()=>({status:302,headers:{Location:`${env.fixture.url}/credential_sink`},body:{}}));
    await expect(new SlackIdentityClient(env.fixture.url).verify('RUNTIME_FIXTURE',seed.binding.workspaceId,seed.binding.slackUserId,AbortSignal.timeout(1000))).rejects.toThrow('SLACK_PROVIDER_FAILED');
    expect(env.fixture.requests.map(r=>r.path)).toEqual(['/auth.test']);
  });
  it('leaves lifecycle consumer absent without DB, ingress config or safe sandbox endpoint',()=>{
    expect(runtime({pool:undefined})).toBeUndefined();expect(runtime({env:{}})).toBeUndefined();
    expect(runtime({env:flags})).toBeUndefined();expect(env.fixture.requests).toHaveLength(0);
  });
  it.each(['https://slack.com/api','http://localhost:1234/api','http://user:pass@127.0.0.1:1234/api','http://127.0.0.1:1234/api?q=1','http://127.0.0.1:1234/api#x'])('rejects unsafe sandbox metadata endpoint %s',url=>{
    expect(()=>runtime({env:{...flags,MYSLACK_API_BASE_URL:url}})).toThrow();expect(env.fixture.requests).toHaveLength(0);
  });
  it('pins native metadata transport independently of an unsafe endpoint override',()=>{
    expect(slackLifecycleApiBaseUrl({...flags,MYSLACK_API_BASE_URL:'http://EXTERNAL.invalid'},true)).toBe('https://slack.com/api');
  });
  it.each(['http://fixture-user:FIXTURE_SECRET@[broken]/api','http://fixture-user:FIXTURE_SECRET@127.0.0.1:BAD/api','http://fixture-user:FIXTURE_SECRET@[::1/api'])('does not expose malformed credential-bearing configuration %s',url=>{
    let caught:unknown;try {runtime({env:{...flags,MYSLACK_API_BASE_URL:url}});} catch(error){caught=error;}
    expect(caught).toBeInstanceOf(Error);
    const rendered=[inspect(caught),JSON.stringify(caught),String(caught)].join('\n');
    expect(rendered).not.toContain('FIXTURE_SECRET');expect(rendered).not.toContain('fixture-user');expect(rendered).not.toContain(url);
    expect(Object.hasOwn(caught as object,'input')).toBe(false);expect(Object.hasOwn(caught as object,'cause')).toBe(false);
    expect(env.fixture.requests).toHaveLength(0);
  });
  it('shares concurrent ticks, aborts a real in-flight HTTP probe on stop, and safely restarts',async()=>{
    await event();let release!:()=>void;
    env.fixture.setHandler('/auth.test',async()=>{await new Promise<void>(r=>{release=r;});return {body:{ok:true,team_id:seed.binding.workspaceId,user_id:seed.binding.slackUserId}};});
    const service=runtime();service.start();const a=service.tick(),b=service.tick();expect(a).toBe(b);
    try {
      await waitFor(()=>env.fixture.requests.length===1);await service.stop();await a;
      expect((await state())[0]?.status).not.toBe('applied');expect((await env.invalidationService.checkBarriers({binding:seed.binding})).blocked).toBe(true);
      release();env.fixture.setHandler('/auth.test',()=>({body:{ok:true,team_id:seed.binding.workspaceId,user_id:seed.binding.slackUserId}}));
      await env.db.pool.query("UPDATE slack_lifecycle_intents SET validation_next_attempt_at=now(),validation_lease_until=NULL");
      // PostgreSQL timestamps have microseconds; the caller clock is milliseconds.
      // A first claim can legitimately precede this freshly assigned due time.
      service.start();const end=Date.now()+2000;
      while((await state())[0]?.status!=='applied' && Date.now()<end) await new Promise(r=>setTimeout(r,10));
      expect((await state())[0]?.status).toBe('applied');
    } finally {release?.();await service.stop();}
  });
  it('bounds shutdown while a real PostgreSQL claim is blocked, then applies no late authority outcome',async()=>{
    await event();const holder=await env.db.pool.connect(),workerPool=new pg.Pool({connectionString:env.db.pool.options.connectionString,max:1});
    const pid=(await workerPool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const service=runtime({pool:workerPool,stopGraceMs:50});let pending:ReturnType<typeof service.tick>|undefined;
    try {
      await holder.query('BEGIN');await holder.query('LOCK TABLE slack_lifecycle_intents IN ACCESS EXCLUSIVE MODE');service.start();pending=service.tick();
      const end=Date.now()+2000;let blocked=false;
      while(Date.now()<end) {
        blocked=(await env.db.pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock' AND query LIKE 'WITH due AS (%') AS blocked",[pid])).rows[0].blocked;
        if(blocked) break;await new Promise(r=>setTimeout(r,10));
      }
      expect(blocked).toBe(true);const started=Date.now();await service.stop();expect(Date.now()-started).toBeLessThan(500);expect(service.isRunning()).toBe(false);
      await holder.query('ROLLBACK');await pending;expect((await state())[0]?.status).not.toBe('applied');expect(env.fixture.requests).toHaveLength(0);
      expect((await env.invalidationService.checkBarriers({binding:seed.binding})).blocked).toBe(true);
    } finally {await holder.query('ROLLBACK');holder.release();await pending;await service.stop();await workerPool.end();}
  });
  it('observes a late real PostgreSQL rejection after shutdown grace and reports only a fixed code',async()=>{
    await event();const holder=await env.db.pool.connect(),errors:string[]=[];
    const service=runtime({stopGraceMs:30,onError:(code:string)=>errors.push(code)});
    let pending:ReturnType<typeof service.tick>|undefined;
    try {
      await holder.query('BEGIN');await holder.query('LOCK TABLE slack_lifecycle_intents IN ACCESS EXCLUSIVE MODE');
      await holder.query('UPDATE slack_lifecycle_intents SET validation_attempts=2147483647');
      service.start();pending=service.tick();const observed=pending.catch(()=>{});
      await service.stop();await holder.query('COMMIT');await observed;
      expect(errors).toEqual(['SLACK_LIFECYCLE_SWEEP_FAILED']);expect(env.fixture.requests).toHaveLength(0);
      expect((await state())[0]?.status).not.toBe('applied');
    } finally {await holder.query('ROLLBACK');holder.release();await pending?.catch(()=>{});await service.stop();}
  });
});
