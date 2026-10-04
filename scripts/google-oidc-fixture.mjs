import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const fakeOidc = resolve(fileURLToPath(new URL('.', import.meta.url)), 'fake-oidc.mjs');

// Starts the local OIDC provider used by the AUTH-04 browser scenario and resolves
// with its origin once the child reports readiness on its first stdout line.
export async function startGoogleFixture() {
  const child = spawn(process.execPath, [fakeOidc], {
    env: { ...process.env, FAKE_OIDC_PORT: '55534' }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  const stopped = new Promise(resolve => child.once('close', resolve));
  let port;
  try {
    port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Local OIDC fixture readiness timeout')), 10_000);
      let output = '';
      const fail = () => { clearTimeout(timer); reject(new Error('Local OIDC fixture stopped before readiness')); };
      child.once('error', fail);
      child.once('exit', fail);
      child.stdout.on('data', chunk => {
        output += chunk.toString();
        if (output.length > 4096) { clearTimeout(timer); return reject(new Error('Invalid local OIDC readiness output')); }
        const newline = output.indexOf('\n');
        if (newline < 0) return;
        try {
          const ready = JSON.parse(output.slice(0, newline));
          if (ready.status !== 'ready' || ready.port !== 55534) throw new Error('Invalid local OIDC readiness');
          clearTimeout(timer);
          child.removeListener('error', fail);
          child.removeListener('exit', fail);
          resolve(ready.port);
        } catch (error) { clearTimeout(timer); reject(error); }
      });
    });
  } catch (error) {
    child.kill();
    await stopped;
    throw error;
  }
  return { origin: `http://127.0.0.1:${port}`, stop: async () => { child.kill(); await stopped; } };
}
