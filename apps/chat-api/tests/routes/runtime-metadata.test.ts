import {expect,it,vi} from 'vitest';
import request from 'supertest';
import {createApp} from '../../src/app.js';
import {generateTokens} from '../../src/auth/jwt.js';
import {encryptCredentials} from '@wap/tool-adapters';
import {ALL_TOOLS} from '@wap/tool-schemas';
const secret='fixture-secret-at-least-32-characters';
const key='test-only-encryption-key-with-32bytes';
const token=generateTokens({id:'u1',email:'test@example.test',name:'Tester'},secret).accessToken;
it.each(['sandbox','live'] as const)('reports %s runtime publicly without secrets',async runtimeMode=>{
  const response=await request(createApp({jwtSecret:secret,runtimeMode} as any)).get('/api/health');
  expect(response.body).toEqual({status:'ok',version:'v3',runtimeMode});
});
it('reports registered tools, configured scope and the latest connection check, including transport failure',async()=>{
  const config=encryptCredentials({botToken:'test-only',allowedScope:{channels:['C1']}},key);
  const fetchFn=vi.fn().mockResolvedValueOnce(new Response('{"ok":true}')).mockRejectedValueOnce(new TypeError('network unavailable'));
  const app=createApp({jwtSecret:secret,encryptionKey:key,credentialRepo:{getCredentials:async(id:string)=>id==='slack'?{config}:null} as any,serviceFetchFn:fetchFn});
  const list=()=>request(app).get('/api/services').set('Authorization',`Bearer ${token}`);
  const check=()=>request(app).post('/api/services/slack/test').set('Authorization',`Bearer ${token}`);
  const before=(await list()).body.services;
  expect(before.map((s:any)=>s.id)).toEqual(['trello','slack','github','sheets','calendar','notion','telegram','jira']);
  for(const service of before) expect(service.tools).toEqual(ALL_TOOLS.filter(t=>t.service===service.id).map(t=>t.name));
  expect(before.find((s:any)=>s.id==='slack')).toMatchObject({configured:true,connected:false,connectionStatus:'unchecked'});
  await check(); expect((await list()).body.services.find((s:any)=>s.id==='slack')).toMatchObject({connected:true,connectionStatus:'healthy',lastCheckedAt:expect.any(String)});
  await check(); expect((await list()).body.services.find((s:any)=>s.id==='slack')).toMatchObject({connected:false,connectionStatus:'unhealthy'});
  expect(JSON.stringify((await list()).body)).not.toContain('test-only');
});
