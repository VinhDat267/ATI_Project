import {beforeAll,afterAll,it,expect} from 'vitest';
import request from 'supertest';
import {createApp} from '../../src/app.js';
import {generateAccessToken} from '../../src/auth/jwt.js';
import {createPersonalSlackAssistantRuntime} from '../../src/config/slack-assistant-runtime.js';
import {createSlackReadEnvironment,TEST_KEY,type SlackReadEnvironment,type SeededUser} from '../helpers/slack-private-read-fixture.js';
let env:SlackReadEnvironment,seed:SeededUser,runtime:NonNullable<ReturnType<typeof createPersonalSlackAssistantRuntime>>;
const secret='assistant-test-jwt-secret-more-than-32';
beforeAll(async()=>{
 env=await createSlackReadEnvironment('assistant_routes',f=>({LLM_PROVIDER:'openai-compatible',LLM_MODEL:'fixture',LLM_BASE_URL:f.url,RUNTIME_ACCOUNT_ID:'M4_LOCAL_MODEL'}));seed=await env.addUser({name:'route',workspaceId:'T_ROUTE',actorId:'U_ONE'});
 runtime=createPersonalSlackAssistantRuntime({pool:env.db.pool,encryptionKey:TEST_KEY,oauth:{appId:'A_TEST',clientId:'fixture',clientSecret:'fixture',redirectUri:'https://ati.example/connections/myslack/callback',authorizationUrl:env.fixture.url+'/authorize',apiBaseUrl:env.fixture.url},live:false,env:{...env.runtimeEnv,MYSLACK_ENABLED:'on',MYSLACK_AUTOMATION_ENABLED:'on',MYSLACK_APP_ID:'A_TEST'}})!;
});
afterAll(async()=>{await runtime?.runner?.stop();await env?.close();});
const app=(value=runtime)=>createApp({jwtSecret:secret,userRepo:env.db.users,slackAssistant:value});
const bearer=(p=seed.person)=>'Bearer '+generateAccessToken(p,secret,p.sid).accessToken;
const path=()=>'/api/connections/myslack/'+seed.row.id+'/assistant';
it('requires a real active session, isolates owner before any HTTP and returns no-store metadata',async()=>{
 expect((await request(app()).get(path())).status).toBe(401);
 const foreign=await env.db.person('foreign');expect((await request(app()).get(path()).set('Authorization',bearer(foreign))).status).toBe(404);
 const response=await request(app()).get(path()).set('Authorization',bearer());expect(response.status).toBe(200);expect(response.headers['cache-control']).toBe('no-store');expect(response.body).toMatchObject({config:{enabled:false,mode:'hybrid'},configVersion:'1',available:true});expect(JSON.stringify(response.body)).not.toMatch(/xoxp|clientSecret|config_fingerprint/);expect(env.fixture.requests).toEqual([]);
});
it('real HTTP config CAS uses a string revision and rejects stale/extra authority fields',async()=>{
 let response=await request(app()).get(path()).set('Authorization',bearer());const original=response.body;
 response=await request(app()).put(path()).set('Authorization',bearer()).send({expectedVersion:original.configVersion,config:{...original.config,mode:'rules'}});expect(response.status).toBe(200);expect(response.body.configVersion).toBe('2');
 expect((await request(app()).put(path()).set('Authorization',bearer()).send({expectedVersion:'1',config:original.config})).status).toBe(409);
 expect((await request(app()).put(path()).set('Authorization',bearer()).send({expectedVersion:2,config:original.config})).status).toBe(400);
 expect((await request(app()).put(path()).set('Authorization',bearer()).send({expectedVersion:'2',config:original.config,atiUserId:seed.person.id})).status).toBe(400);
});
it('keeps preferences and Inbox metadata available when the automation flag is off',async()=>{
 const off=createPersonalSlackAssistantRuntime({pool:env.db.pool,encryptionKey:TEST_KEY,live:false,env:{...env.runtimeEnv,MYSLACK_ENABLED:'off',MYSLACK_AUTOMATION_ENABLED:'off'}})!;expect(off.runner).toBeUndefined();
 const response=await request(app(off)).get(path()).set('Authorization',bearer());expect(response.status).toBe(200);expect(response.body.available).toBe(false);
 expect((await request(app(off)).put(path()).set('Authorization',bearer()).send({expectedVersion:response.body.configVersion,config:{...response.body.config,enabled:true}})).status).toBe(503);
 expect((await request(app(off)).get('/api/slack/proposals').query({connectionId:seed.row.id}).set('Authorization',bearer())).body).toEqual({proposals:[]});
});
it('does not route a sandbox source to a native/non-loopback model',async()=>{
 const unsafe=createPersonalSlackAssistantRuntime({pool:env.db.pool,encryptionKey:TEST_KEY,live:false,env:{LLM_PROVIDER:'gemini',MYSLACK_ENABLED:'on',MYSLACK_AUTOMATION_ENABLED:'on',MYSLACK_APP_ID:'A_TEST'}})!;expect(unsafe.runner).toBeUndefined();expect((await unsafe.repo.getConfig(seed.person.id,seed.row.id)).available).toBe(false);expect(env.fixture.requests).toEqual([]);
});
it('follow updates accept only owned bounded metadata, with no Slack content request',async()=>{
 const payload={channelId:'C_TEST',threadTs:'1793549000.000001',follow:true};expect((await request(app()).put(path()+'/followed-threads').set('Authorization',bearer()).send(payload)).status).toBe(200);
 expect((await request(app()).put(path()+'/followed-threads').set('Authorization',bearer()).send({...payload,slackUserId:'U_OTHER'})).status).toBe(400);expect(env.fixture.requests).toEqual([]);
});
it('revoked processing consent blocks enable through the real route',async()=>{
 const current=(await request(app()).get(path()).set('Authorization',bearer())).body,consent=(await env.consentRepo.getConsent(seed.binding.workspaceId,env.runtimeIdentity.providerId))!;
 await env.consentRepo.revokeConsent({workspaceId:seed.binding.workspaceId,providerId:env.runtimeIdentity.providerId,expectedRevision:consent.revision,recordedBy:'fixture',reason:'fixture'});
 expect((await request(app()).put(path()).set('Authorization',bearer()).send({expectedVersion:current.configVersion,config:{...current.config,enabled:true}})).status).toBe(403);expect(env.fixture.requests).toEqual([]);
});
