import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {it} from 'vitest';
import type pg from 'pg';
import {slackPolicyRefToEpoch} from '@wap/tool-schemas';
import {createMigratedSchema} from '../helpers/gmail-test-db.js';
import {SlackSourceRepo} from '../../src/db/repositories/slack-source-repo.js';
import {SlackEventReceiptRepo} from '../../src/db/repositories/slack-event-receipt-repo.js';
import {SlackConsentRepo} from '../../src/db/repositories/slack-consent-repo.js';
import {resolveRuntimeProviderIdentity} from '../../src/config/slack-policy-runtime.js';
import {SlackInvalidationService,acquireSlackInvalidationLocks,slackSourceWriteLockKeys} from '../../src/services/slack/slack-invalidation-service.js';

it.each(['token_revocation_validation','app_uninstall_validation'] as const)(
  '%s takes invalidation advisory locks before connection row locks', async intentType=>{
    const db=await createMigratedSchema('slack_ingress_source_lock');
    let writer: pg.PoolClient | undefined;
    let pending: Promise<unknown> | undefined;
    try {
      const user=await db.person('Lock order fixture');
      const connectionId=randomUUID(),workspaceId='T_'+randomUUID().replaceAll('-','');
      await db.pool.query("INSERT INTO slack_connections(id,user_id,app_id,workspace_id,workspace_name,actor_id,identity_version,status,config,scopes,connected_at,last_state_order) VALUES($1,$2,'A_LOCK',$3,'Fixture','U_LOCK',1,'active','FIXTURE_SEALED',ARRAY['channels:history'],now(),'0001')",[connectionId,user.id,workspaceId]);
      const identity=resolveRuntimeProviderIdentity({LLM_PROVIDER:'gemini',GEMINI_MODEL:'fixture-model',RUNTIME_ACCOUNT_ID:'LOCK_FIXTURE'});
      const consents=new SlackConsentRepo(db.pool);
      await consents.attestProvider({id:identity.providerId,name:identity.name,verified:true,noTraining:true,maxRetentionDays:30,configurationFingerprint:identity.fingerprint,evidenceRef:'FIXTURE_ONLY',verifiedBy:'fixture-operator',verifiedAt:new Date()});
      const grant=await consents.grantConsent({workspaceId,providerId:identity.providerId,policyVersion:'fixture-policy',purposes:['storage','manual_lookup'],retentionDays:30,organizationRepresentative:'fixture-org',evidenceRef:'FIXTURE_ONLY',recordedBy:'fixture-operator'});
      const binding={atiUserId:user.id,connectionId,workspaceId,slackUserId:'U_LOCK',identityVersion:1};
      const policyRef={binding,purpose:'storage' as const,requestedRetentionDays:30,providerProfileId:identity.providerId,configFingerprint:identity.fingerprint,policyVersion:'fixture-policy',consentRevision:String(grant.revision),providerRevision:'1'};
      const sourceRef={binding,resourceType:'message' as const,resourceId:JSON.stringify(['C_LOCK','1730000000.000001']),revision:'1730000000.000001'};
      const invalidator=new SlackInvalidationService(db.pool),sources=new SlackSourceRepo(db.pool);
      const ingress=new SlackEventReceiptRepo(db.pool,invalidator);
      writer=await db.pool.connect();
      await writer.query('BEGIN');
      await writer.query("SET LOCAL lock_timeout='500ms'");
      await acquireSlackInvalidationLocks(writer,slackSourceWriteLockKeys({binding,epoch:slackPolicyRefToEpoch(policyRef),resourceType:sourceRef.resourceType,resourceId:sourceRef.resourceId,channelId:'C_LOCK'}));
      const ingressPid=new Promise<number>((resolve,reject)=>{
        db.pool.once('acquire',(client: pg.PoolClient)=>{
          void client.query<{pid:number}>('SELECT pg_backend_pid() AS pid')
            .then(result=>resolve(result.rows[0]!.pid),reject);
        });
      });
      const staged=ingress.recordLifecycle({appId:'A_LOCK',eventId:'Ev_'+randomUUID().replaceAll('-',''),teamId:workspaceId,eventType:intentType==='token_revocation_validation'?'tokens_revoked':'app_uninstalled',eventSubtype:null,eventContext:null,sourceEventTs:'1730000001.000001',sourceEventTimeIso:'2024-10-27T03:33:21.000001Z',channelId:null,messageTs:null,payloadHash:'a'.repeat(64),lifecycle:intentType==='token_revocation_validation'?{intentType,slackUserIds:['U_LOCK']}:{intentType}});
      pending=staged;staged.catch(()=>{});
      const pid=await ingressPid;
      const deadline=Date.now()+1500;
      let waiting=false;
      while(Date.now()<deadline){
        const row=await db.pool.query('SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE pid=$1',[pid]);
        if(row.rows[0]?.wait_event_type==='Lock'&&row.rows[0]?.wait_event==='advisory'){waiting=true;break;}
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      assert.equal(waiting,true,'real ingress transaction must be waiting on the held advisory lock');
      const saved=await sources.saveSourceInTransaction(writer,{sourceRef,policyRef,untrustedContent:'LOCK_FIXTURE_CONTENT',metadata:{channelId:'C_LOCK'}});
      await writer.query('COMMIT');
      assert.ok(saved.id);
      assert.equal((await staged).kind,'recorded');
      assert.equal((await invalidator.checkBarriers({binding})).blocked,true);
    } finally {
      if(writer){await writer.query('ROLLBACK').catch(()=>{});writer.release();}
      if(pending)await pending.catch(()=>{});
      await db.close();
    }
  }, 15000,
);
