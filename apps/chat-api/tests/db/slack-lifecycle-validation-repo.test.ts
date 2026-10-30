import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import { SlackEventReceiptRepo } from '../../src/db/repositories/slack-event-receipt-repo.js';
import { SlackInvalidationService } from '../../src/services/slack/slack-invalidation-service.js';
import { SlackLifecycleValidationRepo } from '../../src/db/repositories/slack-lifecycle-validation-repo.js';

describe('04B1 leased credential validation jobs on real PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>, repo: SlackLifecycleValidationRepo;
  beforeAll(async () => { db = await createMigratedSchema('slack_validation_jobs'); repo = new SlackLifecycleValidationRepo(db.pool); });
  beforeEach(async () => { await db.pool.query('DELETE FROM slack_event_receipts'); });
  afterAll(async () => { await db?.close(); });
  async function seed(count: number) {
    const person = await db.person(), id = randomUUID(), team = `T${randomUUID()}`;
    await db.pool.query(`INSERT INTO slack_connections(id,user_id,app_id,workspace_id,workspace_name,actor_id,
      identity_version,status,config,scopes,connected_at,last_state_order)
      VALUES($1,$2,'A_JOBS',$3,'Fixture','U_JOBS',1,'active','FIXTURE',ARRAY['channels:history'],now(),'1')`, [id,person.id,team]);
    const ingress = new SlackEventReceiptRepo(db.pool, new SlackInvalidationService(db.pool));
    for (let i=0;i<count;i++) await ingress.recordLifecycle({ appId:'A_JOBS',eventId:`Ev${randomUUID()}`,teamId:team,
      eventType:'tokens_revoked',eventSubtype:null,eventContext:null,sourceEventTs:'1730000000.000001',
      sourceEventTimeIso:'2024-10-27T03:33:20.000001Z',channelId:null,messageTs:null,payloadHash:'a'.repeat(64),
      lifecycle:{intentType:'token_revocation_validation',slackUserIds:['U_JOBS']} });
    // These tests start with due jobs, then exercise retry/lease clocks
    // explicitly. PG microseconds can be later than Date.now() immediately
    // after INSERT; do not make safe-code assertions depend on that boundary.
    await db.pool.query("UPDATE slack_lifecycle_intents SET validation_next_attempt_at='2000-01-01T00:00:00Z' WHERE status='pending'");
  }
  it('claims concurrently with SKIP LOCKED and no shared job ownership', async () => {
    await seed(8);
    const [a,b] = await Promise.all([repo.claim(4,'worker-a',60),repo.claim(4,'worker-b',60)]);
    expect(a).toHaveLength(4); expect(b).toHaveLength(4);
    expect(new Set([...a,...b].map(j=>j.id)).size).toBe(8);
    expect(a.every(j=>j.workerId==='worker-a' && j.attempts===1)).toBe(true);
    expect(await repo.claim(4,'worker-c',60)).toEqual([]);
  });
  it('reclaims expired leases with a different token and rejects stale retry ownership', async () => {
    await seed(1); const now = new Date(), a = (await repo.claim(1,'first',1,now))[0]!;
    const later = new Date(now.getTime()+2000), b = (await repo.claim(1,'second',60,later))[0]!;
    expect(b.leaseToken).not.toBe(a.leaseToken); expect(b.attempts).toBe(2);
    expect(await repo.retry(a,'probe_transient',30,later)).toBe(false);
    expect(await repo.retry(b,'probe_transient',30,later)).toBe(true);
    expect(await repo.claim(1,'early',60,new Date(later.getTime()+1000))).toEqual([]);
    expect((await repo.claim(1,'due',60,new Date(later.getTime()+31_000)))).toHaveLength(1);
  });
  it('fences completion inside the caller transaction and rolls it back atomically', async () => {
    await seed(1); const job=(await repo.claim(1,'owner',60))[0]!, c=await db.pool.connect();
    try {
      await expect(repo.completeInTransaction(c,job,'valid')).rejects.toThrow();
      await c.query('BEGIN'); expect(await repo.completeInTransaction(c,job,'valid')).toBe(true);
      await c.query('ROLLBACK');
      expect((await db.pool.query('SELECT status FROM slack_lifecycle_intents WHERE id=$1',[job.id])).rows[0].status).toBe('pending');
      await c.query('BEGIN'); expect(await repo.completeInTransaction(c,job,'valid')).toBe(true); await c.query('COMMIT');
      expect((await db.pool.query('SELECT status,validation_lease_token FROM slack_lifecycle_intents WHERE id=$1',[job.id])).rows[0])
        .toEqual({status:'applied',validation_lease_token:null});
      expect(await repo.claim(1,'later',60)).toEqual([]);
    } finally { await c.query('ROLLBACK'); c.release(); }
  });
  it('an expired lease cannot mark the job applied', async () => {
    await seed(1); const now=new Date(), job=(await repo.claim(1,'owner',1,now))[0]!, c=await db.pool.connect();
    try { await c.query('BEGIN'); expect(await repo.completeInTransaction(c,job,'valid',new Date(now.getTime()+2000))).toBe(false); await c.query('ROLLBACK'); }
    finally { c.release(); }
  });
  it('checks actual lease expiry after waiting on a real row lock, not a stale caller clock', async () => {
    await seed(1); const now=new Date(), job=(await repo.claim(1,'owner',1,now))[0]!;
    const holder=await db.pool.connect(), writer=await db.pool.connect();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await holder.query('BEGIN'); await holder.query('SELECT id FROM slack_lifecycle_intents WHERE id=$1 FOR UPDATE',[job.id]);
      await writer.query('BEGIN');
      const pending=repo.completeInTransaction(writer,job,'valid',now); pending.catch(()=>{});
      timer=setTimeout(()=>{ void holder.query('ROLLBACK'); },1200);
      expect(await pending).toBe(false);
      await writer.query('ROLLBACK');
    } finally {
      if (timer) clearTimeout(timer);
      await holder.query('ROLLBACK'); await writer.query('ROLLBACK'); holder.release(); writer.release();
    }
  });
  it('validates bounds and safe retry codes without storing arbitrary error text', async () => {
    await expect(repo.claim(0,'worker',60)).rejects.toThrow();
    await expect(repo.claim(1,'',60)).rejects.toThrow();
    await expect(repo.claim(1,'worker',0)).rejects.toThrow();
    await seed(1); const job=(await repo.claim(1,'owner',60))[0]!;
    await expect(repo.retry(job,'xoxp-do-not-log' as any,30)).rejects.toThrow();
    expect((await db.pool.query('SELECT validation_last_error_code FROM slack_lifecycle_intents WHERE id=$1',[job.id])).rows[0].validation_last_error_code).toBeNull();
  });
});
