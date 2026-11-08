const fs = require('fs');
const { execFileSync } = require('child_process');

const promptText = fs.readFileSync('docs/handoff/planora-prompts/review-pl05-r7-spec.txt', 'utf8');
const bin = 'C:\\Users\\Admin\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe';

const out = execFileSync(bin, [
  'terminal', 'send',
  '--terminal', 'term_da766dd7-fe75-4380-94e6-7b1f6cebfd65',
  '--text', promptText,
  '--enter'
], { encoding: 'utf8' });

console.log(out);
