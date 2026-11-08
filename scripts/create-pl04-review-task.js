const { execFileSync } = require('child_process');
const bin = 'C:\\Users\\Admin\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe';
const out = execFileSync(bin, [
  'orchestration', 'task-create',
  '--run', 'run_d989b8a87d57',
  '--task-title', 'Codex Review PL-04',
  '--spec', 'Independent review PL-04 Advanced Auth on HEAD f23bbff4',
  '--deps', '["task_e2c93836360d"]'
], { encoding: 'utf8' });
console.log(out);
