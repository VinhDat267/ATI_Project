const fs = require('fs');
const { execFileSync } = require('child_process');

const promptText = fs.readFileSync('docs/handoff/planora-prompts/refactor-pl04-spec.txt', 'utf8');
const bin = 'C:\\Users\\Admin\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe';

const out = execFileSync(bin, [
  'terminal', 'send',
  '--terminal', 'term_38fdd67a-a4df-4813-b893-a602096df623',
  '--text', promptText,
  '--enter'
], { encoding: 'utf8' });

console.log(out);
