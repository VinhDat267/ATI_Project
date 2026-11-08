const { execFileSync } = require('child_process');
const bin = 'C:\\Users\\Admin\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe';
const out = execFileSync(bin, [
  'orchestration', 'task-create',
  '--run', 'run_d989b8a87d57',
  '--task-title', 'Codex Re-Review Findings R1-R3 (PL-03)',
  '--spec', 'Sửa findings R1-R3 từ Codex re-review vòng 2 PL-03 trên HEAD 1b41b14c',
  '--deps', '["task_8cab7157f5ea"]'
], { encoding: 'utf8' });
console.log(out);
