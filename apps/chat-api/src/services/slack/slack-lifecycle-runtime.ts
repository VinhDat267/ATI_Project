import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { slackIngressEnv } from '../../config/slack-ingress-env.js';
import { slackLifecycleApiBaseUrl } from '../../config/slack-env.js';
import { SlackLifecycleValidationRepo } from '../../db/repositories/slack-lifecycle-validation-repo.js';
import { SlackIdentityClient, SlackRefreshClient } from './oauth-client.js';
import { SlackInvalidationService } from './slack-invalidation-service.js';
import { SlackLifecycleValidationWorker } from './slack-lifecycle-validation-worker.js';

type Stats=Awaited<ReturnType<SlackLifecycleValidationWorker['runOnce']>>;
interface RunnerOptions { intervalMs?:number; stopGraceMs?:number; onError?:(code:'SLACK_LIFECYCLE_SWEEP_FAILED')=>void }
interface RuntimeOptions extends RunnerOptions {
  pool?:pg.Pool;
  encryptionKey:string;
  env:Record<string,string|undefined>;
  live:boolean;
  workerId?:string;
}
/** Nonoverlapping native supervision. Stop requests abort and bounds our wait;
 * a blocked database claim may settle later with only an expiring metadata lease. */
export class SlackLifecycleValidationRunner {
  private readonly intervalMs:number;
  private readonly graceMs:number;
  private running=false;
  private timer?:ReturnType<typeof setInterval>;
  private current?:Promise<Stats>;
  private controller?:AbortController;
  constructor(private readonly worker:Pick<SlackLifecycleValidationWorker,'runOnce'>,private readonly options:RunnerOptions={}) {
    this.intervalMs=options.intervalMs??5000;this.graceMs=options.stopGraceMs??3000;
    if(!Number.isSafeInteger(this.intervalMs) || this.intervalMs<10 || this.intervalMs>60_000 ||
       !Number.isSafeInteger(this.graceMs) || this.graceMs<1 || this.graceMs>10_000) throw new TypeError('Invalid lifecycle runtime bounds');
  }
  isRunning():boolean {return this.running;}
  start():void {
    if(this.running) return;
    this.running=true;
    const sweep=()=>{void this.tick().catch(()=>this.options.onError?.('SLACK_LIFECYCLE_SWEEP_FAILED'));};
    this.timer=setInterval(sweep,this.intervalMs);this.timer.unref();sweep();
  }
  tick():Promise<Stats> {
    if(this.current) return this.current;
    if(!this.running) return Promise.resolve({claimed:0,applied:0,retried:0});
    this.controller=new AbortController();
    const task=this.worker.runOnce(5,this.controller.signal);this.current=task;
    void task.finally(()=>{if(this.current===task){this.current=undefined;this.controller=undefined;}}).catch(()=>{});
    return task;
  }
  async stop():Promise<void> {
    this.running=false;if(this.timer){clearInterval(this.timer);this.timer=undefined;}
    this.controller?.abort();
    const pending=this.current;if(!pending) return;
    let timer:ReturnType<typeof setTimeout>|undefined;
    try {await Promise.race([pending.catch(()=>{}),new Promise<void>(resolve=>{timer=setTimeout(resolve,this.graceMs);})]);}
    finally {if(timer) clearTimeout(timer);}
  }
}

/** Requires retained ingress configuration, not OAuth/content enablement. */
export function createSlackLifecycleRuntime(options:RuntimeOptions):SlackLifecycleValidationRunner|undefined {
  if(!options.pool || !options.encryptionKey) return undefined;
  const ingress=slackIngressEnv(options.env,options.live);
  if(!ingress) return undefined;
  const apiBaseUrl=slackLifecycleApiBaseUrl(options.env,options.live);
  if(!apiBaseUrl) return undefined;
  const clientId=options.env.MYSLACK_OAUTH_CLIENT_ID?.trim(),clientSecret=options.env.MYSLACK_OAUTH_CLIENT_SECRET?.trim();
  const worker=new SlackLifecycleValidationWorker({pool:options.pool,jobs:new SlackLifecycleValidationRepo(options.pool),
    oauth:new SlackIdentityClient(apiBaseUrl),invalidation:new SlackInvalidationService(options.pool),
    ...(clientId && clientSecret?{rotation:{appId:ingress.appId,client:new SlackRefreshClient(apiBaseUrl,clientId,clientSecret)}}:{}),
    encryptionKey:options.encryptionKey,workerId:options.workerId??`slack-validation-${randomUUID()}`});
  return new SlackLifecycleValidationRunner(worker,options);
}
