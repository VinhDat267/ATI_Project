import { mkdtemp, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, relative } from 'node:path';
import { build } from 'vite';

const scratch = await mkdtemp(join(tmpdir(), 'ati-fe01-build-'));
const sentinels = ['FE01_admin_sentinel_92!', 'FE01_demo_sentinel_38!'];
const keys = ['CHAT_ADMIN_PASSWORD', 'SANDBOX_USER_PASSWORD', 'VITE_SHOW_DEMO_LOGIN', 'RUNTIME_MODE'];
const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
try {
  Object.assign(process.env, { CHAT_ADMIN_PASSWORD: sentinels[0], SANDBOX_USER_PASSWORD: sentinels[1], VITE_SHOW_DEMO_LOGIN: 'true', RUNTIME_MODE: 'sandbox' });
  await writeFile(join(scratch, '.env'), `CHAT_ADMIN_PASSWORD=${sentinels[0]}\nSANDBOX_USER_PASSWORD=${sentinels[1]}\nVITE_DEMO_PASSWORD=${sentinels[1]}\nVITE_SHOW_DEMO_LOGIN=true\n`);
  const output = join(scratch, 'dist');
  await build({ root: resolve('apps/chat-web'), envDir: scratch, logLevel: 'error', build: { outDir: output, emptyOutDir: true } });
  const files = await readdir(output, { recursive: true });
  for (const file of files.filter(file => /\.(js|html|map)$/.test(file))) {
    const contents = await readFile(join(output, file), 'utf8');
    if ([...sentinels, 'Admin@12345678'].some(secret => contents.includes(secret))) {
      throw new Error(`Production artifact contains a credential: ${file}`);
    }
  }
  console.log('PASS: production build excludes admin and demo credential sentinels');
} finally {
  for (const key of keys) previous[key] === undefined ? delete process.env[key] : process.env[key] = previous[key];
  // Delete only the unique directory created by this test, inside the OS temp folder.
  if (relative(tmpdir(), scratch).startsWith('ati-fe01-build-')) await rm(scratch, { recursive: true, force: true });
}
