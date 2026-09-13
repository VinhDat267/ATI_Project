// Run from any cwd after npm run check. Read-only apart from this directory's result JSON.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import { createRequire } from 'node:module';
import { RunStatusSchema } from '@wap/dsl';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const { Ajv2020 } = createRequire(path.join(root,'packages/dsl/package.json'))('ajv/dist/2020.js');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const spec = parse(read('docs/openapi.yaml'));
const failures = [];
let refs = 0;
function visit(value) {
  if (!value || typeof value !== 'object') return;
  if (typeof value.$ref === 'string' && value.$ref.startsWith('#/')) {
    refs++;
    let target = spec;
    for (const part of value.$ref.slice(2).split('/')) target = target?.[part.replaceAll('~1','/').replaceAll('~0','~')];
    if (target === undefined) failures.push(`Unresolved OpenAPI reference: ${value.$ref}`);
  }
  for (const child of Object.values(value)) visit(child);
}
visit(spec);
const ajv = new Ajv2020({ strict: false, validateFormats: false });
const validators = {};
for (const name of Object.keys(spec.components.schemas)) {
  validators[name] = ajv.compile({ ...spec, $ref: `#/components/schemas/${name}` });
}
const fixtures = JSON.parse(read('testdata/test-cases.json'));
const validPlan = fixtures.cases.find(c=>c.expected_result.kind === 'plan').expected_result.plan;
if (!validators.WorkflowPlan(validPlan) || validators.WorkflowPlan({...validPlan,steps:[]})) failures.push('WorkflowPlan JSON Schema lost constraints');
const planning = {run_id:'r',status:'planning',workflow_version_id:null,plan:null,planner_result:null,approval:null,time_zone:'Asia/Ho_Chi_Minh',runtime:{},last_seq:0};
if (!validators.RunDetail(planning) || validators.RunDetail({...planning,plan:42})) failures.push('RunDetail plan contract is not typed');
const base = {seq:1,created_at:'2026-09-13T00:00:00Z',type:'run.finished'};
if (!validators.RunEvent({...base,payload:{status:'succeeded',duration_ms:1,error_message:null}}) || validators.RunEvent({...base,payload:{status:'running',duration_ms:1,error_message:null}})) failures.push('Terminal event contract broken');
const initial = read('db/migrations/0001_init.sql');
const migration = read('db/migrations/0002_audit_contracts.sql');
const block = initial.match(/CREATE TYPE run_status\s+AS ENUM\s*\(([\s\S]*?)\);/)[1].replace(/--[^\n]*/g,'');
const sqlStatuses = [...block.matchAll(/'([^']+)'/g)].map(m=>m[1]);
sqlStatuses.push(...[...migration.matchAll(/ALTER TYPE run_status ADD VALUE IF NOT EXISTS '([^']+)'/g)].map(m=>m[1]));
if (JSON.stringify([...sqlStatuses].sort()) !== JSON.stringify([...RunStatusSchema.options].sort())) failures.push('SQL/Zod run status drift');
let links = 0;
function walk(dir) {
  for (const item of fs.readdirSync(dir,{withFileTypes:true})) {
    if (['node_modules','dist','generated','archive','audit-evidence'].includes(item.name)) continue;
    const full = path.join(dir,item.name);
    if (item.isDirectory()) { walk(full); continue; }
    if (!item.name.endsWith('.md')) continue;
    const markdown = fs.readFileSync(full,'utf8').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
    for (const match of markdown.matchAll(/\]\((?:<([^>]+)>|([^)]+))\)/g)) {
      let target = match[1] ?? match[2];
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      target = target.split('#')[0].replace(/:\d+$/,'');
      links++;
      const resolved = path.isAbsolute(target) ? target : path.resolve(path.dirname(full),target);
      if (!fs.existsSync(resolved)) failures.push(`Broken local link in ${path.relative(root,full)}: ${target}`);
    }
  }
}
walk(root);
const fr = [...read('docs/functional-requirements.md').matchAll(/^\| FR-[^|]+\|[^\n]+\| (M|S|OUT) \|$/gm)];
const result = { checked_at:new Date().toISOString(), node:process.version,
  schema_count:Object.keys(validators).length, openapi_local_refs_checked:refs,
  operations:Object.values(spec.paths).reduce((n,p)=>n+Object.keys(p).filter(k=>['get','post','patch','delete','put'].includes(k)).length,0),
  sql_zod_run_statuses:sqlStatuses.length, current_markdown_local_links_checked:links,
  requirements:fr.length, requirements_by_profile:Object.fromEntries(['M','S','OUT'].map(k=>[k,fr.filter(r=>r[1]===k).length])),
  cases:fixtures.cases.length, package_lock_sha256:createHash('sha256').update(read('package-lock.json')).digest('hex'),
  limitations:['JSON Schema structural checks do not replace Zod refinements or runtime authorization','This script checks static artifacts only; PostgreSQL and 3 MCP tools are verified separately in check-g1.log/runtime-snapshot.json; controller/HTTP/engine/LLM/browser E2E remain NOT_RUN'], failures };
fs.writeFileSync(new URL('artifact-verification.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
if (failures.length) process.exitCode=1;
