/**
 * Telegram digests are sent as plain text (no parse_mode). Several digest
 * builders produce Slack mrkdwn (`*bold*`, `<url|label>`, `&amp;`), which would
 * show up as raw markup in Telegram. Convert that markup into readable text.
 */
export function slackMrkdwnToTelegramPlain(text: string): string {
  return String(text ?? '')
    .split('\n')
    .map((line) =>
      line
        .replace(/^(\s*)&gt;\s?/, '$1')
        .replace(/^(\s*)>\s/, '$1')
        .replace(/<(https?:\/\/[^|>\s]+)\|([^>]+)>/g, (_m, url: string, label: string) => `${label} — ${url}`)
        .replace(/<(https?:\/\/[^|>\s]+)>/g, '$1')
        .replace(/(^|[\s(•\-])\*([^*\n]+?)\*(?=$|[\s:).,!?])/g, '$1$2')
        .replace(/(^|[\s(])_([^\s_][^\n]*?)_(?=$|[\s:).,!?])/g, '$1$2')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&'),
    )
    .join('\n');
}
