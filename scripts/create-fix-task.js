const { execFileSync } = require('child_process');
const bin = 'C:\\Users\\Admin\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe';
const out = execFileSync(bin, [
  'orchestration', 'task-create',
  '--run', 'run_d989b8a87d57',
  '--task-title', 'Codex Review Findings (PL-03)',
  '--spec', 'Sửa findings F1-F8 từ Codex review PL-03 trên HEAD 9cce7c25',
  '--deps', '["task_d32b50b49dcc"]'
], { encoding: 'utf8' });
console.log(out);
