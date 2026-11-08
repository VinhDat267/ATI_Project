const fs = require('fs');
const { execFileSync } = require('child_process');

const promptText = fs.readFileSync('docs/handoff/planora-prompts/worker-pl07-spec.txt', 'utf8');
const bin = 'C:\\Users\\Admin\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe';

const out = execFileSync(bin, [
  'terminal', 'send',
  '--terminal', 'term_4db76d3d-ff4f-4ee2-a78b-3c2729eab901',
  '--text', promptText,
  '--enter'
], { encoding: 'utf8' });

console.log(out);
