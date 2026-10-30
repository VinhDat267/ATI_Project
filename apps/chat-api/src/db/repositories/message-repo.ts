import type pg from 'pg';
import { SlackDerivedLineageRepo, type DerivedSegmentInput } from './slack-derived-lineage-repo.js';
import { SlackPolicyService } from '../../services/slack/policy-service.js';
import { eraseMessageSelector, hasSlackMarker, messageSelectorKind, messageSelectorValue, SLACK_MESSAGE_TOMBSTONE, validateMessageSelector } from '../../services/slack/slack-message-selectors.js';

export interface SlackMessageWriteContext { segments: DerivedSegmentInput[]; selectors: string[] }
const lineage = Symbol('server Slack message context');
export function slackMessageContext(row: MessageRow): SlackMessageWriteContext | undefined { return (row as any)[lineage] ? structuredClone((row as any)[lineage]) : undefined; }
export function mergeSlackMessageContexts(rows: MessageRow[]): SlackMessageWriteContext | undefined {
  const contexts = rows.map(slackMessageContext).filter((c): c is SlackMessageWriteContext => !!c);
  const segments = [...new Map(contexts.flatMap(c => c.segments).map(s => [JSON.stringify(s), s])).values()];
  return segments.length ? { segments, selectors: [] } : undefined;
}

export interface MessageRow {
  id: string;
  conv_id: string;
  role: string;
  content: string;
  metadata: any;
  created_at: Date;
}

export class MessageRepo {
  private readonly slack: SlackDerivedLineageRepo;
  constructor(private pool: pg.Pool, slack?: SlackDerivedLineageRepo) { this.slack = slack ?? new SlackDerivedLineageRepo(pool, new SlackPolicyService(pool)); }

  async createMessage(
    convId: string,
    role: string,
    content: string,
    metadata?: any,
    /** A client inside the caller's transaction; the pool otherwise. */
    db: Pick<pg.Pool | pg.PoolClient, 'query'> = this.pool,
  ): Promise<MessageRow> {
    if (hasSlackMarker(metadata)) throw new Error('SLACK_PROVENANCE_REQUIRED');
    return this.insertMessage(convId, role, content, metadata, db);
  }

  private async insertMessage(convId: string, role: string, content: string, metadata: any,
    db: Pick<pg.Pool | pg.PoolClient, 'query'>): Promise<MessageRow> {
    const res = await db.query(
      `WITH locked_conversation AS (
         SELECT id FROM conversations WHERE id=$1 FOR UPDATE
       ), inserted AS (
         INSERT INTO messages (conv_id, role, content, metadata)
         SELECT id, $2, $3, $4 FROM locked_conversation RETURNING *
       ), touched AS (
         UPDATE conversations SET
           title=CASE WHEN $2='user' THEN COALESCE(title, left($3, 60)) ELSE title END,
           updated_at=now()
         WHERE id=(SELECT conv_id FROM inserted) RETURNING id
       ) SELECT inserted.* FROM inserted JOIN touched ON touched.id=inserted.conv_id`,
      [convId, role, content, metadata ? JSON.stringify(metadata) : null]
    );
    return res.rows[0];
  }

  /** Private server entrypoint. HTTP/model payloads never supply this context. */
  async createSlackMessage(convId: string, role: string, content: string, metadata: any,
    context: SlackMessageWriteContext, held?: pg.PoolClient, signal?: AbortSignal): Promise<MessageRow> {
    signal?.throwIfAborted();
    const snapshot = structuredClone({ content, metadata, context });
    const { selectors, segments } = snapshot.context;
    if (!['assistant','system'].includes(role) || !Array.isArray(selectors) || selectors.length === 0 || selectors.length > 256 || new Set(selectors).size !== selectors.length || !Array.isArray(segments) || segments.length === 0) throw new Error('SLACK_PROVENANCE_REQUIRED');
    for (const selector of selectors) {
      validateMessageSelector(messageSelectorKind(selector), selector);
      if (messageSelectorValue(snapshot, messageSelectorKind(selector), selector) === undefined) throw new Error('SLACK_SELECTOR_MISSING');
    }
    const uncovered = structuredClone(snapshot);
    for (const selector of selectors) eraseMessageSelector(uncovered,messageSelectorKind(selector),selector);
    if (hasSlackMarker(uncovered.metadata)) throw new Error('SLACK_PROVENANCE_UNCOVERED');
    const owner = segments[0]!.sourceRef.binding.atiUserId;
    const client = held ?? await this.pool.connect();
    try {
      if (!held) await client.query('BEGIN');
      await this.slack.prepareConversationWriteInTransaction(client, convId, owner, segments);
      signal?.throwIfAborted();
      const row = await this.insertMessage(convId, role, snapshot.content, snapshot.metadata, client);
      await client.query('UPDATE messages SET slack_lineage_manifest=$2 WHERE id=$1', [row.id, JSON.stringify(selectors)]);
      for (const selector of selectors) await this.slack.registerDerivedCopyInTransaction(client, { atiUserId: owner,
        targetKind: messageSelectorKind(selector), targetId: row.id, targetSubId: selector, segments });
      signal?.throwIfAborted();
      if (!held) await client.query('COMMIT');
      delete (row as any).slack_lineage_manifest;
      Object.defineProperty(row, lineage, { value: snapshot.context });
      return row;
    } catch (error) { if (!held) await client.query('ROLLBACK'); throw error; }
    finally { if (!held) client.release(); }
  }

  async inSlackTransaction<T>(convId: string, context: SlackMessageWriteContext, work: (client: pg.PoolClient) => Promise<T>, signal?: AbortSignal, purpose?: 'planning'): Promise<T> {
    const snapshot = structuredClone(context), client = await this.pool.connect();
    try {
      await client.query('BEGIN'); await client.query("SET LOCAL statement_timeout='5s'");
      signal?.throwIfAborted();
      await this.slack.prepareConversationWriteInTransaction(client, convId, snapshot.segments[0]!.sourceRef.binding.atiUserId, snapshot.segments, purpose);
      const result = await work(client); signal?.throwIfAborted();
      await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }

  async listMessages(convId: string, limit: number = 100, purpose: 'manual_lookup' | 'planning' = 'manual_lookup', signal?: AbortSignal): Promise<MessageRow[]> {
    const res = await this.pool.query(
      `SELECT m.*, EXISTS(SELECT 1 FROM slack_derived_copies c WHERE c.target_id=m.id::text
         AND c.target_kind IN ('chat_history_message','working_memory_entity')) AS slack_registered FROM messages m
       WHERE m.conv_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      [convId, limit]
    );
    const rows = res.rows.reverse();
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      if (row.slack_lineage_manifest != null || row.slack_registered || hasSlackMarker(row.metadata)) rows[index] = await this.readSlackMessage(row.id, purpose, signal);
      delete rows[index].slack_lineage_manifest; delete rows[index].slack_registered;
    }
    return rows;
  }

  private async readSlackMessage(id: string, purpose: 'manual_lookup' | 'planning', signal?: AbortSignal): Promise<any> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); await client.query("SET LOCAL statement_timeout='5s'");
      const found = (await client.query('SELECT m.*,v.user_id FROM messages m JOIN conversations v ON v.id=m.conv_id WHERE m.id=$1', [id])).rows[0];
      if (!found) throw new Error('SLACK_MESSAGE_NOT_FOUND');
      const manifest = found.slack_lineage_manifest;
      if (!Array.isArray(manifest) || manifest.length === 0 || manifest.length > 256 || new Set(manifest).size !== manifest.length) {
        found.content = SLACK_MESSAGE_TOMBSTONE; found.metadata = { type: 'slack_source_unavailable' };
        await client.query('COMMIT'); delete found.user_id; return found;
      }
      const copies = (await client.query(`SELECT * FROM slack_derived_copies WHERE target_id=$1 AND ati_user_id=$2
        AND target_kind IN ('chat_history_message','working_memory_entity') AND status='active'`, [id, found.user_id])).rows;
      if (copies.some(c => !manifest.includes(c.target_sub_id))) throw new Error('SLACK_LINEAGE_UNCOVERED');
      const allSegments: DerivedSegmentInput[] = [];
      for (const copy of copies) allSegments.push(...await this.slack.segmentsInTransaction(client, copy.id));
      // All sorted source locks precede the common parent row; never acquire another source after that.
      if (allSegments.length) await this.slack.lockSegmentsInTransaction(client, allSegments, found.user_id);
      await client.query('SELECT id FROM conversations WHERE id=$1 AND user_id=$2 FOR SHARE', [found.conv_id, found.user_id]);
      const row = (await client.query('SELECT * FROM messages WHERE id=$1 FOR SHARE', [id])).rows[0];
      if (JSON.stringify(row.slack_lineage_manifest) !== JSON.stringify(manifest)) throw new Error('SLACK_LINEAGE_CHANGED');
      const safe = structuredClone(row), permitted: DerivedSegmentInput[] = [], allowedSelectors: string[] = [];
      for (const selector of manifest) {
        validateMessageSelector(messageSelectorKind(selector), selector);
        const copy = copies.find(c => c.target_sub_id === selector && c.target_kind === messageSelectorKind(selector));
        const decision = copy ? await this.slack.assertDerivedCopyAllowedInTransaction(client, { callerAtiUserId: found.user_id,
          consumerPurpose: purpose, targetKind: copy.target_kind, targetId: id, targetSubId: selector, expectedTargetVersion: copy.target_version, signal }) : null;
        if (decision?.status === 'allowed') { permitted.push(...await this.slack.segmentsInTransaction(client, copy.id)); allowedSelectors.push(selector); }
        else eraseMessageSelector(safe, messageSelectorKind(selector), selector);
      }
      const uncovered = structuredClone(row);
      for (const selector of manifest) eraseMessageSelector(uncovered,messageSelectorKind(selector),selector);
      if (hasSlackMarker(uncovered.metadata)) throw new Error('SLACK_LINEAGE_UNCOVERED');
      signal?.throwIfAborted();
      await client.query('COMMIT');
      if (permitted.length) Object.defineProperty(safe, lineage, { value: { segments: permitted, selectors: allowedSelectors } });
      return safe;
    } catch {
      await client.query('ROLLBACK').catch(() => {});
      // A metadata-only fallback cannot carry source-derived content into HTTP or planner hydration.
      const row = (await client.query('SELECT id,conv_id,role,created_at FROM messages WHERE id=$1', [id])).rows[0];
      return { ...row, content: SLACK_MESSAGE_TOMBSTONE, metadata: { type: 'slack_source_unavailable' } };
    } finally { client.release(); }
  }
}
