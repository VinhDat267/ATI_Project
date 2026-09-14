import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';
import { openDatabase, migrate, seedDemo, G1_DATABASE_URL, DEMO_USER_ID } from '@wap/db';
import { WorkflowPlanSchema, TraceSchema } from '@wap/dsl';
import { WorkflowEngine, openLocalGateway } from '@wap/engine';

const dir=fileURLToPath(new URL('./',import.meta.url));
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const baseline=JSON.parse(readFileSync(path.join(dir,'before.json'),'utf8'));
const verifyProtected=()=>{
  for(const [p,hash] of Object.entries(baseline.protected_sha256))
    assert.equal(createHash('sha256').update(readFileSync(path.join(root,p))).digest('hex'),hash,p);
};
const name='engine_it_'+randomUUID().replaceAll('-','');
const address=new URL(G1_DATABASE_URL);
assert.ok(['127.0.0.1','localhost'].includes(address.hostname));
assert.equal(address.pathname,'/wap_g1');
address.pathname='/'+name;
const url=address.href, user=DEMO_USER_ID;
const admin=postgres(G1_DATABASE_URL,{max:1,onnotice:()=>{}});
let db,raw,gateway,created=false;
const results=[];
const report={recorded_at:null,status:'FAILED',database:name,database_dropped:false,scope:'REAL_CONTROLLER_POSTGRESQL_MCP_AND_CLI',results};
const decision=r=>({approval_id:r.approval.id,workflow_version_id:r.workflow_version_id,snapshot_hash:r.approval.snapshot_hash,decision:'approved'});
const move=()=>WorkflowPlanSchema.parse(JSON.parse(readFileSync(path.join(root,'testdata/dev-hand-plans/th-move.json'),'utf8')));
const create=()=>WorkflowPlanSchema.parse({version:'1.0',name:'Independent create then notify',source_prompt:'Create review card',steps:[
  {id:'create',description:'Create card',tool:{server:'task_hub',name:'create_card',args:{board_id:'board_a',list_name:'Backlog',title:'Independent TH06'}},side_effect:'write',depends_on:[],idempotency_key:'${runtime.run_id}_create'},
  {id:'notify',description:'Notify',tool:{server:'task_hub',name:'send_slack_message',args:{channel:'#team',text:'Created independent card'}},side_effect:'write',depends_on:['create'],idempotency_key:'${runtime.run_id}_notify'}
],outputs:{}});
const card=async()=> (await raw`SELECT card_id,list_name,title,updated_at::text FROM hub_cards WHERE user_id=${user} AND card_id='c1'`)[0];
const receipts=async runId=>await raw`SELECT r.operation_id,r.tool_name,r.result FROM hub_receipts r JOIN tool_operations o ON o.operation_id=r.operation_id AND o.user_id=r.user_id WHERE o.run_id=${runId} ORDER BY r.operation_id`;
const counts=async()=>({cards:(await raw`SELECT count(*)::int n FROM hub_cards WHERE user_id=${user}`)[0].n,messages:(await raw`SELECT count(*)::int n FROM hub_messages WHERE user_id=${user}`)[0].n,receipts:(await raw`SELECT count(*)::int n FROM hub_receipts WHERE user_id=${user}`)[0].n});
const cliCalls=[];
const cli=async(...args)=>{
  const started=new Date().toISOString();
  const {stdout}=await promisify(execFile)(process.execPath,[path.join(root,'packages/engine/dist/cli.js'),...args],{cwd:root,windowsHide:true,timeout:20000,env:{...process.env,G1_DATABASE_URL:url,G1_USER_ID:user,ATI_EVIDENCE_DIR:path.relative(root,dir)}});
  cliCalls.push({command:args[0],started_at:started,finished_at:new Date().toISOString(),exit_code:0});
  return JSON.parse(stdout);
};
const record=(name,evidence)=>results.push({name,status:'PASS',evidence});
const seed=async()=>{await raw`TRUNCATE users CASCADE`;await seedDemo(db);};
try {
  verifyProtected();
  await admin.unsafe(`CREATE DATABASE "${name}"`);created=true;
  await migrate(url);db=openDatabase(url);raw=db.client;await seedDemo(db);
  gateway=await openLocalGateway({root,databaseUrl:url,userId:user});
  const engine=new WorkflowEngine(db,gateway,user);

  // All authorization here comes from real prepare/decide or separate CLI processes.
  const run=await cli('prepare',path.join(root,'testdata/dev-hand-plans/th-move.json'));
  assert.equal(run.status,'awaiting_approval');assert.equal(run.approval.actions.length,2);
  assert.deepEqual(await counts(),{cards:2,messages:0,receipts:0});
  const preview=await cli('preview',run.run_id);
  assert.equal(preview.read_outputs.read.title,'Viết API');
  await raw`UPDATE hub_cards SET title='Changed after CLI preview' WHERE user_id=${user} AND card_id='c1'`;
  await cli('approve',run.run_id,run.approval.id,run.workflow_version_id,run.approval.snapshot_hash);
  assert.equal((await cli('execute',run.run_id)).status,'succeeded');
  const trace=TraceSchema.parse(await cli('trace',run.run_id));
  assert.equal(trace.attempts.length,3);assert.ok(trace.attempts.every(a=>a.ended_at&&a.outcome_certainty==='confirmed'));
  assert.equal((await card()).list_name,'Done');
  assert.deepEqual([...(await raw`SELECT channel,text FROM hub_messages WHERE user_id=${user}`)],[{channel:'#team',text:'Đã chuyển Viết API sang Done.'}]);
  assert.equal((await raw`SELECT id FROM approvals WHERE run_id=${run.run_id}`).length,1);
  assert.equal((await receipts(run.run_id)).length,2);
  record('Separate CLI processes preserve the previewed title and exact two-write approval',{run_id:run.run_id,cli_calls:cliCalls,card:await card(),receipts:await receipts(run.run_id),trace});

  for(const kind of ['create','move']) for(const mode of ['response_loss','process_crash']) {
    await seed();
    const calls=[];let lost=false;
    const lossy={...gateway,async call(...args){
      const response=await gateway.call(...args);calls.push({name:args[0],authorized:!!args[2],isError:!!response.isError});
      if(args[2]&&!response.isError&&!lost){lost=true;throw Error('Independent response loss after committed receiver result');}
      return response;
    }};
    const worker=new WorkflowEngine(db,mode==='response_loss'?lossy:gateway,user);
    const r=await worker.prepare(kind==='create'?create():move());
    const before=await counts();assert.deepEqual(before,{cards:2,messages:0,receipts:0});
    await worker.decide(r.run_id,decision(r));
    let exitCode=null,recovery=null;
    if(mode==='response_loss') assert.equal((await worker.execute(r.run_id)).status,'reconciliation_required');
    else {
      exitCode=await promisify(execFile)(process.execPath,[path.join(root,'packages/engine/tests/crash-worker.mjs'),url,user,r.run_id,root],{windowsHide:true,timeout:20000,env:{...process.env,ATI_EVIDENCE_DIR:path.relative(root,dir)}}).then(()=>0,e=>e.code);
      assert.equal(exitCode,86);assert.equal((await worker.detail(r.run_id)).status,'running');
    }
    const inspector=new WorkflowEngine(db,undefined,user);
    if(mode==='process_crash'){
      recovery=await inspector.recoverOrphans();
      assert.deepEqual(recovery,[{run_id:r.run_id,status:'reconciliation_required'}]);
    }
    const beforeReconcile=TraceSchema.parse(await inspector.trace(r.run_id));
    const writeAttempt=beforeReconcile.attempts.find(a=>a.step_id===kind);
    assert.ok(writeAttempt?.ended_at);assert.equal(writeAttempt.outcome_certainty,'unknown');
    assert.equal(beforeReconcile.attempts.length,kind==='create'?1:2);
    const rs=await receipts(r.run_id);assert.equal(rs.length,1);assert.equal(rs[0].tool_name,kind+'_card');
    if(kind==='create'){
      const rows=await raw`SELECT card_id,title,list_name FROM hub_cards WHERE user_id=${user} AND card_id=${rs[0].result.id}`;
      assert.deepEqual([...rows],[{card_id:rs[0].result.id,title:'Independent TH06',list_name:'Backlog'}]);
    } else {assert.equal((await card()).list_name,'Done');assert.deepEqual(rs[0].result,{id:'c1',list_name:'Done'});}
    const expectedCounts={cards:kind==='create'?3:2,messages:0,receipts:1};assert.deepEqual(await counts(),expectedCounts);
    const rec=await inspector.reconcile(r.run_id);
    assert.equal(rec.read_only,true);
    const op=rec.operations.find(o=>o.step_id===kind);
    assert.equal(op.operation_id,rs[0].operation_id);assert.equal(op.state,'unknown');assert.equal(op.receipt,'confirmed');assert.deepEqual(op.result,rs[0].result);
    assert.deepEqual(await inspector.trace(r.run_id),beforeReconcile);
    assert.equal((await inspector.detail(r.run_id)).status,'reconciliation_required');
    assert.deepEqual(await inspector.recoverOrphans(),[]);
    await assert.rejects(engine.execute(r.run_id),e=>e.code==='CONFLICT');
    assert.deepEqual(await counts(),expectedCounts);
    assert.deepEqual(await inspector.trace(r.run_id),beforeReconcile);
    if(mode==='response_loss') assert.equal(calls.filter(c=>c.authorized).length,1);
    record(kind+' '+mode+': committed receipt survives; inspection/recovery never resumes',{run_id:r.run_id,exit_code:exitCode,calls,recovery,inspection:rec,counts:await counts(),trace:beforeReconcile});
  }
  for(const kind of ['create','move']){
    await seed();const r=await engine.prepare(kind==='create'?create():move());await engine.decide(r.run_id,decision(r));
    const otherGateway=await openLocalGateway({root,databaseUrl:url,userId:user});
    try {
      const second=new WorkflowEngine(db,otherGateway,user);
      const settled=await Promise.allSettled([engine.execute(r.run_id),second.execute(r.run_id)]);
      assert.equal(settled.filter(s=>s.status==='fulfilled').length,1);
      assert.equal(settled.find(s=>s.status==='fulfilled').value.status,'succeeded');
      assert.ok(['BUSY','CONFLICT'].includes(settled.find(s=>s.status==='rejected').reason.code));
      await assert.rejects(engine.execute(r.run_id),e=>e.code==='CONFLICT');
      assert.deepEqual(await counts(),{cards:kind==='create'?3:2,messages:1,receipts:2});
      if(kind==='move')assert.equal((await card()).list_name,'Done');
      record(kind+' concurrent claims through separate real gateways execute once',{run_id:r.run_id,receipts:await receipts(r.run_id),counts:await counts()});
    } finally {await otherGateway.close();}
  }
  verifyProtected();report.protected_files=Object.keys(baseline.protected_sha256).length;report.status='PASS';
} catch(error) { report.error={name:error.name,message:error.message,stack:error.stack};process.exitCode=1; }
finally {
  await gateway?.close();await db?.close();
  if(created){await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);report.database_dropped=true;}
  await admin.end();report.recorded_at=new Date().toISOString();
  writeFileSync(path.join(dir,'probe-'+Date.now()+'.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,groups:results.length,database_dropped:report.database_dropped,error:report.error}));
}
