import { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { encryptCredentials, decryptCredentials } from '@wap/tool-adapters';
import { createAuthMiddleware, type AuthUser } from '../../auth/jwt.js';
import type { SessionRepo } from '../../db/repositories/session-repo.js';
import type { SlackConnectionRepo, SlackConnectionRow } from '../../db/repositories/slack-connection-repo.js';
import { SlackPolicyService } from '../../services/slack/policy-service.js';
import { SlackOAuthClient, SlackProviderError, SLACK_USER_SCOPES, type SlackOAuthConfig } from '../../services/slack/oauth-client.js';
import { SlackTokenManager } from '../../services/slack/token-manager.js';
const cookieName = 'ati_slack_browser', cookiePath = '/api/connections/myslack';
const random = () => randomBytes(32).toString('base64url');
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const valid = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{43}$/.test(s);
const CONVERSATION_PATH = /^\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
export interface SlackConnectionsOptions {
  oauth: SlackOAuthConfig; repo: SlackConnectionRepo; jwtSecret: string; encryptionKey: string;
  sessionRepo: SessionRepo; fetchFn?: typeof fetch; clock?: () => number; timeoutMs?: number;
  policyService?: SlackPolicyService;
  conversationOwner?: (conversationId: string) => Promise<string | null>;
}
export const slackConnectionView = (
  row: SlackConnectionRow,
  readiness: { processingReady?: boolean; consentStatus?: 'pending' | 'granted' | 'revoked' } = {}
) => {
  const status = row.status === 'disconnected' ? 'revoked' : row.status;
  const consentStatus = readiness.consentStatus ?? 'pending';
  const processingReady = status === 'active' && consentStatus === 'granted' && (readiness.processingReady === true);
  const connectedAt = row.connected_at instanceof Date
    ? row.connected_at.toISOString()
    : new Date(row.connected_at).toISOString();

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    slackUserId: row.actor_id,
    slackUserLabel: row.actor_id,
    status,
    identityVersion: row.identity_version,
    scopes: row.scopes,
    connectedAt,
    consentStatus,
    processingReady,
    actorId: row.actor_id,
    missingScopes: SLACK_USER_SCOPES.filter(s => !row.scopes.includes(s)),
    processingStatus: (processingReady ? 'ready' : 'pending') as 'ready' | 'pending',
    ...(row.status === 'disconnected' ? { legacyStatus: 'disconnected' } : {}),
  };
};
/** Setup metadata only. No content read, model call, tool or processing-consent endpoint. */
export function createSlackConnectionRoutes(options: SlackConnectionsOptions): Router {
  const router = Router(), oauth = new SlackOAuthClient(options.oauth, options.fetchFn), clock = options.clock ?? Date.now;
  const tokens = new SlackTokenManager(options.repo, oauth, options.encryptionKey, clock, options.timeoutMs);
  const policyService = options.policyService ?? new SlackPolicyService((options.repo as any).pool);
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.use(createAuthMiddleware(options.jwtSecret, { sessionRepo: options.sessionRepo, clock }));
  router.use((req, res, next) => { if (!(req as any).user?.sid) { res.status(401).json({ code: 'INVALID_SESSION', error: 'Phiên đăng nhập đã hết hạn.' }); return; } next(); });
  const user = (req: any) => req.user as AuthUser;
  const browser = (req: any) => req.headers.cookie?.split(';').map((s: string) => s.trim()).find((s: string) => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  const fail = (res: any, code: string) => res.status(400).json({ code, error: code === 'SLACK_IDENTITY_CONFLICT'
    ? 'Tài khoản Slack này đang liên kết với một tài khoản ATI khác. Hãy ngắt liên kết cũ trước.'
    : code === 'SLACK_DENIED' ? 'Bạn đã hủy kết nối Slack.' : 'Không hoàn tất được kết nối Slack. Hãy bắt đầu lại từ Kết nối dịch vụ.' });
  const ownConversation = async (value: unknown, userId: string): Promise<string | null> => {
    const id = typeof value === 'string' ? CONVERSATION_PATH.exec(value)?.[1]?.toLowerCase() : undefined;
    if (!id || !options.conversationOwner) return null;
    return (await options.conversationOwner(id)) === userId ? `/c/${id}` : null;
  };
  router.get('/', async (req, res) => {
    try {
      const list = await options.repo.list(user(req).id);
      const connections = await Promise.all(list.map(async row => {
        let readiness: { processingReady?: boolean; consentStatus?: 'pending' | 'granted' | 'revoked' } = {};
        try {
          readiness = await policyService.checkProcessingReady(row.workspace_id);
        } catch {
          readiness = { processingReady: false, consentStatus: 'pending' };
        }
        return slackConnectionView(row, readiness);
      }));
      res.json({ connections });
    }
    catch { res.status(503).json({ error: 'Chưa tải được kết nối Slack. Hãy thử lại.' }); }
  });
  router.post('/start', async (req, res) => {
    const who = user(req), state = random(), binding = valid(browser(req)) ? browser(req)! : random();
    try {
      let returnTo: string | null = null;
      if (req.body?.returnTo !== undefined) {
        returnTo = await ownConversation(req.body.returnTo, who.id);
        if (!returnTo) {
          res.status(400).json({ error: 'Không mở được kết nối từ hội thoại này.', code: 'RETURN_TO_INVALID' });
          return;
        }
      }
      const workspaceHint = typeof req.body?.workspaceHint === 'string' && req.body.workspaceHint.trim()
        ? req.body.workspaceHint.trim()
        : undefined;

      await options.repo.start({
        userId: who.id,
        sessionId: who.sid!,
        stateHash: hash(state),
        browserHash: hash(binding),
        returnTo,
      }, clock());
      res.cookie(cookieName, binding, { httpOnly: true, secure: options.oauth.redirectUri.startsWith('https:'), sameSite: 'lax', path: cookiePath, maxAge: 600000 });
      res.json({ url: oauth.authorizationUrl(state, workspaceHint) });
    } catch { res.status(503).json({ error: 'Không bắt đầu được kết nối Slack.' }); }
  });
  router.post('/callback', async (req, res) => {
    const who = user(req), binding = browser(req), { state, code, error } = req.body ?? {};
    if (!valid(state) || !valid(binding) || (!error && (typeof code !== 'string' || !code || code.length > 4096))) { fail(res, 'SLACK_STATE_INVALID'); return; }
    try {
      const consumed = await options.repo.consume({ userId: who.id, sessionId: who.sid!, state, browser: binding }, clock());
      if (!consumed) { fail(res, 'SLACK_STATE_INVALID'); return; }
      if (error) { fail(res, 'SLACK_DENIED'); return; }
      const grant = await oauth.exchange(code, AbortSignal.timeout(options.timeoutMs ?? 10000));
      const config = encryptCredentials({ accessToken: grant.accessToken, ...(grant.refreshToken ? { refreshToken: grant.refreshToken, expiresAt: clock() + grant.expiresIn! * 1000 } : {}) }, options.encryptionKey);
      const row = await options.repo.save(who.id, consumed.id, { ...grant, config }, clock);
      if (!row) { fail(res, 'SLACK_STATE_INVALID'); return; }

      // Recheck conversation ownership on callback: if deleted or transferred, omit returnTo safely
      let returnTo: string | undefined = undefined;
      if (consumed.returnTo) {
        const verified = await ownConversation(consumed.returnTo, who.id);
        if (verified) {
          returnTo = verified;
        }
      }

      let readiness: { processingReady?: boolean; consentStatus?: 'pending' | 'granted' | 'revoked' } = {};
      try { readiness = await policyService.checkProcessingReady(row.workspace_id); } catch { readiness = { processingReady: false, consentStatus: 'pending' }; }
      const view = slackConnectionView(row, readiness);
      res.json({
        ...view,
        connectionId: row.id,
        ...(returnTo ? { returnTo } : {}),
      });
    } catch (e) { fail(res, e instanceof Error && e.message === 'SLACK_IDENTITY_CONFLICT' ? e.message : 'SLACK_CONNECT_FAILED'); }
  });
  router.post('/:id/check', async (req, res) => {
    const who = user(req), id = req.params.id;
    if (!/^[0-9a-f-]{36}$/i.test(id)) { res.status(404).json({ error: 'Không tìm thấy kết nối.' }); return; }
    const row = (await options.repo.list(who.id)).find(r => r.id === id);
    if (!row) { res.status(404).json({ error: 'Không tìm thấy kết nối.' }); return; }
    try {
      const token = await tokens.getAccessToken(who.id, id, row.identity_version);
      await oauth.verify(token, row.workspace_id, row.actor_id, AbortSignal.timeout(options.timeoutMs ?? 10000));
    } catch (e) {
      if (!(e instanceof SlackProviderError && e.authenticationLost) && !(e instanceof Error && e.message === 'SLACK_RECONNECT_REQUIRED')) {
        res.status(503).json({ error: 'Chưa kiểm tra được Slack. Hãy thử lại.' }); return;
      }
      await options.repo.withOwner(who.id, async c => { await c.query("UPDATE slack_connections SET status='reconnect_required',config=NULL WHERE id=$1 AND user_id=$2 AND identity_version=$3 AND status='active'", [id, who.id, row.identity_version]); });
    }
    const current = (await options.repo.list(who.id)).find(r => r.id === id);
    if (!current) { res.status(404).json({ error: 'Kết nối đã được ngắt.' }); return; }
    let readiness: { processingReady?: boolean; consentStatus?: 'pending' | 'granted' | 'revoked' } = {};
    try { readiness = await policyService.checkProcessingReady(current.workspace_id); } catch { readiness = { processingReady: false, consentStatus: 'pending' }; }
    res.json(slackConnectionView(current, readiness));
  });
  router.delete('/:id', async (req, res) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) { res.status(400).json({ error: 'Kết nối không hợp lệ.' }); return; }
    let revoked = false;
    try {
      await options.repo.disconnect(user(req).id, req.params.id, async row => {
        try {
          const token = decryptCredentials(row.config!, options.encryptionKey).accessToken;
          if (typeof token === 'string') { await oauth.revoke(token, AbortSignal.timeout(options.timeoutMs ?? 10000)); revoked = true; }
        } catch { /* Local disconnection is complete; provider failure is explicitly reported. */ }
      });
      res.json({ success: true, revoked });
    } catch { res.status(503).json({ error: 'Không ngắt được kết nối Slack. Hãy thử lại.' }); }
  });
  return router;
}
