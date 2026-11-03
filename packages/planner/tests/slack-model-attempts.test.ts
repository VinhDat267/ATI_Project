import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import {it,expect} from 'vitest';
import {GoogleGenAI} from '@google/genai';
import {OpenAICompatibleProvider} from '../src/providers/openai-compatible-provider.js';
import {GeminiProvider,type GeminiClient} from '../src/providers/gemini-provider.js';
const baseInput=()=>({systemPrompt:'classify untrusted source',conversationHistory:[{role:'user' as const,content:'source fixture'}],toolCatalog:[],workingMemory:{}});
async function fixture(run:(origin:string,requests:any[])=>Promise<void>,kind:'openai'|'gemini'='openai',firstFailure=false){
 const requests:any[]=[];
 const server=createServer(async(req:IncomingMessage,res:ServerResponse)=>{
  let raw='';for await(const part of req)raw+=part;requests.push({path:req.url,body:JSON.parse(raw)});res.setHeader('content-type','application/json');
  if(firstFailure&&requests.length===1){res.statusCode=503;res.end(JSON.stringify({error:{message:'fixture transient',code:503}}));return;}
  res.end(JSON.stringify(kind==='openai'?{model:'fixture',choices:[{message:{content:'{"kind":"no_action"}'}}],usage:{prompt_tokens:20,completion_tokens:10}}:{candidates:[{content:{role:'model',parts:[{text:'{"kind":"no_action"}'}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:8,candidatesTokenCount:3,thoughtsTokenCount:2,totalTokenCount:13}}));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`,requests);}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
it('gates and caps each real HTTP gateway attempt including transient retry',async()=>{
 await fixture(async(origin,requests)=>{
  let gates=0;const provider=new OpenAICompatibleProvider({baseUrl:origin+'/v1',model:'fixture',maxRetries:1,retryDelayMs:1});
  const text=await provider.generatePlan({...baseInput(),maxOutputTokens:512,beforeModelAttempt:async(signal:AbortSignal)=>{expect(signal.aborted).toBe(false);gates++;}} as any);
  expect(JSON.parse(text).kind).toBe('no_action');expect(gates).toBe(2);expect(requests).toHaveLength(2);
  expect(requests.map(r=>r.body.max_completion_tokens)).toEqual([512,512]);
 },'openai',true);
});
it('a private gate can veto the next retry before another provider request',async()=>{
 await fixture(async(origin,requests)=>{
  let gates=0;const provider=new OpenAICompatibleProvider({baseUrl:origin+'/v1',model:'fixture',maxRetries:2,retryDelayMs:1});
  await expect(provider.generatePlan({...baseInput(),maxOutputTokens:512,beforeModelAttempt:async()=>{if(++gates===2)throw new Error('MODEL_ATTEMPT_DENIED');}} as any)).rejects.toThrow('MODEL_ATTEMPT_DENIED');
  expect(gates).toBe(2);expect(requests).toHaveLength(1);
 },'openai',true);
});
it('an actual signal aborted by the gate prevents dispatch even when the callback returns',async()=>{
 await fixture(async(origin,requests)=>{
  const controller=new AbortController(),provider=new OpenAICompatibleProvider({baseUrl:origin+'/v1',model:'fixture'});
  await expect(provider.generatePlan({...baseInput(),signal:controller.signal,maxOutputTokens:512,beforeModelAttempt:async()=>{controller.abort();}} as any)).rejects.toBeDefined();
  expect(requests).toHaveLength(0);
 });
});
it('bounds native Gemini SDK output and disables its internal retry so every retry is gated',async()=>{
 await fixture(async(origin,requests)=>{
  let gates=0;const client=new GoogleGenAI({apiKey:'fixture',httpOptions:{baseUrl:origin,retryOptions:{attempts:3,initialDelay:0.001,maxDelay:0.001}}});
  const provider=new GeminiProvider({apiKey:'fixture',model:'fixture',client:client as unknown as GeminiClient,maxRetries:2,retryDelayMs:1});
  await expect(provider.generatePlan({...baseInput(),maxOutputTokens:512,beforeModelAttempt:async()=>{if(++gates===2)throw new Error('MODEL_ATTEMPT_DENIED');}} as any)).rejects.toThrow('MODEL_ATTEMPT_DENIED');
  expect(gates).toBe(2);expect(requests).toHaveLength(1);expect(requests[0].body.generationConfig.maxOutputTokens).toBe(512);
 },'gemini',true);
});
it.each([0,-1,Infinity,1.5])('rejects malformed output cap%s before network',async cap=>{
 await fixture(async(origin,requests)=>{
  const provider=new OpenAICompatibleProvider({baseUrl:origin+'/v1',model:'fixture'});
  await expect(provider.generatePlan({...baseInput(),maxOutputTokens:cap,beforeModelAttempt:async()=>{}} as any)).rejects.toThrow();expect(requests).toHaveLength(0);
 });
});

it('records reported Gemini usage from the actual SDK response separately from reservation caps',async()=>{
 await fixture(async(origin)=>{
  const client=new GoogleGenAI({apiKey:'fixture-only',httpOptions:{baseUrl:origin,apiVersion:'v1beta'}});
  const provider=new GeminiProvider({apiKey:'fixture-only',model:'fixture',client:client as unknown as GeminiClient,maxRetries:0});
  await provider.generatePlan({...baseInput(),maxOutputTokens:512,beforeModelAttempt:async()=>{}});
  expect(provider.lastCallMetrics?.usage).toEqual({promptTokens:8,completionTokens:3,reasoningTokens:2,totalTokens:13});
 },'gemini');
});
