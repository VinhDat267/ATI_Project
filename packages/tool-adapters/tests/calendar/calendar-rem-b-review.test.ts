import { afterAll,beforeAll,expect,it } from 'vitest';
import { createServer } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import { once } from 'node:events';
import { PersonalCalendarAdapter } from '../../src/calendar/personal-calendar-adapter';
import { CalendarAdapter, eventsOverlap } from '../../src/calendar/calendar-adapter';
let server:any,base:string,mode='empty';
const cal='work@example.test';
const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
beforeAll(async()=>{
 server=createServer((_req:any,res:any)=>{
  res.setHeader('content-type','application/json');
  const url=new URL(_req.url,'http://fixture');
  if(!url.pathname.endsWith('/events')){
   if(mode==='metadata-failure' || mode==='allday-metadata-failure' || mode==='timed-metadata-failure'){res.writeHead(503);res.end('{}');return;}
   if(mode==='metadata-missing-tz'){res.end(JSON.stringify({summary:'Work'}));return;}
   res.end(JSON.stringify({summary:'Work',timeZone:'America/New_York'}));return;
  }
  const allDay={id:'all-day',summary:'Away',htmlLink:'https://calendar.google.com/event?eid=away',start:{date:'2026-11-16'},end:{date:'2026-11-17'}};
  if(mode==='allday' || mode==='allday-metadata-failure'){res.end(JSON.stringify({items:[allDay]}));return;}
  if(mode==='timed-metadata-failure'){
   res.end(JSON.stringify({items:[{id:'timed-1',summary:'Sync',htmlLink:'https://calendar.google.com/event?eid=t1',start:{dateTime:'2026-11-16T10:00:00-05:00'},end:{dateTime:'2026-11-16T11:00:00-05:00'}}]}));return;
  }
  if(mode==='malformed-page'){
   const items=Array.from({length:20},(_,i)=>({id:'event'+i,summary:'Meeting',htmlLink:'https://calendar.google.com/event?eid='+i,start:{dateTime:'2026-11-16T08:'+String(i).padStart(2,'0')+':00-05:00'},end:{dateTime:'2026-11-16T08:'+String(i+1).padStart(2,'0')+':00-05:00'}}));
   res.end(JSON.stringify({items,nextPageToken:{invalid:true}}));return;
  }
  if(mode==='malformed-scan-page'){
   const items=Array.from({length:250},(_,i)=>({id:'scan'+i,summary:'Scan',htmlLink:'https://calendar.google.com/event?eid=s'+i,start:{dateTime:'2026-11-16T08:00:00-05:00'},end:{dateTime:'2026-11-16T08:15:00-05:00'}}));
   res.end(JSON.stringify({items,nextPageToken:{invalid:true}}));return;
  }
  res.end(JSON.stringify({items:[]}));
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;
});
afterAll(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
const adapter=()=>new PersonalCalendarAdapter({userId:'fixture',tokens:{getAccessToken:async()=> 'fixture'},allowedScope:{calendars:[cal]},apiBaseUrl:base});
const window={calendarId:cal,timeMin:'2026-11-16T00:00:00-05:00',timeMax:'2026-11-17T00:00:00-05:00'};
it('Codex: metadata failure cannot silently resolve a natural day using Vietnam timezone',async()=>{
 mode='metadata-failure';
 await expect(adapter().execute('mycalendar.list_events',{calendarId:cal,query:'tomorrow'})).rejects.toBeDefined();
});
it('Codex: all-day list event must retain effective named zone for downstream precheck/digest overlap',async()=>{
 mode='allday';
 const out=await adapter().execute('mycalendar.list_events',{...window,timeZone:'America/New_York'});
 expect(eventsOverlap(out.events[0],{start:'2026-11-16T20:00:00-05:00',end:'2026-11-16T21:00:00-05:00'}),'opaque all-day is busy at20:00 in its NY calendar, not VN midnight').toBe(true);
});
it('Codex: malformed continuation at20 cap must fail closed or mark incomplete, never complete',async()=>{
 mode='malformed-page';
 let result:any;
 try{result=await adapter().execute('mycalendar.list_events',window);}catch{return;}
 expect(result.coverage.complete).toBe(false);
 expect(result.coverage.totalAvailable).toBeNull();
});
it('Codex: all-day list event without explicit args.timeZone resolves authorized calendar metadata zone for downstream overlap and fails if metadata unavailable',async()=>{
 mode='allday';
 const out=await adapter().execute('mycalendar.list_events',window);
 expect(out.events[0].timeZone).toBe('America/New_York');
 expect(eventsOverlap(out.events[0],{start:'2026-11-16T20:00:00-05:00',end:'2026-11-16T21:00:00-05:00'})).toBe(true);
 expect(eventsOverlap(out.events[0],{start:'2026-11-17T00:00:00-05:00',end:'2026-11-17T01:00:00-05:00'})).toBe(false);

 mode='allday-metadata-failure';
 await expect(adapter().execute('mycalendar.list_events',window)).rejects.toBeDefined();
});
it('Codex: find_free_slots rejects when calendar timezone metadata fails or is missing instead of guessing from ISO offset or defaulting to Vietnam, while explicit ISO timed list_events still succeeds',async()=>{
 mode='metadata-failure';
 await expect(adapter().execute('mycalendar.find_free_slots',window)).rejects.toBeDefined();
 mode='metadata-missing-tz';
 await expect(adapter().execute('mycalendar.find_free_slots',window)).rejects.toBeDefined();

 mode='timed-metadata-failure';
 const timedOut=await adapter().execute('mycalendar.list_events',window);
 expect(timedOut.events).toHaveLength(1);
 expect(timedOut.coverage).toEqual({complete:true,returned:1,totalAvailable:1});
});
it('Codex: malformed continuation at cap in shared CalendarAdapter.list_events and internal find_free_slots scanner never reports complete',async()=>{
 mode='malformed-scan-page';
 let scanResult:any;
 try{scanResult=await adapter().execute('mycalendar.find_free_slots',window);}catch{scanResult=null;}
 if(scanResult){
  expect(scanResult.coverage.complete).toBe(false);
  expect(scanResult.coverage.totalAvailable).toBeNull();
  expect(scanResult.freeSlots).toEqual([]);
 }

 const shared=new CalendarAdapter({
  credentials:{clientEmail:'calendar@unit.iam.gserviceaccount.com',privateKey},
  allowedScope:{calendars:[cal]},
  fetchFn:async(input)=>{
   if(String(input)==='https://oauth2.googleapis.com/token'){
    return new Response(JSON.stringify({access_token:'tok',token_type:'Bearer',expires_in:3600}),{status:200});
   }
   const items=Array.from({length:20},(_,i)=>({id:'ev'+i,summary:'M',htmlLink:'https://calendar.google.com/event?eid='+i,start:{dateTime:'2026-11-16T08:00:00-05:00'},end:{dateTime:'2026-11-16T08:30:00-05:00'}}));
   return new Response(JSON.stringify({items,nextPageToken:{invalid:true}}),{status:200});
  },
 });
 let sharedResult:any;
 try{sharedResult=await shared.execute('calendar.list_events',window);}catch{sharedResult=null;}
 if(sharedResult){
  expect(sharedResult.coverage.complete).toBe(false);
  expect(sharedResult.coverage.totalAvailable).toBeNull();
 }
});
