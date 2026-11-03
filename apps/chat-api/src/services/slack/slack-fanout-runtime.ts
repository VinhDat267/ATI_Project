import type pg from 'pg';
import {randomUUID} from 'node:crypto';
import {SlackFanoutRepo} from '../../db/repositories/slack-fanout-repo.js';
import {slackIngressEnv} from '../../config/slack-ingress-env.js';
import {slackLifecycleApiBaseUrl} from '../../config/slack-env.js';
import {SlackPolicyService} from './policy-service.js';
import {SlackAuthorizationsResolver} from './slack-authorizations-resolver.js';
import {SlackLifecycleValidationRunner} from './slack-lifecycle-runtime.js';

interface WorkerOptions {repo:SlackFanoutRepo;resolver:SlackAuthorizationsResolver;appId:string;workerId:string}
export class SlackFanoutWorker {
 constructor(private readonly options:WorkerOptions){}
 async runOnce(limit=5,signal?:AbortSignal):Promise<{claimed:number;applied:number;retried:number}>{
  const stats={claimed:0,applied:0,retried:0};if(signal?.aborted)return stats;
  const leases=await this.options.repo.claim(limit,this.options.workerId,60,this.options.appId);stats.claimed=leases.length;
  for(const lease of leases){
   if(signal?.aborted)break;
   let actors:string[]=[];
   if(lease.eventType==='message'&&lease.eventSubtype===null&&lease.channelId&&lease.messageTs&&lease.eventContext?.trim()){
    try{actors=await this.options.resolver.resolve(lease.eventContext,lease.workspaceId,signal);}
    catch{if(await this.options.repo.retry(lease,signal?.aborted?'aborted':'authorization_failed'))stats.retried++;continue;}
   }
   try{const result=await this.options.repo.complete(lease,actors,signal);if(result.backlogFull)stats.retried++;else stats.applied++;}
   catch{if(await this.options.repo.retry(lease,signal?.aborted?'aborted':'fanout_failed'))stats.retried++;}
  }
  return stats;
 }
}
interface Options {pool?:pg.Pool;env:Record<string,string|undefined>;live:boolean;workerId?:string;intervalMs?:number;stopGraceMs?:number;onError?:(code:'SLACK_FANOUT_SWEEP_FAILED')=>void}
/** No body/content is recovered here. Source/model work belongs to05 under freshly checked authority. */
export async function createSlackFanoutRuntime(options:Options):Promise<SlackLifecycleValidationRunner|undefined>{
 const ingress=slackIngressEnv(options.env,options.live);if(!options.pool||!ingress)return undefined;
 const repo=new SlackFanoutRepo(options.pool,new SlackPolicyService(options.pool,{env:options.env}));
 const token=options.env.MYSLACK_APP_TOKEN;
 if(!ingress.automationEnabled){await repo.setRuntime(ingress.appId,false);return undefined;}
 const apiBaseUrl=slackLifecycleApiBaseUrl(options.env,options.live);
 if(!token||!apiBaseUrl){await repo.setRuntime(ingress.appId,false);if(options.live)throw new Error('SLACK_AUTHORIZATIONS_CONFIG_INVALID');return undefined;}
 const resolver=new SlackAuthorizationsResolver({appToken:token,apiBaseUrl});
 await repo.setRuntime(ingress.appId,true);
 const worker=new SlackFanoutWorker({repo,resolver,appId:ingress.appId,workerId:options.workerId??'slack-fanout-'+randomUUID()});
 return new SlackLifecycleValidationRunner(worker,{intervalMs:options.intervalMs,stopGraceMs:options.stopGraceMs,onError:()=>options.onError?.('SLACK_FANOUT_SWEEP_FAILED')});
}
