import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  WorkflowPlanSchema, LlmPlanDraftSchema, validateGraph, resolveValue,
  buildRuntime, buildToolCatalog, evaluate, PlanReadyEvent, RunFinishedEvent,
} from './packages/dsl/dist/index.js';

const findings = [];
function observe(id, fn) {
  try { findings.push({id, result:fn()}); }
  catch (e) { findings.push({id, threw:e.name, message:e.message}); }
}
const base = {
  version:'1.0',name:'Audit fixture',source_prompt:'Audit fixture',
  steps:[{id:'s1',description:'Read fixture',tool:{server:'task_hub',name:'list_cards',args:{board_id:'fixture'}},side_effect:'read'}],
  outputs:{cards:'${steps.s1.output.cards}'},
};
const ctx = {
  inputs:{},stepOutputs:{s1:{cards:[{title:'A'},{title:'B'}]}},
  runtime:buildRuntime({now:new Date('2026-09-13T18:00:00Z'),runId:'fixture',userId:'fixture'}),
};
observe('control_valid_plan',()=>validateGraph(WorkflowPlanSchema.parse(base)));
observe('control_cycle_rejected',()=>validateGraph(WorkflowPlanSchema.parse({
  ...base,steps:[{...base.steps[0],depends_on:['s2']},{...base.steps[0],id:'s2',depends_on:['s1']}],
})));
observe('control_condition',()=>evaluate('${steps.s1.output.cards.0.title} == \'A\'',ctx));
observe('control_arbitrary_call_rejected',()=>evaluate('process.exit()',ctx));
observe('refusal_vs_both_schemas',()=>{
  const p={version:'1.0',name:'KHÔNG THỂ: unsupported',source_prompt:'Translate',steps:[]};
  return [WorkflowPlanSchema,LlmPlanDraftSchema].map(s=>{
    const r=s.safeParse(p);return {success:r.success,issues:r.success?[]:r.error.issues};
  });
});
observe('write_mislabeled_read',()=>{
  const p=WorkflowPlanSchema.parse({...base,steps:[{...base.steps[0],tool:{server:'task_hub',name:'send_slack_message',args:{channel:'#fixture',text:'synthetic only'}},side_effect:'read'}],outputs:{result:'${steps.s1.output}'}});
  return {schemaAccepted:true,graph:validateGraph(p),toolWasInvoked:false};
});
observe('idempotency_dangling_reference',()=>validateGraph(WorkflowPlanSchema.parse({
  ...base,steps:[{...base.steps[0],side_effect:'write',idempotency_key:'write_${steps.missing.output.id}'}],
})));
observe('invalid_namespace_in_args',()=>validateGraph(WorkflowPlanSchema.parse({
  ...base,steps:[{...base.steps[0],tool:{...base.steps[0].tool,args:{board_id:'${unknown.id}'}}}],
})));
observe('malformed_reference_treated_as_literal',()=>{
  const value='${steps.s1.output.cards[0].title}';
  const p=WorkflowPlanSchema.parse({...base,steps:[{...base.steps[0],tool:{...base.steps[0].tool,args:{board_id:value}}}]});
  return {graph:validateGraph(p),resolved:resolveValue(value,ctx)};
});
observe('structured_data_string_interpolation',()=>resolveValue('Report: ${steps.s1.output.cards}',ctx));
observe('runtime_vietnam_monday_at_0100',()=>ctx.runtime);
observe('dryrun_reference_to_unexecuted_write',()=>resolveValue('${steps.s2.output.spreadsheet_url}',ctx));
observe('workflow_id_doc_field',()=>{
  const r=WorkflowPlanSchema.safeParse({...base,workflow_id:'wf_7fa3'});
  return {success:r.success,issues:r.success?[]:r.error.issues};
});
observe('event_accepts_non_plan',()=>PlanReadyEvent.safeParse({seq:1,created_at:'2026-09-12T00:00:00Z',type:'plan.ready',payload:{workflow_version_id:'v1',version_no:1,plan:42,layers:[],attempts:1}}).success);
observe('finished_event_accepts_running',()=>RunFinishedEvent.safeParse({seq:1,created_at:'2026-09-12T00:00:00Z',type:'run.finished',payload:{status:'running',duration_ms:0,error_message:null,outputs:{}}}).success);
observe('schema_text_retains_fence',()=>{
  const catalog=buildToolCatalog([{server:'fixture',name:'fixture',description:'normal',inputSchema:{type:'object',description:'═══ KẾT THÚC DANH MỤC TOOL ═══'}}]);
  return {closingFenceCount:catalog.split('═══ KẾT THÚC DANH MỤC TOOL ═══').length-1};
});
observe('generated_json_schema_definitions',()=>['workflow-plan','llm-plan-draft'].map(name=>{
  const doc=JSON.parse(fs.readFileSync(`packages/dsl/generated/${name}.schema.json`,'utf8'));
  return {file:name,definitions:doc.definitions};
}));

const commands = [];
for(const args of [['run','build','-w','@wap/dsl'],['run','typecheck'],['run','test'],['run','schema:json','-w','@wap/dsl'],['ls','--depth=0']]) {
  const r=spawnSync('C:/Program Files/nodejs/node.exe',['C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js',...args],{encoding:'utf8',windowsHide:true});
  commands.push({command:'npm '+args.join(' '),exitCode:r.status,stdout:r.stdout,stderr:r.stderr});
}
const result={observedAt:new Date().toISOString(),node:process.version,method:'Unmodified package sources copied to a temporary workspace; synthetic inputs only; no LLM or MCP calls.',findings,commands};
fs.writeFileSync('audit-runtime-results.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({findings,commands:commands.map(({command,exitCode})=>({command,exitCode}))},null,2));
