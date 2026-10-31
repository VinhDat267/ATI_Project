import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createProbeClient, ProbeError } from './client.mjs';
import { createProbeSession } from './session.mjs';

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function validateRunnerConfig(config) {
  try {
    const callback = new URL(config.redirectUri);
    if (callback.protocol !== 'http:' || callback.hostname !== '127.0.0.1' || callback.pathname !== '/oauth/callback' || callback.username || callback.password || callback.search || callback.hash || !callback.port || (config.mode === 'live' && callback.port === '0')) throw 0;
    createProbeClient(config);
    return callback;
  } catch { throw new ProbeError('INVALID_CONFIG'); }
}

/** Loopback-only diagnostic runner. No production API or Jira write endpoint. */
export async function startProbeServer(config) {
  const callback = validateRunnerConfig(config);
  let session, origin, owner, notice = '', closed = false;
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${config.mode === 'live' ? 'https://auth.atlassian.com https://id.atlassian.com' : new URL(config.fixtureBaseUrl).origin}; frame-ancestors 'none'`);
    const send = (status, body, contentType = 'text/plain; charset=utf-8') => {
      if (res.destroyed) return; res.writeHead(status, { 'Content-Type': contentType }); res.end(body);
    };
    const redirectHome = () => { res.writeHead(303, { Location: '/' }); res.end(); };
    try {
      if (!session || req.headers.host !== new URL(origin).host) return send(403, 'LOCAL_HOST_REQUIRED');
      const url = new URL(req.url, origin);
      const cookies = (req.headers.cookie ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith('probe_owner='));
      let binding = cookies.length === 1 ? cookies[0].slice('probe_owner='.length) : undefined;
      if (req.method === 'GET' && url.pathname === '/' && !owner) {
        owner = randomBytes(32).toString('base64url'); binding = owner;
        res.setHeader('Set-Cookie', `probe_owner=${owner}; HttpOnly; SameSite=Lax; Path=/`);
      }
      if (!same(owner, binding)) {
        if (req.method === 'GET' && url.pathname === '/oauth/callback') return redirectHome();
        return send(403, 'BROWSER_MISMATCH');
      }
      if (req.method === 'GET' && url.pathname === '/') {
        // no-referrer makes native form POSTs send Origin: null. Preserve the
        // local Origin here; callbacks/redirects keep no-referrer for code safety.
        res.setHeader('Referrer-Policy', 'same-origin');
        const report = session.report(binding);
        return send(200, `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ATI Jira OAuth probe</title><body><main><h1>ATI Jira OAuth — JIRA-01</h1><p>Chỉ kiểm chứng danh tính, site và quyền. Không tạo issue hoặc comment.</p><p>Trình duyệt đầu tiên giữ phiên này. Muốn dùng trình duyệt khác, dừng và chạy lại probe.</p><p>${escapeHtml(notice)}</p><form action="/start" method="post"><button name="flow" value="identity">1. Kết nối danh tính (read:me)</button><button name="flow" value="jira">2. Cấp quyền Jira / thêm site</button></form><form action="/refresh" method="post"><button>Làm mới token và kiểm rotation</button></form><form action="/disconnect" method="post"><button>Ngắt phiên local</button></form><p><a href="/report">Xem report an toàn</a></p><p>Account chưa có site cần chủ tài khoản xác nhận riêng; danh sách site rỗng không chứng minh điều đó.</p><pre>${escapeHtml(JSON.stringify(report, null, 2))}</pre></main></body></html>`, 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && url.pathname === '/report') return send(200, JSON.stringify(session.report(binding), null, 2), 'application/json; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/oauth/callback') {
        if (['state', 'code', 'error', 'error_description'].some(key => url.searchParams.getAll(key).length > 1) || (url.searchParams.has('code') && url.searchParams.has('error'))) {
          notice = 'INVALID_CALLBACK'; return redirectHome();
        }
        try {
          await session.callback({ state: url.searchParams.get('state'), code: url.searchParams.get('code'), error: url.searchParams.get('error'), browserBinding: binding });
          notice = 'CALLBACK_OBSERVED — chưa đồng nghĩa hoàn tất native gate.';
        } catch (error) { notice = error instanceof ProbeError ? error.code : 'PROBE_FAILED'; }
        return redirectHome();
      }
      if (req.method === 'POST' && ['/start', '/refresh', '/disconnect'].includes(url.pathname)) {
        if (req.headers.origin !== origin) return send(403, 'ORIGIN_MISMATCH');
        if (req.headers['content-type'] !== 'application/x-www-form-urlencoded') return send(415, 'FORM_REQUIRED');
        let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 1024) return send(413, 'FORM_TOO_LARGE'); }
        const form = new URLSearchParams(body);
        try {
          if (url.pathname === '/start') {
            if (form.getAll('flow').length !== 1) throw new ProbeError('INVALID_INPUT');
            const started = session.start(form.get('flow'), binding);
            res.writeHead(303, { Location: started.authorizationUrl }); return res.end();
          }
          if (url.pathname === '/refresh') { await session.refresh(binding); notice = 'TOKEN_ROTATION_OBSERVED'; }
          else { session.disconnect(binding); notice = 'LOCAL_DISCONNECT — grant tại Atlassian chưa bị thu hồi bởi thao tác này.'; }
        } catch (error) { notice = error instanceof ProbeError ? error.code : 'PROBE_FAILED'; }
        return redirectHome();
      }
      return send(404, 'NOT_FOUND');
    } catch { send(500, 'PROBE_FAILED'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(callback.port), '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  session = createProbeSession({ client: createProbeClient({ ...config, redirectUri: `${origin}/oauth/callback` }), mode: config.mode });
  return {
    url: `${origin}/`,
    async close() {
      if (closed) return; closed = true;
      if (owner) session.disconnect(owner);
      server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    },
  };
}
