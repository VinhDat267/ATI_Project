const fs = require('fs');
const { execFileSync } = require('child_process');

const promptText = fs.readFileSync('docs/handoff/planora-prompts/review-pl05-r3-spec.txt', 'utf8');
const bin = 'C:\\Users\\Admin\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe';

const out = execFileSync(bin, [
  'terminal', 'send',
  '--terminal', 'term_7bfec423-028d-48d9-8ab0-e38d4b790963',
  '--text', promptText,
  '--enter'
], { encoding: 'utf8' });

console.log(out);
