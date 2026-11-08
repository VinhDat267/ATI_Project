const fs = require('fs');
const { execFileSync } = require('child_process');

const promptText = fs.readFileSync('docs/handoff/planora-prompts/review-pl05-r2-spec.txt', 'utf8');
const bin = 'C:\\Users\\Admin\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe';

const out = execFileSync(bin, [
  'terminal', 'send',
  '--terminal', 'term_1f2faf21-aaaf-4a3e-aa67-ba715cd74d5c',
  '--text', promptText,
  '--enter'
], { encoding: 'utf8' });

console.log(out);
