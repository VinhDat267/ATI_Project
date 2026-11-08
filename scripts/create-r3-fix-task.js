const { execFileSync } = require('child_process');
const bin = 'C:\\Users\\Admin\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe';
const out = execFileSync(bin, [
  'orchestration', 'task-create',
  '--run', 'run_d989b8a87d57',
  '--task-title', 'Codex Re-Review Finding C1 (PL-03)',
  '--spec', 'Sửa finding C1 từ Codex re-review vòng 3 PL-03 trên HEAD 5da40a11',
  '--deps', '["task_05b7d88956a7"]'
], { encoding: 'utf8' });
console.log(out);
