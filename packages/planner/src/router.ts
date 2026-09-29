export type TargetService = 'trello' | 'slack';

export function classifyIntent(message: string): TargetService[] {
  const normalized = message.toLowerCase();
  const matched: TargetService[] = [];

  // Trello keywords (including Vietnamese task management keywords)
  const trelloPattern = /\b(trello|card|cards|board|boards|list|lists|checklist|task|tasks|thẻ|deadline|hạn chót|gán)\b/i;
  // Slack keywords (including Vietnamese words)
  const slackPattern = /\b(slack|channel|channels|kênh|tin nhắn|message|notify|thông báo|báo)\b/i;

  if (trelloPattern.test(normalized)) {
    matched.push('trello');
  }
  if (slackPattern.test(normalized)) {
    matched.push('slack');
  }

  // Fallback to both services if ambiguous
  if (matched.length === 0) {
    return ['trello', 'slack'];
  }

  return matched;
}
