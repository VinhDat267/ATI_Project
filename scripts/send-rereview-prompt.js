const fs = require('fs');
const { execFileSync } = require('child_process');

const promptText = fs.readFileSync('docs/handoff/planora-prompts/review-pl03-r2-spec.txt', 'utf8');
const bin = 'C:\\Users\\Admin\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe';

const out = execFileSync(bin, [
  'terminal', 'send',
  '--terminal', 'term_5c7f5431-d65c-46e1-afd3-d9cc5a7c1470',
  '--text', promptText,
  '--enter'
], { encoding: 'utf8' });

console.log(out);
