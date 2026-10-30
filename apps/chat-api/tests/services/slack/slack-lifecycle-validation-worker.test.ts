import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { encryptCredentials } from '@wap/tool-adapters';
import pg from 'pg';
import { SlackConnectionRepo } from '../../../src/db/repositories/slack-connection-repo.js';
import { createSlackReadEnvironment, TEST_KEY, type SlackReadEnvironment, type SeededUser } from '../../helpers/slack-private-read-fixture.js';
import { SlackEventReceiptRepo } from '../../../src/db/repositories/slack-event-receipt-repo.js';
import { SlackLifecycleValidationRepo } from '../../../src/db/repositories/slack-lifecycle-validation-repo.js';
import { SlackOAuthClient } from '../../../src/services/slack/oauth-client.js';
import { SlackLifecycleValidationWorker } from '../../../src/services/slack/slack-lifecycle-validation-worker.js';

describe('04B1 credential validation with real PostgreSQL and HTTP', () => {
  let env: SlackReadEnvironment, jobs: SlackLifecycleValidationRepo, seed: SeededUser;
  beforeAll(async()=>{ env=await createSlackReadEnvironment('slack_validation_worker'); jobs=new SlackLifecycleValidationRepo(env.db.pool); });
  beforeEach(async()=>{
    await env.db.pool.query('DELETE FROM slack_event_receipts');
    env.fixture.clearHandlers(); env.fixture.reset();
    seed=await env.addUser({name:'validator',workspaceId:`T${randomUUID()}`,actorId:`U${randomUUID()}`,accessToken:'VALIDATOR_FIXTURE'});
    env.fixture.setHandler('/auth.test',()=>({body:{ok:true,team_id:seed.binding.workspaceId,user_id:seed.binding.slackUserId}}));
  });
  afterAll(async()=>{await env?.close();});
  async function event() {
    return new SlackEventReceiptRepo(env.db.pool,env.invalidationService).recordLifecycle({
      appId:seed.row.app_id,eventId:`Ev${randomUUID()}`,teamId:seed.binding.workspaceId,eventType:'tokens_revoked',
      eventSubtype:null,eventContext:null,sourceEventTs:'1730000000.000001',sourceEventTimeIso:'2024-10-27T03:33:20.000001Z',
      channelId:null,messageTs:null,payloadHash:'a'.repeat(64),lifecycle:{intentType:'token_revocation_validation',slackUserIds:[seed.binding.slackUserId]},
    });
  }
  function worker(timeoutMs=500,invalidation:Pick<typeof env.invalidationService,'stageInTransaction'>=env.invalidationService) {
    const oauth=new SlackOAuthClient({appId:seed.row.app_id,clientId:'fixture',clientSecret:'fixture',redirectUri:'http://127.0.0.1/callback',
      authorizationUrl:'https://slack.com/oauth/v2/authorize',apiBaseUrl:env.fixture.url});
    return new SlackLifecycleValidationWorker({pool:env.db.pool,jobs,oauth,invalidation,
      encryptionKey:TEST_KEY,workerId:'validation-fixture',probeTimeoutMs:timeoutMs});
  }
  async function connection() {return (await env.db.pool.query('SELECT status,config,identity_version FROM slack_connections WHERE id=$1',[seed.binding.connectionId])).rows[0];}
  async function state() {return (await env.db.pool.query('SELECT status,validation_outcome,validation_last_error_code FROM slack_lifecycle_intents ORDER BY created_at')).rows;}

  it('valid captured credential clears only its owned provisional block and restores active',async()=>{
    await event(); const before=await connection(); await worker().runOnce();
    expect(await connection()).toEqual({...before,status:'active'});
    expect((await env.invalidationService.checkBarriers({binding:seed.binding})).blocked).toBe(false);
    expect(await state()).toEqual([{status:'applied',validation_outcome:'valid',validation_last_error_code:null}]);
    expect(env.fixture.requests.filter(r=>r.path==='/auth.test')).toHaveLength(1);
  });
  it('confirmed invalid nonrotating credential disconnects only its captured generation and queues eight purges',async()=>{
    await env.db.pool.query('UPDATE slack_connections SET config=$2 WHERE id=$1',
      [seed.binding.connectionId,encryptCredentials({accessToken:'NONROTATING_FIXTURE'},TEST_KEY)]);
    await event(); env.fixture.setHandler('/auth.test',()=>({body:{ok:false,error:'token_revoked'}})); await worker().runOnce();
    expect(await connection()).toEqual({status:'disconnected',config:null,identity_version:seed.binding.identityVersion+1});
    expect((await env.db.pool.query("SELECT count(*)::int AS n FROM slack_invalidation_intents WHERE purge_target->'binding'->>'connectionId'=$1",[seed.binding.connectionId])).rows[0].n).toBe(8);
    expect((await state())[0]).toMatchObject({status:'applied',validation_outcome:'invalid'});
  });
  it('a stale job cannot mutate a newer OAuth generation',async()=>{
    await event(); seed=await env.reconnect(seed,{accessToken:'NEW_GRANT'}); const current=await connection();
    await worker().runOnce(); expect(await connection()).toEqual(current);
    expect((await state())[0]).toMatchObject({status:'applied',validation_outcome:'superseded'});
    expect(env.fixture.requests.filter(r=>r.path==='/auth.test')).toHaveLength(0);
  });
  it('keeps other pending barriers while completing just one valid job',async()=>{
    await event(); await event(); await worker().runOnce(1);
    expect((await connection()).status).toBe('reconnect_required');
    expect((await env.invalidationService.checkBarriers({binding:seed.binding})).blocked).toBe(true);
    await worker().runOnce(1); expect((await connection()).status).toBe('active');
  });
  it.each([429,500])('keeps encrypted config and block after transient HTTP%s',async status=>{
    await event(); const before=await connection(); env.fixture.setHandler('/auth.test',()=>({status,body:{ok:false,error:'invalid_auth'}}));
    await worker().runOnce(); expect(await connection()).toEqual(before);
    expect((await state())[0]).toMatchObject({status:'failed',validation_last_error_code:'probe_transient'});
    expect((await env.invalidationService.checkBarriers({binding:seed.binding})).blocked).toBe(true);
  });
  it('does not erase or refresh an expired rotating credential',async()=>{
    seed=await env.reconnect(seed,{accessToken:'EXPIRING',refreshToken:'ROTATING_FIXTURE',expiresAt:Date.now()-1000});
    await event(); const before=await connection(); await worker().runOnce(); expect(await connection()).toEqual(before);
    expect((await state())[0]).toMatchObject({status:'failed',validation_last_error_code:'credential_uncertain'});
    expect(env.fixture.requests).toHaveLength(0);
  });
  it('uses actual AbortSignal timeout for an unresolved HTTP probe without clearing config',async()=>{
    await event(); const before=await connection(); let release!:()=>void;
    env.fixture.setHandler('/auth.test',async()=>{await new Promise<void>(resolve=>{release=resolve;});return {body:{ok:true,team_id:seed.binding.workspaceId,user_id:seed.binding.slackUserId}};});
    try {await worker(75).runOnce(); expect(await connection()).toEqual(before); expect((await state())[0].status).toBe('failed');}
    finally {release?.();}
  });
  it('does not trust a job whose barrier ownership was relabeled',async()=>{
    const receipt=await event(); const intent=receipt.intents[0]!;
    await env.db.pool.query("UPDATE slack_lifecycle_intents SET payload_json=jsonb_set(payload_json,'{barrierId}',to_jsonb($2::text)) WHERE id=$1",[intent.id,randomUUID()]);
    const before=await connection(); await worker().runOnce(); expect(await connection()).toEqual(before);
    expect((await state())[0]).toMatchObject({status:'failed',validation_last_error_code:'invalid_job'});
    expect(env.fixture.requests).toHaveLength(0);
  });
  it('does not erase a rotating grant just because one access token is revoked',async()=>{
    await event(); const before=await connection();
    env.fixture.setHandler('/auth.test',()=>({body:{ok:false,error:'token_revoked'}}));
    await worker().runOnce(); expect(await connection()).toEqual(before);
    expect((await state())[0]).toMatchObject({status:'failed',validation_last_error_code:'credential_uncertain'});
  });
  it.each([{team_id:undefined,user_id:undefined},{team_id:42},{user_id:[]},{bot_id:42},{team_id:' '}])(
    'preserves a nonrotating credential after malformed successful identity metadata: %j',async malformed=>{
      await env.db.pool.query('UPDATE slack_connections SET config=$2 WHERE id=$1',
        [seed.binding.connectionId,encryptCredentials({accessToken:'NONROTATING_FIXTURE'},TEST_KEY)]);
      await event(); const before=await connection();
      env.fixture.setHandler('/auth.test',()=>({body:{ok:true,team_id:seed.binding.workspaceId,user_id:seed.binding.slackUserId,...malformed}}));
      await worker().runOnce(); expect(await connection()).toEqual(before);
      expect((await state())[0]).toMatchObject({status:'failed',validation_last_error_code:'probe_transient'});
      expect((await env.db.pool.query("SELECT count(*)::int AS n FROM slack_invalidation_intents WHERE purge_target->'binding'->>'connectionId'=$1",[seed.binding.connectionId])).rows[0].n).toBe(0);
    }
  );
  it('treats a well-formed contradictory principal as invalid for the captured binding',async()=>{
    await env.db.pool.query('UPDATE slack_connections SET config=$2 WHERE id=$1',
      [seed.binding.connectionId,encryptCredentials({accessToken:'NONROTATING_FIXTURE'},TEST_KEY)]);
    await event();
    env.fixture.setHandler('/auth.test',()=>({body:{ok:true,team_id:seed.binding.workspaceId,user_id:'U_OTHER_PRINCIPAL'}}));
    await worker().runOnce(); expect((await connection()).status).toBe('disconnected');
    expect((await state())[0]).toMatchObject({status:'applied',validation_outcome:'invalid'});
  });
  it('retries when a real owner lock is occupied without making a provider call',async()=>{
    await event(); const holder=await env.db.pool.connect();
    try {
      await holder.query("SELECT pg_advisory_lock(hashtext('ati-slack-owner'),hashtext($1))",[seed.person.id]);
      await worker().runOnce();
      expect((await state())[0]).toMatchObject({status:'failed',validation_last_error_code:'owner_busy'});
      expect(env.fixture.requests).toHaveLength(0);
    } finally {await holder.query("SELECT pg_advisory_unlock(hashtext('ati-slack-owner'),hashtext($1))",[seed.person.id]);holder.release();}
  });
  it('cannot apply a valid probe after its actual lease expires',async()=>{
    await event(); const before=await connection();
    env.fixture.setHandler('/auth.test',async()=>{
      await env.db.pool.query("UPDATE slack_lifecycle_intents SET validation_lease_until=clock_timestamp()-interval '1 second'");
      return {body:{ok:true,team_id:seed.binding.workspaceId,user_id:seed.binding.slackUserId}};
    });
    await worker().runOnce(); expect(await connection()).toEqual(before);
    expect((await state())[0].status).toBe('pending');
    expect((await env.invalidationService.checkBarriers({binding:seed.binding})).blocked).toBe(true);
  });
  it('aborts a real in-flight HTTP probe and keeps the read block',async()=>{
    await event(); const before=await connection(), controller=new AbortController(); let release!:()=>void;
    env.fixture.setHandler('/auth.test',async()=>{
      controller.abort(); await new Promise<void>(resolve=>{release=resolve;});
      return {body:{ok:true,team_id:seed.binding.workspaceId,user_id:seed.binding.slackUserId}};
    });
    try {await worker().runOnce(1,controller.signal);expect(await connection()).toEqual(before);
      expect((await state())[0]).toMatchObject({status:'failed',validation_last_error_code:'aborted'});
    } finally {release?.();}
  });
  it('does not restore a connection after a manual disconnect',async()=>{
    await event(); await env.connectionRepo.disconnect(seed.person.id,seed.binding.connectionId);
    const before=await connection(); await worker().runOnce(); expect(await connection()).toEqual(before);
    expect((await state())[0]).toMatchObject({status:'applied',validation_outcome:'superseded'});
    expect(env.fixture.requests).toHaveLength(0);
  });
  it('leaves a changed credential fingerprint untouched without probing it',async()=>{
    await event();
    await env.db.pool.query('UPDATE slack_connections SET config=$2 WHERE id=$1',
      [seed.binding.connectionId,encryptCredentials({accessToken:'REPLACED_FIXTURE'},TEST_KEY)]);
    const before=await connection(); await worker().runOnce(); expect(await connection()).toEqual(before);
    expect((await state())[0]).toMatchObject({status:'applied',validation_outcome:'superseded'});
    expect(env.fixture.requests).toHaveLength(0);
  });
  it('serializes an actual manual disconnect requested during the HTTP probe after the held owner lock',async()=>{
    await event(); const manualPool=new pg.Pool({...env.db.pool.options,max:1});
    const pid=(await manualPool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const manual=new SlackConnectionRepo(manualPool,env.invalidationService);
    let disconnect:Promise<void>|undefined;
    env.fixture.setHandler('/auth.test',async()=>{
      disconnect=manual.disconnect(seed.person.id,seed.binding.connectionId); disconnect.catch(()=>{});
      const start=Date.now();
      while (true) {
        const row=(await env.db.pool.query('SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0];
        if (row?.wait_event_type==='Lock' && row.wait_event==='advisory') break;
        if (Date.now()-start>1000) throw new Error('Manual disconnect did not wait on actual owner lock');
        await new Promise(resolve=>setTimeout(resolve,5));
      }
      return {body:{ok:true,team_id:seed.binding.workspaceId,user_id:seed.binding.slackUserId}};
    });
    try {await worker(2000).runOnce();await disconnect;
      expect((await connection()).status).toBe('disconnected');expect((await connection()).config).toBeNull();
    } finally {await disconnect?.catch(()=>{});await manualPool.end();}
  });
  it('rolls permanent barriers, purge intents and config erasure back when final lease fencing fails',async()=>{
    await env.db.pool.query('UPDATE slack_connections SET config=$2 WHERE id=$1',
      [seed.binding.connectionId,encryptCredentials({accessToken:'NONROTATING_FIXTURE'},TEST_KEY)]);
    await event(); const before=await connection();
    env.fixture.setHandler('/auth.test',()=>({body:{ok:false,error:'token_revoked'}}));
    await worker(500,{stageInTransaction:async(client,input)=>{
      const result=await env.invalidationService.stageInTransaction(client,input);
      await client.query("UPDATE slack_lifecycle_intents SET validation_lease_until=clock_timestamp()-interval '1 second'");
      return result;
    }}).runOnce();
    expect(await connection()).toEqual(before);
    expect((await env.db.pool.query("SELECT count(*)::int AS n FROM slack_invalidation_intents WHERE purge_target->'binding'->>'connectionId'=$1",[seed.binding.connectionId])).rows[0].n).toBe(0);
    expect((await env.invalidationService.checkBarriers({binding:seed.binding})).blocked).toBe(true);
    expect((await state())[0].status).toBe('failed');
  });
});
