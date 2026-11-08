const { execFileSync } = require('child_process');
const bin = 'C:\\Users\\Admin\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe';
const out = execFileSync(bin, [
  'orchestration', 'task-create',
  '--run', 'run_d989b8a87d57',
  '--task-title', 'Codex Re-Review PL-03 on HEAD 1b41b14c',
  '--spec', 'Re-review PL-03 after fixes F1-F8 on HEAD 1b41b14c',
  '--deps', '["task_0edfd142253e"]'
], { encoding: 'utf8' });
console.log(out);
