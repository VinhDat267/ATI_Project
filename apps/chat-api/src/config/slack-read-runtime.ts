import type pg from 'pg';
import type {LLMProvider} from '@wap/planner';
import type {PlanRepo} from '../db/repositories/plan-repo.js';
import type {StepRepo} from '../db/repositories/step-repo.js';
import {SlackConnectionRepo} from '../db/repositories/slack-connection-repo.js';
import {SlackOAuthClient,type SlackOAuthConfig} from '../services/slack/oauth-client.js';
import {SlackTokenManager} from '../services/slack/token-manager.js';
import {SlackPolicyService} from '../services/slack/policy-service.js';
import {SlackInvalidationService} from '../services/slack/slack-invalidation-service.js';
import {SlackPrivateReadWrapper} from '../services/slack/slack-private-read-wrapper.js';
import {SlackReadPlanBindings} from '../services/slack/slack-plan-bindings.js';
import {SlackReadRuntime} from '../services/slack/slack-read-runtime.js';
import {SlackReadProposalService} from '../services/slack/slack-read-proposals.js';
/** Public reads exist only with the same explicit personal OAuth configuration and PostgreSQL. */
export function createPersonalSlackReadRuntime(input:{pool?:pg.Pool;oauth?:SlackOAuthConfig;encryptionKey:string;plans:PlanRepo;steps:StepRepo;provider:LLMProvider;env:Record<string,string|undefined>}){
 if(!input.pool||!input.oauth||input.env.MYSLACK_ENABLED!=='on')return undefined;
 const invalidation=new SlackInvalidationService(input.pool),connections=new SlackConnectionRepo(input.pool,invalidation),policy=new SlackPolicyService(input.pool,{env:input.env});
 const binder=new SlackReadPlanBindings(connections,policy,invalidation);
 // OAuth fixtures include /api; the read adapter's loopback contract takes an origin.
 const endpoint=new URL(input.oauth.apiBaseUrl);
 const apiBaseUrl=endpoint.protocol==='http:'&&['127.0.0.1','localhost'].includes(endpoint.hostname)&&endpoint.pathname==='/api'&&!endpoint.username&&!endpoint.password&&!endpoint.search&&!endpoint.hash?endpoint.origin:input.oauth.apiBaseUrl;
 const wrapper=new SlackPrivateReadWrapper({policyService:policy,tokenManager:new SlackTokenManager(connections,new SlackOAuthClient(input.oauth),input.encryptionKey),invalidationService:invalidation,ownerGate:connections,runtimeConfig:{env:input.env},apiBaseUrl});
 return {execution:new SlackReadRuntime({binder,wrapper,plans:input.plans,steps:input.steps,policy,invalidation}),proposals:new SlackReadProposalService({connections,policy,binder,provider:input.provider})};
}
