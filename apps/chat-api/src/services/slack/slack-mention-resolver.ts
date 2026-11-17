export interface SlackUserRef {
  id: string;
  name?: string;
  realName?: string;
  displayName?: string;
  email?: string;
}

export interface MentionAssigneeInput {
  displayName?: string | null;
  username?: string | null;
  email?: string | null;
}

const VALID_SLACK_USER_ID = /^[UW][A-Z0-9]+$/i;
const AMBIGUOUS = Symbol('AMBIGUOUS');
type IndexEntry = string | typeof AMBIGUOUS;

export interface SlackMentionIndex {
  byEmail: Map<string, IndexEntry>;
  byUsername: Map<string, IndexEntry>;
  byName: Map<string, IndexEntry>;
}

function norm(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : '';
}

function recordEntry(map: Map<string, IndexEntry>, key: string, userId: string): void {
  if (!key) return;
  const existing = map.get(key);
  if (existing === undefined) {
    map.set(key, userId);
  } else if (existing !== userId) {
    map.set(key, AMBIGUOUS);
  }
}

export function isValidSlackUserId(id: unknown): id is string {
  return typeof id === 'string' && VALID_SLACK_USER_ID.test(id.trim());
}

/**
 * Indexes Slack users for fail-safe assignee mention resolution.
 * Duplicate display/real names are marked AMBIGUOUS so we never ping the wrong person.
 */
export function buildSlackMentionIndex(users: readonly SlackUserRef[]): SlackMentionIndex {
  const byEmail = new Map<string, IndexEntry>();
  const byUsername = new Map<string, IndexEntry>();
  const byName = new Map<string, IndexEntry>();

  for (const user of users) {
    const id = typeof user?.id === 'string' ? user.id.trim() : '';
    if (!isValidSlackUserId(id)) continue;

    recordEntry(byEmail, norm(user.email), id);
    recordEntry(byUsername, norm(user.name), id);
    recordEntry(byUsername, norm(user.displayName), id);
    recordEntry(byName, norm(user.displayName), id);
    recordEntry(byName, norm(user.realName), id);
    recordEntry(byName, norm(user.name), id);
  }

  return { byEmail, byUsername, byName };
}

function uniqueMatch(entry: IndexEntry | undefined): string | null {
  return typeof entry === 'string' ? entry : null;
}

export function resolveSlackUserId(
  assignee: MentionAssigneeInput | null | undefined,
  index: SlackMentionIndex | null | undefined,
): string | null {
  if (!assignee || !index) return null;

  const emailKey = norm(assignee.email);
  if (emailKey) {
    const match = uniqueMatch(index.byEmail.get(emailKey));
    if (match) return match;
  }

  const userKey = norm(assignee.username);
  if (userKey) {
    const match =
      uniqueMatch(index.byUsername.get(userKey)) ??
      uniqueMatch(index.byName.get(userKey));
    if (match) return match;
  }

  const displayKey = norm(assignee.displayName);
  if (displayKey) {
    const match = uniqueMatch(index.byName.get(displayKey));
    if (match) return match;
  }

  return null;
}

export function formatAssigneeForSlack(
  assignee: MentionAssigneeInput,
  index: SlackMentionIndex | null | undefined,
  escapeFallback: (text: string) => string,
): string {
  const slackId = resolveSlackUserId(assignee, index);
  if (slackId) {
    return `<@${slackId}>`;
  }
  const fallback = assignee.displayName?.trim() || assignee.username?.trim() || '';
  return fallback ? escapeFallback(fallback) : '';
}

/**
 * Best-effort workspace member fetch via `slack.search_users`.
 * Bounded by a short timeout and swallows non-abort errors (e.g. `missing_scope` on legacy tokens)
 * so scheduled digests continue delivering reliably without `<@U...>` mentions.
 */
export async function fetchSlackMentionIndexSafe(
  slackAdapter: { execute?: (tool: string, args: Record<string, any>, opts?: { signal?: AbortSignal }) => Promise<any> } | null | undefined,
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<SlackMentionIndex | null> {
  if (!slackAdapter || typeof slackAdapter.execute !== 'function') {
    return null;
  }
  const parentSignal = options?.signal;
  if (parentSignal?.aborted) return null;

  const timeoutMs = Math.max(250, options?.timeoutMs ?? 2500);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('SLACK_USERS_TIMEOUT')), timeoutMs);
  timer.unref?.();

  const onParentAbort = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener('abort', onParentAbort, { once: true });

  try {
    const result = await Promise.race([
      slackAdapter.execute('slack.search_users', { query: '', limit: 200 }, { signal: controller.signal }),
      new Promise<null>((resolve) => {
        if (controller.signal.aborted) resolve(null);
        else controller.signal.addEventListener('abort', () => resolve(null), { once: true });
      }),
    ]);
    if (parentSignal?.aborted) return null;
    if (!Array.isArray(result) || result.length === 0) return null;
    return buildSlackMentionIndex(result as SlackUserRef[]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
}
