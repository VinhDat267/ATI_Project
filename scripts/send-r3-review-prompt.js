const fs = require('fs');
const { execFileSync } = require('child_process');

const promptText = fs.readFileSync('docs/handoff/planora-prompts/review-pl03-r3-spec.txt', 'utf8');
const bin = 'C:\\Users\\Admin\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe';

const out = execFileSync(bin, [
  'terminal', 'send',
  '--terminal', 'term_9d752c51-f82c-48c2-8d6d-4698618767dd',
  '--text', promptText,
  '--enter'
], { encoding: 'utf8' });

console.log(out);
