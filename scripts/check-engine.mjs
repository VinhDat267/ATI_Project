// npm entry point; preserve historical G1 observations while running all current checks.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const npm=process.env.npm_execpath;
if(!npm)throw Error('Run via npm run check:engine');
const cwd=fileURLToPath(new URL('../',import.meta.url));
for(const args of [['run','check'],['run','test:integration','-w','@wap/mcp-task-hub'],['run','test:integration','-w','@wap/engine']]){
  const result=spawnSync(process.execPath,[npm,...args],{cwd,stdio:'inherit',windowsHide:true,env:{...process.env,ATI_TEST_EVIDENCE_PROFILE:'engine'}});
  if(result.error)throw result.error;
  if(result.status!==0){process.exitCode=result.status??1;break;}
}
