/**
 * Channel discovery for the shared Slack bot, used by Settings so an admin can tick
 * channels instead of typing raw channel IDs. Read-only (conversations.list).
 */
export interface SlackCandidateChannel {
  id: string;
  name: string;
  isPrivate: boolean;
  /** Bot already joined: it can post and read history there without /invite. */
  isMember: boolean;
}

export type SlackCandidateResult =
  | { ok: true; channels: SlackCandidateChannel[]; truncated: boolean }
  | { ok: false; status: number; code: string; error: string };

const MAX_PAGES = 10;

export async function listSlackCandidateChannels(
  botToken: string,
  fetchFn: typeof fetch,
  baseUrl = 'https://slack.com/api',
  signal: AbortSignal = AbortSignal.timeout(10_000),
): Promise<SlackCandidateResult> {
  const channels: SlackCandidateChannel[] = [];
  let cursor = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${baseUrl}/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=200${
      cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
    }`;
    const res = await fetchFn(url, { headers: { Authorization: `Bearer ${botToken}` }, signal });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || body?.ok !== true) {
      const err = String(body?.error ?? `http_${res.status}`);
      if (['invalid_auth', 'not_authed', 'token_revoked', 'account_inactive'].includes(err)) {
        return { ok: false, status: 400, code: 'SLACK_TOKEN_INVALID', error: 'Bot token không hợp lệ hoặc đã bị thu hồi.' };
      }
      if (err === 'missing_scope') {
        return {
          ok: false,
          status: 400,
          code: 'SLACK_MISSING_SCOPE',
          error: 'Bot thiếu quyền. Cài lại app Slack với scope: chat:write, channels:read, groups:read, channels:history, groups:history.',
        };
      }
      return { ok: false, status: 502, code: 'SLACK_CHANNELS_FAILED', error: `Slack từ chối yêu cầu (${err}).` };
    }
    for (const ch of Array.isArray(body.channels) ? body.channels : []) {
      if (typeof ch?.id !== 'string' || typeof ch?.name !== 'string') continue;
      channels.push({ id: ch.id, name: ch.name, isPrivate: ch.is_private === true, isMember: ch.is_member === true });
    }
    cursor = typeof body?.response_metadata?.next_cursor === 'string' ? body.response_metadata.next_cursor : '';
    if (!cursor) return { ok: true, channels: sortChannels(channels), truncated: false };
  }
  return { ok: true, channels: sortChannels(channels), truncated: true };
}

function sortChannels(list: SlackCandidateChannel[]): SlackCandidateChannel[] {
  // Joined channels first (immediately usable), then alphabetical.
  return [...list].sort((a, b) => Number(b.isMember) - Number(a.isMember) || a.name.localeCompare(b.name));
}
