const { execFileSync } = require('child_process');
const bin = 'C:\\Users\\Admin\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe';
const out = execFileSync(bin, [
  'orchestration', 'task-create',
  '--run', 'run_d989b8a87d57',
  '--task-title', 'Codex Re-Review PL-03 Round 3 on HEAD 5da40a11',
  '--spec', 'Re-review PL-03 Round 3 after fixes R1-R3 on HEAD 5da40a11',
  '--deps', '["task_79712f70cbbd"]'
], { encoding: 'utf8' });
console.log(out);
