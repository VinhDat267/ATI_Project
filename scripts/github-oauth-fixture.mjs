import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

/** OAuth setup fixture only; never reads or writes real GitHub. Codes and tokens are stateful. */
export async function startGitHubOAuthFixture({ redirectUri }) {
  const worker = new Worker(new URL(import.meta.url), { workerData: { redirectUri } });
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error('GitHub fixture readiness timeout'));
    }, 10_000);
    worker.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.once('message', (value) => {
      clearTimeout(timer);
      resolve(value.origin);
    });
  });
  return { origin, stop: () => worker.terminate() };
}

async function serveGitHubOAuthFixture({ redirectUri }) {
  const codes = new Set();
  const memberTokens = new Set();
  const candidateRepos = [
    { id: 100, name: 'repo', full_name: 'owner/repo', private: false },
    { id: 101, name: 'ati', full_name: 'acme/ati', private: false },
    { id: 102, name: 'docs', full_name: 'acme/docs', private: false },
    { id: 103, name: 'secret', full_name: 'acme/secret', private: true },
    { id: 104, name: 'infra', full_name: 'acme/infra', private: true },
  ];

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname === '/authorize') {
      if (
        url.searchParams.get('client_id') !== 'github-fixture-client' ||
        url.searchParams.get('redirect_uri') !== redirectUri
      ) {
        res.writeHead(400);
        res.end();
        return;
      }
      const code = 'gh-fixture-code-' + randomBytes(16).toString('hex');
      codes.add(code);
      const back = new URL(redirectUri);
      back.searchParams.set('code', code);
      back.searchParams.set('state', url.searchParams.get('state') ?? '');
      res.writeHead(302, { Location: back.href });
      res.end();
      return;
    }

    let body = '';
    for await (const chunk of req) body += chunk;
    res.setHeader('Content-Type', 'application/json');
    const reply = (status, value) => {
      res.writeHead(status);
      res.end(JSON.stringify(value));
    };

    if (url.pathname === '/token' && req.method === 'POST') {
      let parsed = {};
      try {
        parsed = JSON.parse(body);
      } catch {
        return reply(400, { error: 'bad_request' });
      }
      if (
        parsed.client_id !== 'github-fixture-client' ||
        parsed.client_secret !== 'github-fixture-secret'
      ) {
        return reply(401, { error: 'incorrect_client_credentials' });
      }
      if (!codes.has(parsed.code)) {
        return reply(400, { error: 'bad_verification_code' });
      }
      codes.delete(parsed.code);
      const token = 'gho_member_fixture_' + randomBytes(16).toString('hex');
      memberTokens.add(token);
      return reply(200, { access_token: token, token_type: 'bearer', scope: 'repo read:user' });
    }

    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
    if (!token || (token !== 'gho_admin_fixture_token' && !memberTokens.has(token))) {
      return reply(401, { message: 'Bad credentials' });
    }

    if (url.pathname === '/user' && req.method === 'GET') {
      if (token === 'gho_admin_fixture_token') {
        return reply(200, { id: 9001, login: 'admin_octo' });
      }
      return reply(200, { id: 9002, login: 'bob_octo' });
    }

    if (url.pathname === '/user/repos' && req.method === 'GET') {
      return reply(200, candidateRepos);
    }

    return reply(404, { message: 'Not Found' });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    stop: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

if (!isMainThread) {
  const fixture = await serveGitHubOAuthFixture(workerData);
  parentPort.postMessage({ origin: fixture.origin });
}
