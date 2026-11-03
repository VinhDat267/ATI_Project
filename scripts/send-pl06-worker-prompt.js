const fs = require('fs');
const { execFileSync } = require('child_process');

const promptText = fs.readFileSync('docs/handoff/planora-prompts/worker-pl06-spec.txt', 'utf8');
const bin = 'C:\\Users\\Admin\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe';

const out = execFileSync(bin, [
  'terminal', 'send',
  '--terminal', 'term_3efec20c-9bfe-4a0f-aabb-e817fd6bca9c',
  '--text', promptText,
  '--enter'
], { encoding: 'utf8' });

console.log(out);
