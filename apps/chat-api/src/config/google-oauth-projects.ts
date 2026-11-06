/** Conservative deny check only; actual client/project ownership needs Cloud readback. */
export function googleOAuthNamespace(clientId: unknown): string | null {
  return typeof clientId === 'string'
    ? /^(\d+)-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.exec(clientId)?.[1] ?? null
    : null;
}

export function assertSeparateGoogleOAuthProjects(clients: Array<{ name: string; clientId: string }>): void {
  const seen = new Map<string, string>();
  for (const { name, clientId } of clients) {
    const namespace = googleOAuthNamespace(clientId);
    if (!namespace) throw new Error(`${name} must use a checkable Google Web OAuth client in live mode`);
    const peer = seen.get(namespace);
    if (peer) throw new Error(`${peer} and ${name} must use separate Google Cloud projects for independent token revocation`);
    seen.set(namespace, name);
  }
}

export function assertGooglePickerProject(clientId: string, appId: string): void {
  const namespace = googleOAuthNamespace(clientId);
  if (!namespace || appId !== namespace) throw new Error('MYSHEETS_PICKER_APP_ID must match the MySheets OAuth client project number; verify both in Google Cloud');
}
