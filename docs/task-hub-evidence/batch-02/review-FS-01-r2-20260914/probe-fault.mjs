import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
const mode=process.argv[2];
if(!['missing-structured','connect-error','close-error'].includes(mode))throw Error('Invalid mode');
if(!process.env.ATI_EVIDENCE_DIR)throw Error('Use captured fresh evidence directory');
const originalCall=Client.prototype.callTool;
const originalConnect=Client.prototype.connect;
const originalClose=Client.prototype.close;
if(mode==='missing-structured')Client.prototype.callTool=async function(...args){const result=await originalCall.apply(this,args);delete result.structuredContent;return result;};
if(mode==='connect-error')Client.prototype.connect=async function(){throw Error('REVIEW_CONNECT_FAILURE');};
if(mode==='close-error')Client.prototype.close=async function(...args){await originalClose.apply(this,args);throw Error('REVIEW_CLOSE_FAILURE_AFTER_REAL_CLOSE');};
try {await import(pathToFileURL(path.resolve('scripts/probe-filesystem-candidate.mjs')).href);}
finally {Client.prototype.callTool=originalCall;Client.prototype.connect=originalConnect;Client.prototype.close=originalClose;}
const exit=process.exitCode??0;
const record=JSON.parse(fs.readFileSync(path.join(process.env.ATI_EVIDENCE_DIR,'filesystem-candidate-probe.json'),'utf8'));
const expectedError=mode==='missing-structured'?'structuredContent':mode==='connect-error'?'REVIEW_CONNECT_FAILURE':'REVIEW_CLOSE_FAILURE_AFTER_REAL_CLOSE';
const error=mode==='close-error'?record.cleanup.close_error:record.error;
const ok=exit===1&&record.verdict==='FAIL'&&record.cleanup.temp_root_removed&&typeof error==='string'&&error.includes(expectedError);
const outcome={mode,scope:'REVIEW FAULT INJECTION ONLY, no installed source modified',probe_exit:exit,probe_verdict:record.verdict,expected_error:expectedError,observed_error:error,cleanup:record.cleanup,status:ok?'PASS':'FAIL'};
fs.writeFileSync(path.join(process.env.ATI_EVIDENCE_DIR,'fault-verification.json'),JSON.stringify(outcome,null,2)+'\n');
console.log(JSON.stringify(outcome));process.exitCode=ok?0:1;
