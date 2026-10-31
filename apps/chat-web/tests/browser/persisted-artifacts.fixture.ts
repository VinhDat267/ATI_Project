import type pg from 'pg';
import {ConversationRepo} from '../../../chat-api/src/db/repositories/conversation-repo.js';
import {MessageRepo} from '../../../chat-api/src/db/repositories/message-repo.js';

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
