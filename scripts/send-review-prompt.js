const fs = require('fs');
const { execFileSync } = require('child_process');

const promptText = fs.readFileSync('docs/handoff/planora-prompts/review-pl03-spec.txt', 'utf8');
const bin = 'C:\\Users\\Admin\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe';

const out = execFileSync(bin, [
  'terminal', 'send',
  '--terminal', 'term_fa25609a-4bd8-4638-99a0-06654f0e2187',
  '--text', promptText,
  '--enter'
], { encoding: 'utf8' });

console.log(out);
