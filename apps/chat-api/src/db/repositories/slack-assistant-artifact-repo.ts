import {createHash,randomUUID} from 'node:crypto';
import type pg from 'pg';
import {sameSlackBinding,validateSlackAssistantVersion,type SlackTriageDecision} from '@wap/tool-schemas';
import type {SlackPolicyService} from '../../services/slack/policy-service.js';
import {sealMessageOrigin} from '../../services/slack/slack-message-origin.js';
import {slackArtifactValue} from '../../services/slack/slack-artifact-targets.js';
import {SlackDerivedLineageRepo,type DerivedSegmentInput} from './slack-derived-lineage-repo.js';
import type {SlackTriageLease,SlackProposalContext,SlackProposalWriter} from './slack-assistant-repo.js';
import {isUuid} from './uuid.js';
type Decision=Exclude<SlackTriageDecision,{kind:'no_action'}>;
export interface SlackProposalView {id:string;connectionId:string;convId:string;revision:string;status:string;activePlanId:string|null;planHash:string|null;body:any|null;createdAt:string}
/** One registered body selector contains every source-derived byte, including labels and references. */
export class SlackAssistantArtifactRepo implements SlackProposalWriter {
 private readonly lineage:SlackDerivedLineageRepo;
 constructor(private readonly pool:pg.Pool,policy:SlackPolicyService){this.lineage=new SlackDerivedLineageRepo(pool,policy);}
 private dedupe(lease:SlackTriageLease,decision:Decision,context:SlackProposalContext[]){return createHash('sha256').update(JSON.stringify({binding:lease.binding,configVersion:lease.configVersion,sources:context.map(m=>[m.channelId,m.ts]),decision})).digest('hex');}
 async prepareProposalInTransaction(c:pg.PoolClient,lease:SlackTriageLease,decision:Decision,context:SlackProposalContext[]):Promise<void>{
  const existing=(await c.query("SELECT conv_id FROM slack_assistant_artifacts WHERE connection_id=$1 AND kind='proposal_excerpt' AND dedupe_hash=$2 AND user_id=$3",[lease.binding.connectionId,this.dedupe(lease,decision,context),lease.binding.atiUserId])).rows[0];
  if(existing)await c.query('SELECT id FROM conversations WHERE id=$1 AND user_id=$2 FOR UPDATE',[existing.conv_id,lease.binding.atiUserId]);
 }
 async publishProposalInTransaction(c:pg.PoolClient,lease:SlackTriageLease,decision:Decision,segments:DerivedSegmentInput[],context:SlackProposalContext[],truncated:boolean):Promise<string>{
  await c.query('SAVEPOINT assistant_artifact_tx_guard');await c.query('RELEASE SAVEPOINT assistant_artifact_tx_guard');
  if(!context.length||context.length>20||context.reduce((n,m)=>n+m.text.length,0)>20000||typeof truncated!=='boolean'||segments.length===0||segments.some(s=>!sameSlackBinding(s.sourceRef.binding,lease.binding)||s.acquisitionPolicyRef.purpose!=='triage'||s.storagePolicyRef.requestedRetentionDays>lease.config.retentionDays))throw new Error('SLACK_PROPOSAL_SOURCE_REQUIRED');
  for(const m of context)if(!segments.some(s=>s.sourceRef.resourceType==='message'&&s.sourceRef.resourceId===JSON.stringify([m.channelId,m.ts])))throw new Error('SLACK_PROPOSAL_SOURCE_REQUIRED');
  for(const t of lease.triggers)if(!context.some(m=>m.channelId===t.channelId&&m.ts===t.messageTs))throw new Error('SLACK_PROPOSAL_SOURCE_REQUIRED');
  const dedupe=this.dedupe(lease,decision,context),owner=lease.binding.atiUserId;
  const existing=(await c.query("SELECT id FROM slack_assistant_artifacts WHERE connection_id=$1 AND kind='proposal_excerpt' AND dedupe_hash=$2 AND user_id=$3",[lease.binding.connectionId,dedupe,owner])).rows[0];
  if(existing){const copy=await this.lineage.getActiveCopyInTransaction(c,{atiUserId:owner,targetKind:'proposal_excerpt',targetId:existing.id,targetSubId:'body_json'});if(!copy||(await this.lineage.assertDerivedCopyAllowedInTransaction(c,{callerAtiUserId:owner,consumerPurpose:'triage',targetKind:'proposal_excerpt',targetId:existing.id,targetSubId:'body_json',expectedTargetVersion:copy.targetVersion})).status!=='allowed')throw new Error('SLACK_PROPOSAL_STALE');return existing.id;}
  const conv=(await c.query("INSERT INTO conversations(user_id,status,title) VALUES($1,'chatting','Đề xuất Slack') RETURNING id",[owner])).rows[0].id;
  await sealMessageOrigin(c,'conversations',conv,'conversation_create');
  await this.lineage.prepareConversationWriteInTransaction(c,conv,owner,segments,'triage');
  const id=randomUUID(),body={artifactId:id,binding:lease.binding,configVersion:lease.configVersion,payloadRevision:'1',decision,context,truncated};
  await c.query(`INSERT INTO slack_assistant_artifacts(id,kind,user_id,connection_id,workspace_id,slack_user_id,identity_version,conv_id,config_version,status,dedupe_hash,body_json)
   VALUES($1,'proposal_excerpt',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[id,owner,lease.binding.connectionId,lease.binding.workspaceId,lease.binding.slackUserId,lease.binding.identityVersion,conv,lease.configVersion,decision.kind==='needs_clarification'?'needs_info':'pending',dedupe,JSON.stringify(body)]);
  await this.lineage.registerDerivedCopyInTransaction(c,{atiUserId:owner,targetKind:'proposal_excerpt',targetId:id,targetSubId:'body_json',segments});return id;
 }
 async list(owner:string,connectionId:string):Promise<SlackProposalView[]>{
  if(!isUuid(owner)||!isUuid(connectionId))return [];
  const rows=(await this.pool.query("SELECT id FROM slack_assistant_artifacts WHERE user_id=$1 AND connection_id=$2 AND kind='proposal_excerpt' ORDER BY created_at DESC,id LIMIT 100",[owner,connectionId])).rows;
  return Promise.all(rows.map(r=>this.get(owner,r.id,'triage')));
 }
 async get(owner:string,id:string,purpose:'planning'|'digest'|'triage'):Promise<SlackProposalView>{
  if(!isUuid(owner)||!isUuid(id))throw new Error('SLACK_PROPOSAL_NOT_FOUND');const c=await this.pool.connect();
  try{await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='5s'");
   let row=(await c.query("SELECT * FROM slack_assistant_artifacts WHERE id=$1 AND user_id=$2 AND kind='proposal_excerpt'",[id,owner])).rows[0];if(!row)throw new Error('SLACK_PROPOSAL_NOT_FOUND');
   const target={atiUserId:owner,targetKind:'proposal_excerpt' as const,targetId:id,targetSubId:'body_json'};
   const copy=await this.lineage.getActiveCopyInTransaction(c,target);
   const allowed=!!copy&&(await this.lineage.assertDerivedCopyAllowedInTransaction(c,{callerAtiUserId:owner,consumerPurpose:purpose,targetKind:'proposal_excerpt',targetId:id,targetSubId:'body_json',expectedTargetVersion:copy.targetVersion})).status==='allowed';
   row=(await c.query("SELECT a.*,a.review_expires_at>clock_timestamp() AS review_current,cfg.version AS current_config_version,p.plan_hash AS active_plan_hash FROM slack_assistant_artifacts a LEFT JOIN slack_workspace_configs cfg ON cfg.connection_id=a.connection_id LEFT JOIN plans p ON p.id=a.active_plan_id WHERE a.id=$1 AND a.user_id=$2 FOR SHARE OF a",[id,owner])).rows[0];if(!row)throw new Error('SLACK_PROPOSAL_NOT_FOUND');
   let body:any=null;if(allowed&&row.review_current&&row.config_version===row.current_config_version){try{body=slackArtifactValue(row,'proposal_excerpt','body_json');if(body?.__slack_purged)body=null;}catch{body=null;}}
   const view={id:row.id,connectionId:row.connection_id,convId:row.conv_id,revision:row.revision,status:body?row.status:'stale',activePlanId:body?row.active_plan_id??null:null,planHash:body?row.active_plan_hash??null:null,body,createdAt:row.created_at.toISOString()};await c.query('COMMIT');return view;
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 async getSegmentsInTransaction(c:pg.PoolClient,owner:string,id:string,purpose:'planning'|'digest'|'triage'):Promise<DerivedSegmentInput[]>{
  if(!isUuid(owner)||!isUuid(id))throw new Error('SLACK_PROPOSAL_NOT_FOUND');
  const target={atiUserId:owner,targetKind:'proposal_excerpt' as const,targetId:id,targetSubId:'body_json'};
  const copy=await this.lineage.getActiveCopyInTransaction(c,target);
  if(!copy||(await this.lineage.assertDerivedCopyAllowedInTransaction(c,{callerAtiUserId:owner,consumerPurpose:purpose,targetKind:'proposal_excerpt',targetId:id,targetSubId:'body_json',expectedTargetVersion:copy.targetVersion})).status!=='allowed')throw new Error('SLACK_PROPOSAL_STALE');
  return this.lineage.segmentsInTransaction(c,copy.derivedCopyId);
 }
 async reject(owner:string,id:string,revision:string):Promise<{status:'rejected';revision:string;proposal:SlackProposalView}>{
  if(!isUuid(owner)||!isUuid(id))throw new Error('SLACK_PROPOSAL_NOT_FOUND');validateSlackAssistantVersion(revision);
  const c=await this.pool.connect();
  try{
   await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='5s'");
   const existing=(await c.query("SELECT id,conv_id,revision,status FROM slack_assistant_artifacts WHERE id=$1 AND user_id=$2 AND kind='proposal_excerpt' FOR UPDATE",[id,owner])).rows[0];
   if(!existing)throw new Error('SLACK_PROPOSAL_NOT_FOUND');
   if(existing.revision!==revision||!['pending','needs_info','awaiting_approval'].includes(existing.status))throw new Error('SLACK_PROPOSAL_VERSION_CONFLICT');
   await c.query("UPDATE plans SET status='superseded',decided_at=clock_timestamp() WHERE conv_id=$1 AND status='pending'",[existing.conv_id]);
   const row=(await c.query("UPDATE slack_assistant_artifacts SET status='rejected',active_plan_id=NULL,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND user_id=$2 AND revision=$3 RETURNING revision",[id,owner,revision])).rows[0];
   if(!row)throw new Error('SLACK_PROPOSAL_VERSION_CONFLICT');
   await c.query('COMMIT');
   const proposal=await this.get(owner,id,'triage');
   return {status:'rejected',revision:row.revision,proposal};
  }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
 }
}
