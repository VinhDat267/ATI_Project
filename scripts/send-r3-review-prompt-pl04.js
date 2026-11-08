const fs = require('fs');
const { execFileSync } = require('child_process');

const promptText = fs.readFileSync('docs/handoff/planora-prompts/review-pl04-r3-spec.txt', 'utf8');
const bin = 'C:\\Users\\Admin\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe';

const out = execFileSync(bin, [
  'terminal', 'send',
  '--terminal', 'term_f6bcdc72-adce-42b6-96e3-ba779019e0b4',
  '--text', promptText,
  '--enter'
], { encoding: 'utf8' });

console.log(out);
