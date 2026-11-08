const { execFileSync } = require('child_process');
const bin = 'C:\\Users\\Admin\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe';
const out = execFileSync(bin, [
  'orchestration', 'task-create',
  '--run', 'run_d989b8a87d57',
  '--task-title', 'Codex Review PL-03',
  '--spec', 'Review PL-03 on HEAD 9cce7c25',
  '--deps', '["task_24e54f748b69"]'
], { encoding: 'utf8' });
console.log(out);
