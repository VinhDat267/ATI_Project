const fs = require('fs');
const { execFileSync } = require('child_process');

const promptText = fs.readFileSync('docs/handoff/planora-prompts/review-pl03-r4-spec.txt', 'utf8');
const bin = 'C:\\Users\\Admin\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe';

const out = execFileSync(bin, [
  'terminal', 'send',
  '--terminal', 'term_d22401ac-eba4-4913-bdf0-1fed0d6d91ce',
  '--text', promptText,
  '--enter'
], { encoding: 'utf8' });

console.log(out);
