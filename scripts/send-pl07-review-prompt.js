const fs = require('fs');
const { execFileSync } = require('child_process');

const promptText = fs.readFileSync('docs/handoff/planora-prompts/review-pl07-spec.txt', 'utf8');
const bin = 'C:\\Users\\Admin\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe';

const out = execFileSync(bin, [
  'terminal', 'send',
  '--terminal', 'term_f0c06538-9e6b-48ce-865b-c8415d94338a',
  '--text', promptText,
  '--enter'
], { encoding: 'utf8' });

console.log(out);
