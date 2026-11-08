const fs = require('fs');
const { execFileSync } = require('child_process');

const promptText = fs.readFileSync('docs/handoff/planora-prompts/worker-pl03-r2-fixes-spec.txt', 'utf8');
const bin = 'C:\\Users\\Admin\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe';

const out = execFileSync(bin, [
  'terminal', 'send',
  '--terminal', 'term_2978ae29-5664-47d4-99bf-68102a118b6c',
  '--text', promptText,
  '--enter'
], { encoding: 'utf8' });

console.log(out);
