import { expect,it } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createPersonalCalendarAdapter, encryptCredentials } from '@wap/tool-adapters';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import { ChatService } from '../../src/services/chat-service.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { MessageRepo } from '../../src/db/repositories/message-repo.js';
import { PlanRepo } from '../../src/db/repositories/plan-repo.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { createMyCalendarConnectionLookup } from '../../src/services/gmail/connection-reference.js';
it('Codex: precheck missing coverage contract is UNKNOWN and cannot recommend free slots',async()=>{
 const db=await createMigratedSchema('calendar_b_review');
 try{
 const person=await db.person(),key='0123456789abcdef0123456789abcdef',cal='owner@example.test';
 const creds=new CredentialRepo(db.pool);
 await creds.saveCredentials('mycalendar',encryptCredentials({refreshToken:'fixture',email:cal,allowedScope:{calendars:[cal]},selectedCalendars:[{id:cal,summary:'Work'}]},key),person.id);
 const conversations=new ConversationRepo(db.pool),messages=new MessageRepo(db.pool),plans=new PlanRepo(db.pool);
 const conv=await conversations.createConversation(person.id);const events:any[]=[];
 const svc=new ChatService({msgRepo:messages,convRepo:conversations,planRepo:plans,eventEmitter:{emit:(event,payload)=>events.push({event,payload})},
 planner:{processMessage:async()=>({kind:'plan',thinking:'Fixture',summary:'Meeting',warnings:[],steps:[{id:'create',tool:'mycalendar.create_event',description:'Meeting',args:{calendarId:cal,summary:'Meeting',start:'2026-11-16T09:00:00+07:00',end:'2026-11-16T10:00:00+07:00'},dependsOn:[]}]})} as any,
 mycalendarConnection:createMyCalendarConnectionLookup(creds,key),
 lookupTool:async()=>({events:[{id:'busy',title:'Busy',start:'2026-11-16T09:00:00+07:00',end:'2026-11-16T10:00:00+07:00',url:'https://calendar.google.com/event?eid=busy'}]})});
 await svc.handleUserMessage({conversationId:conv.id,userId:person.id,content:'Create meeting9am'});
 for(let n=0;n<100&&!events.some(e=>['plan_preview','error','refusal'].includes(e.event));n++)await new Promise(r=>setTimeout(r,20));
 const row=(await db.pool.query('SELECT plan_json FROM plans WHERE conv_id=$1 ORDER BY created_at DESC LIMIT 1',[conv.id])).rows[0];
 expect(row).toBeDefined();const warnings=(row.plan_json.warnings??[]).join('\n');
 expect(warnings,'missing coverage is unknown; no safe-slot claim').not.toContain('Gợi ý khung giờ trống');
 expect(warnings).toMatch(/chưa đầy đủ|không thể|chưa thể|chưa xác minh/i);
 }finally{await db.close();}
},30000);
it('Codex: precheck treats malformed coverage or non-array events as incomplete even without overlap, and detects NY all-day overlap at 20:00 NY via authorized calendar metadata',async()=>{
 const db=await createMigratedSchema('calendar_b_review_extra');
 const server=createServer((req,res)=>{
  res.setHeader('content-type','application/json');
  const url=new URL(req.url ?? '/','http://127.0.0.1');
  if(!url.pathname.endsWith('/events')){
   res.end(JSON.stringify({id:'ny@example.test',summary:'NY Work',timeZone:'America/New_York'}));
   return;
  }
  res.end(JSON.stringify({
   items:[{id:'ny-allday',summary:'NY Thanksgiving Prep',htmlLink:'https://calendar.google.com/event?eid=ny',start:{date:'2026-11-16'},end:{date:'2026-11-17'}}],
  }));
 });
 server.listen(0,'127.0.0.1');
 await once(server,'listening');
 const base=`http://127.0.0.1:${(server.address() as any).port}`;
 try{
  const person=await db.person(),key='0123456789abcdef0123456789abcdef',cal='ny@example.test';
  const creds=new CredentialRepo(db.pool);
  await creds.saveCredentials('mycalendar',encryptCredentials({refreshToken:'fixture',email:cal,allowedScope:{calendars:[cal]},selectedCalendars:[{id:cal,summary:'NY Work'}]},key),person.id);
  const conversations=new ConversationRepo(db.pool),messages=new MessageRepo(db.pool),plans=new PlanRepo(db.pool);

  // 1. Malformed coverage ({ complete: true, returned: 0, totalAvailable: null }) with 0 overlaps must still warn that calendar check is incomplete
  const conv1=await conversations.createConversation(person.id);
  const events1:any[]=[];
  const svc1=new ChatService({
   msgRepo:messages,convRepo:conversations,planRepo:plans,
   eventEmitter:{emit:(event,payload)=>events1.push({event,payload})},
   planner:{processMessage:async()=>({kind:'plan',thinking:'Fixture',summary:'Meeting',warnings:[],steps:[{id:'create',tool:'mycalendar.create_event',description:'Meeting',args:{calendarId:cal,summary:'Meeting',start:'2026-11-16T09:00:00-05:00',end:'2026-11-16T10:00:00-05:00'},dependsOn:[]}]})} as any,
   mycalendarConnection:createMyCalendarConnectionLookup(creds,key),
   lookupTool:async()=>({events:[],coverage:{complete:true,returned:0,totalAvailable:null}}),
  });
  await svc1.handleUserMessage({conversationId:conv1.id,userId:person.id,content:'Create meeting'});
  for(let n=0;n<100&&!events1.some(e=>['plan_preview','error','refusal'].includes(e.event));n++)await new Promise(r=>setTimeout(r,20));
  const row1=(await db.pool.query('SELECT plan_json FROM plans WHERE conv_id=$1 ORDER BY created_at DESC LIMIT 1',[conv1.id])).rows[0];
  const warnings1=(row1.plan_json.warnings??[]).join('\n');
  expect(warnings1).toMatch(/Không thể kiểm tra đầy đủ|chưa đầy đủ/i);

  // 2. Real PersonalCalendarAdapter against HTTP server with NY all-day event (16->17 Nov) detects overlap at 20:00-21:00 NY
  const conv2=await conversations.createConversation(person.id);
  const events2:any[]=[];
  const svc2=new ChatService({
   msgRepo:messages,convRepo:conversations,planRepo:plans,
   eventEmitter:{emit:(event,payload)=>events2.push({event,payload})},
   planner:{processMessage:async()=>({kind:'plan',thinking:'Fixture',summary:'Late NY Sync',warnings:[],steps:[{id:'create',tool:'mycalendar.create_event',description:'Late NY Sync',args:{calendarId:cal,summary:'Late NY Sync',start:'2026-11-16T20:00:00-05:00',end:'2026-11-16T21:00:00-05:00'},dependsOn:[]}]})} as any,
   mycalendarConnection:createMyCalendarConnectionLookup(creds,key),
   getAdapter:async(serviceName)=>serviceName==='mycalendar'?createPersonalCalendarAdapter({userId:person.id,tokens:{getAccessToken:async()=>'fixture'},allowedScope:{calendars:[cal]},apiBaseUrl:base}):null,
  });
  await svc2.handleUserMessage({conversationId:conv2.id,userId:person.id,content:'Create late NY sync'});
  for(let n=0;n<100&&!events2.some(e=>['plan_preview','error','refusal'].includes(e.event));n++)await new Promise(r=>setTimeout(r,20));
  const row2=(await db.pool.query('SELECT plan_json FROM plans WHERE conv_id=$1 ORDER BY created_at DESC LIMIT 1',[conv2.id])).rows[0];
  const warnings2=(row2.plan_json.warnings??[]).join('\n');
  expect(warnings2).toContain('NY Thanksgiving Prep');
  expect(warnings2).toContain('trùng giờ');
 }finally{
  server.closeAllConnections();
  await new Promise<void>(r=>server.close(()=>r()));
  await db.close();
 }
},30000);
