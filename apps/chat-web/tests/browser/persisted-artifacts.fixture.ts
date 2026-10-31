import type pg from 'pg';
import {ConversationRepo} from '../../../chat-api/src/db/repositories/conversation-repo.js';
import {MessageRepo} from '../../../chat-api/src/db/repositories/message-repo.js';
import {sealPlanOrigin} from '../../../chat-api/src/services/slack/slack-plan-origin.js';
import {certifyScheduleFixture} from '../../../chat-api/src/services/slack/slack-schedule-origin.js';

/** Known sandbox fixture data uses the same origin gate as actual backend writes.
 * SQL remains available to tests for technical timestamps/statuses, never as an
 * automatic certificate for arbitrary legacy payload. */
export async function fixtureConversation(db:pg.Pool,owner:string,title?:string):Promise<string>{
  const repo=new ConversationRepo(db),row=await repo.createConversation(owner);
  if(title!==undefined)await repo.renameConversation(row.id,owner,title);
  return row.id;
}
export async function fixtureMessage(db:pg.Pool,convId:string,role:string,content:string,metadata?:unknown):Promise<string>{
  return (await new MessageRepo(db).createMessage(convId,role,content,metadata)).id;
}
/** Call after the fixture's plan row and any execution_steps rows exist. */
export async function certifyFixturePlan(db:pg.Pool,planId:string):Promise<void>{
  const client=await db.connect();
  try{
    await client.query('BEGIN');
    await sealPlanOrigin(client,'plans',planId,'plan_writer');
    const steps=await client.query('SELECT id FROM execution_steps WHERE plan_id=$1 ORDER BY step_id',[planId]);
    for(const step of steps.rows)await sealPlanOrigin(client,'execution_steps',step.id,'step_writer');
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{client.release();}
}
/** Call after a SQL schedule seed or a SQL edit of name, request, recurrence, or services. */
export async function certifyFixtureSchedule(db:pg.Pool,scheduleId:string):Promise<void>{
  await certifyScheduleFixture(db,scheduleId);
}
