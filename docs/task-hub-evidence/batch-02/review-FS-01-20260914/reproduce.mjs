import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const outDir = path.dirname(fileURLToPath(import.meta.url));
const root = process.cwd();
const sourcePath = path.join(root, 'packages/engine/src/filesystem-paths.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {inspectFilesystemPath,readBoundedUtf8} = await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const started_at = new Date().toISOString();
const base = fs.mkdtempSync(path.join(os.tmpdir(),'ati-fs-review-'));
const userId = crypto.randomUUID();
const results=[];
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function owned(p){const rel=path.relative(base,path.resolve(p));if(!rel||rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error('not an owned child');return p;}
function fixture(name){const dir=owned(path.join(base,name));fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'.ati-root.json'),JSON.stringify({format:'ati-filesystem-root-1',root_id:crypto.randomUUID(),user_id:userId}));fs.writeFileSync(path.join(dir,'notes.txt'),'REVIEW_SENTINEL');return dir;}
async function rejected(id,fn){try {const v=await fn();results.push({id,expected:'REJECT',actual:'ACCEPT',returned_text:v?.expectedReadText??null});}catch(e){results.push({id,expected:'REJECT',actual:'REJECT',error:e.message});}}
try {
  const target=fixture('actual-root');const linked=owned(path.join(base,'linked-root'));
  fs.symlinkSync(target,linked,'junction');
  await rejected('root-junction',()=>inspectFilesystemPath(linked,'notes.txt','read',userId));
  const parent=owned(path.join(base,'actual-parent'));fs.mkdirSync(parent);
  const child=path.join(parent,'child');fs.mkdirSync(child);fs.copyFileSync(path.join(target,'.ati-root.json'),path.join(child,'.ati-root.json'));fs.writeFileSync(path.join(child,'notes.txt'),'ANCESTOR_SENTINEL');
  const ancestor=owned(path.join(base,'linked-parent'));fs.symlinkSync(parent,ancestor,'junction');
  await rejected('ancestor-junction',()=>inspectFilesystemPath(path.join(ancestor,'child'),'notes.txt','read',userId));
  const dangling=path.join(target,'dangling');fs.symlinkSync(path.join(base,'missing-dir'),dangling,'junction');
  results.push({id:'native-dangling-junction',existsSync:fs.existsSync(dangling),lstat_isSymbolicLink:fs.lstatSync(dangling).isSymbolicLink()});
  await rejected('dangling-junction-write',()=>inspectFilesystemPath(target,'dangling','write',userId));
  for (const [id,marker] of [['empty-root-id',{format:'ati-filesystem-root-1',root_id:'',user_id:userId}],['extra-marker-field',{format:'ati-filesystem-root-1',root_id:crypto.randomUUID(),user_id:userId,unexpected:true}]]){
    const dir=fixture(id);fs.writeFileSync(path.join(dir,'.ati-root.json'),JSON.stringify(marker));
    await rejected(id,()=>inspectFilesystemPath(dir,'notes.txt','read',userId));
  }
  const hard=fixture('hardlink-marker');const marker=path.join(hard,'.ati-root.json');fs.linkSync(marker,owned(path.join(base,'marker-alias.json')));
  await rejected('hardlink-marker',()=>inspectFilesystemPath(hard,'notes.txt','read',userId));
  for(const kind of ['file','junction','hardlink']){
    try {const link=owned(path.join(base,'capability-'+kind));if(kind==='hardlink')fs.linkSync(path.join(target,'notes.txt'),link);else fs.symlinkSync(kind==='file'?path.join(target,'notes.txt'):target,link,kind);results.push({id:'native-capability-'+kind,status:'AVAILABLE'});}catch(e){results.push({id:'native-capability-'+kind,status:'UNAVAILABLE',code:e.code});}
  }
  const shortFile=owned(path.join(base,'short.txt'));fs.writeFileSync(shortFile,'abcdef');
  const originalOpen=fs.promises.open;
  try {
    fs.promises.open=async (...args)=>{const h=await originalOpen.apply(fs.promises,args);const originalRead=h.read.bind(h);h.read=(buffer,offset,length,position)=>originalRead(buffer,offset,Math.min(3,length),position);return h;};
    results.push({id:'legal-short-read',scope:'fault injection: actual OS file, handle.read limited to 3 bytes',expected:'abcdef',actual:await readBoundedUtf8(shortFile)});
  } finally {fs.promises.open=originalOpen;}
} finally {
  const resolved=fs.realpathSync(base);const rel=path.relative(fs.realpathSync(os.tmpdir()),resolved);
  if(!rel||rel.startsWith('..')||path.isAbsolute(rel)||!path.basename(resolved).startsWith('ati-fs-review-'))throw Error('unsafe cleanup');
  fs.rmSync(resolved,{recursive:true,force:true});
}
const baseline=JSON.parse(fs.readFileSync('docs/antigravity/filesystem-handoff-baseline.json','utf8'));
const report=fs.readFileSync('docs/task-hub-evidence/batch-02/FS-01/FS-01.md','utf8');
const hashes=Object.entries(baseline.candidate_review.files_sha256).map(([f,expected])=>{const actual=sha(path.join('node_modules/@modelcontextprotocol/server-filesystem',f));return {file:f,baseline:expected,installed:actual,installed_matches_baseline:actual===expected,report_contains_actual:report.includes(actual)};});
const preservation=Object.fromEntries(['protected_sha256','source_sha256'].map(k=>[k,{count:Object.keys(baseline[k]).length,mismatches:Object.entries(baseline[k]).filter(([p,h])=>!fs.existsSync(p)||sha(p)!==h).map(([p])=>p)}]));
const result={started_at,finished_at:new Date().toISOString(),source_sha256:sha(sourcePath),results,hashes,preservation,cleanup:!fs.existsSync(base)};
fs.writeFileSync(path.join(outDir,'reproduction.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
