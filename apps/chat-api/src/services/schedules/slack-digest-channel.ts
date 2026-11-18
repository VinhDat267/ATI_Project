/** A trailing period belongs to the sentence, not the Slack channel hint. */
export function extractSlackDigestChannelHint(request: string): string {
  const match = request.match(/#([a-z0-9._-]+)/i) ??
    request.match(/(?:kênh|channel|slack)\s+#?([a-z0-9._-]+)/i);
  return match?.[1]?.replace(/\.+$/, '') ?? '';
}
