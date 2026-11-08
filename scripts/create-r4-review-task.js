const { execFileSync } = require('child_process');
const bin = 'C:\\Users\\Admin\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe';
const out = execFileSync(bin, [
  'orchestration', 'task-create',
  '--run', 'run_d989b8a87d57',
  '--task-title', 'Codex Re-Review PL-03 Round 4 on HEAD 5633e6b8',
  '--spec', 'Re-review PL-03 Round 4 after fix C1 on HEAD 5633e6b8',
  '--deps', '["task_3062afc8d024"]'
], { encoding: 'utf8' });
console.log(out);
