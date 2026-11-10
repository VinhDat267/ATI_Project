import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { PersonalCalendarAdapter } from '../../../packages/tool-adapters/src/calendar/personal-calendar-adapter';
import { PreviewContents } from '../src/pages/Cockpit/PreviewContents';
import { PlanMoment } from '../src/pages/Cockpit/PlanMoment';
afterEach(cleanup);

it('Codex: update with existing guests and sendInvites true must disclose update notifications even when attendees is omitted',async()=>{
 const requests:any[]=[];
 const server=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;requests.push({method:req.method,url:req.url,body:JSON.parse(raw)});
 res.setHeader('content-type','application/json');res.end(JSON.stringify({id:'existing',summary:'Renamed',htmlLink:'https://calendar.google.com/event?eid=existing',start:{dateTime:'2026-11-13T09:00:00+07:00'},end:{dateTime:'2026-11-13T10:00:00+07:00'},attendees:[{email:'existing@example.test'}]}));});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
 const adapter=new PersonalCalendarAdapter({userId:'fixture',tokens:{getAccessToken:async()=> 'fixture'},allowedScope:{calendars:['work@example.test']},apiBaseUrl:'http://127.0.0.1:'+String((server.address() as any).port)});
 const step:any={id:'update',tool:'mycalendar.update_event',description:'Rename existing meeting',args:{calendarId:'work@example.test',eventId:'existing',summary:'Renamed',sendInvites:true}};
 await adapter.execute(step.tool,step.args);
 expect(requests[0].method).toBe('PATCH');expect(new URL(requests[0].url,'http://fixture').searchParams.get('sendUpdates')).toBe('all');expect(requests[0].body.attendees).toBeUndefined();
 const preview=render(<PreviewContents step={step} destination="Work"/>);
 expect(screen.queryByText(/Gửi.*(?:mời|cập nhật|thông báo)/i),'provider PATCH requests updates to existing guests; preview must disclose it').not.toBeNull();
 preview.unmount();
 render(<PlanMoment plan={{id:'review',status:'pending',summary:'Rename',steps:[step]}} services={[]} destination={()=>'Work'} onPreview={()=>{}} onApprove={()=>{}} onCancel={()=>{}} onEdit={()=>{}} inlineComposer={null} runtimeMode="sandbox"/>);
 expect(screen.queryByText(/Gửi.*(?:mời|cập nhật|thông báo)/i)).not.toBeNull();
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

it('Codex: displayed wall time must match an explicitly displayed named timezone',()=>{
 const instant='2026-11-13T09:00:00+07:00';
 const zone='America/New_York';
 const expectedTime=new Intl.DateTimeFormat('vi-VN',{hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:zone}).format(new Date(instant));
 const step:any={id:'zone',tool:'mycalendar.create_event',description:'Meeting',args:{calendarId:'work@example.test',summary:'Meeting',start:instant,end:'2026-11-13T10:00:00+07:00',timeZone:zone}};
 render(<PreviewContents step={step} destination="Work"/>);
 const card=screen.getByTestId('calendar-event-preview');
 expect(card.textContent).toContain('Múi giờ: '+zone);
 expect(card.textContent,'wall time must correspond to zone label and provider instant').toContain(expectedTime);
});


import { formatCalendarDateTime } from '../src/pages/Cockpit/PreviewContents';
it.each([
 ['2026-11-13T09:00:00+07:00', '21:00', '12/11/2026'],
 ['2026-03-08T06:30:00Z', '01:30', '08/03/2026'],
 ['2026-03-08T07:30:00Z', '03:30', '08/03/2026'],
 ['2026-11-01T05:30:00Z', '01:30', '01/11/2026'],
 ['2026-11-01T06:30:00Z', '01:30', '01/11/2026'],
])('preserves instant and named-zone wall time across midnight and DST: %s', (instant, wallTime, date) => {
 const args = Object.freeze({calendarId:'work@example.test',summary:'Zone meeting',start:instant,end:instant,timeZone:'America/New_York'});
 const step:any={id:'zone-boundary',tool:'mycalendar.create_event',description:'Zone meeting',args};
 const preview=render(<PreviewContents step={step} destination="Work"/>);
 expect(screen.getByTestId('calendar-event-preview').textContent).toContain(wallTime);
 expect(screen.getByTestId('calendar-event-preview').textContent).toContain(date);
 preview.unmount();
 render(<PlanMoment plan={{id:'boundary',status:'pending',summary:'Zone',steps:[step]}} services={[]} destination={()=>'Work'} onPreview={()=>{}} onApprove={()=>{}} onCancel={()=>{}} onEdit={()=>{}} inlineComposer={null} runtimeMode="sandbox"/>);
 expect(screen.getByTestId('step-inline-payload').textContent).toContain(wallTime);
 expect(screen.getByTestId('step-inline-payload').textContent).toContain(date);
 expect(args.start).toBe(instant);
});
it('invalid timezone shows original instant and explicit error instead of mislabeled browser time',()=>{
 const instant='2026-11-13T09:00:00+07:00';
 expect(formatCalendarDateTime(instant,'Invalid/Zone')).toBe(instant+' (Múi giờ không hợp lệ)');
 expect(formatCalendarDateTime('2026-11-13','America/New_York')).toBe('13/11/2026 (Cả ngày)');
});
