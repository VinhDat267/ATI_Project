import { Router, type Request, type Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { decryptCredentials, encryptCredentials } from '@wap/tool-adapters';
import { createAuthMiddleware, isAdmin, type AuthUser } from '../../auth/jwt.js';
import type { TelegramBotConfig } from '../../config/env.js';
import type { CredentialRepo } from '../../db/repositories/credential-repo.js';
import type { GoogleAuthRepo } from '../../db/repositories/google-auth-repo.js';
import type { SessionRepo } from '../../db/repositories/session-repo.js';
import type { TelegramTeamChatItem, TelegramTeamRepo } from '../../db/repositories/telegram-team-repo.js';
import { TelegramBotClient, TelegramBotError } from '../../services/telegram/bot-client.js';

export const TELEGRAM_BROWSER_COOKIE = 'ati_telegram_browser';
const COOKIE_PATH = '/api/connections/telegram';

export interface PersonalTelegramConfig {
  telegramUserId: string;
  username: string;
  displayName: string;
  selectedChats: TelegramTeamChatItem[];
  knownChats: TelegramTeamChatItem[];
}

export interface TelegramConnectionsOptions {
  jwtSecret: string;
  sessionRepo?: SessionRepo;
  states?: GoogleAuthRepo;
  credentialRepo?: CredentialRepo;
  teamRepo?: TelegramTeamRepo;
  bot?: TelegramBotConfig;
  encryptionKey?: string;
  fetchFn?: typeof fetch;
  botClient?: TelegramBotClient;
  clock?: () => number;
  telegramTimeoutMs?: number;
  onConnectionChanged?: (userId: string) => void;
  conversationOwner?: (conversationId: string) => Promise<string | null>;
  adminUserIds?: string[];
}

export function isTelegramConnectAvailable(
  options: Pick<
    TelegramConnectionsOptions,
    'bot' | 'states' | 'sessionRepo' | 'credentialRepo' | 'encryptionKey'
  >,
): boolean {
  return Boolean(
    options.bot &&
      options.bot.botToken &&
      options.bot.botUsername &&
      options.bot.callbackUrl &&
      options.states &&
      options.sessionRepo &&
      options.credentialRepo &&
      options.encryptionKey,
  );
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const readCookie = (header: string | undefined, name: string) => {
  for (const part of (header || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return '';
      }
    }
  }
  return '';
};

export function createTelegramConnectionRoutes(options: TelegramConnectionsOptions): Router {
  const router = Router();
  const clock = options.clock ?? Date.now;
  const timeoutMs = options.telegramTimeoutMs ?? 10_000;
  const botClient = options.botClient ?? (options.bot ? new TelegramBotClient(options.bot, options.fetchFn) : undefined);
  const auth = createAuthMiddleware(options.jwtSecret, { sessionRepo: options.sessionRepo, clock });

  router.use((_req, res, next) => {
    const json = res.json.bind(res);
    res.json = (body: any) =>
      json(
        res.statusCode === 401 && body && typeof body === 'object' && !body.code
          ? { ...body, code: 'INVALID_SESSION' }
          : body,
      );
    next();
  });

  router.use(auth);
  router.use((req, res, next) => {
    if (!(req as any).user?.sid) {
      res.status(401).json({ error: 'Phiên đăng nhập không còn hợp lệ.', code: 'INVALID_SESSION' });
      return;
    }
    next();
  });

  router.use((req, res, next) => {
    if (!isTelegramConnectAvailable(options)) {
      if (req.method === 'GET' && (req.path === '/' || req.path === '')) {
        res.json({ status: 'unconfigured', chats: [] });
        return;
      }
      res.status(503).json({ error: 'Telegram chưa được cấu hình trên máy chủ.' });
      return;
    }
    next();
  });

  const cookieFlags = () => {
    const secure = options.bot?.callbackUrl.startsWith('https:') ? '; Secure' : '';
    return `HttpOnly; SameSite=Lax; Path=${COOKIE_PATH}${secure}`;
  };

  router.get('/', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const user = (req as any).user as AuthUser;
    const record = await options.credentialRepo!.getPersonalConnectionStatus('telegram', user.id);
    if (!record) {
      res.json({ status: 'not_connected', botUsername: options.bot!.botUsername, chats: [] });
      return;
    }

    let decrypted: PersonalTelegramConfig;
    try {
      decrypted = decryptCredentials<PersonalTelegramConfig>(record.config, options.encryptionKey!);
    } catch {
      res.json({ status: 'reconnect_required', botUsername: options.bot!.botUsername, chats: [] });
      return;
    }

    const { telegramUserId, username, displayName } = decrypted;
    const selectedChats = Array.isArray(decrypted.selectedChats) ? decrypted.selectedChats : [];
    const knownChats = Array.isArray(decrypted.knownChats) ? decrypted.knownChats : [];

    if (record.status === 'reconnect_required') {
      res.json({
        status: 'reconnect_required',
        username,
        displayName,
        telegramUserId,
        botUsername: options.bot!.botUsername,
        chats: [],
      });
      return;
    }

    if (selectedChats.length === 0) {
      res.json({
        status: 'needs_scope',
        username,
        displayName,
        telegramUserId,
        botUsername: options.bot!.botUsername,
        chats: [],
      });
      return;
    }

    const selectedSet = new Set(selectedChats.map((c) => c.chatId));
    const mergedMap = new Map<string, TelegramTeamChatItem>();
    for (const c of [...selectedChats, ...knownChats]) {
      if (c && typeof c.chatId === 'string' && c.chatId) {
        mergedMap.set(c.chatId, c);
      }
    }

    const chats: Array<TelegramTeamChatItem & { selected: boolean; member: boolean }> = [];
    for (const c of mergedMap.values()) {
      if (c.type === 'private' && c.chatId !== telegramUserId) continue;
      let member = true;
      if (c.type !== 'private') {
        try {
          member = await botClient!.getChatMember(c.chatId, telegramUserId, AbortSignal.timeout(timeoutMs));
        } catch (err) {
          if (err instanceof TelegramBotError && err.kind === 'unauthorized') {
            await options.credentialRepo!.markReconnectRequired('telegram', user.id, record.id);
            options.onConnectionChanged?.(user.id);
            res.json({
              status: 'reconnect_required',
              username,
              displayName,
              telegramUserId,
              botUsername: options.bot!.botUsername,
              chats: [],
            });
            return;
          }
          member = false;
        }
      }
      if (!member && !selectedSet.has(c.chatId)) continue;
      chats.push({
        chatId: c.chatId,
        title: c.title,
        type: c.type,
        selected: selectedSet.has(c.chatId),
        member,
      });
    }

    const anySelectedMember = chats.some((c) => c.selected && c.member);
    res.json({
      status: anySelectedMember ? 'connected' : 'needs_scope',
      username,
      displayName,
      telegramUserId,
      botUsername: options.bot!.botUsername,
      chats,
    });
  });

  router.post('/start', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const user = (req as any).user as AuthUser;

    let returnTo: string | null = null;
    if (req.body?.returnTo !== undefined && req.body?.returnTo !== null) {
      const match =
        typeof req.body.returnTo === 'string'
          ? req.body.returnTo.match(/^\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)
          : null;
      const convId = match?.[1]?.toLowerCase();
      const ownerId = convId && options.conversationOwner ? await options.conversationOwner(convId) : null;
      if (!ownerId || ownerId !== user.id) {
        res.status(400).json({
          error: 'Không mở được kết nối từ hội thoại này.',
          code: 'RETURN_TO_INVALID',
        });
        return;
      }
      returnTo = `/c/${convId}`;
    }

    const state = randomBytes(32).toString('base64url');
    const existing = readCookie(req.headers.cookie, TELEGRAM_BROWSER_COOKIE);
    const browser = /^[A-Za-z0-9_-]{43}$/.test(existing) ? existing : randomBytes(32).toString('base64url');

    await options.states!.createState(
      {
        state_hash: sha256(state),
        browser_binding_hash: sha256(browser),
        code_verifier: 'telegram_1click',
        nonce: randomBytes(16).toString('base64url'),
        mode: 'connect_telegram',
        user_id: user.id,
        session_id: user.sid!,
        return_to: returnTo,
      },
      clock(),
    );

    res.setHeader('Set-Cookie', `${TELEGRAM_BROWSER_COOKIE}=${browser}; ${cookieFlags()}; Max-Age=600`);

    res.json({
      url: botClient!.callbackUrl(state),
      state,
      botUsername: botClient!.botUsername,
      deepLinkUrl: botClient!.deepLinkUrl(state),
      groupDeepLinkUrl: botClient!.groupDeepLinkUrl(state),
    });
  });

  router.post('/callback', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const user = (req as any).user as AuthUser;
    const { state } = req.body ?? {};
    const binding = readCookie(req.headers.cookie, TELEGRAM_BROWSER_COOKIE);

    if (
      typeof state !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(state) ||
      !/^[A-Za-z0-9_-]{43}$/.test(binding)
    ) {
      res.status(400).json({
        error: 'Yêu cầu kết nối Telegram đã hết hạn hoặc không còn hợp lệ. Hãy bấm "Kết nối Telegram" lại.',
        code: 'TELEGRAM_STATE_INVALID',
      });
      return;
    }

    // Step 1: Non-destructive check before making any HTTP call to Telegram
    const verifiedState = await options.states!.verifyState(
      state,
      binding,
      clock(),
      ['connect_telegram'],
      user.id,
      user.sid!,
    );
    if (!verifiedState) {
      res.status(400).json({
        error: 'Yêu cầu kết nối Telegram đã hết hạn hoặc không còn hợp lệ. Hãy bấm "Kết nối Telegram" lại.',
        code: 'TELEGRAM_STATE_INVALID',
      });
      return;
    }

    // Step 2: Check Telegram Bot API for /start ati_<state>
    let pairing;
    try {
      pairing = await botClient!.verifyPairing(state, AbortSignal.timeout(timeoutMs));
    } catch {
      res.status(502).json({
        error: 'Không kết nối được Telegram. Vui lòng thử lại.',
        code: 'TELEGRAM_CONNECT_FAILED',
      });
      return;
    }

    if (!pairing.matched) {
      res.status(409).json({
        error: 'Chưa nhận được xác nhận từ Telegram. Hãy bấm "Mở Telegram", nhấn Start rồi thử lại.',
        code: 'TELEGRAM_PAIRING_PENDING',
      });
      return;
    }

    // Step 3: Atomically consume state once
    const consumed = await options.states!.consumeState(
      state,
      binding,
      clock(),
      ['connect_telegram'],
      user.id,
      user.sid!,
    );
    res.setHeader('Set-Cookie', `${TELEGRAM_BROWSER_COOKIE}=; ${cookieFlags()}; Max-Age=0`);
    if (!consumed) {
      res.status(400).json({
        error: 'Yêu cầu kết nối Telegram đã hết hạn hoặc không còn hợp lệ. Hãy bấm "Kết nối Telegram" lại.',
        code: 'TELEGRAM_STATE_INVALID',
      });
      return;
    }

    const { telegramUserId, username, displayName, pairedChat, discoveredGroups } = pairing;
    const personalChat: TelegramTeamChatItem = {
      chatId: telegramUserId,
      title: `Telegram của tôi (${displayName})`,
      type: 'private',
    };

    const candidateMap = new Map<string, TelegramTeamChatItem>();
    candidateMap.set(personalChat.chatId, personalChat);

    if (options.teamRepo) {
      const teamScope = await options.teamRepo.get();
      for (const c of teamScope?.chats ?? []) {
        if (c.type !== 'private') candidateMap.set(c.chatId, c);
      }
    }
    if (pairedChat && pairedChat.type !== 'private') {
      candidateMap.set(pairedChat.chatId, pairedChat);
    }
    for (const g of discoveredGroups) {
      if (g.type !== 'private') candidateMap.set(g.chatId, g);
    }

    const eligibleChats: TelegramTeamChatItem[] = [personalChat];
    for (const c of candidateMap.values()) {
      if (c.chatId === personalChat.chatId) continue;
      try {
        const isMember = await botClient!.getChatMember(c.chatId, telegramUserId, AbortSignal.timeout(timeoutMs));
        if (isMember) {
          eligibleChats.push(c);
        }
      } catch {
        // Ignore groups where membership check fails
      }
    }

    const selectedChats = eligibleChats.slice(0, 10);
    if (isAdmin(user, options.adminUserIds) && options.teamRepo) {
      const groupChats = selectedChats.filter((c) => c.type !== 'private').slice(0, 10);
      if (groupChats.length > 0) {
        await options.teamRepo.replace({ chosenBy: user.id, chats: groupChats }).catch(() => {});
      }
    }

    await options.credentialRepo!.saveCredentials(
      'telegram',
      encryptCredentials(
        {
          telegramUserId,
          username,
          displayName,
          selectedChats,
          knownChats: eligibleChats,
        } satisfies PersonalTelegramConfig,
        options.encryptionKey!,
      ),
      user.id,
    );
    options.onConnectionChanged?.(user.id);

    const selectedSet = new Set(selectedChats.map((c) => c.chatId));
    res.json({
      username,
      telegramUserId,
      displayName,
      chats: eligibleChats.map((c) => ({
        chatId: c.chatId,
        title: c.title,
        type: c.type,
        selected: selectedSet.has(c.chatId),
        member: true,
      })),
      ...(consumed.return_to ? { returnTo: consumed.return_to } : {}),
    });
  });

  router.get('/candidate-chats', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const user = (req as any).user as AuthUser;

    const record = await options.credentialRepo!.getPersonalConnectionStatus('telegram', user.id);
    if (!record || record.status !== 'active') {
      res.status(409).json({ error: 'Tài khoản của bạn chưa Kết nối Telegram hoặc cần kết nối lại.' });
      return;
    }

    const decrypted = decryptCredentials<PersonalTelegramConfig>(record.config, options.encryptionKey!);
    const { telegramUserId, displayName } = decrypted;
    const personalChat: TelegramTeamChatItem = {
      chatId: telegramUserId,
      title: `Telegram của tôi (${displayName || decrypted.username})`,
      type: 'private',
    };

    const candidateMap = new Map<string, TelegramTeamChatItem>();
    candidateMap.set(personalChat.chatId, personalChat);

    for (const c of [...(decrypted.selectedChats ?? []), ...(decrypted.knownChats ?? [])]) {
      if (c && c.type !== 'private') candidateMap.set(c.chatId, c);
    }

    if (options.teamRepo) {
      const teamScope = await options.teamRepo.get();
      for (const c of teamScope?.chats ?? []) {
        if (c.type !== 'private') candidateMap.set(c.chatId, c);
      }
    }

    try {
      const discovered = await botClient!.discoverGroups(AbortSignal.timeout(timeoutMs));
      for (const g of discovered) {
        if (g.type !== 'private') candidateMap.set(g.chatId, g);
      }
    } catch (err) {
      if (err instanceof TelegramBotError && err.kind === 'unauthorized') {
        await options.credentialRepo!.markReconnectRequired('telegram', user.id, record.id);
        options.onConnectionChanged?.(user.id);
        res.status(409).json({ error: 'Tài khoản của bạn chưa Kết nối Telegram hoặc cần kết nối lại.' });
        return;
      }
      res.status(502).json({ error: 'Không tải được danh sách cuộc trò chuyện từ Telegram.' });
      return;
    }

    const selectedSet = new Set((decrypted.selectedChats ?? []).map((c) => c.chatId));
    const chats: Array<TelegramTeamChatItem & { selected: boolean; member: boolean }> = [
      { ...personalChat, selected: selectedSet.has(personalChat.chatId), member: true },
    ];

    for (const c of candidateMap.values()) {
      if (c.chatId === personalChat.chatId) continue;
      const member = await botClient!.getChatMember(c.chatId, telegramUserId, AbortSignal.timeout(timeoutMs));
      if (!member) continue;
      chats.push({
        chatId: c.chatId,
        title: c.title,
        type: c.type,
        selected: selectedSet.has(c.chatId),
        member: true,
      });
    }

    res.json({ chats });
  });

  router.put('/scope', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const user = (req as any).user as AuthUser;

    const { chatIds } = req.body ?? {};
    if (!Array.isArray(chatIds) || chatIds.some((id) => typeof id !== 'string' || !/^-?[1-9]\d{0,19}$/.test(id.trim()))) {
      res.status(400).json({ error: 'Danh sách cuộc trò chuyện Telegram không hợp lệ.' });
      return;
    }
    const uniqueIds = [...new Set((chatIds as string[]).map((id) => id.trim()))];
    if (uniqueIds.length < 1 || uniqueIds.length > 10) {
      res.status(400).json({ error: 'Hãy chọn từ 1 đến 10 cuộc trò chuyện hoặc nhóm Telegram.' });
      return;
    }

    const record = await options.credentialRepo!.getPersonalConnectionStatus('telegram', user.id);
    if (!record || record.status !== 'active') {
      res.status(409).json({ error: 'Tài khoản của bạn chưa Kết nối Telegram hoặc cần kết nối lại.' });
      return;
    }

    const decrypted = decryptCredentials<PersonalTelegramConfig>(record.config, options.encryptionKey!);
    const { telegramUserId, username, displayName } = decrypted;
    const personalChat: TelegramTeamChatItem = {
      chatId: telegramUserId,
      title: `Telegram của tôi (${displayName || username})`,
      type: 'private',
    };

    const candidateMap = new Map<string, TelegramTeamChatItem>();
    candidateMap.set(personalChat.chatId, personalChat);
    for (const c of [...(decrypted.selectedChats ?? []), ...(decrypted.knownChats ?? [])]) {
      if (c && c.type !== 'private') candidateMap.set(c.chatId, c);
    }
    if (options.teamRepo) {
      const teamScope = await options.teamRepo.get();
      for (const c of teamScope?.chats ?? []) {
        if (c.type !== 'private') candidateMap.set(c.chatId, c);
      }
    }
    try {
      const discovered = await botClient!.discoverGroups(AbortSignal.timeout(timeoutMs));
      for (const g of discovered) {
        if (g.type !== 'private') candidateMap.set(g.chatId, g);
      }
    } catch {
      // Fall back to known chats if discovery fails
    }

    const chosenChats: TelegramTeamChatItem[] = [];
    for (const id of uniqueIds) {
      if (id === telegramUserId) {
        chosenChats.push(personalChat);
        continue;
      }
      if (!id.startsWith('-')) {
        res.status(400).json({
          error: 'Cuộc trò chuyện không hợp lệ hoặc bạn không phải thành viên của nhóm.',
        });
        return;
      }
      let chatItem = candidateMap.get(id) ?? null;
      const isMember = await botClient!.getChatMember(id, telegramUserId, AbortSignal.timeout(timeoutMs));
      if (!isMember) {
        res.status(400).json({
          error: 'Cuộc trò chuyện không hợp lệ hoặc bạn không phải thành viên của nhóm.',
        });
        return;
      }
      if (!chatItem) {
        chatItem = await botClient!.getChat(id, AbortSignal.timeout(timeoutMs));
      }
      if (!chatItem || chatItem.type === 'private') {
        res.status(400).json({
          error: 'Cuộc trò chuyện không hợp lệ hoặc bạn không phải thành viên của nhóm.',
        });
        return;
      }
      chosenChats.push(chatItem);
      candidateMap.set(id, chatItem);
    }

    if (isAdmin(user, options.adminUserIds) && options.teamRepo) {
      const groupChats = chosenChats.filter((c) => c.type !== 'private').slice(0, 10);
      if (groupChats.length > 0) {
        await options.teamRepo.replace({ chosenBy: user.id, chats: groupChats });
      }
    }

    const knownChats = [...candidateMap.values()];
    await options.credentialRepo!.saveCredentials(
      'telegram',
      encryptCredentials(
        {
          telegramUserId,
          username,
          displayName,
          selectedChats: chosenChats,
          knownChats,
        } satisfies PersonalTelegramConfig,
        options.encryptionKey!,
      ),
      user.id,
    );
    options.onConnectionChanged?.(user.id);

    res.json({
      chats: chosenChats.map((c) => ({
        chatId: c.chatId,
        title: c.title,
        type: c.type,
        selected: true,
        member: true,
      })),
    });
  });

  router.delete('/', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const user = (req as any).user as AuthUser;
    await options.credentialRepo!.deleteCredentials('telegram', user.id);
    options.onConnectionChanged?.(user.id);
    res.json({ success: true });
  });

  return router;
}
