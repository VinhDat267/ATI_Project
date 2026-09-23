export type PilotConfig = {
  enabled: boolean;
  principals: readonly string[];
  spreadsheetId: string;
  tabId: string;
  boardId: string;
  google?: {
    clientEmail?: string;
    privateKey?: string;
    apiKey?: string;
  };
  trello?: {
    apiKey?: string;
    apiToken?: string;
    listId?: string;
  };
};

export function loadPilotConfig(config?: Partial<PilotConfig>): PilotConfig {
  const enabled =
    config?.enabled ??
    (process.env.PILOT_V2_ENABLED === 'true');

  const principals =
    config?.principals ??
    (process.env.PILOT_PRINCIPALS
      ? process.env.PILOT_PRINCIPALS.split(',').map((s) => s.trim()).filter(Boolean)
      : []);

  const spreadsheetId =
    config?.spreadsheetId ?? process.env.PILOT_SPREADSHEET_ID ?? '';
  const tabId = config?.tabId ?? process.env.PILOT_TAB_ID ?? '';
  const boardId = config?.boardId ?? process.env.PILOT_BOARD_ID ?? '';

  const google = {
    clientEmail:
      config?.google?.clientEmail ?? process.env.GOOGLE_SHEETS_CLIENT_EMAIL ?? '',
    privateKey:
      config?.google?.privateKey ?? process.env.GOOGLE_SHEETS_PRIVATE_KEY ?? '',
    apiKey: config?.google?.apiKey ?? process.env.GOOGLE_SHEETS_API_KEY ?? '',
  };

  const trello = {
    apiKey: config?.trello?.apiKey ?? process.env.TRELLO_API_KEY ?? '',
    apiToken: config?.trello?.apiToken ?? process.env.TRELLO_API_TOKEN ?? '',
    listId: config?.trello?.listId ?? process.env.PILOT_TRELLO_LIST_ID ?? '',
  };

  const result: PilotConfig = {
    enabled,
    principals,
    spreadsheetId,
    tabId,
    boardId,
    google,
    trello,
  };

  if (enabled) {
    if (!spreadsheetId.trim() || !tabId.trim() || !boardId.trim()) {
      throw new Error('CONFIG_ERROR: Missing target spreadsheetId, tabId, or boardId');
    }
    if (!principals.length) {
      throw new Error('CONFIG_ERROR: Missing allowed principals list');
    }
    const hasGoogleCreds =
      (google.clientEmail && google.privateKey) || google.apiKey;
    const hasTrelloCreds = trello.apiKey && trello.apiToken;

    if (!hasGoogleCreds) {
      throw new Error('CONFIG_ERROR: Missing Google credentials');
    }
    if (!hasTrelloCreds) {
      throw new Error('CONFIG_ERROR: Missing Trello credentials');
    }
  }

  return result;
}

export function redactSecrets(
  text: string,
  secrets: readonly (string | undefined | null)[],
): string {
  if (!text) return text;
  let sanitized = text;

  // Mask common URL query params like key=... and token=...
  sanitized = sanitized.replace(/([?&](?:key|token|apiKey|apiToken)=)[^&\s]+/gi, '$1[REDACTED]');
  // Mask Bearer tokens
  sanitized = sanitized.replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED]');

  for (const secret of secrets) {
    if (secret && secret.trim().length > 3) {
      sanitized = sanitized.replaceAll(secret, '[REDACTED]');
    }
  }
  return sanitized;
}

export function redactObject<T>(
  target: T,
  secrets: readonly (string | undefined | null)[],
): T {
  if (target === null || typeof target !== 'object') {
    if (typeof target === 'string') {
      return redactSecrets(target, secrets) as unknown as T;
    }
    return target;
  }

  if (target instanceof Date) {
    return target;
  }

  if (Array.isArray(target)) {
    return target.map((item) => redactObject(item, secrets)) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(target as Record<string, unknown>)) {
    result[key] = redactObject(value, secrets);
  }
  return result as T;
}
