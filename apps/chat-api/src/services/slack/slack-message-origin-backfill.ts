import type pg from 'pg';
import {isUuid} from '../../db/repositories/uuid.js';
import {messageOriginAllowed,messageOriginFingerprint,sealMessageOrigin,type MessageOriginTable} from './slack-message-origin.js';
import {eraseMessageSelector,messageFingerprint,messageSelectorKind,messageSelectorValue,SLACK_MESSAGE_TOMBSTONE} from './slack-message-selectors.js';
import {slackArtifactIsErased} from './slack-artifact-targets.js';

type Options={afterId?:string;limit?:number;apply?:boolean;signal?:AbortSignal};
function empty(value:unknown):boolean{return value!==null&&typeof value==='object'&&Object.values(value).every(v=>v!==null&&typeof v==='object'&&empty(v));}
/** Only literal server control fields and a fully erased source payload remain.
 * Arbitrary other-service text, role=user and absent copies prove nothing. */
function fullyCovered(row:any,table:MessageOriginTable):boolean{
  if(table==='conversations')return true; // selector proof below must cover title
  const remainder=structuredClone({content:row.content,metadata:row.metadata});
  for(const selector of row.slack_lineage_manifest)eraseMessageSelector(remainder,messageSelectorKind(selector),selector);
  if(!['',SLACK_MESSAGE_TOMBSTONE].includes(remainder.content))return false;
  if(remainder.metadata==null)return true;
  if(!remainder.metadata||typeof remainder.metadata!=='object'||Array.isArray(remainder.metadata))return false;
  const {type,state,...rest}=remainder.metadata;
  return Object.keys(rest).length===0&&(['answer','working_memory'].includes(type)||type===undefined)&&
    (state===undefined||type==='working_memory'&&empty(state));
}
/** Bounded explicit maintenance. Each row's private evidence/certificate commits
 * atomically; unknown bytes are neither overwritten nor guessed. */
export class SlackMessageOriginBackfill{
  constructor(private readonly pool:pg.Pool){}
  async page(table:MessageOriginTable,options:Options={}){
    const {afterId,limit=50,apply=false,signal}=options;
    signal?.throwIfAborted();
    if(!['messages','conversations'].includes(table)||!Number.isInteger(limit)||limit<1||limit>200||(afterId!==undefined&&!isUuid(afterId)))throw TypeError('INVALID_ORIGIN_BACKFILL_PAGE');
    const ids=(await this.pool.query(`SELECT id FROM ${table} WHERE ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT $2`,[afterId??null,limit])).rows;
    const counts={scanned:0,alreadyValid:0,eligible:0,quarantined:0,applied:0,nextCursor:ids.length===limit?ids.at(-1).id as string:null};
    for(const {id} of ids){
      signal?.throwIfAborted();const client=await this.pool.connect();
      try{
        await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='5s'");
        const found=(await client.query(table==='messages'?'SELECT conv_id FROM messages WHERE id=$1':'SELECT id AS conv_id FROM conversations WHERE id=$1',[id])).rows[0];
        if(!found){await client.query('COMMIT');continue;}
        const parent=(await client.query('SELECT user_id FROM conversations WHERE id=$1 FOR UPDATE',[found.conv_id])).rows[0];
        const row=(await client.query(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`,[id])).rows[0];
        if(!parent||!row||(table==='messages'&&row.conv_id!==found.conv_id))throw Error('SLACK_ORIGIN_CHANGED');
        counts.scanned++;
        const exists=(await client.query('SELECT 1 FROM slack_message_origins WHERE artifact_table=$1 AND artifact_id=$2',[table,id])).rowCount;
        if(await messageOriginAllowed(client,table,row,parent.user_id))counts.alreadyValid++;
        else if(exists)counts.quarantined++; // never launder a tampered certificate
        else{
          const copies=(await client.query(`SELECT * FROM slack_derived_copies WHERE target_id=$1 AND target_kind=ANY($2::text[]) ORDER BY id`,
            [id,table==='messages'?['chat_history_message','working_memory_entity']:['scheduled_workflow_arg']])).rows;
          const manual=table==='conversations'&&typeof row.title==='string'&&row.slack_title_manual_fingerprint===messageFingerprint(row.title,'title')&&!copies.some(c=>c.status==='active');
          // Legacy registered artifacts may predate the private manifest. Infer
          // only the concrete current selectors whose exact bytes are proven.
          const candidate={...row,slack_lineage_manifest:row.slack_lineage_manifest??copies.filter(c=>c.status==='active').map(c=>c.target_sub_id)};
          let eligible=manual;
          if(!manual)try{
            const selectors=messageOriginFingerprint(table,candidate,parent.user_id).selectors;
            eligible=selectors.length>0&&!copies.some(c=>c.status==='active'&&!selectors.includes(c.target_sub_id))&&selectors.every(selector=>{
              const kind=table==='messages'?messageSelectorKind(selector):'scheduled_workflow_arg';
              const value=table==='messages'?messageSelectorValue(row,kind,selector):row.title;
              const active=copies.find(c=>c.status==='active'&&c.target_sub_id===selector);
              if(active)return active.ati_user_id===parent.user_id&&active.target_kind===kind&&active.target_fingerprint===messageFingerprint(value,selector);
              return copies.some(c=>c.status==='purged'&&c.ati_user_id===parent.user_id&&c.target_kind===kind&&c.target_sub_id===selector)&&slackArtifactIsErased(value,kind,selector);
            })&&fullyCovered(candidate,table);
          }catch{eligible=false;}
          if(!eligible)counts.quarantined++;
          else{
            counts.eligible++;
            if(apply){
              if(!manual&&row.slack_lineage_manifest==null)await client.query(`UPDATE ${table} SET slack_lineage_manifest=$2 WHERE id=$1`,[id,JSON.stringify(candidate.slack_lineage_manifest)]);
              await sealMessageOrigin(client,table,id,manual?'backfill_manual':'backfill_covered');counts.applied++;
            }
          }
        }
        signal?.throwIfAborted();await client.query('COMMIT');
      }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
    }
    return counts;
  }
}
