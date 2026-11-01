import type pg from 'pg';
import {createProviderFromEnv,SlackTriagePlanner} from '@wap/planner';
import type {SlackOAuthConfig} from '../services/slack/oauth-client.js';
import {SlackOAuthClient} from '../services/slack/oauth-client.js';
import {SlackConnectionRepo} from '../db/repositories/slack-connection-repo.js';
import {SlackAssistantRepo} from '../db/repositories/slack-assistant-repo.js';
import {SlackAssistantArtifactRepo} from '../db/repositories/slack-assistant-artifact-repo.js';
import {SlackDerivedLineageRepo} from '../db/repositories/slack-derived-lineage-repo.js';
import {PlanRepo} from '../db/repositories/plan-repo.js';
import {MessageRepo} from '../db/repositories/message-repo.js';
import {SlackPolicyService} from '../services/slack/policy-service.js';
import {SlackInvalidationService} from '../services/slack/slack-invalidation-service.js';
import {SlackPrivateReadWrapper} from '../services/slack/slack-private-read-wrapper.js';
import {SlackTokenManager} from '../services/slack/token-manager.js';
import {SlackTriageWorker} from '../services/slack/slack-triage-worker.js';
import {SlackProposalService} from '../services/slack/slack-proposal-service.js';
import {SlackDigestService} from '../services/slack/slack-digest-service.js';
import {SlackLifecycleValidationRunner} from '../services/slack/slack-lifecycle-runtime.js';
import {resolveRuntimeProviderIdentity} from './slack-policy-runtime.js';
interface Options {pool?:pg.Pool;oauth?:SlackOAuthConfig;encryptionKey:string;env:Record<string,string|undefined>;live:boolean;workerId?:string;intervalMs?:number}
function literalLoopback(value:string|undefined):boolean{try{const u=new URL(value??'');return u.protocol==='http:'&&['127.0.0.1','[::1]'].includes(u.hostname)&&!u.username&&!u.password&&!u.search&&!u.hash;}catch{return false;}}
/** Metadata and protected Inbox survive background flags. Sandbox content uses only an explicitly attested loopback model. */
export function createPersonalSlackAssistantRuntime(input:Options){
 if(!input.pool)return undefined;
 const env=Object.freeze({...input.env});
 for(const key of ['MYSLACK_ENABLED','MYSLACK_AUTOMATION_ENABLED'])if(env[key]!==undefined&&!['on','off'].includes(env[key]!))throw new Error('SLACK_ASSISTANT_CONFIG_INVALID');
 const policy=new SlackPolicyService(input.pool,{env}),invalidation=new SlackInvalidationService(input.pool),artifacts=new SlackAssistantArtifactRepo(input.pool,policy),lineage=new SlackDerivedLineageRepo(input.pool,policy);
 const identity=resolveRuntimeProviderIdentity(env);
 const sandboxReady=env.LLM_PROVIDER==='openai-compatible'&&literalLoopback(env.LLM_BASE_URL)&&literalLoopback(input.oauth?.apiBaseUrl);
 const available=env.MYSLACK_ENABLED==='on'&&env.MYSLACK_AUTOMATION_ENABLED==='on'&&!!input.oauth&&!!input.encryptionKey&&!!identity.accountIdentifier&&!!identity.model&&(input.live||sandboxReady);
 const repo=new SlackAssistantRepo(input.pool,policy,{appId:input.oauth?.appId??env.MYSLACK_APP_ID??'disabled',automationEnabled:available,timezone:env.APP_TIME_ZONE},artifacts);
 const proposals=new SlackProposalService({pool:input.pool,repo,artifacts,plans:new PlanRepo(input.pool,lineage),messages:new MessageRepo(input.pool,lineage),policy,invalidation});
 const digests=new SlackDigestService({pool:input.pool,repo,artifacts,policy});
 if(!available)return {repo,artifacts,proposals,digests,runner:undefined};
 // A dedicated provider is created from the very same frozen environment used by F1; never the canned sandbox planner.
 const provider=createProviderFromEnv({...env,LLM_PROVIDER:env.LLM_PROVIDER?.trim().toLowerCase(),LLM_MODEL:identity.model,GEMINI_MODEL:identity.model});
 const connections=new SlackConnectionRepo(input.pool,invalidation);
 const endpoint=new URL(input.oauth!.apiBaseUrl),apiBaseUrl=!input.live&&endpoint.pathname==='/api'?endpoint.origin:input.oauth!.apiBaseUrl;
 const wrapper=new SlackPrivateReadWrapper({policyService:policy,invalidationService:invalidation,ownerGate:connections,tokenManager:new SlackTokenManager(connections,new SlackOAuthClient(input.oauth!),input.encryptionKey),runtimeConfig:{env},apiBaseUrl});
 const worker=new SlackTriageWorker({repo,wrapper,policy,planner:new SlackTriagePlanner(provider),workerId:input.workerId??'slack-assistant'});
 const runner=new SlackLifecycleValidationRunner({runOnce:async(limit?:number,signal?:AbortSignal)=>{const stats=await worker.runOnce(limit,signal);await digests.runDueDigests(new Date(),signal).catch(()=>{});return stats;}},{intervalMs:input.intervalMs});return {repo,artifacts,proposals,digests,runner};
}
