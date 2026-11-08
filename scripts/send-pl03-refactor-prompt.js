const fs = require('fs');
const { execFileSync } = require('child_process');

const promptText = fs.readFileSync('docs/handoff/planora-prompts/refactor-pl03-spec.txt', 'utf8');
const bin = 'C:\\Users\\Admin\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe';

const out = execFileSync(bin, [
  'terminal', 'send',
  '--terminal', 'term_33db6cd2-b61a-4eff-bbea-7f023343d899',
  '--text', promptText,
  '--enter'
], { encoding: 'utf8' });

console.log(out);
