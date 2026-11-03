const fs = require('fs');
const { execFileSync } = require('child_process');

const promptText = fs.readFileSync('docs/handoff/planora-prompts/fix-pl06-f1-f3-spec.txt', 'utf8');
const bin = 'C:\\Users\\Admin\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe';

const out = execFileSync(bin, [
  'terminal', 'send',
  '--terminal', 'term_4ea485ca-f2cc-4652-af4c-df82f1490749',
  '--text', promptText,
  '--enter'
], { encoding: 'utf8' });

console.log(out);
