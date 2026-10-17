import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Separate process: the synchronous Playwright launcher must not block the HTTP fixture. */
export async function startGmailBrowserFixture({ redirectUri }) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fake-google-gmail.mjs', import.meta.url))], {
    env: { ...process.env, FAKE_GOOGLE_GMAIL_PORT: '0', FAKE_GOOGLE_GMAIL_REDIRECT_URI: redirectUri }, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true,
  });
  const stopped = new Promise(resolve => child.once('close', resolve));
  const stop = async () => { child.kill(); await stopped; };
  try {
    const origin = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Gmail fixture readiness timeout')), 10_000);
      let output = '';
      const fail = () => { clearTimeout(timer); reject(new Error('Gmail fixture stopped before readiness')); };
      child.once('error', fail); child.once('exit', fail);
      child.stdout.on('data', chunk => {
        output += chunk;
        if (output.length > 4096) return fail();
        if (!output.includes('\n')) return;
        try {
          const ready = JSON.parse(output.slice(0, output.indexOf('\n')));
          if (ready.status !== 'ready' || !Number.isInteger(ready.port) || ready.port < 1 || ready.port > 65535) throw new Error('Invalid Gmail fixture readiness');
          clearTimeout(timer); child.removeListener('error', fail); child.removeListener('exit', fail);
          resolve(`http://127.0.0.1:${ready.port}`);
        } catch (error) { clearTimeout(timer); reject(error); }
      });
    });
    return { origin, stop };
  } catch (error) { await stop(); throw error; }
}
