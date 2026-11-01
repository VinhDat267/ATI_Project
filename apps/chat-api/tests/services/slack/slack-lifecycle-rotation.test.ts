import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { decryptCredentials } from '@wap/tool-adapters';
import { createSlackReadEnvironment, TEST_KEY, type SlackReadEnvironment, type SeededUser } from '../../helpers/slack-private-read-fixture.js';
import { SlackEventReceiptRepo } from '../../../src/db/repositories/slack-event-receipt-repo.js';
import { SlackLifecycleValidationRepo } from '../../../src/db/repositories/slack-lifecycle-validation-repo.js';
import { SlackOAuthClient } from '../../../src/services/slack/oauth-client.js';
import { SlackLifecycleValidationWorker } from '../../../src/services/slack/slack-lifecycle-validation-worker.js';
import { createSlackLifecycleRuntime } from '../../../src/services/slack/slack-lifecycle-runtime.js';

describe('04B4 single-use lifecycle rotation with real PostgreSQL/HTTP',()=>{
  let env:SlackReadEnvironment,seed:SeededUser,jobs:SlackLifecycleValidationRepo;
  beforeAll(async()=>{env=await createSlackReadEnvironment('slack_rotation');jobs=new SlackLifecycleValidationRepo(env.db.pool);});
  beforeEach(async()=>{
    await env.db.pool.query('DELETE FROM slack_event_receipts');env.fixture.clearHandlers();env.fixture.reset();
    seed=await env.addUser({name:'rotation',workspaceId:`T${randomUUID()}`,actorId:`U${randomUUID()}`,accessToken:'OLD_ACCESS',refreshToken:'SINGLE_USE',expiresAt:Date.now()-1000});
    env.fixture.setHandler('/auth.test',r=>({body:r.authorization==='Bearer ROTATED_ACCESS'?{ok:true,team_id:seed.binding.workspaceId,user_id:seed.binding.slackUserId}:{ok:false,error:'token_revoked'}}));
  });
  afterAll(async()=>{await env?.close();});
  const row=async()=>(await env.db.pool.query('SELECT * FROM slack_connections WHERE id=$1',[seed.binding.connectionId])).rows[0];
  const state=async()=>(await env.db.pool.query('SELECT status,validation_outcome,validation_last_error_code FROM slack_lifecycle_intents ORDER BY created_at,id')).rows;
  async function event(){return new SlackEventReceiptRepo(env.db.pool,env.invalidationService).recordLifecycle({appId:seed.row.app_id,eventId:`Ev${randomUUID()}`,teamId:seed.binding.workspaceId,eventType:'tokens_revoked',eventSubtype:null,eventContext:null,sourceEventTs:'1730000000.000001',sourceEventTimeIso:'2024-10-27T03:33:20.000001Z',channelId:null,messageTs:null,payloadHash:'a'.repeat(64),lifecycle:{intentType:'token_revocation_validation',slackUserIds:[seed.binding.slackUserId]}});}
  async function due(){await env.db.pool.query("UPDATE slack_lifecycle_intents SET validation_next_attempt_at=clock_timestamp()-interval '1 second'");}
  function worker(timeout=1000){const oauth=new SlackOAuthClient({appId:seed.row.app_id,clientId:'FIXTURE_CLIENT',clientSecret:'FIXTURE_SECRET',redirectUri:'http://127.0.0.1/callback',authorizationUrl:'https://slack.com/oauth/v2/authorize',apiBaseUrl:env.fixture.url});return new SlackLifecycleValidationWorker({pool:env.db.pool,jobs,oauth,rotation:{appId:seed.row.app_id,client:oauth},invalidation:env.invalidationService,encryptionKey:TEST_KEY,workerId:'rotation-fixture',probeTimeoutMs:timeout});}
  it('checkpoints before exchanging once, persists fresh ciphertext and verifies its exact actor',async()=>{
    await event();env.fixture.setHandler('/oauth.v2.access',async r=>{expect((await row()).refresh_in_flight).toBe(true);expect(new URLSearchParams(r.body).get('refresh_token')).toBe('SINGLE_USE');return {body:{ok:true,token_type:'user',access_token:'ROTATED_ACCESS',refresh_token:'ROTATED_REFRESH',expires_in:43200}};});
    await worker().runOnce();const current=await row();expect(current.status).toBe('active');expect(current.refresh_in_flight).toBe(false);expect(decryptCredentials(current.config,TEST_KEY)).toMatchObject({accessToken:'ROTATED_ACCESS',refreshToken:'ROTATED_REFRESH'});expect((await state())[0]).toMatchObject({status:'applied',validation_outcome:'valid'});expect(env.fixture.refreshCalls).toBe(1);
  });
  it('can recover a revoked but not yet expired rotating access token',async()=>{
    seed=await env.reconnect(seed,{accessToken:'OLD_ACCESS',refreshToken:'SINGLE_USE',expiresAt:Date.now()+3600000});await event();await worker().runOnce();expect((await row()).status).toBe('active');expect(env.fixture.refreshCalls).toBe(1);expect(env.fixture.requests.filter(r=>r.path==='/auth.test')).toHaveLength(2);
  });
  it('does not exchange on a transient probe failure',async()=>{
    seed=await env.reconnect(seed,{accessToken:'OLD_ACCESS',refreshToken:'SINGLE_USE',expiresAt:Date.now()+3600000});await event();env.fixture.setHandler('/auth.test',()=>({status:503,body:{ok:false,error:'token_revoked'}}));await worker().runOnce();expect(env.fixture.refreshCalls).toBe(0);expect((await state())[0].validation_last_error_code).toBe('probe_transient');
  });
  it('retains confirmed new credentials after a transient fresh probe and retries without another exchange',async()=>{
    await event();env.fixture.setHandler('/auth.test',()=>({status:503,body:{ok:false}}));await worker().runOnce();expect(decryptCredentials((await row()).config,TEST_KEY)).toMatchObject({accessToken:'ROTATED_ACCESS'});expect((await row()).status).toBe('reconnect_required');await due();env.fixture.setHandler('/auth.test',()=>({body:{ok:true,team_id:seed.binding.workspaceId,user_id:seed.binding.slackUserId}}));await worker().runOnce();expect((await row()).status).toBe('active');expect(env.fixture.refreshCalls).toBe(1);
  });
  it('transfers sibling fingerprints without releasing their independent barriers',async()=>{
    await event();await event();await worker().runOnce(1);expect((await row()).status).toBe('reconnect_required');expect((await state()).filter(s=>s.status==='applied')).toHaveLength(1);await worker().runOnce(1);expect((await row()).status).toBe('active');expect(env.fixture.refreshCalls).toBe(1);expect((await state()).every(s=>s.validation_outcome==='valid')).toBe(true);
  });
  it('refreshes claimed sibling snapshots from durable payload before processing them',async()=>{
    await event();await event();await worker().runOnce(5);expect((await row()).status).toBe('active');expect((await state()).every(s=>s.validation_outcome==='valid')).toBe(true);expect(env.fixture.refreshCalls).toBe(1);
  });
  it('never reuses a single-use token after the provider commits but its response is aborted',async()=>{
    await event();const controller=new AbortController();let committed=0,release!:()=>void;
    env.fixture.setHandler('/oauth.v2.access',async()=>{committed++;controller.abort();await new Promise<void>(r=>{release=r;});return {body:{ok:true,token_type:'user',access_token:'LOST',refresh_token:'LOST',expires_in:43200}};});
    try{await worker().runOnce(1,controller.signal);expect(committed).toBe(1);expect((await row()).refresh_in_flight).toBe(true);expect((await row()).status).toBe('reconnect_required');await due();await worker().runOnce();expect(committed).toBe(1);expect((await env.invalidationService.checkBarriers({binding:seed.binding})).blocked).toBe(true);}finally{release?.();}
  });
  it('does not replay a checkpoint left by a previous process',async()=>{
    await event();await env.db.pool.query('UPDATE slack_connections SET refresh_in_flight=true WHERE id=$1',[seed.binding.connectionId]);await worker().runOnce();expect(env.fixture.requests).toHaveLength(0);expect((await state())[0].validation_last_error_code).toBe('credential_uncertain');
  });
  it('cannot persist tokens or release a barrier after actual lease loss during the exchange',async()=>{
    await event();const before=(await row()).config;env.fixture.setHandler('/oauth.v2.access',async()=>{await env.db.pool.query("UPDATE slack_lifecycle_intents SET validation_lease_until=clock_timestamp()-interval '1 second'");return {body:{ok:true,token_type:'user',access_token:'ROTATED_ACCESS',refresh_token:'ROTATED_REFRESH',expires_in:43200}};});await worker().runOnce();expect((await row()).config).toBe(before);expect((await row()).refresh_in_flight).toBe(true);expect((await state())[0].status).toBe('pending');expect(env.fixture.requests.filter(r=>r.path==='/auth.test')).toHaveLength(0);
  });
  it('never overwrites a different identity/config changed while the provider was in flight',async()=>{
    await event();env.fixture.setHandler('/oauth.v2.access',async()=>{await env.db.pool.query("UPDATE slack_connections SET status='disconnected',identity_version=identity_version+1,config=NULL,refresh_in_flight=false WHERE id=$1",[seed.binding.connectionId]);return {body:{ok:true,token_type:'user',access_token:'ROTATED_ACCESS',refresh_token:'ROTATED_REFRESH',expires_in:43200}};});await worker().runOnce();expect((await row()).config).toBeNull();expect((await row()).status).toBe('disconnected');expect((await env.db.pool.query('SELECT count(*)::int n FROM slack_invalidation_intents')).rows[0].n).toBe(0);
  });
  it('retains lifecycle rotation with both flags off and retained private client credentials',async()=>{
    await event();const service=createSlackLifecycleRuntime({pool:env.db.pool,encryptionKey:TEST_KEY,live:false,env:{MYSLACK_ENABLED:'off',MYSLACK_AUTOMATION_ENABLED:'off',MYSLACK_APP_ID:seed.row.app_id,SLACK_SIGNING_SECRET:'FIXTURE_SIGNING',MYSLACK_API_BASE_URL:env.fixture.url,MYSLACK_OAUTH_CLIENT_ID:'FIXTURE_CLIENT',MYSLACK_OAUTH_CLIENT_SECRET:'FIXTURE_SECRET'}})!;
    service.start();try{await service.tick();expect((await row()).status).toBe('active');expect(env.fixture.refreshCalls).toBe(1);}finally{await service.stop();}
  });
  it('never uses retained client credentials to rotate another app installation',async()=>{
    await event();const service=createSlackLifecycleRuntime({pool:env.db.pool,encryptionKey:TEST_KEY,live:false,env:{MYSLACK_APP_ID:'A_OTHER',SLACK_SIGNING_SECRET:'FIXTURE_SIGNING',MYSLACK_API_BASE_URL:env.fixture.url,MYSLACK_OAUTH_CLIENT_ID:'OTHER_CLIENT',MYSLACK_OAUTH_CLIENT_SECRET:'OTHER_SECRET'}})!;
    service.start();try{await service.tick();expect(env.fixture.refreshCalls).toBe(0);expect((await row()).refresh_in_flight).toBe(false);}finally{await service.stop();}
  });
  it.each(['app','owner'])('rejects %s authority changes during the exchange without publishing fresh tokens',async change=>{
    await event();const before=(await row()).config;
    env.fixture.setHandler('/oauth.v2.access',async()=>{
      if(change==='app')await env.db.pool.query("UPDATE slack_connections SET app_id='A_CHANGED' WHERE id=$1",[seed.binding.connectionId]);
      else await env.db.pool.query("UPDATE users SET status='disabled' WHERE id=$1",[seed.person.id]);
      return {body:{ok:true,token_type:'user',access_token:'ROTATED_ACCESS',refresh_token:'ROTATED_REFRESH',expires_in:43200}};
    });
    await worker().runOnce();expect((await row()).config).toBe(before);expect((await row()).refresh_in_flight).toBe(true);expect(env.fixture.requests.filter(r=>r.path==='/auth.test')).toHaveLength(0);
  });
  it('rechecks lease expiry after a real connection row-lock wait before persisting the exchange',async()=>{
    await event();const before=(await row()).config,holder=await env.db.pool.connect();let ready=false,running:Promise<unknown>|undefined;
    const pid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    env.fixture.setHandler('/oauth.v2.access',async()=>{
      await holder.query('BEGIN');await holder.query('SELECT id FROM slack_connections WHERE id=$1 FOR UPDATE',[seed.binding.connectionId]);ready=true;
      return {body:{ok:true,token_type:'user',access_token:'ROTATED_ACCESS',refresh_token:'ROTATED_REFRESH',expires_in:43200}};
    });
    try{
      running=worker(2000).runOnce();const end=Date.now()+2500;let blocked=false;
      while(Date.now()<end){if(ready)blocked=(await env.db.pool.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked',[pid])).rows[0].blocked;if(blocked)break;await new Promise(r=>setTimeout(r,5));}
      expect(blocked).toBe(true);await env.db.pool.query("UPDATE slack_lifecycle_intents SET validation_lease_until=clock_timestamp()-interval '1 second'");await holder.query('COMMIT');await running;
      expect((await row()).config).toBe(before);expect((await row()).refresh_in_flight).toBe(true);expect(env.fixture.requests.filter(r=>r.path==='/auth.test')).toHaveLength(0);
    }finally{await holder.query('ROLLBACK');holder.release();await running;}
  });
  it('does not repeatedly rotate a fresh credential whose principal contradicts the binding',async()=>{
    await event();env.fixture.setHandler('/auth.test',()=>({body:{ok:true,team_id:seed.binding.workspaceId,user_id:'U_DIFFERENT'}}));await worker().runOnce();await due();await worker().runOnce();expect(env.fixture.refreshCalls).toBe(1);expect((await row()).status).toBe('reconnect_required');expect((await env.invalidationService.checkBarriers({binding:seed.binding})).blocked).toBe(true);expect((await env.db.pool.query('SELECT count(*)::int n FROM slack_invalidation_intents')).rows[0].n).toBe(0);
  });
});
