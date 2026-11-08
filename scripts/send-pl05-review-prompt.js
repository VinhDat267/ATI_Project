const fs = require('fs');
const { execFileSync } = require('child_process');

const promptText = fs.readFileSync('docs/handoff/planora-prompts/review-pl05-spec.txt', 'utf8');
const bin = 'C:\\Users\\Admin\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe';

const out = execFileSync(bin, [
  'terminal', 'send',
  '--terminal', 'term_5fcc93d6-58b2-4cc1-aab2-8dadc5e56eae',
  '--text', promptText,
  '--enter'
], { encoding: 'utf8' });

console.log(out);
