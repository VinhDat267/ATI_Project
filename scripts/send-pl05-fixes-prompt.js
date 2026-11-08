const fs = require('fs');
const { execFileSync } = require('child_process');

const promptText = fs.readFileSync('docs/handoff/planora-prompts/worker-pl05-fixes-spec.txt', 'utf8');
const bin = 'C:\\Users\\Admin\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe';

const out = execFileSync(bin, [
  'terminal', 'send',
  '--terminal', 'term_244187ba-fdfe-4fdd-85d8-558213e43ae9',
  '--text', promptText,
  '--enter'
], { encoding: 'utf8' });

console.log(out);
