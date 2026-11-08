const fs = require('fs');
const { execFileSync } = require('child_process');

const promptText = fs.readFileSync('docs/handoff/planora-prompts/review-pl04-spec.txt', 'utf8');
const bin = 'C:\\Users\\Admin\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe';

const out = execFileSync(bin, [
  'terminal', 'send',
  '--terminal', 'term_6cef31ae-b57e-4f91-9ee0-583fd1524dfa',
  '--text', promptText,
  '--enter'
], { encoding: 'utf8' });

console.log(out);
