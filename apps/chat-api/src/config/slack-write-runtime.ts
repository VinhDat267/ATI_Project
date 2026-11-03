import type pg from 'pg';
import type {PlanRepo} from '../db/repositories/plan-repo.js';
import {SlackConnectionRepo} from '../db/repositories/slack-connection-repo.js';
import {SlackOAuthClient,type SlackOAuthConfig} from '../services/slack/oauth-client.js';
import {SlackTokenManager} from '../services/slack/token-manager.js';
import {SlackPolicyService} from '../services/slack/policy-service.js';
import {SlackInvalidationService} from '../services/slack/slack-invalidation-service.js';
import {SlackWriteRuntime} from '../services/slack/slack-write-runtime.js';
export function createPersonalSlackWriteRuntime(i:{pool?:pg.Pool;oauth?:SlackOAuthConfig;encryptionKey:string;plans:PlanRepo;env:Record<string,string|undefined>}){
 if(i.env.MYSLACK_WRITES_ENABLED&&!['on','off'].includes(i.env.MYSLACK_WRITES_ENABLED))throw new Error('MYSLACK_WRITES_ENABLED must be on or off');
 if(i.env.MYSLACK_WRITES_ENABLED!=='on'||i.env.MYSLACK_ENABLED!=='on'||!i.pool||!i.oauth)return undefined;
 const invalidation=new SlackInvalidationService(i.pool),connections=new SlackConnectionRepo(i.pool,invalidation);
 return new SlackWriteRuntime({pool:i.pool,connections,invalidation,policy:new SlackPolicyService(i.pool,{env:i.env}),plans:i.plans,tokens:new SlackTokenManager(connections,new SlackOAuthClient(i.oauth),i.encryptionKey),appId:i.oauth.appId,apiBaseUrl:i.oauth.apiBaseUrl});
}
