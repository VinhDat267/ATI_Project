import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const output = new URL('./dist/', import.meta.url);
await mkdir(output, { recursive: true });
await build({
  entryPoints: [fileURLToPath(new URL('../src/cloud-workspace.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('./server.mjs', output)),
  bundle: true, platform: 'node', target: 'node24', format: 'esm',
  external: ['express', 'pg', 'nodemailer'],
  logLevel: 'info',
});
