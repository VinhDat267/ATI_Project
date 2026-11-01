import type pg from 'pg';
import type { DerivedSegmentInput,SlackDerivedLineageRepo } from '../../db/repositories/slack-derived-lineage-repo.js';
import { hasSlackMarker } from './slack-message-selectors.js';
import { JSON_TOMBSTONE,PLAN_TOMBSTONE,PLAN_TOMBSTONE_TEXT,redactPlanRow } from './slack-artifact-targets.js';
import { planOriginAllowed } from './slack-plan-origin.js';
import {isBoundSlackManualPlan} from './slack-write-plan.js';

export interface SlackPlanWriteContext {segments:DerivedSegmentInput[];selectors?:string[]}
const sourceBound=Symbol('server source-bound plan/step');
export function isSlackSourceArtifact(row:unknown):boolean{return !!row && (row as any)[sourceBound]===true;}
export function tagSlackSourceArtifact<T extends object>(row:T):T{Object.defineProperty(row,sourceBound,{value:true});return row;}
export function uniqueSegments(segments:DerivedSegmentInput[]):DerivedSegmentInput[]{return [...new Map(segments.map(s=>[JSON.stringify(s),s])).values()];}
export function planSelectors(data:{resourceLabels?:Record<string,string>}):string[]{return ['plan_json','plan_text','plan_hash',...Object.keys(data.resourceLabels??{}).map(k=>`resource_labels/${encodeURIComponent(k)}`)];}

/** Caller transaction keeps all source/parent locks through artifact read or mutation. */
export async function guardPlanInTransaction(client:pg.PoolClient,registry:SlackDerivedLineageRepo,id:string,purpose:'planning'|'manual_lookup'='planning') {
  const first=(await client.query('SELECT p.*,p.xmin::text AS revision,v.user_id FROM plans p JOIN conversations v ON v.id=p.conv_id WHERE p.id=$1',[id])).rows[0];
  if(!first)throw new Error('PLAN_NOT_FOUND');
  const copies=(await client.query(`SELECT * FROM slack_derived_copies WHERE
    (target_kind='plan_step_arg' AND target_id=$1 AND target_sub_id<>'args_json') OR
    (target_kind IN ('plan_step_arg','audit_log_entry') AND target_id IN(SELECT id::text FROM execution_steps WHERE plan_id=$1::uuid))
    ORDER BY id`,[id])).rows;
  const planCopies=copies.filter(c=>c.target_id===id&&c.target_kind==='plan_step_arg'&&c.target_sub_id!=='args_json');
  const source=first.slack_lineage_manifest!=null||copies.length>0||(!isBoundSlackManualPlan(first.plan_json,first.user_id)&&hasSlackMarker(first.plan_json))||hasSlackMarker(first.resource_labels);
  if(!source){
    const owner=first.user_id as string;
    const certified=await planOriginAllowed(client,'plans',first,owner);
    delete first.user_id;delete first.slack_lineage_manifest;
    if(!certified){
      const row={...first,plan_json:structuredClone(PLAN_TOMBSTONE),plan_text:PLAN_TOMBSTONE_TEXT};
      return {row,source:false,allowed:false,segments:[] as DerivedSegmentInput[],copies};
    }
    return {row:first,source:false,allowed:true,segments:[] as DerivedSegmentInput[],copies};
  }
  const segments:DerivedSegmentInput[]=[];
  for(const c of copies.filter(c=>c.status==='active'))segments.push(...await registry.segmentsInTransaction(client,c.id));
  const union=uniqueSegments(segments);
  try {
    if(union.length===0)throw new Error('SLACK_PLAN_UNAVAILABLE');
    await registry.prepareConversationWriteInTransaction(client,first.conv_id,first.user_id,union,purpose);
    const row=(await client.query('SELECT *,xmin::text AS revision FROM plans WHERE id=$1 FOR SHARE',[id])).rows[0];
    const manifest=row.slack_lineage_manifest;
    if(JSON.stringify(manifest)!==JSON.stringify(first.slack_lineage_manifest)||!Array.isArray(manifest)||
      manifest.length<3||manifest.length>256||new Set(manifest).size!==manifest.length||
      !['plan_json','plan_text','plan_hash'].every(s=>manifest.includes(s))||
      planCopies.some(c=>c.status==='active'&&!manifest.includes(c.target_sub_id)))throw new Error('SLACK_PLAN_UNAVAILABLE');
    const current=(await client.query(`SELECT id FROM slack_derived_copies WHERE target_id=$1 AND target_kind='plan_step_arg' AND status='active' ORDER BY id`,[id])).rows.map(r=>r.id);
    if(JSON.stringify(current)!==JSON.stringify(planCopies.filter(c=>c.status==='active').map(c=>c.id).sort()))throw new Error('SLACK_PLAN_UNAVAILABLE');
    for(const selector of manifest){
      const c=planCopies.find(c=>c.target_sub_id===selector&&c.status==='active'&&c.ati_user_id===first.user_id);
      if(!c||(await registry.assertDerivedCopyAllowedInTransaction(client,{callerAtiUserId:first.user_id,consumerPurpose:purpose,targetKind:'plan_step_arg',targetId:id,targetSubId:selector,expectedTargetVersion:c.target_version})).status!=='allowed')throw new Error('SLACK_PLAN_UNAVAILABLE');
    }
    delete row.slack_lineage_manifest;tagSlackSourceArtifact(row);
    const sourceSegments:DerivedSegmentInput[]=[];
    for(const c of planCopies.filter(c=>c.status==='active'))sourceSegments.push(...await registry.segmentsInTransaction(client,c.id));
    return {row,source:true,allowed:true,segments:uniqueSegments(sourceSegments),copies};
  }catch(error){
    // SQL failures abort the outer transaction. Authorization/TTL failures only
    // produce a tombstone snapshot, never the raw source row.
    if(error && typeof error==='object' && 'code' in error)throw error;
    const row=redactPlanRow(first);delete row.user_id;delete row.slack_lineage_manifest;tagSlackSourceArtifact(row);
    return {row,source:true,allowed:false,segments:[] as DerivedSegmentInput[],copies};
  }
}

export async function guardStepRowsInTransaction(client:pg.PoolClient,registry:SlackDerivedLineageRepo,plan:Awaited<ReturnType<typeof guardPlanInTransaction>>,rows:any[],purpose:'planning'|'manual_lookup') {
  if(!plan.source && !rows.some(r=>r.slack_lineage_manifest!=null||hasSlackMarker(r.args_json)||hasSlackMarker(r.output_json)||hasSlackMarker(r.error_json))){
    const owner=(await client.query('SELECT user_id FROM conversations WHERE id=$1',[plan.row.conv_id])).rows[0]?.user_id as string;
    for(let i=0;i<rows.length;i++){
      const row=rows[i];
      const certified=!!owner&&await planOriginAllowed(client,'execution_steps',row,owner);
      if(!certified)rows[i]={...row,status:'unknown',args_json:JSON_TOMBSTONE,output_json:row.output_json==null?null:JSON_TOMBSTONE,error_json:row.error_json==null?null:JSON_TOMBSTONE};
      delete rows[i].slack_lineage_manifest;
    }
    return rows;
  }
  for(let i=0;i<rows.length;i++){
    const row=rows[i],manifest=row.slack_lineage_manifest;
    const fixedRestartError=row.error_json && Object.keys(row.error_json).length===2 && row.error_json.category==='UNKNOWN' && row.error_json.message==='Server restarted while this step was running';
    let allowed=plan.source&&plan.allowed&&Array.isArray(manifest)&&manifest.includes('args_json')&&new Set(manifest).size===manifest.length&&
      (row.output_json==null||manifest.includes('output_json'))&&(row.error_json==null||manifest.includes('error_json')||fixedRestartError);
    if(allowed){
      for(const selector of manifest){
        const kind=selector==='args_json'?'plan_step_arg':'audit_log_entry';
        const c=plan.copies.find(c=>c.target_id===row.id&&c.target_kind===kind&&c.target_sub_id===selector&&c.status==='active');
        if(!c||(await registry.assertDerivedCopyAllowedInTransaction(client,{callerAtiUserId:c.ati_user_id,consumerPurpose:purpose,targetKind:kind,targetId:row.id,targetSubId:selector,expectedTargetVersion:c.target_version})).status!=='allowed'){allowed=false;break;}
      }
      if(plan.copies.some(c=>c.target_id===row.id&&c.status==='active'&&!manifest.includes(c.target_sub_id)))allowed=false;
    }
    const safe=allowed?row:{...row,status:'unknown',args_json:JSON_TOMBSTONE,output_json:row.output_json==null?null:JSON_TOMBSTONE,error_json:row.error_json==null?null:JSON_TOMBSTONE};
    delete safe.slack_lineage_manifest;tagSlackSourceArtifact(safe);rows[i]=safe;
  }
  return rows;
}
