import {readScheduleArtifact,captureScheduleArtifact,prelockScheduleArtifacts,scheduleRegistry} from '../../services/slack/slack-schedule-lineage.js';
import {messageFingerprint} from '../../services/slack/slack-message-selectors.js';
import type pg from 'pg';
import { encodeConversationCursor, validateConversationPage, validateConversationTitle, type ConversationPageOptions } from './conversation-history.js';
import { isUuid } from './uuid.js';

export interface ConversationRow {
  id: string;
  user_id: string;
  status: string;
  title: string | null;
  created_at: Date;
  updated_at: Date;
}

export class ConversationRepo {
  constructor(private pool: pg.Pool) {}

  async createConversation(userId: string): Promise<ConversationRow> {
    const res = await this.pool.query(
      `INSERT INTO conversations (user_id, status)
       VALUES ($1, 'chatting')
       RETURNING *`,
      [userId]
    );
    return res.rows[0];
  }

  async listConversations(userId: string, limit: number = 50): Promise<ConversationRow[]> {
    const res = await this.pool.query(
      `SELECT * FROM conversations
       WHERE user_id = $1
       ORDER BY updated_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return Promise.all(res.rows.map(row=>readScheduleArtifact(this.pool,'conversations',row.id)));
  }

  async getConversation(id: string): Promise<ConversationRow | null> {
    if (!isUuid(id)) return null;
    const res = await this.pool.query(
      'SELECT * FROM conversations WHERE id = $1',
      [id]
    );
    return res.rows[0]?readScheduleArtifact(this.pool,'conversations',id):null;
  }

  async listConversationPage(userId: string, options: ConversationPageOptions = {}): Promise<{ conversations: ConversationRow[]; nextCursor: string | null }> {
    const { limit, search, cursor } = validateConversationPage(options);
    const values: unknown[] = [userId];
    const where = ['user_id = $1'];
    if (cursor) {
      values.push(cursor.updatedAt, cursor.id);
      where.push(`(updated_at, id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`);
    }
    values.push(search?500:limit+1);
    const result = await this.pool.query<ConversationRow & { cursor_updated_at: string }>(
      `SELECT *, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_updated_at
       FROM conversations WHERE ${where.join(' AND ')} ORDER BY updated_at DESC, id DESC LIMIT $${values.length}`, values,
    );
    const guarded=await Promise.all(result.rows.map(async row=>({...await readScheduleArtifact(this.pool,'conversations',row.id),cursor_updated_at:row.cursor_updated_at})));
    const matching=search?guarded.filter(row=>row.title?.toLocaleLowerCase().includes(search.toLocaleLowerCase())):guarded;
    const visible = matching.slice(0, limit);
    const last = matching.length>limit?visible.at(-1):result.rows.length===500?guarded.at(-1):undefined;
    const nextCursor = last
      ? encodeConversationCursor({ updatedAt: last.cursor_updated_at, id: last.id }) : null;
    return { conversations: visible.map(({ cursor_updated_at: _timestamp, ...row }) => row), nextCursor };
  }

  async renameConversation(id: string, userId: string, title: string): Promise<ConversationRow | null> {
    if (!isUuid(id)) return null;
    const cleaned=validateConversationTitle(title),client=await this.pool.connect(),registry=scheduleRegistry(this.pool);
    try{
      await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='5s'");
      const snapshot=await captureScheduleArtifact(client,registry,'conversations',id);
      if(!snapshot||snapshot.owner!==userId){await client.query('COMMIT');return null;}
      await prelockScheduleArtifacts(client,registry,[snapshot]);
      await client.query('SELECT id FROM conversations WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,userId]);
      const current=await captureScheduleArtifact(client,registry,'conversations',id);
      if(JSON.stringify(current?.copies)!==JSON.stringify(snapshot.copies))throw Error('SLACK_TITLE_CHANGED');
      await client.query("UPDATE slack_derived_copies SET status='retired',retired_at=clock_timestamp(),retired_reason='manual',updated_at=clock_timestamp() WHERE target_kind='scheduled_workflow_arg' AND target_id=$1 AND target_sub_id='title' AND status='active'",[id]);
      const result=await client.query('UPDATE conversations SET title=$3,updated_at=now(),slack_title_manual_fingerprint=$4,slack_lineage_manifest=NULL WHERE id=$1 AND user_id=$2 RETURNING *',[id,userId,cleaned,messageFingerprint(cleaned,'title')]);
      await client.query('COMMIT');
      const row=result.rows[0];delete row.slack_lineage_manifest;delete row.slack_title_manual_fingerprint;return row;
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
  }

  async updateStatus(id: string, status: string): Promise<void> {
    await this.pool.query(
      'UPDATE conversations SET status = $2, updated_at = now() WHERE id = $1',
      [id, status]
    );
  }
}
