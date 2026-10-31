import type pg from 'pg';
import {eraseMessageSelector,messageFingerprint,messageSelectorKind,validateMessageSelector} from './slack-message-selectors.js';

export type MessageOriginTable='messages'|'conversations';
type Producer='message_writer'|'title_first_user'|'conversation_create'|'title_manual'|'schedule_title'|'backfill_covered'|'backfill_manual';
const cutover='message-origin-v1';
function manifest(row:any,table:MessageOriginTable):string[]{
  const selectors=row.slack_lineage_manifest??[];
  if(!Array.isArray(selectors)||selectors.length>256||new Set(selectors).size!==selectors.length)throw Error('SLACK_ORIGIN_UNAVAILABLE');
  for(const selector of selectors){
    if(typeof selector!=='string')throw Error('SLACK_ORIGIN_UNAVAILABLE');
    if(table==='conversations'){if(selector!=='title')throw Error('SLACK_ORIGIN_UNAVAILABLE');}
    else validateMessageSelector(messageSelectorKind(selector),selector);
  }
  return [...selectors].sort();
}
/** Normalize only registered selectors using the concrete eraser. Never include
 * payload/status/timestamps from unrelated artifacts or client attestations. */
export function messageOriginFingerprint(table:MessageOriginTable,row:any,owner:string):{selectors:string[];fingerprint:string}{
  const selectors=manifest(row,table);
  const remainder=table==='messages'?structuredClone({content:row.content,metadata:row.metadata}):{title:row.title};
  for(const selector of selectors){
    if(table==='conversations')(remainder as any).title='';
    else eraseMessageSelector(remainder as any,messageSelectorKind(selector),selector);
  }
  return {selectors,fingerprint:messageFingerprint({protocol:cutover,table,id:row.id,owner,convId:table==='messages'?row.conv_id:row.id,
    role:table==='messages'?row.role:null,selectors,remainder},'origin')};
}
/** Callers hold the common conversation/artifact lock. A missing/disabled
 * cutover or certificate never falls back to absence-of-lineage semantics. */
export async function messageOriginAllowed(client:pg.PoolClient,table:MessageOriginTable,row:any,owner:string):Promise<boolean>{
  const proof=(await client.query(`SELECT o.* FROM slack_message_origins o JOIN slack_message_origin_cutovers c ON c.id=o.cutover_id
    WHERE o.artifact_table=$1 AND o.artifact_id=$2 AND c.id=$3 AND c.enabled FOR SHARE OF o,c`,[table,row.id,cutover])).rows[0];
  if(!proof||proof.ati_user_id!==owner||proof.conv_id!==(table==='messages'?row.conv_id:row.id))return false;
  try{const current=messageOriginFingerprint(table,row,owner);return JSON.stringify(current.selectors)===JSON.stringify(proof.selectors)&&current.fingerprint===proof.remainder_fingerprint;}
  catch{return false;}
}
/** Private backend gate: reads the actual locked DB payload, never caller hashes
 * or metadata. Must share the writer's transaction; no autocommit certificate. */
export async function sealMessageOrigin(client:pg.PoolClient,table:MessageOriginTable,id:string,producer:Producer):Promise<void>{
  await client.query('SAVEPOINT message_origin_tx_guard');await client.query('RELEASE SAVEPOINT message_origin_tx_guard');
  const marker=(await client.query('SELECT id FROM slack_message_origin_cutovers WHERE id=$1 AND enabled FOR SHARE',[cutover])).rows[0];
  if(!marker)throw Error('SLACK_ORIGIN_CUTOVER_REQUIRED');
  const row=(await client.query(table==='messages'?`SELECT m.*,v.user_id AS origin_owner FROM messages m JOIN conversations v ON v.id=m.conv_id WHERE m.id=$1 FOR UPDATE OF m`:
    'SELECT *,user_id AS origin_owner FROM conversations WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!row)throw Error('SLACK_ORIGIN_UNAVAILABLE');
  const proof=messageOriginFingerprint(table,row,row.origin_owner);
  await client.query(`INSERT INTO slack_message_origins(artifact_table,artifact_id,ati_user_id,conv_id,cutover_id,producer,selectors,remainder_fingerprint)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(artifact_table,artifact_id) DO UPDATE SET ati_user_id=excluded.ati_user_id,
    conv_id=excluded.conv_id,cutover_id=excluded.cutover_id,producer=excluded.producer,selectors=excluded.selectors,remainder_fingerprint=excluded.remainder_fingerprint,recorded_at=clock_timestamp()`,
    [table,id,row.origin_owner,table==='messages'?row.conv_id:row.id,cutover,producer,JSON.stringify(proof.selectors),proof.fingerprint]);
}
