import { createHash, generateKeyPairSync, randomBytes, sign, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const defaults = {
  clientId: 'auth04-test.apps.googleusercontent.com', clientSecret: 'fake-oidc-secret',
  redirectUri: 'http://127.0.0.1:5174/auth/google/callback',
  email: 'auth04-google@example.test', name: 'Google Fixture', sub: 'fixture-google-user',
};
const equal = (a, b) => typeof a === 'string' && typeof b === 'string'
  && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const json = (response, status, body) => {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
};

// Local test provider only. It never calls Google and logs no request URLs or tokens.
export async function startFakeOidc(options = {}) {
  const { port = 0, now = Date.now, clientId, clientSecret, redirectUri, email, name, sub } = { ...defaults, ...options };
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = randomBytes(8).toString('hex');
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
  const codes = new Map();
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { ready: true });
      if (request.method === 'GET' && url.pathname === '/jwks') {
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' });
        return response.end(JSON.stringify({ keys: [jwk] }));
      }
      if (request.method === 'GET' && url.pathname === '/authorize') {
        const params = url.searchParams;
        const state = params.get('state');
        const nonce = params.get('nonce');
        const challenge = params.get('code_challenge');
        const scopes = new Set((params.get('scope') ?? '').split(' '));
        if (params.get('client_id') !== clientId || params.get('redirect_uri') !== redirectUri
          || params.get('response_type') !== 'code' || params.get('code_challenge_method') !== 'S256'
          || !/^[A-Za-z0-9_-]{43}$/.test(challenge ?? '')
          || !state || state.length > 1024 || !nonce || nonce.length > 1024
          || !['openid', 'email', 'profile'].every(scope => scopes.has(scope))) {
          return json(response, 400, { error: 'invalid_request' });
        }
        for (const [code, entry] of codes) if (entry.expiresAt <= now()) codes.delete(code);
        if (codes.size >= 1000) return json(response, 503, { error: 'temporarily_unavailable' });
        const code = randomBytes(32).toString('base64url');
        codes.set(code, { challenge, nonce, expiresAt: now() + 600_000 });
        const callback = new URL(redirectUri);
        callback.searchParams.set('code', code);
        callback.searchParams.set('state', state);
        response.writeHead(302, { Location: callback.href, 'Cache-Control': 'no-store' });
        return response.end();
      }
      if (request.method === 'POST' && url.pathname === '/token') {
        if (!request.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) {
          return json(response, 400, { error: 'invalid_request' });
        }
        let body = '';
        let bytes = 0;
        for await (const chunk of request) {
          bytes += chunk.length;
          if (bytes > 16_384) return json(response, 413, { error: 'invalid_request' });
          body += chunk.toString('utf8');
        }
        const params = new URLSearchParams(body);
        const code = params.get('code');
        const entry = codes.get(code);
        const verifier = params.get('code_verifier') ?? '';
        if (!entry || entry.expiresAt <= now() || params.get('grant_type') !== 'authorization_code'
          || !equal(params.get('client_id'), clientId) || !equal(params.get('client_secret'), clientSecret)
          || params.get('redirect_uri') !== redirectUri || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)
          || !equal(createHash('sha256').update(verifier).digest('base64url'), entry.challenge)) {
          return json(response, 400, { error: 'invalid_grant' });
        }
        // No await between lookup/validation and consume: concurrent exchanges have one winner.
        codes.delete(code);
        const iat = Math.floor(now() / 1000);
        const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString('base64url');
        const claims = Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: clientId,
          sub, email, email_verified: true, name, nonce: entry.nonce, iat, exp: iat + 300 })).toString('base64url');
        const input = `${header}.${claims}`;
        const signature = sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url');
        return json(response, 200, { id_token: `${input}.${signature}`, token_type: 'Bearer', expires_in: 300 });
      }
      return json(response, 404, { error: 'not_found' });
    } catch {
      if (!response.headersSent) json(response, 400, { error: 'invalid_request' });
      else response.end();
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const provider = await startFakeOidc({ port: Number(process.env.FAKE_OIDC_PORT ?? 55534),
    ...(process.env.FAKE_OIDC_REDIRECT_URI ? { redirectUri: process.env.FAKE_OIDC_REDIRECT_URI } : {}) });
  process.stdout.write(`${JSON.stringify({ status: 'ready', port: provider.server.address().port })}\n`);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await provider.close();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
