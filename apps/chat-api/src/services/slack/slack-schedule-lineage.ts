import type pg from 'pg';
import {messageOriginAllowed,sealMessageOrigin} from './slack-message-origin.js';
import type {DerivedSegmentInput} from '../../db/repositories/slack-derived-lineage-repo.js';
import {SlackDerivedLineageRepo} from '../../db/repositories/slack-derived-lineage-repo.js';
import {SlackPolicyService} from './policy-service.js';
import {hasSlackMarker,messageFingerprint,messageOutputSelectors,SLACK_MESSAGE_TOMBSTONE} from './slack-message-selectors.js';
import {uniqueSegments} from './slack-plan-lineage.js';
import {sameSlackBinding,slackPolicyRefToEpoch,validateSlackPolicyReference,validateSlackSourceRef} from '@wap/tool-schemas';
import {acquireSlackInvalidationLocks,slackSourceWriteLockKeys} from './slack-invalidation-service.js';

type Table='schedules'|'schedule_runs'|'conversations'|'messages';
type Purpose='planning'|'manual_lookup';
const contextKey=Symbol('server schedule source context');
export function scheduleSourceContext(value:unknown):{segments:DerivedSegmentInput[];selectors:string[]}|undefined {
  const context=value && (value as any)[contextKey];return context?structuredClone(context):undefined;
}
export function tagScheduleContext<T extends object>(value:T,segments:DerivedSegmentInput[]):T {
  if(segments.length)Object.defineProperty(value,contextKey,{value:{segments:uniqueSegments(segments),selectors:[]}});return value;
}
export interface ScheduleArtifactState {table:Table;id:string;row:any;convId:string;owner:string;copies:any[];segments:DerivedSegmentInput[];source:boolean}
export function scheduleRegistry(pool:pg.Pool){return new SlackDerivedLineageRepo(pool,new SlackPolicyService(pool));}

/** Metadata-only snapshot. The caller prelocks the union of ALL states before parents. */
export async function captureScheduleArtifact(client:pg.PoolClient,registry:SlackDerivedLineageRepo,table:Table,id:string):Promise<ScheduleArtifactState|null> {
  const query=table==='conversations'?'SELECT a.*,a.xmin::text AS revision,a.id AS root_conv,a.user_id AS owner FROM conversations a WHERE a.id=$1':
    table==='schedule_runs'?'SELECT a.*,a.xmin::text AS revision,s.conv_id AS root_conv,s.user_id AS owner FROM schedule_runs a JOIN schedules s ON s.id=a.schedule_id WHERE a.id=$1':
    `SELECT a.*,a.xmin::text AS revision,a.conv_id AS root_conv,v.user_id AS owner FROM ${table} a JOIN conversations v ON v.id=a.conv_id WHERE a.id=$1`;
  const row=(await client.query(query,[id])).rows[0];if(!row)return null;
  const kinds=table==='messages'?['chat_history_message','working_memory_entity']:['scheduled_workflow_arg'];
  const copies=(await client.query('SELECT * FROM slack_derived_copies WHERE target_id=$1 AND target_kind=ANY($2::text[]) ORDER BY id',[id,kinds])).rows;
  const segments:DerivedSegmentInput[]=[];
  for(const c of copies.filter(c=>c.status==='active'))segments.push(...await registry.segmentsInTransaction(client,c.id));
  return {table,id,row,convId:row.root_conv,owner:row.owner,copies,segments:uniqueSegments(segments),source:row.slack_lineage_manifest!=null||copies.length>0||hasSlackMarker(row)};
}
export async function prelockScheduleArtifacts(client:pg.PoolClient,_registry:SlackDerivedLineageRepo,states:Array<ScheduleArtifactState|null>):Promise<void> {
  const present=states.filter((s):s is ScheduleArtifactState=>!!s);
  // A transaction never mixes owners; reject rather than lock a new authority late.
  if(new Set(present.map(s=>s.owner)).size>1)throw Error('SLACK_SCHEDULE_UNAVAILABLE');
  const segments=uniqueSegments(present.flatMap(s=>s.segments));
  // Lock preparation does not authorize consumption. Expired persisted segments
  // must still take their source keys so the mandatory read guard can deny them
  // under the same ordering; it never refreshes retention or grants a read.
  const keys=segments.flatMap(s=>{
    const source=validateSlackSourceRef(s.sourceRef),policy=validateSlackPolicyReference(s.storagePolicyRef);
    if(source.binding.atiUserId!==present[0]!.owner||!sameSlackBinding(source.binding,policy.binding))throw Error('SLACK_SCHEDULE_UNAVAILABLE');
    let channel=s.channelId;
    if(source.resourceType==='message'){
      const tuple=JSON.parse(source.resourceId);
      if(!Array.isArray(tuple)||tuple.length!==2||typeof tuple[0]!=='string'||typeof tuple[1]!=='string'||JSON.stringify(tuple)!==source.resourceId||(channel!==undefined&&channel!==tuple[0]))throw Error('SLACK_SCHEDULE_UNAVAILABLE');
      channel=tuple[0];
    }else if(source.resourceType==='conversation')channel=source.resourceId;
    return slackSourceWriteLockKeys({binding:source.binding,epoch:slackPolicyRefToEpoch(policy),resourceType:source.resourceType,resourceId:source.resourceId,channelId:channel});
  });
  await acquireSlackInvalidationLocks(client,keys);
}
function copyIdentity(c:any){return [c.id,c.ati_user_id,c.target_version,c.target_fingerprint,c.target_sub_id,c.target_kind,c.status,c.retired_reason];}
export async function guardScheduleArtifact(client:pg.PoolClient,registry:SlackDerivedLineageRepo,state:ScheduleArtifactState,purpose:Purpose='planning',mode:'SHARE'|'UPDATE'='SHARE'):Promise<{row:any;allowed:boolean;source:boolean;segments:DerivedSegmentInput[]}> {
  await client.query(`SELECT id FROM conversations WHERE id=$1 AND user_id=$2 FOR ${mode}`,[state.convId,state.owner]);
  const row=(await client.query(`SELECT *,xmin::text AS revision FROM ${state.table} WHERE id=$1 FOR ${mode}`,[state.id])).rows[0];
  if(!row)throw Error('SLACK_SCHEDULE_UNAVAILABLE');
  const current=(await client.query('SELECT * FROM slack_derived_copies WHERE target_id=$1 AND target_kind=ANY($2::text[]) ORDER BY id',[state.id,state.table==='messages'?['chat_history_message','working_memory_entity']:['scheduled_workflow_arg']])).rows;
  if((state.source&&row.revision!==state.row.revision)||(!state.source&&(row.slack_lineage_manifest!=null||hasSlackMarker(row)))||JSON.stringify(current.map(copyIdentity))!==JSON.stringify(state.copies.map(copyIdentity)))throw Error('SLACK_SCHEDULE_CHANGED');
  for(const c of current.filter(c=>c.status==='active')){
    const fresh=await registry.segmentsInTransaction(client,c.id);
    if(fresh.some(s=>!state.segments.some(old=>JSON.stringify(old)===JSON.stringify(s))))throw Error('SLACK_SCHEDULE_CHANGED');
  }
  if((state.table==='conversations'||state.table==='messages')&&!await messageOriginAllowed(client,state.table,row,state.owner))return {row:maskScheduleArtifact(row,state.table),allowed:false,source:state.source,segments:[]};
  if(!state.source)return {row,allowed:true,source:false,segments:[]};
  // Human rename is a server-written certificate, never client provenance. Old
  // purged evidence stays immutable and cannot invalidate an unrelated new title.
  if(state.table==='conversations' && row.slack_title_manual_fingerprint===messageFingerprint(row.title,'title') &&
    !current.some(c=>c.status==='active'))return {row,allowed:true,source:false,segments:[]};
  const manifest=row.slack_lineage_manifest;
  const required=state.table==='schedules'?['name','request','recurrence']:state.table==='conversations'?['title']:
    state.table==='messages'?messageOutputSelectors(row):row.error==null?[]:['error'];
  let allowed=state.segments.length>0&&Array.isArray(manifest)&&manifest.length>0&&manifest.length<=256&&new Set(manifest).size===manifest.length&&required.every(s=>manifest.includes(s))&&
    !current.some(c=>c.status==='active'&&!manifest.includes(c.target_sub_id));
  if(allowed)for(const selector of manifest){
    const c=current.find(c=>c.status==='active'&&c.target_sub_id===selector&&c.ati_user_id===state.owner);
    if(!c||(await registry.assertDerivedCopyAllowedInTransaction(client,{callerAtiUserId:state.owner,consumerPurpose:purpose,targetKind:c.target_kind,targetId:state.id,targetSubId:selector,expectedTargetVersion:c.target_version})).status!=='allowed'){allowed=false;break;}
  }
  if(allowed)tagScheduleContext(row,state.segments);
  return {row:allowed?row:maskScheduleArtifact(row,state.table),allowed,source:true,segments:allowed?state.segments:[]};
}
export function maskScheduleArtifact(row:any,table:Table):any {
  if(table==='conversations')return {...row,title:SLACK_MESSAGE_TOMBSTONE};
  if(table==='messages')return {...row,content:SLACK_MESSAGE_TOMBSTONE,metadata:{type:'slack_source_unavailable'}};
  if(table==='schedule_runs')return {...row,error:row.error==null?null:SLACK_MESSAGE_TOMBSTONE,status:'discarded',plan_id:null,latest_plan_id:null,plan_status:null};
  return {...row,name:SLACK_MESSAGE_TOMBSTONE,request:SLACK_MESSAGE_TOMBSTONE,recurrence:{},status:row.status==='active'?'paused':row.status,pause_reason:'slack_source_invalidated',next_run_at:null};
}
export async function registerScheduleFields(client:pg.PoolClient,registry:SlackDerivedLineageRepo,table:Exclude<Table,'messages'>,id:string,owner:string,segments:DerivedSegmentInput[],selectors:string[]):Promise<void> {
  if(!segments.length){if(table==='conversations')await sealMessageOrigin(client,'conversations',id,'schedule_title');return;}
  await client.query(`UPDATE ${table} SET slack_lineage_manifest=$2 WHERE id=$1`,[id,JSON.stringify(selectors)]);
  if(table==='conversations')await client.query('UPDATE conversations SET slack_title_manual_fingerprint=NULL WHERE id=$1',[id]);
  for(const selector of selectors)await registry.registerDerivedCopyInTransaction(client,{atiUserId:owner,targetKind:'scheduled_workflow_arg',targetId:id,targetSubId:selector,segments});
  if(table==='conversations')await sealMessageOrigin(client,'conversations',id,'schedule_title');
}
/** Own transaction for public reads. Raw fields never escape a failed guard. */
export async function readScheduleArtifact(pool:pg.Pool,table:Table,id:string,purpose:Purpose='manual_lookup') {
  const client=await pool.connect(),registry=scheduleRegistry(pool);let state:ScheduleArtifactState|null=null;
  try{
    await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='5s'");
    state=await captureScheduleArtifact(client,registry,table,id);if(!state){await client.query('COMMIT');return null;}
    await prelockScheduleArtifacts(client,registry,[state]);
    const result=await guardScheduleArtifact(client,registry,state,purpose);await client.query('COMMIT');
    delete result.row.slack_lineage_manifest;delete result.row.slack_title_manual_fingerprint;delete result.row.revision;delete result.row.root_conv;delete result.row.owner;return result.row;
  }catch(error){await client.query('ROLLBACK').catch(()=>{});if(!state)throw error;const safe=maskScheduleArtifact(state.row,table);for(const key of ['slack_lineage_manifest','slack_title_manual_fingerprint','revision','root_conv','owner'])delete safe[key];return safe;}
  finally{client.release();}
}
